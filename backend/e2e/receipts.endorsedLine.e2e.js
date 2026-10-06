// Receipts (Jamma) — an endorsed entry is a line of its voucher (per the user, 2026-10-05). On the
// real screen: the endorsed line shows in the voucher's detail rows marked "Endorsed → <account>",
// Total Endorsed carries it, deleting one goes through the password prompt (the server now checks
// that password too), Post posts it TOGETHER with the ordinary lines — it used to post alone and
// leave the ordinary lines behind, looking erased — and Overall Records shows it on its voucher's
// row rather than as a separate settlement.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { query, closePool } = require('../src/db/pool');
const receiptVouchersService = require('../src/services/receiptVouchers.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const settlementsService = require('../src/services/settlements.service');
const { makeCustomer, makeVendor } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

test('Receipts: an endorsed entry shows in the voucher and posts with its other entries', async (t) => {
  const { customer, region } = await makeCustomer();
  const vendor = await makeVendor();
  // Far-future date so this is the newest unposted voucher — the one Unposted opens.
  const voucher = await receiptVouchersService.create({ voucher_date: '2099-12-30' }, null);
  t.after(async () => {
    try { await receiptVouchersService.unpost(voucher.voucher_id, undefined); } catch { /* not posted */ }
    try { await receiptVouchersService.remove(voucher.voucher_id, null); } catch { /* already gone */ }
    // Posting moved the cash line into dbo.receipts; remove() only takes an UNPOSTED voucher's lines.
    await query(`DELETE FROM dbo.ledger_entries WHERE source_type IN ('RECEIPT', 'COMMISSION')
      AND source_id IN (SELECT receipt_id FROM dbo.receipts WHERE ba_id = @baId)`, { baId: customer.ba_id });
    await query('DELETE FROM dbo.receipts WHERE ba_id = @baId', { baId: customer.ba_id });
    await query('DELETE FROM dbo.draft_receipts WHERE ba_id = @baId', { baId: customer.ba_id });
    await cleanupFixtures({
      customerId: customer.customer_id, ba_id: customer.ba_id, regionId: region.region_id, vendorId: vendor.vendor_id,
    });
  });

  await draftReceiptsService.create({
    voucher_id: voucher.voucher_id, ba_id: customer.ba_id, receipt_date: '2099-12-30', amount: 700, payment_mode: 'CASH',
  }, null, undefined);
  const endorsement = await settlementsService.create({
    voucher_id: voucher.voucher_id, settlement_date: '2099-12-30', from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id,
    amount: 300, payment_mode: 'CHEQUE', cheque_no: 'E2E-1',
  }, null, undefined);
  const toDelete = await settlementsService.create({
    voucher_id: voucher.voucher_id, settlement_date: '2099-12-30', from_ba_id: customer.ba_id, to_ba_id: vendor.ba_id,
    amount: 50, remarks: 'E2E-DELETE-ME',
  }, null, undefined);

  const session = await h.launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await h.login(win);
  const page = await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click());

  await h.chooseFilter(page, 'unposted');
  const endorsedMark = page.getByText(`Endorsed → ${vendor.name}`, { exact: true }).first();
  await endorsedMark.waitFor({ timeout: 10000 });
  assert.equal(await page.locator('tbody tr', { hasText: customer.name }).count(), 3,
    'the ordinary line and both endorsed lines must be detail rows of the voucher');
  const totalEndorsed = page.locator('label', { hasText: 'Total Endorsed' }).locator('xpath=following-sibling::input');
  assert.match(await totalEndorsed.inputValue(), /350/);

  // Delete one endorsed line through its row's Delete and the password prompt.
  const deleteRow = page.locator('tbody tr', { hasText: 'E2E-DELETE-ME' });
  await deleteRow.locator('button[title="Delete this entry (asks for your password)"]').click();
  await page.locator('input[type="password"]').fill('admin123');
  await page.locator('input[type="password"]').press('Enter');
  const remaining = await h.eventually(async () => (await query(
    'SELECT COUNT(*) AS n FROM dbo.settlements WHERE settlement_id = @id', { id: toDelete.settlement_id },
  )).recordset[0].n, 0, 10000);
  assert.equal(remaining, 0, 'the endorsed line must be deleted once the password is confirmed');
  assert.equal(await h.eventually(() => deleteRow.count(), 0), 0, 'the deleted line must leave the grid');
  const totalAfterDelete = async () => {
    const value = await totalEndorsed.inputValue();
    return /300/.test(value) && !/350/.test(value) ? true : value;
  };
  assert.equal(await h.eventually(totalAfterDelete, true), true, 'Total Endorsed must drop to 300');

  await h.click(page, 'Post');
  const posted = await h.eventually(
    async () => (await receiptVouchersService.getById(voucher.voucher_id)).status, 'POSTED', 10000,
  );
  assert.equal(posted, 'POSTED', 'Post must post the endorsed line and the ordinary line together');
  const v = await receiptVouchersService.getById(voucher.voucher_id);
  assert.equal(v.lines.length, 2, 'no line may disappear from the voucher on Post');
  assert.ok(v.lines.every((l) => l.status === 'CONFIRMED'));

  // Overall Records: the endorsed line is on its voucher's row, not a "Settlement #" row of its own.
  await page.getByRole('button', { name: 'Overall Records', exact: true }).click();
  const voucherRow = page.locator('tbody tr', { hasText: `#${voucher.voucher_no}` }).filter({ hasText: '+ 1 Endorsed' });
  await voucherRow.waitFor({ timeout: 10000 });
  assert.equal(await page.getByText(`Settlement #${endorsement.settlement_id}`, { exact: true }).count(), 0,
    'an endorsement made on a voucher must not be listed as a separate settlement');
  assert.match(await voucherRow.innerText(), /1,000/, 'the row total must include the endorsed amount (700 + 300)');
  await voucherRow.click();
  await page.getByText(`→ ${vendor.name}`, { exact: true }).waitFor({ timeout: 10000 });
});

test.after(() => closePool());
