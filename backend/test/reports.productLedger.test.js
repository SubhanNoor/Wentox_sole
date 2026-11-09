// Product Ledger one-line-per-product view (client request, 2026-10-12; columns 2026-11-08): one
// line per product+colour with Opening Stock (before the From date), In (stock vouchers and other
// direct stock entries), Return (sale returns), Total Stock, Out (sale bills) and Balance (stock on
// the To date), plus a running balance on every movement for the Detailed view. Columns go by the
// document that moved the stock, not by the sign. `rows`/`total_in`/`total_out`/`net` stay the
// plain sign split.
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

test('Product Ledger: one line per product+colour with Opening, In, Return, Total Stock, Out and Balance', async (t) => {
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
  // Manual adjustments are no sale document, so even the negative ones net into In — Out is sales.
  const line = (p) => ({ opening: p.opening, in: p.in, returned: p.returned, total_stock: p.total_stock, out: p.out, balance: p.balance });
  assert.deepEqual(
    line(blackLine),
    { opening: 500, in: -240, returned: 0, total_stock: 260, out: 0, balance: 260 },
    'Black: Total Stock - Out = Balance, and the movement after the To date is excluded',
  );
  assert.deepEqual(line(brownLine), { opening: 0, in: 24, returned: 0, total_stock: 24, out: 0, balance: 24 });
  assert.equal(blackLine.article_code, product.code);
  assert.equal(blackLine.packing, 12, 'the colour has no packing of its own, so the article\'s');
  assert.deepEqual(result.product_totals, { opening: 500, in: -216, returned: 0, total_stock: 284, out: 0, balance: 284 });

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

// Movements as the documents write them (stock voucher, sale bill, sale return and their drafts),
// straight into stock_movements — this test is about which column each lands in, not the documents.
async function documentMove(variant, date, movementType, qtyPairs, sourceType) {
  await query(
    `INSERT INTO dbo.stock_movements (variant_id, movement_type, qty_pairs, movement_date, source_type, source_id)
     VALUES (@variantId, @movementType, @qtyPairs, @date, @sourceType, 1)`,
    { variantId: variant.variant_id, movementType, qtyPairs, date, sourceType },
  );
}

test('Product Ledger: In is stock vouchers, Return is sale returns, Out is sale bills net of unposts', async (t) => {
  const { category, black } = await makeTwoColourProduct(t);
  await documentMove(black, '2026-06-15', 'ADJUSTMENT', 120, 'STOCK_VOUCHER'); // opening
  await documentMove(black, '2026-07-02', 'ADJUSTMENT', 240, 'STOCK_VOUCHER');
  await documentMove(black, '2026-07-03', 'SALE', -100, 'SALE_BILL');
  await documentMove(black, '2026-07-04', 'ADJUSTMENT', 36, 'SALE_BILL'); // unposted: pairs put back
  await documentMove(black, '2026-07-05', 'ADJUSTMENT', -12, 'DRAFT_SALE_BILL');
  await documentMove(black, '2026-07-06', 'SALE_RETURN', 24, 'SALE_RETURN');
  await documentMove(black, '2026-07-07', 'ADJUSTMENT', 6, 'DRAFT_SALE_RETURN');

  const result = await reportsService.productLedger({
    category_id: category.category_id, date_from: '2026-07-01', date_to: '2026-07-31',
  });
  const p = result.products[0];
  assert.deepEqual(
    { opening: p.opening, in: p.in, returned: p.returned, total_stock: p.total_stock, out: p.out, balance: p.balance },
    { opening: 120, in: 240, returned: 30, total_stock: 390, out: 76, balance: 314 },
    'the sale bill put back by its unpost reduces Out, it does not add to In',
  );
  assert.deepEqual(result.rows.map((r) => r.bucket), ['IN', 'OUT', 'OUT', 'OUT', 'RETURN', 'RETURN']);
  assert.equal(result.rows.at(-1).running_balance, 314);
});

test.after(() => closePool());
