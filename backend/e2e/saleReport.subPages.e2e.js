// Sale Report sub pages, as the client asked for them (2026-11-23): Customer Search (everything one
// customer bought, each line with its own rate, returns negative, bill discount reconciled) and
// Article Wise (one group per price with a subtotal). Driven through the real app, and checking the
// thing the client stressed — that everything is IN LINE: every cell of every row sits under its
// own column heading, on the screen AND on every page of the print preview, and a total appears
// once, at the very end. Set E2E_SHOTS=<dir> to also save screenshots of each view.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./harness');
const { closePool } = require('../src/db/pool');
const saleBillsService = require('../src/services/saleBills.service');
const draftSaleReturnsService = require('../src/services/draftSaleReturns.service');
const { setupSaleFixtures, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const SHOTS = process.env.E2E_SHOTS;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : Promise.resolve());

// Cells of every row of every table inside `root`, as the column each starts in vs the heading
// above it: returns the mismatches (empty = everything lines up).
const alignmentProblems = (root) => {
  const problems = [];
  for (const table of root.querySelectorAll('table')) {
    const heads = [...table.querySelectorAll('thead th')];
    if (!heads.length) continue;
    const headBox = heads.map((th) => th.getBoundingClientRect());
    for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
      let col = 0;
      for (const cell of row.children) {
        const span = cell.colSpan || 1;
        const box = cell.getBoundingClientRect();
        const first = headBox[col];
        const last = headBox[col + span - 1];
        if (!first || !last) {
          problems.push(`row has more columns than the heading: "${row.innerText.slice(0, 40)}"`);
        } else if (Math.abs(box.left - first.left) > 1.5 || Math.abs(box.right - last.right) > 1.5) {
          problems.push(`cell "${cell.innerText.trim().slice(0, 25)}" (col ${col + 1}, span ${span}) is at ${box.left.toFixed(0)}-${box.right.toFixed(0)}, heading at ${first.left.toFixed(0)}-${last.right.toFixed(0)}`);
        }
        col += span;
      }
      if (col !== heads.length) problems.push(`row spans ${col} columns, heading has ${heads.length}: "${row.innerText.slice(0, 40)}"`);
    }
  }
  return problems;
};

function trackDocs(t) {
  const docs = { bills: [], returns: [] };
  t.after(async () => {
    for (const id of docs.bills) await cleanupFixtures({ billId: id });
    for (const id of docs.returns) await cleanupFixtures({ returnId: id });
  });
  return docs;
}

async function bill(fx, docs, { date, items, invoiceDiscount = 0 }) {
  const created = await saleBillsService.create({
    bill_date: date,
    store_id: fx.store.store_id,
    customer_id: fx.customer.customer_id,
    bill_no: uniqueName('B').slice(-12),
    invoice_discount: invoiceDiscount,
    items: items.map(([cartons, rate]) => ({ variant_id: fx.variant.variant_id, cartons, rate, discount_percent: 0 })),
  }, null);
  docs.bills.push(created.bill_id);
  await saleBillsService.post(created.bill_id);
}

async function sale(t) {
  const docs = trackDocs(t);
  const fx = await setupSaleFixtures(t, { pairsOnHand: 100000 });
  await bill(fx, docs, { date: '2026-10-05', items: [[4, 300]] });
  await bill(fx, docs, { date: '2026-10-12', items: [[2, 300]], invoiceDiscount: 500 });
  // One big bill (45 lines: a price rise to 600 with a few 300s mixed back in) so each report runs past one page.
  await bill(fx, docs, {
    date: '2026-10-20',
    items: Array.from({ length: 45 }, (_, i) => [1, i % 9 === 8 ? 300 : 600]),
  });
  const draft = await draftSaleReturnsService.create({
    return_date: '2026-10-25',
    store_id: fx.store.store_id,
    customer_id: fx.customer.customer_id,
    bill_no: uniqueName('R').slice(-12),
    items: [{ variant_id: fx.variant.variant_id, cartons: 1, rate: 300, discount_percent: 0 }],
  }, null);
  const posted = await draftSaleReturnsService.confirm(draft.draft_id, null);
  docs.returns.push(posted.return_id);
  return fx;
}

async function openSaleReport(win, app) {
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    (await h.menuItem(win, '5.SALE REPORTS', 'SALE / BILL LIST REPORT')).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Customer Search', exact: true }).waitFor({ timeout: 20000 });
  return page;
}

// Opens the print preview this sub page's own button opens (a new window, straight into the
// preview) and returns it once its pages are built.
async function openPreview(app, page) {
  const [preview] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: /Show Print Preview/ }).click(),
  ]);
  await preview.waitForLoadState('domcontentloaded');
  await preview.locator('.report-preview-sheet').first().waitFor({ timeout: 20000 });
  await preview.waitForTimeout(800);
  return preview;
}

async function previewChecks(preview, { totalLabels, name }) {
  // Every page's tables line up with their own headings.
  const problems = await preview.evaluate(`(${alignmentProblems.toString()})(document.querySelector('.report-modal-scroll-wrapper'))`);
  // Page shape: more than one page, nothing runs past the bottom of its sheet.
  const pages = await preview.evaluate(() => [...document.querySelectorAll('.report-preview-sheet')].map((sheet) => {
    const box = sheet.getBoundingClientRect();
    const content = [...sheet.querySelectorAll('table, .excel-print-header, .report-signoff, p, div')]
      .filter((el) => el.closest('.report-preview-page-badge') === null)
      .reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0);
    return { text: sheet.innerText, overflow: content - box.bottom, tables: sheet.querySelectorAll('table').length };
  }));
  assert.ok(pages.length >= 2, `the report should run onto a second page, got ${pages.length}`);
  for (const [i, p] of pages.entries()) assert.ok(p.overflow <= 1, `page ${i + 1} content runs ${p.overflow.toFixed(0)}px past the sheet`);
  // A total printed once, on the last page only.
  for (const label of totalLabels) {
    const where = pages.map((p, i) => (p.text.includes(label) ? i + 1 : null)).filter(Boolean);
    assert.deepEqual(where, [pages.length], `"${label}" should appear only on the last page, found on ${where.join(',')}`);
  }
  // Pictures last: scrolling a sheet into view for its screenshot must not disturb the measurements above.
  if (SHOTS) {
    const sheets = preview.locator('.report-preview-sheet');
    for (let i = 0; i < await sheets.count(); i++) await sheets.nth(i).screenshot({ path: path.join(SHOTS, `${name}-page${i + 1}.png`) });
  }
  return { problems, pageCount: pages.length };
}

