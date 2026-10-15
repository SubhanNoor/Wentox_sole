// Product Ledger, as the client asked for it (2026-10-12): one line per product+colour with
// Opening / In / Out / Balance, a Detailed view with a running balance, and Date Range / This Week period radios.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');
const stockService = require('../src/services/stock.service');
const categoriesService = require('../src/services/categories.service');
const productsService = require('../src/services/products.service');
const productColorsService = require('../src/services/productColors.service');
const { uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Product Ledger: summary line, detailed running balance and This Week', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  const category = await categoriesService.create({ name: uniqueName('CATEGORY') });
  created.categoryId = category.category_id;
  const product = await productsService.create({ name: uniqueName('PRODUCT'), category_id: category.category_id, packing: 12 });
  created.productId = product.article_id;
  const variant = await productColorsService.resolveOrCreate(product.article_id, 'Black', null);
  created.variantId = variant.variant_id;
  const move = (movement_date, qty_pairs) => stockService.adjust(
    { variant_id: variant.variant_id, movement_date, movement_type: 'ADJUSTMENT', qty_pairs }, null);
  await move('2026-06-15', 500);
  await move('2026-07-08', 240);
  await move('2026-07-10', -480);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  const [page] = await Promise.all([
    app.waitForEvent('window'),
    (await h.menuItem(win, '4.STOCK REPORTS', 'STOCK LEDGER REPORT')).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  const search = page.getByPlaceholder('Search by article code or name...');
  await search.waitFor({ timeout: 20000 });
  await search.fill(product.code);
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-07-01');
  await dates.nth(1).fill('2026-07-31');

  // Summary: one line — code, article, colour, vendor, Opening 500, In 240, Out (480), Balance 260.
  const line = page.locator('tr', { has: page.getByText(product.name, { exact: true }) }).first();
  await line.waitFor();
  const cells = (await line.locator('td').allInnerTexts()).map((s) => s.trim());
  assert.deepEqual(cells.slice(4), ['500', '240', '(480)', '260'], `summary line: ${cells.join(' | ')}`);

  // Detailed: Opening Stock row, then each movement with its running balance.
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await page.getByText('Opening Stock').first().waitFor();
  const balances = await page.locator('table.excel-print-table tbody tr').evaluateAll((rows) =>
    rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.innerText.trim())));
  const opening = balances.find((c) => c.includes('Opening Stock'));
  assert.equal(opening.at(-1), '500');
  const movementBalances = balances.filter((c) => c.length === 6 && /^#\d+$/.test(c[2])).map((c) => c[5]);
  assert.deepEqual(movementBalances, ['740', '260']);

  // This Week radio: Monday of the current week to today.
  const thisWeek = page.getByRole('radio', { name: 'This Week' });
  const dateRange = page.getByRole('radio', { name: 'Date Range' });
  assert.equal(await dateRange.isChecked(), true, 'Date Range is selected by default');
  await thisWeek.check();
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  assert.equal(await dates.nth(0).inputValue(), localISO(monday));
  assert.equal(await dates.nth(1).inputValue(), localISO(now));

  // Switching back to Date Range restores the dates that were there before (per the user,
  // 2026-10-13: the old button couldn't be switched off).
  await dateRange.check();
  assert.equal(await dates.nth(0).inputValue(), '2026-07-01');
  assert.equal(await dates.nth(1).inputValue(), '2026-07-31');

  // Editing a date while on This Week switches the radio back to Date Range.
  await thisWeek.check();
  await dates.nth(0).fill('2026-07-02');
  assert.equal(await dateRange.isChecked(), true, 'editing a date leaves This Week');
});

test.after(() => closePool());
