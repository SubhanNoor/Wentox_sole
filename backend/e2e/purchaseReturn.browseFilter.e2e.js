// Purchase Return keeps every document on screen after Post (it never clears for the next one),
// so it is where the "New greyed out after Post" regression (2026-09-30) hit hardest: posting moves
// the dropdown to Posted, and New used to be disabled there. Also covers Unpost -> Unposted, which
// this page never did on its own before useBrowseFilterFollowsDocument.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftPurchaseReturnsService = require('../src/services/draftPurchaseReturns.service');
const vendorsService = require('../src/services/vendors.service');
const { uniqueName } = require('../testlib/fixtures');

// Everything this test's own vendor ends up with, whatever the screens did to it.
async function removeVendorDocuments(vendorId) {
  const params = { vendorId };
  const returns = "(SELECT return_id FROM dbo.purchase_returns WHERE vendor_id = @vendorId)";
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE_RETURN' AND source_id IN ${returns}`, params);
  await query(`DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE_RETURN' AND source_id IN ${returns}`, params);
  await query('DELETE FROM dbo.purchase_returns WHERE vendor_id = @vendorId', params); // cascades items
  await query(`DELETE FROM dbo.draft_purchase_return_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_purchase_returns WHERE vendor_id = @vendorId)`, params);
  await query('DELETE FROM dbo.draft_purchase_returns WHERE vendor_id = @vendorId', params);
  const row = await query('SELECT ba_id FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  await query('DELETE FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  if (row.recordset[0]?.ba_id != null) {
    await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
  }
}

test('Purchase Return: after Post, New stays usable and returns to Unposted; Unpost returns to Unposted', async (t) => {
  const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
  t.after(() => removeVendorDocuments(vendor.vendor_id));
  await draftPurchaseReturnsService.create({
    return_date: '2026-09-30',
    vendor_id: vendor.vendor_id,
    bill_no: uniqueName('E2E'),
    items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 50 }],
  }, null);

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);

  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE RETURN')).click());
  assert.equal(await page.evaluate(() => window.__sawLogin), false, 'a new window must never show the Login page');

  // The page opens on Unposted with the newest draft — ours.
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true), true, 'the draft should be on screen');
  assert.equal(await h.filterValue(page)(), 'unposted');

  await h.click(page, 'Post');
  assert.equal(await h.eventually(h.filterValue(page), 'posted'), 'posted', 'a posted return is shown under Posted');
  assert.equal(await h.eventually(h.isEnabled(page, 'New'), true), true, 'New must not grey out after Post');

  // New → a blank return under Unposted.
  await h.click(page, 'New');
  assert.equal(await h.eventually(h.filterValue(page), 'unposted'), 'unposted', 'New must switch back to Unposted');
  assert.equal(await h.isEnabled(page, 'Un Post')(), false, 'New must leave a blank return, not the posted one');

  // Back to the posted return via the dropdown, then Unpost: a draft again → Unposted. (Unpost
  // lands in edit mode on purpose, so this is the last step — Post needs view mode.)
  await h.chooseFilter(page, 'posted');
  assert.equal(await h.eventually(h.isEnabled(page, 'Un Post'), true), true, 'Posted should open the posted return');
  await h.click(page, 'Un Post');
  assert.equal(await h.eventually(h.filterValue(page), 'unposted'), 'unposted', 'Unpost must switch back to Unposted');
});

test.after(() => closePool());
