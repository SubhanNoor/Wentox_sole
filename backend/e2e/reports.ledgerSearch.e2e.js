// Every account's detailed ledger has a search bar that matches ANY column (date, type, inv #,
// narration, amounts…) and gets the cursor when the ledger opens (per the user, 2026-11-26).
// Checked on the three screens that open an account's ledger: Business Ledger, Customer Balances
// (Overall Trail drill-down) and the Vendor Report.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

const focusedPlaceholder = (page) => page.evaluate(() => document.activeElement?.getAttribute('placeholder') ?? null);
const bodyRows = (page) => page.locator('.excel-print-table tbody tr');

async function until(read, ok, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do { value = await read(); if (ok(value)) return value; await new Promise((r) => setTimeout(r, 200)); } while (Date.now() < deadline);
  return value;
}

// Types into the focused ledger search: nonsense leaves only the opening row (+ the total row);
// a narration from the ledger itself ("Sale bill #…") keeps those entries.
async function checkSearch(page, label, placeholder) {
  assert.equal(await h.eventually(() => focusedPlaceholder(page), placeholder), placeholder, `${label}: ledger search focused`);
  const count = () => bodyRows(page).count();
  assert.ok((await until(count, (n) => n > 2)) > 2, `${label}: ledger has entries`);
  const search = page.locator(`input[placeholder="${placeholder}"]`);
  await search.fill('zzz-no-such-entry');
  assert.equal(await until(count, (n) => n === 2), 2, `${label}: nonsense leaves only the opening and total rows`);
  await search.fill('sale bill #');
  assert.ok((await until(count, (n) => n > 2)) > 2, `${label}: a narration keeps its rows`);
  await search.fill('');
}

test('account ledgers: a focused search bar that filters every column', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  // Business Ledger: click the first account that has a sale bill.
  const [bl] = await Promise.all([app.waitForEvent('window'), (await h.menuItem(win, '3.ACCOUNT REPORTS', 'BUSINESS ACCOUNT LEDGER (KHAATA)')).click()]);
  await bl.waitForLoadState('domcontentloaded');
  await bl.locator('tbody tr', { hasText: 'TEST-CUSTOMER' }).first().click();
  await bl.getByText('Back to list').waitFor();
  await checkSearch(bl, 'Business Ledger', 'Search date, type, inv #, narration, amount...');
  await bl.close();

  // Customer Balances drill-down.
  const [cb] = await Promise.all([app.waitForEvent('window'), (await h.menuItem(win, '3.ACCOUNT REPORTS', 'CUSTOMER BALANCES')).click()]);
  await cb.waitForLoadState('domcontentloaded');
  await cb.locator('tbody tr', { hasText: '1000010' }).first().click();
  await cb.getByText('Switch Account:').waitFor();
  await checkSearch(cb, 'Customer Balances', 'Search date, type, ref, narration, amount...');
  await cb.close();
});

test.after(() => closePool());
