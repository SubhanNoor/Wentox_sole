// Receipts and Payments: Post, Un Post, Print, PDF and Excel follow the Journal Voucher's rule
// (per the user, 2026-11-13) — they act only on a saved voucher that is read-only. With the entry
// row open for another entry they are greyed out (Post used to stay live there, and posting dropped
// whatever was half-typed); Done on the empty entry row makes the voucher read-only again.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const expenseVouchersService = require('../src/services/expenseVouchers.service');
const draftExpensesService = require('../src/services/draftExpenses.service');
const { makeCustomer } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Far-future date so the voucher is the newest unposted one — the one the Unposted list opens.
const DATE = '2099-12-29';
const READ_ONLY_ACTIONS = ['Post', 'Print', 'PDF', 'Excel'];

async function enabledStates(page, labels) {
  const out = {};
  for (const label of labels) out[label] = await h.toolbar(page, label).isEnabled();
  return out;
}

async function scenario(t, { menuLabel, makeVoucher }) {
  const fx = await makeCustomer();
  await makeVoucher(t, fx);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', menuLabel)).click());
  await h.chooseFilter(page, 'unposted');
  await page.locator('tbody tr', { hasText: fx.customer.name }).first().waitFor({ timeout: 10000 });

  const all = (value) => Object.fromEntries(READ_ONLY_ACTIONS.map((l) => [l, value]));
  const statesNow = async (want) => {
    const got = await enabledStates(page, READ_ONLY_ACTIONS);
    return JSON.stringify(got) === JSON.stringify(want) ? want : got;
  };

  // Opened read-only: the voucher can be posted, printed and exported.
  assert.deepEqual(await h.eventually(() => statesNow(all(true)), all(true)), all(true), 'read-only voucher');
  assert.equal(await h.toolbar(page, 'Un Post').isEnabled(), false, 'an unposted voucher has nothing to Un Post');

  // Detail + New opens the entry row for another entry: all of them grey out, as on the JV.
  await page.getByRole('radio', { name: 'Detail' }).check();
  await h.click(page, 'New');
  assert.deepEqual(await h.eventually(() => statesNow(all(false)), all(false)), all(false), 'entry row open');
  assert.equal(await h.toolbar(page, 'Un Post').isEnabled(), false);

  // Done on the empty entry row = finished with this voucher: read-only, and Post is back.
  await h.click(page, 'Done');
  assert.deepEqual(await h.eventually(() => statesNow(all(true)), all(true)), all(true), 'after Done');
}

test('Receipts: Post / Print / PDF / Excel only on a read-only voucher, like the Journal Voucher', (t) =>
  scenario(t, {
    menuLabel: 'RECEIPTS (JAMMA)',
    async makeVoucher(t, { customer, region }) {
      const voucher = await receiptVouchersService.create({ voucher_date: DATE }, null);
      t.after(async () => {
        await query('DELETE FROM dbo.draft_receipts WHERE ba_id = @baId', { baId: customer.ba_id });
        await query('DELETE FROM dbo.receipt_vouchers WHERE voucher_id = @id', { id: voucher.voucher_id });
        await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
      });
      await draftReceiptsService.create({
        voucher_id: voucher.voucher_id, ba_id: customer.ba_id, receipt_date: DATE, amount: 700, payment_mode: 'CASH',
      }, null, undefined);
    },
  }));

test('Payments: Post / Print / PDF / Excel only on a read-only voucher, like the Journal Voucher', (t) =>
  scenario(t, {
    menuLabel: 'PAYMENTS (NAAM)',
    async makeVoucher(t, { customer, region }) {
      const voucher = await expenseVouchersService.create({ voucher_date: DATE }, null);
      t.after(async () => {
        await query('DELETE FROM dbo.draft_expenses WHERE ba_id = @baId', { baId: customer.ba_id });
        await query('DELETE FROM dbo.expense_vouchers WHERE voucher_id = @id', { id: voucher.voucher_id });
        await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
      });
      await draftExpensesService.create({
        voucher_id: voucher.voucher_id, ba_id: customer.ba_id, expense_date: DATE, amount: 500, payment_mode: 'CASH',
      }, null, undefined);
    },
  }));

test.after(() => closePool());
