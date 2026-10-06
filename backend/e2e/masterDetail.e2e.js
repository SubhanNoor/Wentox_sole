// The Master/Detail edit flow (document_page_standard.md §5–§6), ported from the Journal Voucher to
// every line-grid document page on 2026-10-06 — run on each page through
// harness.masterDetailScenario. Each setup makes one unposted, two-line document, dated far in the
// future so it is the one the page opens on.
'use strict';

const test = require('node:test');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const draftSaleBillsService = require('../src/services/draftSaleBills.service');
const draftSaleReturnsService = require('../src/services/draftSaleReturns.service');
const draftPurchasesService = require('../src/services/draftPurchases.service');
const draftPurchaseReturnsService = require('../src/services/draftPurchaseReturns.service');
const stockVouchersService = require('../src/services/stockVouchers.service');
const vendorsService = require('../src/services/vendors.service');
const { setupSaleFixtures, uniqueName } = require('../testlib/fixtures');

const DATE = '2099-12-30';

// Sale fixtures whose own cleanup runs only after `removeDocs` (documents reference the customer).
async function saleFixtures(t, removeDocs) {
  const fixtureCleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => fixtureCleanup.push(fn) });
  t.after(async () => {
    await removeDocs(fx);
    for (const fn of fixtureCleanup) await fn();
  });
  return fx;
}

async function removeVendor(vendorId, draftItems, drafts) {
  const params = { vendorId };
  await query(`DELETE FROM dbo.${draftItems} WHERE draft_id IN (SELECT draft_id FROM dbo.${drafts} WHERE vendor_id = @vendorId)`, params);
  await query(`DELETE FROM dbo.${drafts} WHERE vendor_id = @vendorId`, params);
  const row = await query('SELECT ba_id FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  await query('DELETE FROM dbo.vendors WHERE vendor_id = @vendorId', params);
  if (row.recordset[0]?.ba_id != null) {
    await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
  }
}

test('Sale Bill: Master/Detail edit flow', (t) => h.masterDetailScenario(t, {
  menuLabel: 'SALE / BILL',
  async setup() {
    const fx = await saleFixtures(t, async ({ customer }) => {
      const params = { customerId: customer.customer_id };
      await query(`DELETE FROM dbo.draft_sale_bill_items WHERE draft_id IN
        (SELECT draft_id FROM dbo.draft_sale_bills WHERE customer_id = @customerId)`, params);
      await query('DELETE FROM dbo.draft_sale_bills WHERE customer_id = @customerId', params);
    });
    await draftSaleBillsService.create({
      bill_date: DATE, store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no: uniqueName('E2E'),
      items: [
        { variant_id: fx.variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 },
        { variant_id: fx.variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 },
      ],
    }, null);
  },
}));

test('Sale Return: Master/Detail edit flow', (t) => h.masterDetailScenario(t, {
  menuLabel: 'SALE RETURN',
  async setup() {
    const fx = await saleFixtures(t, async ({ customer }) => {
      const params = { customerId: customer.customer_id };
      await query(`DELETE FROM dbo.draft_sale_return_items WHERE draft_id IN
        (SELECT draft_id FROM dbo.draft_sale_returns WHERE customer_id = @customerId)`, params);
      await query('DELETE FROM dbo.draft_sale_returns WHERE customer_id = @customerId', params);
    });
    await draftSaleReturnsService.create({
      return_date: DATE, store_id: fx.store.store_id, customer_id: fx.customer.customer_id, bill_no: uniqueName('E2E'),
      items: [
        { variant_id: fx.variant.variant_id, cartons: 1, rate: 100, discount_percent: 0 },
        { variant_id: fx.variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 },
      ],
    }, null);
  },
}));

test('Purchase: Master/Detail edit flow', (t) => h.masterDetailScenario(t, {
  menuLabel: 'PURCHASE',
  async setup() {
    const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
    t.after(() => removeVendor(vendor.vendor_id, 'draft_purchase_items', 'draft_purchases'));
    await draftPurchasesService.create({
      purchase_date: DATE, vendor_id: vendor.vendor_id, bill_no: uniqueName('E2E'),
      items: [
        { material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 50 },
        { material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 3, price_per_unit: 50 },
      ],
    }, null);
  },
}));

test('Purchase Return: Master/Detail edit flow', (t) => h.masterDetailScenario(t, {
  menuLabel: 'PURCHASE RETURN',
  async setup() {
    const vendor = await vendorsService.create({ name: uniqueName('VENDOR') });
    t.after(() => removeVendor(vendor.vendor_id, 'draft_purchase_return_items', 'draft_purchase_returns'));
    await draftPurchaseReturnsService.create({
      return_date: DATE, vendor_id: vendor.vendor_id, bill_no: uniqueName('E2E'),
      items: [
        { material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 2, price_per_unit: 50 },
        { material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 3, price_per_unit: 50 },
      ],
    }, null);
  },
}));

test('Stock Voucher: Master/Detail edit flow', (t) => h.masterDetailScenario(t, {
  menuLabel: 'STOCK VOUCHER',
  async setup() {
    const fx = await saleFixtures(t, async ({ variant }) => {
      await query(`DELETE FROM dbo.stock_vouchers WHERE stock_voucher_id IN
        (SELECT stock_voucher_id FROM dbo.stock_voucher_lines WHERE variant_id = @variantId)`, { variantId: variant.variant_id });
    });
    await stockVouchersService.create({
      voucher_date: DATE, store_id: fx.store.store_id,
      lines: [
        { variant_id: fx.variant.variant_id, cartons: 1, pairs: 12 },
        { variant_id: fx.variant.variant_id, cartons: 2, pairs: 24 },
      ],
    }, null);
  },
}));

test.after(() => closePool());
