// Regression: one action on a cheque writes one entry, the Cash Book prints each action on its own
// day only, and nothing a double click or retry does can post a second set of rows.
//
//   - 2026-10-23: endorsing two cheques that had bounced back to their customers printed FOUR Cash
//     Book entries — the re-credit (cheques.service.js#recreditIfBounced) and the endorsement, both
//     dated that day. The re-credit is now ledger_entries.is_internal (migration 045): kept on the
//     ledgers, skipped by the Cash Book.
//   - 2026-10-24: every money action on a cheque, and post/unpost of receipts/expenses/transfers,
//     checked status on a pool read BEFORE its transaction, so two simultaneous calls both posted.
//   - 2026-10-24: the Cash Book's Cheques Deposited panel dropped a deposit from its own day once
//     a later bounce reversed it.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const chequesService = require('../src/services/cheques.service');
const expensesService = require('../src/services/expenses.service');
const reportsService = require('../src/services/reports.service');
const { setupChequeFixtures, makeVendor, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function balanceOf(baId) {
  const result = await query(
    'SELECT ISNULL(SUM(debit), 0) - ISNULL(SUM(credit), 0) AS net FROM dbo.ledger_entries WHERE ba_id = @baId',
    { baId },
  );
  return Number(result.recordset[0].net);
}

async function receiptLedgerRowCount(receiptId) {
  const result = await query(
    "SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type IN ('RECEIPT', 'COMMISSION') AND source_id = @id",
    { id: receiptId },
  );
  return result.recordset[0].n;
}

async function postedChequeReceipt(customer, created, { amount, date }) {
  const chequeNo = uniqueName('CHQ');
  const receipt = await receiptsService.create({
    ba_id: customer.ba_id, receipt_date: date, amount, payment_mode: 'CHEQUE',
    cheque_no: chequeNo, cheque_date: date,
  }, null, undefined);
  created.receiptId = receipt.receipt_id;
  await receiptsService.post(receipt.receipt_id, undefined);
  const posted = await receiptsService.getById(receipt.receipt_id);
  return { receiptId: receipt.receipt_id, chequeId: posted.cheque_id, chequeNo };
}

// The Cash Book's posted entries for ONE cheque on ONE day, as their remarks, one per entry.
async function bookEntriesFor(chequeNo, date) {
  const book = await reportsService.cashBook({ date_from: date, date_to: date });
  return book.rows.filter((r) => r.cheque_no === chequeNo && r.is_first_of_txn).map((r) => r.remarks);
}

test('normal endorse: one entry on its day, vendor debited once', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { chequeId, chequeNo } = await postedChequeReceipt(customer, created, { amount: 7000, date: '2026-02-01' });

  await chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: '2026-02-03' }, null, undefined);

  const entries = await bookEntriesFor(chequeNo, '2026-02-03');
  assert.equal(entries.length, 1, `one entry for one endorsement, got: ${entries.join(' | ')}`);
  assert.equal(await balanceOf(vendor.ba_id), 7000);
  assert.equal(await balanceOf(customer.ba_id), -7000);
});

test('endorse then return: each on its own day, vendor nets to zero, customer keeps one credit', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { chequeId, chequeNo, receiptId } = await postedChequeReceipt(customer, created, { amount: 9000, date: '2026-02-05' });
  await chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: '2026-02-10' }, null, undefined);
  const { allocation_id: allocationId } = (await query(
    'SELECT allocation_id FROM dbo.cheque_allocations WHERE receipt_id = @id', { id: receiptId },
  )).recordset[0];

  await chequesService.reverseAllocation(allocationId, { date: '2026-02-15' }, null);

  const day10 = await bookEntriesFor(chequeNo, '2026-02-10');
  const day15 = await bookEntriesFor(chequeNo, '2026-02-15');
  assert.equal(day10.length, 1, `10th: the endorsement only, got: ${day10.join(' | ')}`);
  assert.ok(/to vendor/.test(day10[0]));
  assert.equal(day15.length, 1, `15th: the return only, got: ${day15.join(' | ')}`);
  assert.ok(/Endorsement reversal/.test(day15[0]));
  assert.equal(await balanceOf(vendor.ba_id), 0, 'the vendor is credited back exactly what it was debited');
  assert.equal(await balanceOf(customer.ba_id), -9000, 'the customer still has exactly one credit');
});

