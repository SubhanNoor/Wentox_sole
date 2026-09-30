// Payments (Naam) — the shared Posted/Unposted workflow (see harness.browseFilterScenario), over
// whole payment VOUCHERS: Posted walks fully-posted ones, Unposted walks the rest.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const expenseVouchersService = require('../src/services/expenseVouchers.service');
const draftExpensesService = require('../src/services/draftExpenses.service');
const { makeCustomer } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Every payment line of this test's customer (posted or draft), the vouchers holding them, then
// the customer.
async function removeExpenses({ customer, region }) {
  const params = { baId: customer.ba_id };
  const vouchers = (await query(`SELECT voucher_id FROM dbo.expenses WHERE ba_id = @baId AND voucher_id IS NOT NULL
    UNION SELECT voucher_id FROM dbo.draft_expenses WHERE ba_id = @baId AND voucher_id IS NOT NULL`, params)).recordset;
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'EXPENSE'
    AND source_id IN (SELECT expense_id FROM dbo.expenses WHERE ba_id = @baId)`, params);
  await query('DELETE FROM dbo.expenses WHERE ba_id = @baId', params);
  await query('DELETE FROM dbo.draft_expenses WHERE ba_id = @baId', params);
  for (const { voucher_id: id } of vouchers) {
    await query('DELETE FROM dbo.expense_vouchers WHERE voucher_id = @id', { id });
  }
  await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
}

test('Payments: dropdown follows the voucher on screen through Posted, New, Post and Unpost', (t) =>
  h.browseFilterScenario(t, {
    menuLabel: 'PAYMENTS (NAAM)',
    async setup() {
      const fx = await makeCustomer();
      t.after(() => removeExpenses(fx));
      const voucherWithLine = async () => {
        const voucher = await expenseVouchersService.create({ voucher_date: '2026-09-30' }, null);
        await draftExpensesService.create({
          voucher_id: voucher.voucher_id, ba_id: fx.customer.ba_id, expense_date: '2026-09-30', amount: 500, payment_mode: 'CASH',
        }, null, undefined);
        return voucher;
      };
      // Expense-voucher posting reads session.userId — the app always passes the logged-in session.
      const result = await expenseVouchersService.post((await voucherWithLine()).voucher_id, { userId: null, role: 'ADMIN' });
      assert.equal(result.failed?.length ?? 0, 0, `fixture voucher should post: ${JSON.stringify(result.failed)}`);
      await voucherWithLine();
    },
  }));

test.after(() => closePool());
