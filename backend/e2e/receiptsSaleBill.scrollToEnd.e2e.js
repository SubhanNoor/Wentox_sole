// A document with enough lines to scroll opens at the BOTTOM of its lines, posted or unposted — the
// user scrolls up for the earlier ones (per the user, 2026-11-26). Receipts and Sale Bill.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const draftSaleBillsService = require('../src/services/draftSaleBills.service');
const { makeCustomer, setupSaleFixtures, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const LINES = 40;

// Pixels left below the visible part of the 40-line grid; null until it is there and scrollable.
const gap = (page) => page.evaluate((n) => {
  const body = [...document.querySelectorAll('tbody')].find((b) => b.offsetParent && b.querySelectorAll('tr').length >= n);
  let el = body && body.parentElement;
  while (el && !(el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  return el ? Math.round(el.scrollHeight - el.clientHeight - el.scrollTop) : null;
}, LINES);

async function assertAtBottom(page, what) {
  const ok = await h.eventually(async () => { const g = await gap(page); return g != null && g <= 2; }, true, 10000);
  assert.equal(ok, true, `${what}: should open at the last line (pixels below: ${await gap(page)})`);
}

async function open(t, opener) {
  const session = await h.launchApp();
  t.after(() => session.close());
  await h.login(session.win);
  return h.openInNewWindow(session.app, () => opener(session.win));
}

test('Receipts: a long voucher opens at its last entry, unposted and posted', async (t) => {
  const { customer, region } = await makeCustomer();
  t.after(async () => {
    const params = { baId: customer.ba_id };
    const ids = (await query(`SELECT voucher_id FROM dbo.receipts WHERE ba_id = @baId AND voucher_id IS NOT NULL
      UNION SELECT voucher_id FROM dbo.draft_receipts WHERE ba_id = @baId AND voucher_id IS NOT NULL`, params)).recordset;
    await query(`DELETE FROM dbo.ledger_entries WHERE source_type IN ('RECEIPT', 'COMMISSION')
      AND source_id IN (SELECT receipt_id FROM dbo.receipts WHERE ba_id = @baId)`, params);
    await query('DELETE FROM dbo.receipts WHERE ba_id = @baId', params);
    await query('DELETE FROM dbo.draft_receipts WHERE ba_id = @baId', params);
    for (const { voucher_id: id } of ids) await query('DELETE FROM dbo.receipt_vouchers WHERE voucher_id = @id', { id });
    await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
  });
  const voucher = async () => {
    const v = await receiptVouchersService.create({ voucher_date: '2026-09-30' }, null);
    for (let i = 1; i <= LINES; i++) {
      await draftReceiptsService.create({
        voucher_id: v.voucher_id, ba_id: customer.ba_id, receipt_date: '2026-09-30', amount: i, payment_mode: 'CASH',
      }, null, undefined);
    }
    return v;
  };
  await receiptVouchersService.post((await voucher()).voucher_id, null, undefined);
  await voucher();

  const page = await open(t, async (win) => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click());
  await assertAtBottom(page, 'unposted voucher');
  await h.chooseFilter(page, 'posted');
  await assertAtBottom(page, 'posted voucher');
  await h.chooseFilter(page, 'unposted');
  await assertAtBottom(page, 'unposted voucher, back again');
});

test('Sale Bill: a long bill opens at its last line, unposted and posted', async (t) => {
  const cleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => cleanup.push(fn) });
  t.after(async () => {
    const params = { customerId: fx.customer.customer_id, variantId: fx.variant.variant_id };
    await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL'
      AND source_id IN (SELECT bill_id FROM dbo.sale_bills WHERE customer_id = @customerId)`, params);
    await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
    await query('DELETE FROM dbo.sale_bills WHERE customer_id = @customerId', params);
    await query(`DELETE FROM dbo.draft_sale_bill_items
      WHERE draft_id IN (SELECT draft_id FROM dbo.draft_sale_bills WHERE customer_id = @customerId)`, params);
    await query('DELETE FROM dbo.draft_sale_bills WHERE customer_id = @customerId', params);
    for (const fn of cleanup) await fn();
  });
  const draft = () => draftSaleBillsService.create({
    bill_date: '2026-09-30', store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no: uniqueName('E2E'),
    items: Array.from({ length: LINES }, (_, i) => ({ variant_id: fx.variant.variant_id, cartons: 1, rate: 100 + i, discount_percent: 0 })),
  }, null);
  await draftSaleBillsService.confirm((await draft()).draft_id, null);
  await draft();

  const page = await open(t, (win) => h.quickMenu(win, 'Sale Bill').click());
  await assertAtBottom(page, 'unposted bill');
  await h.chooseFilter(page, 'posted');
  await assertAtBottom(page, 'posted bill');
  await h.chooseFilter(page, 'unposted');
  await assertAtBottom(page, 'unposted bill, back again');
});

test.after(() => closePool());
