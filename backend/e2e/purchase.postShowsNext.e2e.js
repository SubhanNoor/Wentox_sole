// Post with another document still unposted must bring that one on screen, as Delete does; posting
// the last one leaves a blank form (per the user, 2026-11-25).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftPurchasesService = require('../src/services/draftPurchases.service');
const vendorsService = require('../src/services/vendors.service');
const { uniqueName } = require('../testlib/fixtures');

async function removeVendorDocuments(vendorId) {
  const params = { vendorId };
  const purchases = '(SELECT purchase_id FROM dbo.purchases WHERE vendor_id = @vendorId)';
  await query(`DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE' AND source_id IN ${purchases}`, params);
  await query(`DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE' AND source_id IN ${purchases}`, params);
  await query('DELETE FROM dbo.purchases WHERE vendor_id = @vendorId', params); // cascades items
  await query(`DELETE FROM dbo.draft_purchase_items
    WHERE draft_id IN (SELECT draft_id FROM dbo.draft_purchases WHERE vendor_id = @vendorId)`, params);
  await query('DELETE FROM dbo.draft_purchases WHERE vendor_id = @vendorId', params);
  const row = await query('SELECT ba_id FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  await query('DELETE FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  if (row.recordset[0]?.ba_id != null) {
    await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
  }
}

test('Purchase: Post opens the remaining unposted purchase, then a blank one', async (t) => {
  const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
  t.after(() => removeVendorDocuments(vendor.vendor_id));
  const draft = (billNo) => draftPurchasesService.create({
    purchase_date: '2026-09-30',
    vendor_id: vendor.vendor_id,
    bill_no: billNo,
    items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 50 }],
  }, null);
  const older = uniqueName('E2E');
  const newer = uniqueName('E2E');
  await draft(older);
  await draft(newer);

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE')).click());

  const shows = (billNo) => () => page.evaluate(
    (v) => [...document.querySelectorAll('input')].some((i) => i.value === v), billNo);

  assert.equal(await h.eventually(shows(newer), true, 15000), true, 'the page opens on the latest unposted purchase');
  await h.click(page, 'Post');
  assert.equal(await h.eventually(shows(older), true), true, 'the other unposted purchase must come on screen');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), true), true, 'and be ready to post');
  assert.equal(await h.filterValue(page)(), 'unposted');

  await h.click(page, 'Post');
  assert.equal(await h.eventually(h.isEnabled(page, 'Post'), false), false, 'nothing is left unposted');
  assert.equal(await shows(older)(), false, 'the form is blank');
  assert.equal(await h.filterValue(page)(), 'unposted');
});

test.after(() => closePool());
