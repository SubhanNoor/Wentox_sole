// Regression suite for the highest blast-radius, highest-churn area in the whole bug history
// (System_architecture/testing_priority_plan.md Top 8 #2): Sale Bill create -> post -> unpost ->
// edit-while-posted. Covers, concretely:
//   - 2026-09-20: ledger_entries.pairs was never populated for Sale Bill postings (always NULL).
//   - the "stock reserved at save time, not at post time" architecture (create() writes a negative
//     stock_movements row immediately; post()/unpost() only ever touch ledger_entries).
//   - editing an already-posted bill reconciling BOTH ledger_entries and stock_movements to the
//     new totals, not just one of the two.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const saleBillsService = require('../src/services/saleBills.service');
const { setupSaleFixtures, uniqueName } = require('../testlib/fixtures');

async function ledgerRowsFor(billId) {
  const result = await query(
    "SELECT debit, credit, pairs FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL' AND source_id = @id ORDER BY entry_id",
    { id: billId },
  );
  return result.recordset;
}

async function stockRowsFor(billId) {
  const result = await query(
    "SELECT qty_pairs FROM dbo.stock_movements WHERE source_type = 'SALE_BILL' AND source_id = @id",
    { id: billId },
  );
  return result.recordset;
}

test('Sale Bill: create reserves stock immediately but posts no ledger', async (t) => {
  const { store, customer, variant, created } = await setupSaleFixtures(t);

  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;

  assert.equal(bill.total_pairs, 24, '2 cartons at packing 12 should be 24 pairs');
  assert.equal(Number(bill.net_value), 2400);
  assert.equal(bill.is_posted, false);

  const stockRows = await stockRowsFor(bill.bill_id);
  assert.equal(stockRows.length, 1, 'create() should reserve stock immediately, before any post()');
  assert.equal(Number(stockRows[0].qty_pairs), -24);

  const ledgerRows = await ledgerRowsFor(bill.bill_id);
  assert.equal(ledgerRows.length, 0, 'an unposted bill must not have written any ledger rows yet');
});

test('Sale Bill: post() writes a balanced ledger pair with pairs populated on both legs', async (t) => {
  const { store, customer, variant, created } = await setupSaleFixtures(t);

  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;

  const posted = await saleBillsService.post(bill.bill_id);
  assert.equal(posted.is_posted, true);

  const ledgerRows = await ledgerRowsFor(bill.bill_id);
  assert.equal(ledgerRows.length, 2, 'post() should write exactly one debit/credit pair');

  const totalDebit = ledgerRows.reduce((sum, r) => sum + Number(r.debit), 0);
  const totalCredit = ledgerRows.reduce((sum, r) => sum + Number(r.credit), 0);
  assert.equal(totalDebit, 2400);
  assert.equal(totalCredit, 2400);

  // Regression check for the 2026-09-20 bug: both legs must carry the bill's total pairs, not NULL.
  for (const row of ledgerRows) {
    assert.equal(Number(row.pairs), 24, 'every SALE_BILL ledger leg must carry the bill total_pairs, not NULL/0');
  }
});

test('Sale Bill: unpost() removes the ledger pair but leaves the stock reservation untouched', async (t) => {
  const { store, customer, variant, created } = await setupSaleFixtures(t);

  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;

  await saleBillsService.post(bill.bill_id);
  const unposted = await saleBillsService.unpost(bill.bill_id);
  assert.equal(unposted.is_posted, false);

  assert.equal((await ledgerRowsFor(bill.bill_id)).length, 0, 'unpost() must remove the ledger pair entirely');

  const stockRows = await stockRowsFor(bill.bill_id);
  assert.equal(stockRows.length, 1, 'unpost() must NOT touch stock — stock stays reserved from create() regardless of posted status');
  assert.equal(Number(stockRows[0].qty_pairs), -24);
});

test('Sale Bill: editing an already-posted bill reconciles both ledger and stock to the new totals', async (t) => {
  const { store, customer, variant, created } = await setupSaleFixtures(t);
  const billNo = uniqueName('BILL');

  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: billNo,
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;
  await saleBillsService.post(bill.bill_id);

  // Bump from 2 cartons (24 pairs / 2400) to 3 cartons (36 pairs / 3600) while posted.
  const updated = await saleBillsService.update(bill.bill_id, {
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: billNo,
    items: [{ variant_id: variant.variant_id, cartons: 3, rate: 100, discount_percent: 0 }],
  });

  assert.equal(updated.is_posted, true, 'update() on a posted bill must re-post it, not leave it unposted');
  assert.equal(updated.total_pairs, 36);
  assert.equal(Number(updated.net_value), 3600);

  const stockRows = await stockRowsFor(bill.bill_id);
  assert.equal(stockRows.length, 1, 'the old 24-pair reservation must be replaced, not left alongside the new one');
  assert.equal(Number(stockRows[0].qty_pairs), -36);

  const ledgerRows = await ledgerRowsFor(bill.bill_id);
  assert.equal(ledgerRows.length, 2);
  const totalDebit = ledgerRows.reduce((sum, r) => sum + Number(r.debit), 0);
  assert.equal(totalDebit, 3600, 'the old 2400 ledger pair must be replaced, not left alongside the new one');
  for (const row of ledgerRows) {
    assert.equal(Number(row.pairs), 36, 'edited-while-posted ledger legs must also carry the NEW total_pairs');
  }
});

test.after(async () => {
  await closePool();
});
