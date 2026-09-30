// Purchase — the shared Posted/Unposted workflow (see harness.browseFilterScenario).
'use strict';

const test = require('node:test');
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

test('Purchase: dropdown follows the purchase on screen through Posted, New, Post and Unpost', (t) =>
  h.browseFilterScenario(t, {
    menuLabel: 'PURCHASE',
    async setup() {
      const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
      t.after(() => removeVendorDocuments(vendor.vendor_id));
      const draft = () => draftPurchasesService.create({
        purchase_date: '2026-09-30',
        vendor_id: vendor.vendor_id,
        bill_no: uniqueName('E2E'),
        items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 50 }],
      }, null);
      await draftPurchasesService.confirm((await draft()).draft_id, null);
      await draft();
    },
  }));

test.after(() => closePool());
