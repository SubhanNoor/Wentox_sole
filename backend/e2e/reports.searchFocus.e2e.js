// Every report with a search bar opens with the cursor in it, ready to type (per the user,
// 2026-11-23) — and gets it back on a tab switch (Stock & Production Center) or on returning to the
// list (Business Ledger).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

const REPORTS = [
  ['3.ACCOUNT REPORTS', 'CUSTOMER REPORT', 'Search code, name, main account or city...'],
  ['3.ACCOUNT REPORTS', 'BUSINESS ACCOUNT LEDGER (KHAATA)', 'Search code, name, main account, category or city...'],
  ['3.ACCOUNT REPORTS', 'CASH BOOK SUMMARY', 'Search by account, remarks, cheque no...'],
  ['3.ACCOUNT REPORTS', 'CUSTOMER BALANCES', 'Search code or description...'],
  ['3.ACCOUNT REPORTS', 'VENDOR BALANCES', 'Search code or description...'],
  ['3.ACCOUNT REPORTS', 'PAYMENT TRAIL ALL ACCOUNTS', 'Search code or description...'],
  ['3.ACCOUNT REPORTS', 'OVERALL SEARCHING', 'Search by name, code, city, or phone...'],
  ['4.STOCK REPORTS', 'STOCK LEDGER REPORT', 'Search by article code or name...'],
  ['4.STOCK REPORTS', 'CURRENT STOCK REPORT', 'Search article, category or color...'],
  // Search bars added 2026-11-26 (these had none), and Cheque Ledger's moved off its From date.
  ['5.SALE REPORTS', 'SALES ANALYSIS REPORT', 'Search customer, city or region...'],
  ['5.SALE REPORTS', 'SALE / BILL LIST REPORT', 'Search customer, city or region...'],
  ['3.ACCOUNT REPORTS', 'VENDOR REPORT', 'Search vendor...'],
  ['3.ACCOUNT REPORTS', 'RECEIPTS AND PAYMENT TRAIL', 'Search account title...'],
  ['3.ACCOUNT REPORTS', 'TRACK CHEQUE', 'Cheque no. or customer...'], // opens on Disposal
  ['3.ACCOUNT REPORTS', 'TRACK CHEQUE', 'Cheque no. or party...', 'Cheque Ledger'],
];

const focusedPlaceholder = (page) => page.evaluate(() => document.activeElement?.getAttribute('placeholder') ?? null);

test('reports open with the cursor in their search bar', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  for (const [group, label, placeholder, tab] of REPORTS) {
    const [page] = await Promise.all([app.waitForEvent('window'), (await h.menuItem(win, group, label)).click()]);
    await page.waitForLoadState('domcontentloaded');
    if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
    await page.locator(`input[placeholder="${placeholder}"]`).first().waitFor({ timeout: 20000 });
    assert.equal(await h.eventually(() => focusedPlaceholder(page), placeholder), placeholder, `${label}: search bar focused on open`);

    if (label === 'CURRENT STOCK REPORT') {
      await page.getByRole('button', { name: 'Daily Production', exact: true }).click();
      const prod = 'Search by article code or name...';
      assert.equal(await h.eventually(() => focusedPlaceholder(page), prod), prod, 'Stock center: search focused again after a tab switch');
    }
    if (label === 'BUSINESS ACCOUNT LEDGER (KHAATA)') {
      await page.locator('tbody tr').first().click();
      await page.getByText('Back to list').click();
      assert.equal(await h.eventually(() => focusedPlaceholder(page), placeholder), placeholder, 'Business Ledger: search focused again after Back to list');
    }
    if (label === 'RECEIPTS AND PAYMENT TRAIL') {
      // The search filters: a title that matches nothing leaves only the Grand Total row.
      const rowCount = () => page.locator('.excel-print-table tbody tr').count();
      assert.ok(await h.eventually(async () => (await rowCount()) > 1, true), 'account rows listed');
      await page.keyboard.type('zzz-no-such-account');
      assert.equal(await h.eventually(rowCount, 1), 1, 'Payment Trail: search filters the account rows');
    }
    await page.close();
  }

  // Reopening a report whose window is still open only brings it forward — the cursor must still
  // end up in the search bar, even after it was moved elsewhere.
  const [page] = await Promise.all([app.waitForEvent('window'), (await h.menuItem(win, '5.SALE REPORTS', 'SALES ANALYSIS REPORT')).click()]);
  await page.waitForLoadState('domcontentloaded');
  const ph = 'Search customer, city or region...';
  assert.equal(await h.eventually(() => focusedPlaceholder(page), ph), ph, 'focused on first open');
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await focusedPlaceholder(page), null, 'cursor moved off the search bar');
  await (await h.menuItem(win, '5.SALE REPORTS', 'SALES ANALYSIS REPORT')).click();
  assert.equal(await h.eventually(() => focusedPlaceholder(page), ph), ph, 'search bar focused again on reopen');
});

test.after(() => closePool());