test('Customer Search: every line with its own rate, returns negative, total, in line on screen and on every printed page', async (t) => {
  const fx = await sale(t);
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  const page = await openSaleReport(win, app);
  await page.getByRole('button', { name: 'Customer Search', exact: true }).click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-10-01');
  await dates.nth(1).fill('2026-10-31');
  const picker = page.getByPlaceholder('Type a customer name, then press Enter...');
  await picker.fill(fx.customer.name);
  await picker.press('Enter');

  await page.getByText('CUSTOMER TOTAL').waitFor({ timeout: 15000 });
  await shot(page, 'customer-screen');
  const rows = await page.locator('table.excel-print-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())));
  // 1 + 1 + discount + 45 + return.
  assert.equal(rows.length, 1 + 1 + 1 + 45 + 1, 'a row per sale line, the bill discount, and the return');
  assert.deepEqual(rows[0].slice(1, 2).concat(rows[0].slice(5, 10)), ['Sale', '4', '48', '300', '-', '14,400']);
  assert.ok(rows.some((r) => r[1] === 'Return' && r[5] === '(1)' && r[9] === '(3,600)'), 'the return is negative, in brackets');
  // The discount row's label spans two columns, so it has one cell fewer: its figure is the last.
  assert.ok(rows.some((r) => r[1] === 'Discount' && r.at(-1) === '(500)'), 'the bill discount is its own negative row');
  assert.ok(rows.some((r) => r[7] === '600') && rows.some((r) => r[7] === '300'), 'both prices show as their own rows');

  const screenProblems = await page.evaluate(`(${alignmentProblems.toString()})(document.querySelector('[data-live-report]'))`);
  assert.deepEqual(screenProblems, [], `screen alignment: ${screenProblems.slice(0, 5).join(' | ')}`);

  // Nothing in the dates, and a backwards range: a message, never a broken table.
  await dates.nth(0).fill('2027-01-01');
  await dates.nth(1).fill('2027-01-31');
  await page.getByText('No sales found for this customer in these dates.').waitFor({ timeout: 10000 });
  await dates.nth(0).fill('2026-11-01');
  await dates.nth(1).fill('2026-10-01');
  await page.getByText('The From date is after the To date.').waitFor({ timeout: 10000 });
  await dates.nth(0).fill('2026-10-01');
  await dates.nth(1).fill('2026-10-31');
  await page.getByText('CUSTOMER TOTAL').waitFor({ timeout: 15000 });

  const preview = await openPreview(app, page);
  await shot(preview, 'customer-preview');
  const { problems, pageCount } = await previewChecks(preview, { name: 'customer', totalLabels: ['CUSTOMER TOTAL', 'AUTHORIZED SIGN'] });
  assert.deepEqual(problems, [], `print preview alignment (${pageCount} pages): ${problems.slice(0, 5).join(' | ')}`);
});

test('Article Wise: one group per price, subtotals and report total, in line on screen and on every printed page', async (t) => {
  const fx = await sale(t);
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  const page = await openSaleReport(win, app);
  await page.getByRole('button', { name: 'Article Wise', exact: true }).click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-10-01');
  await dates.nth(1).fill('2026-10-31');
  const picker = page.getByPlaceholder('Type an article code or name, then press Enter...');
  await picker.fill(fx.product.code);
  await picker.press('Enter');

  await page.getByText('REPORT TOTAL').first().waitFor({ timeout: 15000 });
  await shot(page, 'article-screen');
  const headings = await page.locator('[data-live-report] div').evaluateAll((ds) => ds.map((d) => d.innerText.trim()).filter((s) => /^PRICE /.test(s)));
  assert.equal(headings.length, 2, 'two prices, two groups');
  assert.ok(headings[0].startsWith('PRICE 300') && headings[1].startsWith('PRICE 600'), `groups in price-history order: ${headings.join(' / ')}`);
  const totals = await page.locator('tfoot tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())));
  assert.ok(totals.some((r) => r[0] === 'TOTAL @ 300'), 'a subtotal for the 300 group');
  assert.ok(totals.some((r) => r[0] === 'TOTAL @ 600'), 'a subtotal for the 600 group');
  assert.ok(totals.some((r) => r[0] === 'REPORT TOTAL'), 'and a report total');

  const screenProblems = await page.evaluate(`(${alignmentProblems.toString()})(document.querySelector('[data-live-report]'))`);
  assert.deepEqual(screenProblems, [], `screen alignment: ${screenProblems.slice(0, 5).join(' | ')}`);

  const preview = await openPreview(app, page);
  await shot(preview, 'article-preview');
  const { problems, pageCount } = await previewChecks(preview, { name: 'article', totalLabels: ['REPORT TOTAL', 'AUTHORIZED SIGN'] });
  assert.deepEqual(problems, [], `print preview alignment (${pageCount} pages): ${problems.slice(0, 5).join(' | ')}`);
});

test.after(() => closePool());
