// Regression (2026-11-05, per the user): the Cash Book left out direct settlements unless one side
// happened to be a bank — a customer -> vendor settlement, posted or not, never showed — and it
// printed journal vouchers, which are ledger adjustments, not money handed over.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const settlementsService = require('../src/services/settlements.service');
const journalVouchersService = require('../src/services/journalVouchers.service');
const reportsService = require('../src/services/reports.service');
const { setupChequeFixtures, uniqueName } = require('../testlib/fixtures');

const DAY = '2026-02-11';
const bookFor = () => reportsService.cashBook({ date_from: DAY, date_to: DAY });

test('cash book: a customer -> vendor settlement shows unposted and posted, with its mode and cheque no', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const chequeNo = uniqueName('STL').slice(0, 20);
  const settlement = await settlementsService.create({
    settlement_date: DAY, from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id, amount: 4321,
    payment_mode: 'CHEQUE', cheque_no: chequeNo, cheque_date: DAY,
  }, null, undefined);
  created.settlementId = settlement.settlement_id;

  const rowsOf = (book) => book.rows.filter((r) => r.source_type === 'SETTLEMENT' && r.source_id === settlement.settlement_id);
  const check = (rows, posted) => {
    const label = posted ? 'posted' : 'unposted';
    assert.equal(rows.length, 2, `${label}: a FROM and a TO row`);
    assert.deepEqual(rows.map((r) => [r.side, r.account_name]), [['FROM', customer.name], ['TO', vendor.name]], `${label}: FROM the debtor TO the creditor`);
    assert.ok(rows.every((r) => r.is_posted === posted && r.mode === 'CHEQUE' && r.cheque_no === chequeNo), `${label}: flagged and labelled from the settlement`);
    assert.equal(rows[0].receipt_bank + rows[1].receipt_bank, 4321);
    assert.equal(rows[0].payment_bank + rows[1].payment_bank, 4321);
  };

  const before = await bookFor();
  check(rowsOf(before), false);

  await settlementsService.post(settlement.settlement_id, null, undefined);
  const after = await bookFor();
  check(rowsOf(after), true);
  assert.equal(after.cash_in_hand, before.cash_in_hand, 'a settlement never moves the cash drawer');
});

test('cash book: a posted journal voucher is not printed', async (t) => {
  // Registered BEFORE the fixture, so it runs first — the fixture deletes the accounts these lines name.
  let jvId = null;
  t.after(async () => {
    if (jvId == null) return;
    await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'JOURNAL_VOUCHER' AND source_id = @id", { id: jvId });
    await query('DELETE FROM dbo.journal_vouchers WHERE jv_id = @id', { id: jvId });
  });
  // Against a bank, like the client's own JVs — a JV touching no money account never showed anyway.
  const { customer, bank } = await setupChequeFixtures(t);
  const jv = await journalVouchersService.create({
    jv_date: DAY,
    lines: [
      { ba_id: customer.ba_id, debit: 0, credit: 2500 },
      { ba_id: bank.ba_id, debit: 2500, credit: 0 },
    ],
  }, null, undefined);
  jvId = jv.jv_id;
  await journalVouchersService.post(jv.jv_id, null, undefined);

  const ledger = await query("SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = 'JOURNAL_VOUCHER' AND source_id = @id", { id: jv.jv_id });
  assert.equal(ledger.recordset[0].n, 2, 'the JV is on the ledger');
  const book = await bookFor();
  assert.ok(!book.rows.some((r) => r.source_type === 'JOURNAL_VOUCHER'), 'but not in the Cash Book');
});

test.after(async () => {
  await closePool();
});
