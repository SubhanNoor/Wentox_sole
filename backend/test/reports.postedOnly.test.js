// Regression suite for the "forgot the posted-only filter" bug class
// (System_architecture/testing_priority_plan.md Top 8 #8 / root-cause pattern #3): at least three
// separate report queries (Sale Analysis, Sale Report, Vendor Report) independently forgot to
// filter to POSTED-only documents, each found and fixed separately — an unposted document
// inflated a report total before it had ever touched the ledger. Also covers a LIVE bug found and
// fixed in this same session: paymentTrailRows() only sourced dbo.expenses, never dbo.settlements,
// even though settlements.service.js lets a settlement's to_ba_id be any business account
// (including a vendor/employee/expense head) — reachable today, not a future risk — so Payment
// Trail could silently disagree with Vendor Report over the very same settlement.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/db/pool');
const purchasesService = require('../src/services/purchases.service');
const reportsService = require('../src/services/reports.service');
const settlementsService = require('../src/services/settlements.service');
const {
  setupSaleFixtures, makeVendor, makeCustomer, uniqueName,
} = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

test('Sale Analysis/Sale Report: an unposted Sale Bill must not inflate Total Sales', async (t) => {
  const { store, customer, variant, created } = await setupSaleFixtures(t);
  const saleBillsService = require('../src/services/saleBills.service');

  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;

  const totalSalesFor = async () => {
    const rows = await reportsService.saleAnalysis({});
    const row = rows.find((r) => r.customer_id === customer.customer_id);
    return row ? row.total_sales : 0;
  };

  assert.equal(await totalSalesFor(), 0, 'an unposted Sale Bill must not appear in Sale Analysis at all');

  await saleBillsService.post(bill.bill_id);
  assert.equal(await totalSalesFor(), 2400, 'once posted, the same bill must appear at its net_value');
});

test('Vendor Report: an unposted Purchase must not inflate Total Purchase', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  const purchase = await purchasesService.create({
    vendor_id: vendor.vendor_id,
    purchase_date: '2026-01-05',
    bill_no: uniqueName('PBILL'),
    items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 10, price_per_unit: 50 }],
  }, null);
  created.purchaseId = purchase.purchase_id;
  created.materialIds = purchase.items.map((item) => item.material_id);

  const totalPurchaseFor = async () => {
    const rows = await reportsService.vendorReport({ vendor_id: vendor.vendor_id });
    const row = rows.find((r) => r.vendor_id === vendor.vendor_id);
    return row ? row.total_purchase : 0;
  };

  assert.equal(await totalPurchaseFor(), 0, 'an unposted Purchase must not appear in Vendor Report at all');

  await purchasesService.post(purchase.purchase_id);
  assert.equal(await totalPurchaseFor(), 500, 'once posted, the same purchase must appear at its total_value');
});

test('Payment Trail: a settlement paid straight to a vendor must count in the Vendors - Suppliers bucket', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;

  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  const vendorsBucketTotal = async () => {
    const result = await reportsService.paymentTrail({});
    const bucket = result.buckets.find((b) => b.key === 'vendors_suppliers');
    return bucket.total;
  };

  const before = await vendorsBucketTotal();

  const settlement = await settlementsService.create({
    settlement_date: '2026-01-10',
    from_ba_id: customer.ba_id,
    to_ba_id: vendor.ba_id,
    amount: 1500,
  }, null, undefined);
  created.settlementId = settlement.settlement_id;

  // Unposted (DRAFT) settlements must not count either — same posted-only rule as everything else.
  assert.equal(await vendorsBucketTotal(), before, 'a DRAFT settlement must not appear in Payment Trail');

  await settlementsService.post(settlement.settlement_id, null, undefined);

  assert.equal(
    await vendorsBucketTotal(),
    before + 1500,
    'a CONFIRMED settlement paid to a vendor must count in Payment Trail\'s Vendors - Suppliers bucket, same as Vendor Report already counts it in Payment Paid',
  );
});

test.after(async () => {
  await closePool();
});
