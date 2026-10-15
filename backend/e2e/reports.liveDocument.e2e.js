// Reports follow the Product Ledger layout (per the user, 2026-10-14): filter bar on top, and under
// it the SAME document the print preview prints — no separate on-screen table. Group A of the
// rollout: Sale Analysis / Sale Report (Region groups listed fully expanded — no click-to-expand)
// and Current Stock (the "Full Report" colour matrix, which replaced the expandable article list
// and the View Full Report popup). "Show Print Preview" still opens the preview in a new window,
// and that preview carries the same rows as the screen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');
const saleBillsService = require('../src/services/saleBills.service');
const stockService = require('../src/services/stock.service');
const productColorsService = require('../src/services/productColors.service');
const { setupSaleFixtures, makeVariantWithStock, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const cellsOf = (trs) => trs.map((tr) => [...tr.querySelectorAll('th,td')].map((c) => c.innerText.trim()));

// Rows of the document drawn on the report screen itself.
const screenRows = (page) => page.locator('[data-live-report] tr').evaluateAll(cellsOf);
// Rows of the paginated preview sheets only (the modal keeps a hidden master copy for measuring).
const previewRows = (page) => page.locator('.report-preview-sheet tr').evaluateAll(cellsOf);

async function openPreview(app, page) {
  const [previewWin] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: 'Show Print Preview' }).click(),
  ]);
  await previewWin.waitForLoadState('domcontentloaded');
  await previewWin.locator('.report-preview-sheet').first().waitFor({ timeout: 20000 });
  return previewWin;
}

async function openReport(app, win, group, label) {
  const [page] = await Promise.all([app.waitForEvent('window'), (await h.menuItem(win, group, label)).click()]);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Show Print Preview' }).waitFor({ timeout: 20000 });
  return page;
}

test('Sale Analysis + Sale Report: the printed document on screen, region groups fully listed', async (t) => {
  const { store, customer, region, variant, created } = await setupSaleFixtures(t);
  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;
  await saleBillsService.post(bill.bill_id);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  for (const [label, title] of [['SALES ANALYSIS REPORT', /SALE ANALYSIS REPORT/], ['SALE / BILL LIST REPORT', /SALE REPORT/]]) {
    const page = await openReport(app, win, '5.SALE REPORTS', label);
    await page.getByRole('button', { name: 'Region Wise', exact: true }).click();
    await page.locator('[data-live-report] .excel-print-table').waitFor();
    assert.match(await page.locator('[data-live-report] h2').innerText(), title);

    // The region's row AND its customer's row are both on screen — nothing to expand.
    await page.locator('[data-live-report] td', { hasText: customer.name }).first().waitFor();
    const rows = await screenRows(page);
    const regionRow = rows.find((r) => r[0] === region.name);
    const customerRow = rows.find((r) => r[0] === customer.name);
    assert.ok(regionRow, `${label}: region row on screen`);
    assert.ok(customerRow, `${label}: customer row listed under its region without a click`);
    assert.equal(await page.locator('[data-live-report] svg.lucide-chevron-right').count(), 0, `${label}: no expand arrows`);

    // The preview window prints the very same rows.
    const previewWin = await openPreview(app, page);
    const printed = await previewRows(previewWin);
    assert.deepEqual(printed.find((r) => r[0] === customer.name), customerRow, `${label}: preview matches the screen`);
    await previewWin.close();
    await page.close();
  }
});

