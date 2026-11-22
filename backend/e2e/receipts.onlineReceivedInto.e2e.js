// Receipts, ONLINE mode: picking "Received Into" with the keyboard (Enter to open the picker, Enter
// to pick) must move on to the next field, and Enter on an already-picked Received Into must move
// on too — never reopen the picker searching the account's full label (which matches nothing).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

test('Receipts ONLINE: Received Into is picked and left with Enter alone', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click());
  await h.click(page, 'New');
  await page.waitForTimeout(500);

  await page.locator('select').filter({ has: page.locator('option[value="ONLINE"]') }).first().selectOption('ONLINE');
  const trigger = page.locator('input[placeholder="Type an account name, or press Enter to search..."]').nth(1); // [0] = the entry's A/C, [1] = Received Into
  await trigger.waitFor();
  await trigger.focus();

  const activeInfo = () => page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, ph: a?.getAttribute('placeholder'), title: a?.getAttribute('title'), value: a?.value };
  });

  await page.keyboard.press('Enter'); // opens the picker
  await page.getByPlaceholder('Search account...').waitFor();
  await page.keyboard.press('Enter'); // picks the highlighted account
  await page.waitForTimeout(400);
  const picked = await trigger.inputValue();
  assert.ok(picked.length > 0, 'an account was picked');
  const afterPick = await activeInfo();

  // Back on the picked Received Into, Enter must move on — it used to reopen the picker searching
  // the account's full label ("NAME (CODE) — PARENT"), which matches nothing (2026-11-19).
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const reopened = await page.getByPlaceholder('Search account...').isVisible().catch(() => false);
  const afterEnter = await activeInfo();
  assert.equal(afterPick.ph === 'Type an account name, or press Enter to search...', false, 'picking must move focus off Received Into');
  assert.equal(reopened, false, 'Enter on a picked Received Into must not reopen the picker');
  assert.notEqual(afterEnter.ph, 'Type an account name, or press Enter to search...', 'Enter must move to the next field');
});

test.after(() => closePool());