test('received, bounced back to the customer, reissued to another party later: the later day shows only the reissue', async (t) => {
  const { customer, vendor: xyz, created } = await setupChequeFixtures(t);
  const abc = await makeVendor();
  t.after(() => cleanupFixtures({ vendorId: abc.vendor_id }));
  const { chequeId, chequeNo, receiptId } = await postedChequeReceipt(customer, created, { amount: 50000, date: '2026-02-08' });

  // With XYZ, back from XYZ (one step), back from the customer (full bounce) — then on to ABC.
  await chequesService.endorseToVendor(chequeId, { vendor_id: xyz.vendor_id, allocation_date: '2026-02-09' }, null, undefined);
  await chequesService.bounce(chequeId, { bounced_date: '2026-02-10' }, null);
  await chequesService.bounce(chequeId, { bounced_date: '2026-02-10' }, null);
  assert.equal((await chequesService.getById(chequeId)).cheque_status, 'BOUNCED');
  await chequesService.endorseToVendor(chequeId, { vendor_id: abc.vendor_id, allocation_date: '2026-02-15' }, null, undefined);

  const day15 = await bookEntriesFor(chequeNo, '2026-02-15');
  assert.equal(day15.length, 1, `15th: the hand-over to ABC only, got: ${day15.join(' | ')}`);
  assert.ok(/to vendor/.test(day15[0]));
  const day10 = await bookEntriesFor(chequeNo, '2026-02-10');
  assert.ok(day10.length >= 1 && day10.every((n) => /reversal/i.test(n)), `10th: the bounces only, got: ${day10.join(' | ')}`);

  // The re-credit is still on the books — just not printed as a movement.
  const internal = (await query(
    "SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = 'RECEIPT' AND source_id = @id AND is_internal = 1",
    { id: receiptId },
  )).recordset[0].n;
  assert.equal(internal, 2, 'the re-credit pair is written, flagged internal');

  assert.equal(await balanceOf(xyz.ba_id), 0, 'XYZ: as if the cheque never went there');
  assert.equal(await balanceOf(abc.ba_id), 50000, 'ABC: only the reissue');
  assert.equal(await balanceOf(customer.ba_id), -50000, 'customer: credited once, not twice');
});

test('repeated reversals: two simultaneous Return-to-sender calls reverse the receipt once', async (t) => {
  const { customer, created } = await setupChequeFixtures(t);
  const { chequeId, receiptId } = await postedChequeReceipt(customer, created, { amount: 4000, date: '2026-02-12' });

  const results = await Promise.allSettled([
    chequesService.returnToSender(chequeId, { returned_date: '2026-02-13', reason: 'twice' }, null),
    chequesService.returnToSender(chequeId, { returned_date: '2026-02-13', reason: 'twice' }, null),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one return succeeds');
  assert.equal(await receiptLedgerRowCount(receiptId), 4, 'the original pair and ONE reversal pair');
  assert.equal(await balanceOf(customer.ba_id), 0);
});

test('repeated reversals: undoing the same endorsement twice at once posts one reversal', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { chequeId, receiptId } = await postedChequeReceipt(customer, created, { amount: 3000, date: '2026-02-12' });
  await chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: '2026-02-13' }, null, undefined);
  const { allocation_id: allocationId } = (await query(
    'SELECT allocation_id FROM dbo.cheque_allocations WHERE receipt_id = @id', { id: receiptId },
  )).recordset[0];

  const results = await Promise.allSettled([
    chequesService.reverseAllocation(allocationId, { date: '2026-02-14' }, null),
    chequesService.reverseAllocation(allocationId, { date: '2026-02-14' }, null),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await balanceOf(vendor.ba_id), 0, 'credited back once, not twice');
});