test('Current Stock: the Full Report colour matrix is the report', async (t) => {
  // One cleanup, Red variant first: the product can't be deleted while a colour of it remains.
  const created = {};
  let redId = null;
  t.after(async () => {
    if (redId != null) await cleanupFixtures({ variantId: redId });
    await cleanupFixtures(created);
  });
  const { category, product, variant } = await makeVariantWithStock({ pairsOnHand: 1000, packing: 12 });
  Object.assign(created, { categoryId: category.category_id, productId: product.article_id, variantId: variant.variant_id });
  // A second colour: 30 pairs = 2 cartons + 6 loose pairs.
  const red = await productColorsService.resolveOrCreate(product.article_id, 'Red', null);
  redId = red.variant_id;
  await stockService.logProduction({ variant_id: red.variant_id, movement_date: '2026-01-02', input_qty: 30, input_unit: 'PAIRS' }, null);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  const page = await openReport(app, win, '4.STOCK REPORTS', 'CURRENT STOCK REPORT');
  assert.equal(await page.getByRole('button', { name: 'View Full Report' }).count(), 0, 'no separate Full Report popup any more');

  // The Full Report search: article, category or colour. Category name is unique to this test.
  await page.getByPlaceholder('Search article, category or color...').fill(category.name);
  // The product is in the unfiltered list too, so wait for the FILTERED table: one article row.
  await page.waitForFunction((name) => {
    const rows = [...document.querySelectorAll('[data-live-report] tbody tr')];
    return rows.length === 2 && rows[0].innerText.includes(name);
  }, product.name);
  const rows = await screenRows(page);
  const header = rows.find((r) => r[0] === 'Article');
  assert.deepEqual(header, ['Article', 'Category', 'Black', 'Red', 'Total (Ctn/Prs)', 'Total Pairs'], 'one column per colour of the listed articles');
  const line = rows.find((r) => r[0] === product.name);
  // Black 1000 pairs = 83 ctn + 4; Red 30 = 2 + 6; together 1030 = 85 + 10.
  assert.deepEqual(line, [product.name, category.name, '83/4', '2/6', '85/10', '1,030']);
  const total = rows.find((r) => /TOTAL PAIRS/.test(r[0]));
  assert.deepEqual(total.slice(1), ['85.83 Ctn', '1,030'], 'totals cover the listed articles only');

  const previewWin = await openPreview(app, page);
  const printed = await previewRows(previewWin);
  assert.deepEqual(printed.find((r) => r[0] === product.name), line, 'preview matches the screen');
  await previewWin.close();

  // As on a date (per the user, 2026-10-15): on 01-01 only Black's 1000 pairs existed (Red came on 01-02).
  const asOn = page.locator('label', { hasText: 'As on:' }).locator('xpath=following-sibling::input');
  await asOn.fill('2026-01-01');
  await page.waitForFunction((name) => {
    const row = [...document.querySelectorAll('[data-live-report] tbody tr')].find((r) => r.innerText.includes(name));
    return row && row.innerText.includes('1,000') && !row.innerText.includes('1,030');
  }, product.name);
  const asOnRows = await screenRows(page);
  assert.deepEqual(asOnRows.find((r) => r[0] === product.name), [product.name, category.name, '83/4', '0/0', '83/4', '1,000']);
  assert.match(await page.locator('[data-live-report]').innerText(), /Stock as on: 01\/01\/2026/);

  // The other tabs show their printed document too...
  await page.getByRole('button', { name: 'Product Ledger', exact: true }).click();
  await page.locator('[data-live-report] h2', { hasText: 'PRODUCT MOVEMENT LEDGER' }).waitFor();
  await page.getByRole('button', { name: 'Daily Production', exact: true }).click();
  await page.locator('[data-live-report] h2', { hasText: 'DAILY PRODUCTION LOG' }).waitFor();
  // ...except Material Stock, which keeps its own table for the parked "−" (reduce stock) button.
  await page.getByRole('button', { name: 'Material Stock', exact: true }).click();
  await page.getByRole('columnheader', { name: 'Actions' }).waitFor();
  assert.equal(await page.locator('[data-live-report]').count(), 0, 'Material Stock is not the live document');
});

