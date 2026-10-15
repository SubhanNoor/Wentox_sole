// Vendor Report in the Product Ledger layout (per the user, 2026-10-14): filter bar on top, the
// printed document live under it; "Show Print Preview" opens the preview in its OWN new window, and
// closing the preview closes that window with focus back on the report window. Also the Balance
// column (the vendor's real ledger balance on the To date, so a purchase from BEFORE the period
// still shows as owed — per the user, 2026-10-13), Skip Zero Balances, and the single-vendor ledger.
'use strict';

const test = require('node:test');
const h = require('./harness');
const assert = require('node:assert/strict');
const { closePool } = require('../src/db/pool');
const purchasesService = require('../src/services/purchases.service');
const { makeVendor, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Rows of the paginated preview sheets only — the modal also keeps a hidden master copy of the
// document for measuring page breaks, which would otherwise double every match.
async function previewRows(page) {
  return page.locator('.report-preview-sheet tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('th,td')].map((c) => c.innerText.trim())));
}

// Preview opens a NEW window holding only the print preview; returns that window.
async function openPreview(app, trigger) {
  const [previewWin] = await Promise.all([app.waitForEvent('window'), trigger()]);
  await previewWin.waitForLoadState('domcontentloaded');
  await previewWin.locator('.report-preview-sheet').first().waitFor({ timeout: 20000 });
  return previewWin;
}

// Closing the preview (Esc) closes its whole window.
async function closePreview(previewWin) {
  // The window closes during the key press itself, so the press can report "target closed".
  await Promise.all([previewWin.waitForEvent('close'), previewWin.keyboard.press('Escape').catch(() => {})]);
}

test('Vendor Report: live document, preview window, Balance, Skip Zero and a vendor ledger', async (t) => {
  const created = {};
  t.after(() => cleanupFixtures(created));
  const vendor = await makeVendor();
  created.vendorId = vendor.vendor_id;
  // A second vendor with nothing at all: zero balance, for Skip Zero Balances.
  const zeroVendor = await makeVendor();
  t.after(() => cleanupFixtures({ vendorId: zeroVendor.vendor_id }));
  const purchase = await purchasesService.create({
    vendor_id: vendor.vendor_id,
    purchase_date: '2026-01-05',
    bill_no: uniqueName('PBILL'),
    items: [{ material_name: uniqueName('MATERIAL'), unit: 'KG', quantity: 10, price_per_unit: 50 }],
  }, null);
  created.purchaseId = purchase.purchase_id;
  created.materialIds = purchase.items.map((item) => item.material_id);
  await purchasesService.post(purchase.purchase_id);

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  const [page] = await Promise.all([
    app.waitForEvent('window'),
    (await h.menuItem(win, '3.ACCOUNT REPORTS', 'VENDOR REPORT')).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');

  const preview = page.getByRole('button', { name: 'Show Print Preview' });
  await preview.waitFor({ timeout: 20000 });
  const screenRows = () => page.locator('[data-live-report] tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('th,td')].map((c) => c.innerText.trim())));

  // February: no purchase in the period, but January's 500 is still owed.
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-02-01');
  await dates.nth(1).fill('2026-02-28');

  // The summary is on screen, no Preview needed.
  await page.locator('[data-live-report] td', { hasText: vendor.name }).first().waitFor();
  let rows = await screenRows();
  const header = rows.find((r) => r.includes('Balance'));
  const balanceCol = header.indexOf('Balance');
  const owed = rows.find((r) => r[0] === vendor.name);
  assert.ok(owed, 'vendor listed in the summary');
  assert.match(owed[balanceCol], /\(?-?500(\.00)?\)?/, `balance cell: ${owed.join(' | ')}`);
  assert.ok(rows.some((r) => r[0] === zeroVendor.name), 'zero-balance vendor listed while Skip Zero is off');

  // Show Print Preview: a new window with the same rows; closing it closes that window and focus
  // comes back to the report window, filters kept.
  let previewWin = await openPreview(app, () => preview.click());
  assert.equal(await page.locator('.report-preview-sheet').count(), 0, 'the preview is not drawn over the report window');
  const printed = await previewRows(previewWin);
  assert.deepEqual(printed.find((r) => r[0] === vendor.name), owed, 'preview matches the screen');
  await closePreview(previewWin);
  assert.equal(await dates.nth(0).inputValue(), '2026-02-01');
  const focusedUrl = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? '');
  assert.ok(focusedUrl.includes('tab=vendor') && !focusedUrl.includes('autoPreview'), `focus back on the report window: ${focusedUrl}`);

  // Skip Zero Balances: the zero vendor drops out, the owed one stays.
  await page.getByRole('radio', { name: 'Skip Zero Balances' }).click();
  await page.waitForFunction((name) => ![...document.querySelectorAll('[data-live-report] td')].some((td) => td.innerText.trim() === name), zeroVendor.name);
  rows = await screenRows();
  assert.ok(rows.some((r) => r[0] === vendor.name), 'a vendor with a balance stays');

  // Picking a vendor shows its ledger statement, opening at the same 500 owed.
  await page.getByRole('button', { name: 'All vendors (summary)' }).click();
  await page.getByPlaceholder('Type a vendor name...').fill(vendor.name);
  await page.getByPlaceholder('Type a vendor name...').press('Enter');
  await page.locator('[data-live-report] h2', { hasText: 'VENDOR LEDGER STATEMENT' }).waitFor();
  rows = await screenRows();
  const opening = rows.find((r) => r.includes('Opening Balance'));
  assert.ok(opening, 'ledger statement has an Opening Balance row');
  assert.match(opening.at(-1), /\(?-?500(\.00)?\)?/, 'opening = January purchase still owed');
  previewWin = await openPreview(app, () => preview.click());
  assert.match(await previewWin.locator('.report-preview-sheet h2').first().innerText(), /VENDOR LEDGER STATEMENT/);
});

test.after(() => closePool());
