// The client's Quick Menu after the 2026-11-25 update (per the user): the page pinned as
// "Search & Bilty Adda Updation" is renamed "Search" (as is its 2.DATA ENTRY menu item), and
// BILTY ADDA comes off the bar — whether 1.11.5 put it back or the client pinned it. Everything
// else on the bar stays as it was.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

const BAR_KEY = 'wento_quick_shortcuts_clean_v3';

// Reload the main window with this stored bar and these one-off markers already set.
async function withBar(win, bar, doneKeys) {
  await win.evaluate(({ BAR_KEY, bar, doneKeys }) => {
    localStorage.setItem(BAR_KEY, JSON.stringify(bar));
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('wento_quick_shortcuts_') && k !== BAR_KEY && k !== 'wento_quick_shortcuts_seed') localStorage.removeItem(k);
    }
    for (const k of doneKeys) localStorage.setItem(k, '1');
  }, { BAR_KEY, bar, doneKeys });
  await win.reload();
  await h.quickMenu(win, 'Sale Bill').waitFor();
}
const labels = (win) => win.evaluate((key) => JSON.parse(localStorage.getItem(key)).map((s) => s.label), BAR_KEY);

const BASE = [
  { id: 'default_sale-bill', label: 'Sale Bill', page: 'sale-bill' },
  { id: 'default_stock-voucher', label: 'Stock', page: 'stock-voucher' },
];

test('client bar: BILTY ADDA removed, the Bilty Adda Updation pin renamed "Search", the rest kept', async (t) => {
  const { win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  // Running 1.11.5 (as in the client's screenshot): BILTY ADDA back on the bar, page pinned under its old title.
  await withBar(win, [
    ...BASE,
    { id: 'default_setup-adda', label: 'BILTY ADDA', page: 'setup-adda' },
    { id: 'bilty-update_main_1', label: 'Search & Bilty Adda Updation', page: 'bilty-update' },
  ], ['wento_quick_shortcuts_retired_2026-11-18', 'wento_quick_shortcuts_adda_swap_2026-11-25']);
  assert.deepEqual(await labels(win), ['Sale Bill', 'Stock', 'Search'], '1.11.5 machine');
  assert.equal(await h.quickMenu(win, 'BILTY ADDA').count(), 0);
  assert.equal(await h.quickMenu(win, 'Search').count(), 1);

  // Still on 1.11.4: Search Customer pinned, no BILTY ADDA — none must come back.
  await withBar(win, [
    ...BASE,
    { id: 'default_search-customer', label: 'Search Customer', page: 'search-customer' },
  ], ['wento_quick_shortcuts_retired_2026-11-18']);
  assert.deepEqual(await labels(win), ['Sale Bill', 'Stock'], '1.11.4 machine');

  // The menu item itself is renamed too.
  assert.equal(await (await h.menuItem(win, '2.DATA ENTRY', 'SEARCH')).count(), 1, '2.DATA ENTRY lists SEARCH');
});

test.after(() => closePool());
