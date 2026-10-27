// The safeguards of 2026-10-25 on the real screens:
//   - Books Check: a cheque entered twice puts a red "Books Check" button in the main window's header,
//     and its panel names the cheque.
//   - A1: typing a cheque number this party already gave, on the Receipts screen, stops at a
//     "Cheque already entered" prompt; confirming saves it.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const { makeCustomer, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function postedCheque(baId, chequeNo, extra = {}) {
  const r = await receiptsService.create({
    ba_id: baId, receipt_date: '2026-04-01', amount: 4321, payment_mode: 'CHEQUE',
    cheque_no: chequeNo, cheque_date: '2026-04-01', ...extra,
  }, null, undefined);
  await receiptsService.post(r.receipt_id, undefined);
  return r;
}

// Everything a test left against this customer: voucher lines, vouchers, posted receipts, the party.
function cleanupCustomer(t, customer, region) {
  t.after(async () => {
    const vouchers = (await query('SELECT DISTINCT voucher_id FROM dbo.draft_receipts WHERE ba_id = @b AND voucher_id IS NOT NULL', { b: customer.ba_id })).recordset;
    for (const { voucher_id: id } of vouchers) {
      try { await receiptVouchersService.remove(id, null); } catch { /* already gone */ }
    }
    await query('DELETE FROM dbo.draft_receipts WHERE ba_id = @b', { b: customer.ba_id });
    const receipts = (await query('SELECT receipt_id FROM dbo.receipts WHERE ba_id = @b', { b: customer.ba_id })).recordset;
    for (const { receipt_id: id } of receipts) await cleanupFixtures({ receiptId: id });
    await cleanupFixtures({ customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id });
  });
}

test('Books Check: a cheque entered twice shows a red notice that names it', async (t) => {
  const { customer, region } = await makeCustomer();
  cleanupCustomer(t, customer, region);
  const chequeNo = uniqueName('E2EBC');
  await postedCheque(customer.ba_id, chequeNo);
  await postedCheque(customer.ba_id, chequeNo, { allow_duplicate_cheque: true });

  const session = await h.launchApp();
  t.after(() => session.close());
  const { win } = session;
  await h.login(win);

  const notice = win.getByRole('button', { name: /Books Check: \d+ problem/ });
  await notice.waitFor({ timeout: 15000 });
  await notice.click();
  await win.getByText('No cheque entered twice for the same party').waitFor();
  assert.ok(await win.getByText(chequeNo, { exact: false }).first().isVisible(), 'the panel names the duplicate cheque');
  await win.keyboard.press('Escape');
  await win.getByText('No cheque entered twice for the same party').waitFor({ state: 'hidden' });
});

test('A1: entering a cheque number the party already gave asks first, and saves once confirmed', async (t) => {
  const { customer, region } = await makeCustomer();
  cleanupCustomer(t, customer, region);
  const chequeNo = uniqueName('E2EA1');
  const existing = await postedCheque(customer.ba_id, chequeNo);

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click());

  await h.click(page, 'New');
  const account = page.getByPlaceholder('Type an account name, or press Enter to search...').first();
  await account.fill(customer.name);
  await account.press('Enter');
  // Enter either picks the one account the text means, or opens the picker seeded with it — then
  // Enter again takes the highlighted match.
  const picker = page.getByText('Select Account', { exact: true });
  if (await picker.isVisible().catch(() => false)) {
    await page.keyboard.press('Enter');
    await picker.waitFor({ state: 'hidden' });
  }
  await page.locator('select', { has: page.locator('option[value="CHEQUE"]') }).first().selectOption('CHEQUE');
  await page.getByPlaceholder('Cheque No.').fill(chequeNo);
  await page.locator('input[title="Date on Cheque"]').fill('2026-04-02');
  await page.getByPlaceholder('Amount').first().fill('4321');
  await h.click(page, 'Done');

  const prompt = page.getByText('Cheque already entered', { exact: true });
  await prompt.waitFor({ timeout: 10000 });
  assert.ok(await page.getByText(`receipt #${existing.receipt_id}`, { exact: false }).first().isVisible(), 'the prompt names the existing receipt');
  const drafts = async () => (await query('SELECT COUNT(*) AS n FROM dbo.draft_receipts WHERE ba_id = @b AND cheque_no = @c', { b: customer.ba_id, c: chequeNo })).recordset[0].n;
  assert.equal(await drafts(), 0, 'nothing is saved until the operator confirms');

  await page.getByRole('button', { name: "It's a different cheque — save" }).click();
  assert.equal(await h.eventually(drafts, 1, 10000), 1, 'confirming saves the line');
});

test.after(async () => {
  await closePool();
});
