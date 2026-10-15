// Product Ledger one-line-per-product view (client request, 2026-10-12): one line per product+
// colour with Opening (stock before the From date), In, Out and Balance (stock on the To date),
// plus a running balance on every movement for the Detailed view. The original `rows`/totals must
// stay as they were — the Stock page's movement ledger still reads them.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const reportsService = require('../src/services/reports.service');
const stockService = require('../src/services/stock.service');
const categoriesService = require('../src/services/categories.service');
const productsService = require('../src/services/products.service');
const productColorsService = require('../src/services/productColors.service');
const { uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function makeTwoColourProduct(t) {
  const created = {};
  let brownId = null;
  // One hook, in FK order: the second colour's movements and row first, then the shared cleanup
  // (first colour, product, category).
  t.after(async () => {
    if (brownId != null) {
      await query('DELETE FROM dbo.stock_movements WHERE variant_id = @id', { id: brownId });
      await query('DELETE FROM dbo.article_colors WHERE variant_id = @id', { id: brownId });
    }
    await cleanupFixtures(created);
  });

  const category = await categoriesService.create({ name: uniqueName('CATEGORY') });
  created.categoryId = category.category_id;
  const product = await productsService.create({ name: uniqueName('PRODUCT'), category_id: category.category_id, packing: 12 });
  created.productId = product.article_id;
  const black = await productColorsService.resolveOrCreate(product.article_id, 'Black', null);
  created.variantId = black.variant_id;
  const brown = await productColorsService.resolveOrCreate(product.article_id, 'Brown', null);
  brownId = brown.variant_id;
  return { category, product, black, brown };
}

const move = (variant, movement_date, qty_pairs) =>
  stockService.adjust({ variant_id: variant.variant_id, movement_date, movement_type: 'ADJUSTMENT', qty_pairs }, null);

test('Product Ledger: one line per product+colour with Opening, In, Out and Balance', async (t) => {
  const { category, product, black, brown } = await makeTwoColourProduct(t);

  // Black: 500 before the period, then +240 / -120 / -360 inside it, and +999 after it.
  await move(black, '2026-06-15', 500);
  await move(black, '2026-07-08', 240);
  await move(black, '2026-07-09', -120);
  await move(black, '2026-07-10', -360);
  await move(black, '2026-08-01', 999);
  // Brown: nothing before the period, +24 inside it.
  await move(brown, '2026-07-08', 24);

  const result = await reportsService.productLedger({
    category_id: category.category_id, date_from: '2026-07-07', date_to: '2026-07-31',
  });

  assert.equal(result.products.length, 2, 'each colour is its own line');
  const blackLine = result.products.find((p) => p.variant_id === black.variant_id);
  const brownLine = result.products.find((p) => p.variant_id === brown.variant_id);
  assert.deepEqual(
    { opening: blackLine.opening, in: blackLine.in, out: blackLine.out, balance: blackLine.balance },
    { opening: 500, in: 240, out: 480, balance: 260 },
    'Black: Opening + In - Out = Balance, and the movement after the To date is excluded',
  );
  assert.deepEqual(
    { opening: brownLine.opening, in: brownLine.in, out: brownLine.out, balance: brownLine.balance },
    { opening: 0, in: 24, out: 0, balance: 24 },
  );
  assert.equal(blackLine.article_code, product.code);
  assert.deepEqual(result.product_totals, { opening: 500, in: 264, out: 480, balance: 284 });

  // Running balance per product+colour, starting from its own opening.
  const blackRunning = result.rows.filter((r) => r.variant_id === black.variant_id).map((r) => r.running_balance);
  assert.deepEqual(blackRunning, [740, 620, 260]);
  const brownRunning = result.rows.filter((r) => r.variant_id === brown.variant_id).map((r) => r.running_balance);
  assert.deepEqual(brownRunning, [24]);

  // Unchanged fields the Stock page relies on.
  assert.equal(result.rows.length, 4);
  assert.equal(result.total_in, 264);
  assert.equal(result.total_out, 480);
  assert.equal(result.net, -216);
});

test('Product Ledger: a product with opening stock but no movement in the period still shows', async (t) => {
  const { category, black, brown } = await makeTwoColourProduct(t);
  await move(black, '2026-06-15', 100);
  await move(brown, '2026-06-15', 50);
  await move(brown, '2026-06-20', -50); // Brown nets to zero before the period: not shown.

  const result = await reportsService.productLedger({
    category_id: category.category_id, date_from: '2026-07-01', date_to: '2026-07-31',
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.products.length, 1, 'zero stock and no movement in the period is left out');
  assert.equal(result.products[0].variant_id, black.variant_id);
  assert.deepEqual(
    { opening: result.products[0].opening, in: result.products[0].in, out: result.products[0].out, balance: result.products[0].balance },
    { opening: 100, in: 0, out: 0, balance: 100 },
  );
});

test.after(() => closePool());