test('double click on Endorse: a cheque is never handed over twice', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { chequeId, receiptId } = await postedChequeReceipt(customer, created, { amount: 6000, date: '2026-02-16' });

  const results = await Promise.allSettled([
    chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: '2026-02-17' }, null, undefined),
    chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: '2026-02-17' }, null, undefined),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const active = (await query(
    "SELECT COUNT(*) AS n FROM dbo.cheque_allocations WHERE receipt_id = @id AND status = 'ACTIVE'", { id: receiptId },
  )).recordset[0].n;
  assert.equal(active, 1);
  assert.equal(await balanceOf(vendor.ba_id), 6000);
});

test('double click on Post: a receipt is posted once', async (t) => {
  const { customer, created } = await setupChequeFixtures(t);
  const receipt = await receiptsService.create({
    ba_id: customer.ba_id, receipt_date: '2026-02-18', amount: 2500, payment_mode: 'CHEQUE',
    cheque_no: uniqueName('CHQ'), cheque_date: '2026-02-18',
  }, null, undefined);
  created.receiptId = receipt.receipt_id;

  const results = await Promise.allSettled([
    receiptsService.post(receipt.receipt_id, undefined),
    receiptsService.post(receipt.receipt_id, undefined),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await receiptLedgerRowCount(receipt.receipt_id), 2);
  assert.equal(await balanceOf(customer.ba_id), -2500);
});

test('double click on Bounce for a cheque we issued: the payee is credited back once', async (t) => {
  const { vendor, bank, created } = await setupChequeFixtures(t);
  const expense = await expensesService.create({
    ba_id: vendor.ba_id, expense_date: '2026-02-19', amount: 8000, payment_mode: 'CHEQUE_ISSUED',
    bank_id: bank.bank_id, issued_cheque_no: uniqueName('ISS'), issued_cheque_date: '2026-02-19',
  }, null, undefined);
  created.expenseId = expense.expense_id;
  await expensesService.post(expense.expense_id, null, undefined);

  const results = await Promise.allSettled([
    expensesService.bounceIssuedCheque(expense.expense_id, { bounced_date: '2026-02-20' }, null),
    expensesService.bounceIssuedCheque(expense.expense_id, { bounced_date: '2026-02-20' }, null),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await balanceOf(vendor.ba_id), 0, 'paid once, credited back once');
});

test('a receipt whose cheque has history cannot be unposted (its reversals would be erased)', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { chequeId, receiptId } = await postedChequeReceipt(customer, created, { amount: 1500, date: '2026-02-21' });
  await chequesService.endorseToVendor(chequeId, { vendor_id: vendor.vendor_id, allocation_date: '2026-02-22' }, null, undefined);
  const { allocation_id: allocationId } = (await query(
    'SELECT allocation_id FROM dbo.cheque_allocations WHERE receipt_id = @id', { id: receiptId },
  )).recordset[0];
  await chequesService.reverseAllocation(allocationId, { date: '2026-02-23' }, null);
  assert.equal((await chequesService.getById(chequeId)).cheque_status, 'PENDING');

  await assert.rejects(receiptsService.unpost(receiptId, undefined), (err) => err.code === 'CHEQUE_IN_USE');
});

test('Cheques Deposited panel: a deposit stays on its own day after a later bounce', async (t) => {
  const { customer, bank, created } = await setupChequeFixtures(t);
  const { chequeId, chequeNo } = await postedChequeReceipt(customer, created, { amount: 11000, date: '2026-02-24' });
  await chequesService.deposit(chequeId, { bank_id: bank.bank_id, allocation_date: '2026-02-25' }, null, undefined);
  await chequesService.bounce(chequeId, { bounced_date: '2026-02-27' }, null);

  const book = await reportsService.cashBook({ date_from: '2026-02-25', date_to: '2026-02-25' });
  assert.ok(book.cheque_deposits.some((d) => d.cheque_no === chequeNo), 'the 25th still lists the deposit');
});

test.after(async () => {
  await closePool();
});
