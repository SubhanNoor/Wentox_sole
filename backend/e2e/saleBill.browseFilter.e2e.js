// Sale Bill's Posted/Unposted dropdown must always describe the bill actually on screen, and New
// must stay usable — regressions reported/found 2026-09-30:
//   - picking Posted as the page opened was undone by the page's own auto-open of the newest draft;
//   - after posting a bill that stays on screen, New was greyed out (New used to be disabled on
//     Posted);
//   - New / Unpost must land back on Unposted.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftSaleBillsService = require('../src/services/draftSaleBills.service');
const { setupSaleFixtures, uniqueName } = require('../testlib/fixtures');

// Bills made through the screens (posted, unposted, re-drafted) aren't tracked by the fixture
// tracker, and they block deleting its customer — so remove every sale document of this test's
// own customer, and all stock of its own variant, before the fixture cleanup runs.
async function removeSaleDocuments({ customer, variant }) {
  const params = { customerId: customer.customer_id, variantId: variant.variant_id };
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL'
    AND source_id IN (SELECT bill_id FROM dbo.sale_bills WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
  await query('DELETE FROM dbo.sale_bills WHERE customer_id = @customerId', params); // cascades items
  await query(`DELETE FROM dbo.draft_sale_bill_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_sale_bills WHERE customer_id = @customerId)`, params);
  await query('DELETE FROM dbo.draft_sale_bills WHERE customer_id = @customerId', params);
}

function draftFor({ store, customer, variant }) {
  return draftSaleBillsService.create({
    bill_date: '2026-09-30',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('E2E'),
    items: [{ variant_id: variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 }],
  }, null);
}

test('Sale Bill: dropdown follows the bill on screen through Posted, New, Post and Unpost', async (t) => {
  // Fixture cleanup is collected here and run AFTER removeSaleDocuments — t.after hooks run in
  // registration order, so handing setupSaleFixtures the real `t` would delete the customer first.
  const fixtureCleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => fixtureCleanup.push(fn) });
  t.after(async () => {
    await removeSaleDocuments(fx);
    for (const fn of fixtureCleanup) await fn();
  });
  // One posted bill (made the way the app makes one: a draft, then Post) and one draft left
  // unposted — so neither list is empty and nothing auto-resets the page on reopen.
  const toPost = await draftFor(fx);
  await draftSaleBillsService.confirm(toPost.draft_id, null);
  await draftFor(fx);

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);

  const open = () => h.openInNewWindow(app, () => h.quickMenu(win, 'Sale Bill').click());

  let page = await open();
  assert.equal(await page.evaluate(() => window.__sawLogin), false, 'a new window must never show the Login page');

  // Posted, picked straight away → the latest posted bill opens for browsing.
  await h.chooseFilter(page, 'posted');
  assert.equal(await h.eventually(h.isEnabled(page, 'Un Post'), true), true, 'a posted bill should be on screen');

  // Choosing Posted right as the page opens must stick — the page's own auto-open of the newest
  // draft used to finish afterwards and replace the posted bill (found by this test, 2026-09-30).
  await page.waitForTimeout(2000);
  assert.equal(await h.filterValue(page)(), 'posted', 'the page auto-open must not undo the Posted choice');
  assert.equal(await h.isEnabled(page, 'Un Post')(), true, 'the posted bill must still be on screen');

  // New works from Posted and returns to Unposted (a blank bill is an unposted one).
  assert.equal(await h.isEnabled(page, 'New')(), true, 'New must be clickable while on Posted');
  await h.click(page, 'New');
  assert.equal(await h.eventually(h.filterValue(page), 'unposted'), 'unposted', 'New must switch back to Unposted');

  // Unposted → the latest draft opens; Post always clears to a blank bill under Unposted (standard
  // §8, 2026-10-06 — it used to keep a bill opened from the list on screen) — and New must still
  // be clickable.
  await h.chooseFilter(page, 'unposted');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true), true, 'a draft should be on screen');
  await h.click(page, 'Post');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), false), false, 'Post should have gone through');
  assert.equal(await h.isEnabled(page, 'Un Post')(), false, 'Post clears to a blank bill');
  assert.equal(await h.eventually(h.filterValue(page), 'unposted'), 'unposted', 'a blank bill is an unposted one');
  assert.equal(await h.eventually(h.isEnabled(page, 'New'), true), true, 'New must not grey out after Post');

  // Posted → the bill just posted; Unpost → it's a draft again → Unposted.
  await h.chooseFilter(page, 'posted');
  assert.equal(await h.eventually(h.isEnabled(page, 'Un Post'), true), true, 'Posted should open the posted bill');
  await h.click(page, 'Un Post');
  assert.equal(await h.eventually(h.filterValue(page), 'unposted'), 'unposted', 'Unpost must switch back to Unposted');
});

test.after(() => closePool());
