// Document page standard §5 (2026-11-18): opening a saved document shows its LAST lines — the lines
// grid starts scrolled to the end. Run on Stock Voucher; every voucher page uses the same hook
// (frontend/src/hooks/useScrollLinesToEnd.ts).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const stockVouchersService = require('../src/services/stockVouchers.service');
const { setupSaleFixtures } = require('../testlib/fixtures');

test('Stock Voucher: a voucher with many lines opens scrolled to its last line', async (t) => {
  const fixtureCleanup = [];
  const fx = await setupSaleFixtures({ after: (fn) => fixtureCleanup.push(fn) });
  t.after(async () => {
    const params = { variantId: fx.variant.variant_id };
    await query(`DELETE FROM dbo.stock_vouchers WHERE stock_voucher_id IN
      (SELECT stock_voucher_id FROM dbo.stock_voucher_lines WHERE variant_id = @variantId)`, params);
    await query('DELETE FROM dbo.stock_movements WHERE variant_id = @variantId', params);
    for (const fn of fixtureCleanup) await fn();
  });
  // Newest unposted voucher, so it is what the page opens on (sale-window-open rule).
  await stockVouchersService.create({
    voucher_date: '2026-09-30',
    store_id: fx.store.store_id,
    lines: Array.from({ length: 40 }, (_, i) => ({ variant_id: fx.variant.variant_id, cartons: 0, pairs: i + 1 })),
  }, null);

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'STOCK VOUCHER')).click());

  const gap = async () => page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('40'));
    let el = row && row.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement;
    if (!el) return null;
    return el.scrollHeight - el.clientHeight - el.scrollTop;
  });
  // null = no scrollable grid yet (lines still loading); 0-ish = at the end.
  const settled = await h.eventually(async () => {
    const g = await gap();
    return g != null && g <= 2;
  }, true, 15000);
  assert.equal(settled, true, `lines grid should be scrolled to the end (gap from bottom: ${await gap()}px)`);

  // The 2026-10-22 guard still holds: in a short window the grid keeps ~4 lines (140px) and the
  // card grows past the window instead of squeezing the lines away.
  await page.setViewportSize({ width: 1100, height: 420 });
  await page.waitForTimeout(500);
  const gridHeight = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('40'));
    let el = row && row.parentElement;
    while (el && !/overflow-y-auto/.test(String(el.className))) el = el.parentElement;
    return el ? el.clientHeight : null;
  });
  assert.ok(gridHeight != null && gridHeight >= 136, `grid must keep ~4 lines in a short window (got ${gridHeight}px)`);
});

test.after(() => closePool());
