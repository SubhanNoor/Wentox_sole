// Dates on every report (per the user, 2026-10-15): Current Stock and Material Stock take an
// "As on" date (only movements up to that day count), and Cash Book takes a From/To range as a third
// mode next to By Date / By Month.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { closePool } = require('../src/db/pool');
const reportsService = require('../src/services/reports.service');
const stockService = require('../src/services/stock.service');
const purchasesService = require('../src/services/purchases.service');
const { makeVariantWithStock, makeVendor, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

test('Current Stock as on a date counts only movements up to that day', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  // 1000 pairs produced on 2026-01-01 (fixture), then 240 more on 2026-03-01.
  const { category, product, variant } = await makeVariantWithStock({ pairsOnHand: 1000 });
  Object.assign(created, { categoryId: category.category_id, productId: product.article_id, variantId: variant.variant_id });
  await stockService.adjust({ variant_id: variant.variant_id, movement_date: '2026-03-01', movement_type: 'ADJUSTMENT', qty_pairs: 240 }, null);

  const pairsOn = async (asOf) => {
    const rows = await reportsService.stock({ category_id: category.category_id, as_of_date: asOf });
    return rows.find((r) => r.variant_id === variant.variant_id)?.total_pairs;
  };
  assert.equal(await pairsOn(undefined), 1240, 'no date = all movements');
  assert.equal(await pairsOn('2026-02-01'), 1000, 'the March adjustment is after the date');
  assert.equal(await pairsOn('2026-03-01'), 1240, 'a movement ON the date counts');
  assert.equal(await pairsOn('2025-12-31'), 0, 'before any movement the colour still lists, at 0');
});

test('Material Stock as on a date counts only movements up to that day', async (t) => {
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

  const onHand = async (asOf) => (await reportsService.vendorStock({ as_of_date: asOf }))
    .find((r) => r.vendor_id === vendor.vendor_id);
  assert.equal(await onHand('2026-01-04'), undefined, 'nothing bought yet on the 4th');
  assert.equal(Number((await onHand('2026-01-05')).on_hand), 10);
  assert.equal(Number((await onHand(undefined)).on_hand), 10);
});

test('Cash Book between two dates = the same book as the matching month', async () => {
  const byMonth = await reportsService.cashBook({ month: '2026-01' });
  const byRange = await reportsService.cashBook({ date_from: '2026-01-01', date_to: '2026-01-31' });
  assert.deepEqual(byRange, byMonth);
  await assert.rejects(() => reportsService.cashBook({ date_from: '2026-02-01', date_to: '2026-01-01' }), /From date is after To date/);
});

test.after(() => closePool());