// Group B (per the user, 2026-10-14): the account lists are documents too, and clicking an account
// row on screen opens its ledger statement (the preview's copy has no such links).
test('Customer Report + Customer Balances: click an account in the list to open its statement', async (t) => {
  const { store, customer, variant, created } = await setupSaleFixtures(t);
  const bill = await saleBillsService.create({
    bill_date: '2026-01-05',
    store_id: store.store_id,
    customer_id: customer.customer_id,
    bill_no: uniqueName('BILL'),
    items: [{ variant_id: variant.variant_id, cartons: 2, rate: 100, discount_percent: 0 }],
  }, null);
  created.billId = bill.bill_id;
  await saleBillsService.post(bill.bill_id);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  // 3.1 Customer Report: the Accounts List, with the customer's balance.
  const page = await openReport(app, win, '3.ACCOUNT REPORTS', 'CUSTOMER REPORT');
  await page.getByPlaceholder(/Search code, name/).fill(customer.name);
  const listRow = page.locator('[data-live-report] tr.report-row-link', { hasText: customer.name });
  await listRow.waitFor();
  assert.match(await page.locator('[data-live-report] h2').innerText(), /CUSTOMER ACCOUNTS LIST/);
  const cells = (await listRow.locator('td').allInnerTexts()).map((s) => s.trim());
  assert.equal(cells.at(-1), '2,400', `list balance: ${cells.join(' | ')}`);

  // Its preview is the plain list: same row, no links.
  const listPreview = await openPreview(app, page);
  assert.ok((await previewRows(listPreview)).some((r) => r[1] === customer.name), 'list preview has the customer');
  assert.equal(await listPreview.locator('.report-preview-sheet tr.report-row-link').count(), 0, 'preview rows are not links');
  // Closing the preview closes its window (every report, per the user 2026-10-14).
  await Promise.all([listPreview.waitForEvent('close'), listPreview.keyboard.press('Escape').catch(() => {})]);

  // Click the row: the statement opens, with the bill and the closing balance.
  await listRow.click();
  await page.locator('[data-live-report] h2', { hasText: 'CUSTOMER KHAATA LEDGER STATEMENT' }).waitFor();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-01-01');
  await page.locator('[data-live-report] td', { hasText: 'Sale Bill' }).first().waitFor();
  const statement = await screenRows(page);
  assert.equal(statement.find((r) => r[0] === 'GRAND TOTAL').at(-1), '2,400', 'statement closes at the bill');
  // Back to the list.
  await page.getByRole('button', { name: /Back to list/ }).click();
  await page.locator('[data-live-report] h2', { hasText: 'CUSTOMER ACCOUNTS LIST' }).waitFor();
  await page.close();

  // 3.17 Customer Balances (Overall Trail): click the customer to open its ledger.
  const balances = await openReport(app, win, '3.ACCOUNT REPORTS', 'CUSTOMER BALANCES');
  await balances.getByPlaceholder('Search code or description...').fill(customer.name);
  const trailRow = balances.locator('[data-live-report] tr.report-row-link', { hasText: customer.name });
  await trailRow.waitFor();
  await trailRow.click();
  await balances.locator('[data-live-report] h2', { hasText: 'ACCOUNT LEDGER STATEMENT' }).waitFor();
  assert.match(await balances.locator('[data-live-report]').innerText(), new RegExp(customer.name));
});

// The straight swaps: each shows its printed document on screen.
test('Payment Trail, Cash Book and Cheque Ledger show their printed document on screen', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  for (const [group, label, title] of [
    ['3.ACCOUNT REPORTS', 'RECEIPTS AND PAYMENT TRAIL', /PAYMENT TRAIL REPORT/],
    ['3.ACCOUNT REPORTS', 'CASH BOOK SUMMARY', /DAILY CASH BOOK REPORT/],
  ]) {
    const page = await openReport(app, win, group, label);
    await page.locator('[data-live-report] h2', { hasText: title }).waitFor({ timeout: 20000 });
    await page.close();
  }
  // Cash Book's balance checks moved into the document.
  const cash = await openReport(app, win, '3.ACCOUNT REPORTS', 'CASH BOOK SUMMARY');
  await cash.locator('[data-live-report]', { hasText: /Cheq\.\/Online (ties|out by)/ }).waitFor();
  // Between Two Dates, the third mode (per the user, 2026-10-15): the period and a Date column.
  await cash.getByRole('button', { name: 'Between Two Dates' }).click();
  const range = cash.locator('input[type="date"]');
  await range.nth(0).fill('2026-01-01');
  await range.nth(1).fill('2026-01-31');
  await cash.locator('[data-live-report] p', { hasText: 'Period: 01/01/2026 to 31/01/2026' }).waitFor();
  assert.ok((await screenRows(cash)).some((r) => r.includes('Date')), 'a multi-day range gets a Date column');
  await cash.close();

  const [cheque] = await Promise.all([app.waitForEvent('window'), (await h.menuItem(win, '3.ACCOUNT REPORTS', 'TRACK CHEQUE')).click()]);
  await cheque.waitForLoadState('domcontentloaded');
  await cheque.getByRole('button', { name: 'Cheque Ledger', exact: true }).click();
  await cheque.locator('[data-live-report] h2').first().waitFor({ timeout: 20000 });
});

test.after(() => closePool());
