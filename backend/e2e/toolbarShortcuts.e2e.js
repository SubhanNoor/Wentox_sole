// Keyboard shortcuts on the document action bar (per the user, 2026-10-16): Alt+N New, Alt+S Save,
// Alt+D Done and so on, mapping in frontend/src/lib/toolbarShortcuts.ts. Same on all 8 data entry
// pages, because they all use the one DocumentToolbar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const { makeCustomer } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const PAGES = [
  'SALE / BILL', 'SALE RETURN', 'PURCHASE', 'PURCHASE RETURN', 'STOCK VOUCHER',
  'PAYMENTS (NAAM)', 'RECEIPTS (JAMMA)', 'JOURNAL VOUCHER',
];

// [button id, Playwright key]
const KEYS = [
  ['newAction', 'Alt+KeyN'], ['remove', 'Alt+Delete'], ['editRow', 'Alt+KeyR'], ['edit', 'Alt+KeyE'],
  ['save', 'Alt+KeyS'], ['done', 'Alt+KeyD'], ['cancel', 'Alt+KeyC'],
  ['first', 'Alt+Home'], ['prev', 'Alt+ArrowLeft'], ['next', 'Alt+ArrowRight'], ['last', 'Alt+End'],
  ['print', 'Alt+KeyV'], ['find', 'Alt+KeyF'], ['unpost', 'Alt+KeyU'], ['post', 'Alt+KeyP'],
  ['exit', 'Alt+KeyX'], ['saveAndPost', 'Alt+KeyA'], ['postAll', 'Alt+Shift+KeyP'],
];

test('every action bar shortcut presses its own button on all 8 data entry pages', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  for (const label of PAGES) {
    const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', label)).click());

    // Record which bar button a key presses, without letting it act (no real Post, Exit, Delete...):
    // a window capture listener runs before React's own and stops the click there.
    await page.evaluate(() => {
      window.__pressed = [];
      window.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('button[data-shortcut]');
        if (!btn) return;
        window.__pressed.push(btn.dataset.shortcut);
        e.preventDefault();
        e.stopPropagation();
      }, true);
    });

    const newBtn = page.locator('button[data-shortcut="newAction"]');
    assert.match(await newBtn.getAttribute('title'), /\(Alt\+N\)$/, `${label}: tooltip shows the key`);
    assert.equal(await newBtn.locator('u').textContent(), 'N', `${label}: the letter is underlined`);

    // Works with the cursor in a field, the way the keys are used while typing a voucher.
    await page.locator('input:visible:not([disabled]):not([readonly])').first().focus().catch(() => {});

    for (const [id, key] of KEYS) {
      const btn = page.locator(`button[data-shortcut="${id}"]`);
      const enabled = await btn.isEnabled();
      await page.evaluate(() => { window.__pressed = []; });
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
      const pressed = await page.evaluate(() => window.__pressed);
      assert.deepEqual(pressed, enabled ? [id] : [], `${label}: ${key} ${enabled ? 'presses' : 'leaves greyed-out'} ${id}`);
    }
    await page.close();
  }
});

test('a Journal Voucher entered with the keys only: Alt+N, Alt+S, Alt+S, Alt+D make one voucher', async (t) => {
  const { customer, region } = await makeCustomer();
  const jvsOn = async () => (await query(
    'SELECT DISTINCT jv_id FROM dbo.journal_voucher_lines WHERE ba_id = @baId', { baId: customer.ba_id },
  )).recordset.length;
  t.after(async () => {
    await query('DELETE FROM dbo.journal_vouchers WHERE jv_id IN (SELECT jv_id FROM dbo.journal_voucher_lines WHERE ba_id = @baId)', { baId: customer.ba_id });
    await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
  });

  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'JOURNAL VOUCHER')).click());

  // Let the page finish opening (it auto-opens the Unposted list) with New clickable, as a person would.
  await page.locator('button[data-shortcut="newAction"]:not([disabled])').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Alt+KeyN');
  const accountField = page.getByPlaceholder('Type an account name, or press Enter to search...');
  await accountField.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await h.eventually(() => accountField.isEditable(), true), true, 'Alt+N opens a new voucher');
  await accountField.fill(customer.name);
  await accountField.press('Enter');
  const description = page.locator('label', { hasText: 'Account Description' }).locator('xpath=following-sibling::input');
  if ((await description.inputValue()) !== customer.name) {
    await page.getByText(customer.name, { exact: false }).last().click();
  }
  assert.equal(await h.eventually(() => description.inputValue(), customer.name), customer.name, 'the account must be picked');
  const amount = page.getByPlaceholder('+debit / -credit');
  await amount.click();
  await amount.pressSequentially('100');
  await amount.press('Enter');

  await page.keyboard.press('Alt+KeyS');
  assert.equal(await h.eventually(() => jvsOn(), 1, 10000), 1, 'Alt+S saves the voucher');
  await page.keyboard.press('Alt+KeyS');
  await page.waitForTimeout(800);
  await page.keyboard.press('Alt+KeyD');
  await page.waitForTimeout(1500);
  assert.equal(await jvsOn(), 1, 'Alt+S again and Alt+D update the same voucher');
});

test.after(() => closePool());
