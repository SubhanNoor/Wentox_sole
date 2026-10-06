// Journal Voucher — Save (keep editing) on a NEW voucher, then Save and Done again, must keep
// updating that ONE voucher. It used to create() a fresh duplicate voucher, under a new number, on
// every press after the first (2026-10-06).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const { makeCustomer } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

const jvsOn = async (baId) => (await query(
  'SELECT DISTINCT jv_id FROM dbo.journal_voucher_lines WHERE ba_id = @baId', { baId },
)).recordset.length;

test('Journal Voucher: Save then Save/Done on a new voucher updates it, never duplicates it', async (t) => {
  const { customer, region } = await makeCustomer();
  t.after(async () => {
    const params = { baId: customer.ba_id };
    await query('DELETE FROM dbo.journal_vouchers WHERE jv_id IN (SELECT jv_id FROM dbo.journal_voucher_lines WHERE ba_id = @baId)', params);
    await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
  });

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'JOURNAL VOUCHER')).click());

  await h.click(page, 'New');
  const accountField = page.getByPlaceholder('Type an account name, or press Enter to search...');
  await accountField.fill(customer.name);
  await accountField.press('Enter');
  // Enter either picks the one unambiguous match outright or opens Select Account seeded with it.
  const description = page.locator('label', { hasText: 'Account Description' }).locator('xpath=following-sibling::input');
  if ((await description.inputValue()) !== customer.name) {
    await page.getByText(customer.name, { exact: false }).last().click();
  }
  assert.equal(await h.eventually(() => description.inputValue(), customer.name), customer.name, 'the account must be picked');
  const amount = page.getByPlaceholder('+debit / -credit');
  await amount.click();
  await amount.pressSequentially('100');
  await amount.press('Enter');

  await h.click(page, 'Save');
  assert.equal(await h.eventually(() => jvsOn(customer.ba_id), 1, 10000), 1, 'the first Save creates the voucher');
  await h.click(page, 'Save');
  await h.click(page, 'Done');
  await page.waitForTimeout(1500);
  assert.equal(await jvsOn(customer.ba_id), 1, 'Save and Done after the first Save must update the same voucher');
});

test.after(() => closePool());
