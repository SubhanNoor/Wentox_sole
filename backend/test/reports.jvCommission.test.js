// Sale Report Commission = receipt commission + JV commission (per the user, 2026-11-23). A JV
// counts when it has a line on the DISCOUNTS, CLAIMS & COMMISSIONS (400008) account — the client
// gives commission that way ("LESS" lines) — and only once posted. Net Sales goes down with it;
// Sale Analysis (which adds receipt commission to Payment Received) is left untouched.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const journalVouchersService = require('../src/services/journalVouchers.service');
const reportsService = require('../src/services/reports.service');
const { setupChequeFixtures } = require('../testlib/fixtures');

const DAY = '2026-02-13';
const RANGE = { date_from: DAY, date_to: DAY };

test('Sale Report: a posted JV against DISCOUNTS, CLAIMS & COMMISSIONS is commission; other JVs are not', async (t) => {
  const jvIds = [];
  // Registered BEFORE the fixture, so it runs first — the fixture deletes the accounts these lines name.
  t.after(async () => {
    for (const id of jvIds) {
      await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'JOURNAL_VOUCHER' AND source_id = @id", { id });
      await query('DELETE FROM dbo.journal_vouchers WHERE jv_id = @id', { id });
    }
  });
  const { customer, bank } = await setupChequeFixtures(t);
  const dcc = await journalVouchersService.getCounterAccount();

  const makeJv = async (lines) => {
    const jv = await journalVouchersService.create({ jv_date: DAY, lines }, null, undefined);
    jvIds.push(jv.jv_id);
    return jv.jv_id;
  };
  const commissionJv = await makeJv([
    { ba_id: customer.ba_id, debit: 0, credit: 3000 },
    { ba_id: dcc.ba_id, debit: 3000, credit: 0 },
  ]);
  const bankJv = await makeJv([
    { ba_id: customer.ba_id, debit: 0, credit: 500 },
    { ba_id: bank.ba_id, debit: 500, credit: 0 },
  ]);
  await journalVouchersService.post(bankJv, null, undefined);

  const rowFor = async () => (await reportsService.saleReport(RANGE)).find((r) => r.customer_id === customer.customer_id);

  assert.equal((await rowFor())?.commission ?? 0, 0, 'an unposted commission JV and a JV against a bank are not commission');

  await journalVouchersService.post(commissionJv, null, undefined);
  const row = await rowFor();
  assert.equal(row.commission, 3000, 'the posted JV against DISCOUNTS, CLAIMS & COMMISSIONS is');
  assert.equal(row.net_sales, row.total_sales - 3000 - row.sale_return, 'Net Sales goes down with it');

  const analysis = (await reportsService.saleAnalysis(RANGE)).find((r) => r.customer_id === customer.customer_id);
  assert.equal(analysis?.total_commission ?? 0, 0, 'Sale Analysis still counts receipt commission only');
});

test.after(async () => {
  await closePool();
});
