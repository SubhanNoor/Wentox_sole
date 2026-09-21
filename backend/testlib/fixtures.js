// Shared fixture builders for integration tests — real service calls against the DB_NAME database
// (see scripts/setup-test-db.js — npm test points this at a throwaway "wentox_test" database,
// never the real one), not mocks. Each builder returns the created row(s); callers are responsible
// for tearing down what they created via query() in a t.after() hook (see
// businessAccounts.openingBalance.test.js for the pattern) — there is no global reset between
// tests, so leftover fixtures from a failed cleanup will affect later tests.
'use strict';

const regionsService = require('../src/services/regions.service');
const storesService = require('../src/services/stores.service');
const categoriesService = require('../src/services/categories.service');
const productsService = require('../src/services/products.service');
const productColorsService = require('../src/services/productColors.service');
const customersService = require('../src/services/customers.service');
const vendorsService = require('../src/services/vendors.service');
const bankAccountsService = require('../src/services/bankAccounts.service');
const stockService = require('../src/services/stock.service');
const { cleanupFixtures } = require('./cleanup');

let counter = 0;
function uniqueName(prefix) {
  counter += 1;
  return `TEST-${prefix}-${Date.now()}-${counter}`;
}

function makeRegion() {
  return regionsService.create({ name: uniqueName('REGION') });
}

function makeStore() {
  return storesService.create({ name: uniqueName('STORE') });
}

function makeVendor() {
  return vendorsService.create({ name: uniqueName('VENDOR') });
}

function makeBank() {
  return bankAccountsService.create({ name: uniqueName('BANK') });
}

async function makeCustomer(overrides = {}) {
  const region = await makeRegion();
  const customer = await customersService.create({
    name: uniqueName('CUSTOMER'),
    region_id: region.region_id,
    ...overrides,
  });
  return { customer, region };
}

// A product + one colour variant, stocked with `pairsOnHand` pairs via a real PRODUCTION movement
// (not a raw INSERT) so assertStockAvailable()'s own on-hand check passes exactly the way it would
// for a real sale.
async function makeVariantWithStock({ pairsOnHand = 1000, packing = 12 } = {}) {
  const category = await categoriesService.create({ name: uniqueName('CATEGORY') });
  const product = await productsService.create({
    name: uniqueName('PRODUCT'),
    category_id: category.category_id,
    packing,
  });
  const variant = await productColorsService.resolveOrCreate(product.article_id, 'Black', null);
  await stockService.logProduction({
    variant_id: variant.variant_id,
    movement_date: '2026-01-01',
    input_qty: pairsOnHand,
    input_unit: 'PAIRS',
  }, null);
  return { category, product, variant };
}

// Store + customer + stocked variant, the combination every sale-bill/return test needs — with
// cleanup registered against `t` (the test's TestContext) BEFORE anything is created, and mutated
// as each piece succeeds. This is what makes a mid-setup throw clean up whatever did get created
// instead of orphaning it silently, the way a fixed-object t.after() registered only after every
// fixture already succeeded cannot (found the hard way — see businessAccounts.openingBalance.test.js).
// Returns `created`, the same tracker object passed to cleanupFixtures — callers should set
// `created.billId`/`created.returnId` once they create a document, so it's cleaned up too.
async function setupSaleFixtures(t, { pairsOnHand = 1000, packing = 12 } = {}) {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const store = await makeStore();
  created.storeId = store.store_id;

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;

  const { category, product, variant } = await makeVariantWithStock({ pairsOnHand, packing });
  created.categoryId = category.category_id;
  created.productId = product.article_id;
  created.variantId = variant.variant_id;

  return {
    store, customer, region, category, product, variant, created,
  };
}

// Customer + bank + vendor, the combination the cheque-disposal tests need (deposit targets a
// bank, endorseToVendor targets a vendor) — same defensive-cleanup-registered-up-front shape as
// setupSaleFixtures.
async function setupChequeFixtures(t) {
  const created = {};
  t.after(() => cleanupFixtures(created));

  const { customer, region } = await makeCustomer();
  created.customerId = customer.customer_id;
  created.ba_id = customer.ba_id;
  created.regionId = region.region_id;

  const bank = await makeBank();
  created.bankId = bank.bank_id;

  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;

  return {
    customer, region, bank, vendor, created,
  };
}

module.exports = {
  uniqueName, makeRegion, makeStore, makeCustomer, makeVendor, makeBank, makeVariantWithStock,
  setupSaleFixtures, setupChequeFixtures,
};
