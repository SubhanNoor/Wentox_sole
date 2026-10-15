// Balance column on Sale Report, Sales Analysis and Vendor Report (per the user, 2026-10-13): the
// party's REAL account balance on the To date — the same figure its own ledger closes on — not
// just this period's sales minus payments. So an opening balance, or a bill from before the
// period, must be inside it.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/db/pool');
const reportsService = require('../src/services/reports.service');
const saleBillsService = require('../src/services/saleBills.service');
const purchasesService = require('../src/services/purchases.service');
const {
  makeCustomer, makeStore, makeVariantWithStock, makeVendor, uniqueName,
} = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const ADMIN = { userId: null, role: 'ADMIN' };

test('Sale Report / Sales Analysis: Balance is the customer ledger balance, opening balance included', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  const store = await makeStore();
  created.storeId = store.store_id;
  const { customer, region } = await makeCustomer({ opening_balance: 10000, opening_date: '2026-01-01' });
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;
  const { category, product, variant } = await makeVariantWithStock();
  created.categoryId = category.category_id;
  created.productId = product.article_id;
  created.variantId = variant.variant_id;

  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;
  await saleBillsService.post(bill.bill_id);

  const ledger = await reportsService.accountLedger({ ba_id: customer.ba_id }, {}, ADMIN);
  assert.equal(ledger.closing_balance, 12400, 'fixture: opening 10,000 + bill 2,400');

  const reportRow = (await reportsService.saleReport({})).find((r) => r.customer_id === customer.customer_id);
  assert.equal(reportRow.balance, ledger.closing_balance, 'Sale Report balance = ledger closing balance');
  assert.equal(reportRow.net_sales - reportRow.payment, 2400, 'period net alone would have left the opening balance out');

  const analysisRow = (await reportsService.saleAnalysis({})).find((r) => r.customer_id === customer.customer_id);
  assert.equal(analysisRow.balance, ledger.closing_balance, 'Sales Analysis balance = ledger closing balance');
});

test('Vendor Report: Balance is the vendor ledger balance on the To date, earlier purchases included', async (t) => {
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
  await purchasesService.post(purchase.purchase_id);

  const rowFor = async (filters) => (await reportsService.vendorReport({ vendor_id: vendor.vendor_id, ...filters }))
    .find((r) => r.vendor_id === vendor.vendor_id);

  // A February report: no purchase in the period, but the January one is still owed.
  const feb = await rowFor({ date_from: '2026-02-01', date_to: '2026-02-28' });
  const febLedger = await reportsService.vendorLedger(vendor.vendor_id, { date_from: '2026-02-01', date_to: '2026-02-28' });
  assert.equal(feb.total_purchase, 0);
  assert.equal(feb.balance, febLedger.closing_balance, 'Vendor Report balance = vendor ledger closing balance');
  assert.equal(feb.balance, -500, 'we owe the vendor 500 (credit balance, negative like the ledger)');

  // To date before the purchase: nothing owed yet.
  const dec = await rowFor({ date_from: '2025-12-01', date_to: '2025-12-31' });
  assert.equal(dec.balance, 0, 'balance is as of the To date, not today');
});

// Per the user (2026-10-14): a customer with no activity in the period but a balance (like a
// customer whose only entry is an opening credit) is still listed, so the Balance column adds up to
// what customers really owe / are owed. One with no activity AND no balance stays out.
test('Sale Report / Sales Analysis: an idle customer with a balance is listed, an idle zero one is not', async (t) => {
  const created = {};
  const idleZero = {};
  t.after(async () => { await cleanupFixtures(created); await cleanupFixtures(idleZero); });
  const { customer, region } = await makeCustomer({ opening_balance: -25000, opening_date: '2026-01-01' });
  Object.assign(created, { customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
  const zero = await makeCustomer();
  Object.assign(idleZero, { customerId: zero.customer.customer_id, ba_id: zero.customer.ba_id, regionId: zero.region.region_id });

  for (const [name, fn] of [['Sale Report', reportsService.saleReport], ['Sales Analysis', reportsService.saleAnalysis]]) {
    const rows = await fn({ date_from: '2026-02-01', date_to: '2026-02-28' });
    const row = rows.find((r) => r.customer_id === customer.customer_id);
    assert.ok(row, `${name}: idle customer with a credit balance is listed`);
    assert.equal(row.balance, -25000, `${name}: its balance is the opening credit`);
    assert.equal(row.total_sales, 0);
    assert.ok(!rows.some((r) => r.customer_id === zero.customer.customer_id), `${name}: idle zero-balance customer stays out`);
  }
});

test.after(() => closePool());
