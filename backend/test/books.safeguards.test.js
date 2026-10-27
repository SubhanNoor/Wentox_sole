// Regression: the safeguards added after one paper cheque entered twice left the client's balances
// wrong (2026-10-25) — Dasti Lain Dain +50,000 and Dilshad Chapal +100,000.
//   A1  a cheque number this party has already given (and not had returned) needs confirming
//   A2  a fully bounced cheque that was re-entered as a new receipt can't be used again as well
//   A3  a cheque can't be endorsed back to the account that gave it — that is Return to sender
//   B   the Books Check names a duplicate cheque the moment it exists
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const draftReceiptsService = require('../src/services/draftReceipts.service');
const chequesService = require('../src/services/cheques.service');
const booksCheckService = require('../src/services/booksCheck.service');
const { setupChequeFixtures, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

// Extra receipts/drafts a test makes beyond the fixture's one receiptId. Registered BEFORE the
// fixture, so it runs first — the fixture's own cleanup deletes the customer these point at.
function extraCleanup(t) {
  const receiptIds = [];
  const draftIds = [];
  t.after(async () => {
    for (const id of draftIds) await query('DELETE FROM dbo.draft_receipts WHERE draft_id = @id', { id });
    for (const id of receiptIds) await cleanupFixtures({ receiptId: id });
  });
  return { receiptIds, draftIds };
}

async function postedCheque(baId, chequeNo, extra = {}) {
  const r = await receiptsService.create({
    ba_id: baId, receipt_date: '2026-04-01', amount: 5000, payment_mode: 'CHEQUE',
    cheque_no: chequeNo, cheque_date: '2026-04-01', ...extra,
  }, null, undefined);
  await receiptsService.post(r.receipt_id, undefined);
  return receiptsService.getById(r.receipt_id);
}

const draftLine = (baId, chequeNo, extra = {}) => draftReceiptsService.create({
  ba_id: baId, receipt_date: '2026-04-02', amount: 5000, payment_mode: 'CHEQUE',
  cheque_no: chequeNo, cheque_date: '2026-04-02', ...extra,
}, null, undefined);

test('A1: the same cheque number from the same party needs confirming; another party or a returned cheque does not', async (t) => {
  const extra = extraCleanup(t);
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const chequeNo = uniqueName('DUP');
  const first = await postedCheque(customer.ba_id, chequeNo);
  created.receiptId = first.receipt_id;

  await assert.rejects(draftLine(customer.ba_id, chequeNo), (e) => e.code === 'DUPLICATE_CHEQUE' && e.message.includes(`receipt #${first.receipt_id}`));
  await assert.rejects(draftLine(customer.ba_id, ` ${chequeNo} `), (e) => e.code === 'DUPLICATE_CHEQUE', 'spaces around the number do not hide it');

  const confirmed = await draftLine(customer.ba_id, chequeNo, { allow_duplicate_cheque: true });
  extra.draftIds.push(confirmed.draft_id);
  // Editing that same line again checks against the OTHER records, not itself.
  await assert.rejects(
    draftReceiptsService.update(confirmed.draft_id, { ba_id: customer.ba_id, receipt_date: '2026-04-02', amount: 5000, payment_mode: 'CHEQUE', cheque_no: chequeNo, cheque_date: '2026-04-02' }, null, undefined),
    (e) => e.code === 'DUPLICATE_CHEQUE',
  );

  const otherParty = await draftLine(vendor.ba_id, chequeNo);
  extra.draftIds.push(otherParty.draft_id);

  await chequesService.returnToSender(first.cheque_id, { returned_date: '2026-04-03', reason: 'test' }, null);
  await query('DELETE FROM dbo.draft_receipts WHERE draft_id = @id', { id: confirmed.draft_id });
  const afterReturn = await draftLine(customer.ba_id, chequeNo);
  extra.draftIds.push(afterReturn.draft_id);
});

test('A2: a bounced cheque re-entered as a new receipt cannot be used again as well; a bounced cheque never re-entered still can', async (t) => {
  const extra = extraCleanup(t);
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const chequeNo = uniqueName('REENT');
  const old = await postedCheque(customer.ba_id, chequeNo);
  created.receiptId = old.receipt_id;
  await chequesService.bounce(old.cheque_id, { bounced_date: '2026-04-05' }, null);
  assert.equal((await chequesService.getById(old.cheque_id)).cheque_status, 'BOUNCED');

  const again = await postedCheque(customer.ba_id, chequeNo, { allow_duplicate_cheque: true });
  extra.receiptIds.push(again.receipt_id);

  await assert.rejects(
    chequesService.endorseToVendor(old.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-04-06' }, null, undefined),
    (e) => e.code === 'CHEQUE_REENTERED' && e.message.includes(`receipt #${again.receipt_id}`),
  );
  const customerBefore = (await query('SELECT ISNULL(SUM(debit),0)-ISNULL(SUM(credit),0) AS n FROM dbo.ledger_entries WHERE ba_id = @b', { b: customer.ba_id })).recordset[0].n;
  assert.equal(Number(customerBefore), -5000, 'credited once — the refused reuse wrote no re-credit');

  // The re-entered receipt is the one to use, and it works.
  await chequesService.endorseToVendor(again.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-04-06' }, null, undefined);

  // Unaffected: a bounced cheque nobody re-entered is reused exactly as before.
  const solo = await postedCheque(customer.ba_id, uniqueName('SOLO'));
  extra.receiptIds.push(solo.receipt_id);
  await chequesService.bounce(solo.cheque_id, { bounced_date: '2026-04-05' }, null);
  await chequesService.endorseToVendor(solo.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-04-06' }, null, undefined);
  assert.equal((await chequesService.getById(solo.cheque_id)).cheque_status, 'ENDORSED');
});

test('A3: a cheque cannot be endorsed or paid back to the account that gave it', async (t) => {
  const extra = extraCleanup(t);
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const fromCustomer = await postedCheque(customer.ba_id, uniqueName('BACK'));
  created.receiptId = fromCustomer.receipt_id;
  await assert.rejects(
    chequesService.endorseToExpense(fromCustomer.cheque_id, { target_ba_id: customer.ba_id, allocation_date: '2026-04-07' }, null, undefined),
    (e) => e.code === 'CHEQUE_BACK_TO_GIVER' && /Return to sender/.test(e.message),
  );

  // A receipt can name any account — a vendor who handed us a cheque can't be paid with it either.
  const fromVendor = await postedCheque(vendor.ba_id, uniqueName('BACKV'));
  extra.receiptIds.push(fromVendor.receipt_id);
  await assert.rejects(
    chequesService.endorseToVendor(fromVendor.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-04-07' }, null, undefined),
    (e) => e.code === 'CHEQUE_BACK_TO_GIVER',
  );

  // Handing it to anyone else is untouched, and giving it back is Return to sender.
  await chequesService.endorseToVendor(fromCustomer.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-04-07' }, null, undefined);
  await chequesService.returnToSender(fromVendor.cheque_id, { returned_date: '2026-04-07', reason: 'given back' }, null);
  assert.equal((await chequesService.getById(fromVendor.cheque_id)).cheque_status, 'RETURNED');
});

test('B: the Books Check names a cheque entered twice, and clears once it is gone', async (t) => {
  const extra = extraCleanup(t);
  const { customer, created } = await setupChequeFixtures(t);
  const chequeNo = uniqueName('BOOKS');
  const first = await postedCheque(customer.ba_id, chequeNo);
  created.receiptId = first.receipt_id;
  const second = await postedCheque(customer.ba_id, chequeNo, { allow_duplicate_cheque: true });
  extra.receiptIds.push(second.receipt_id);

  const mentions = (result) => result.checks.find((c) => c.key === 'duplicate_cheques').rows.some((r) => r.includes(chequeNo));
  const dirty = await booksCheckService.run();
  assert.equal(dirty.ok, false);
  assert.ok(mentions(dirty), 'the duplicate is listed by cheque number');
  assert.ok(dirty.checks.find((c) => c.key === 'trial_balance').ok, 'debits still equal credits');
  assert.ok(dirty.checks.find((c) => c.key === 'cheques_in_hand').ok, 'Cheques in Hand still matches');

  await chequesService.returnToSender(second.cheque_id, { returned_date: '2026-04-08', reason: 'duplicate entry' }, null);
  assert.ok(!mentions(await booksCheckService.run()), 'a returned duplicate no longer counts');
});

test('B: a receipt bounced, re-used, then returned is not reported as reversed twice', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const r = await postedCheque(customer.ba_id, uniqueName('REV'));
  created.receiptId = r.receipt_id;
  await chequesService.bounce(r.cheque_id, { bounced_date: '2026-04-09' }, null);
  await chequesService.endorseToVendor(r.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-04-10' }, null, undefined);
  const { allocation_id: allocationId } = (await query(
    "SELECT allocation_id FROM dbo.cheque_allocations WHERE receipt_id = @id AND status = 'ACTIVE'", { id: r.receipt_id },
  )).recordset[0];
  await chequesService.reverseAllocation(allocationId, { date: '2026-04-11' }, null);
  await chequesService.returnToSender(r.cheque_id, { returned_date: '2026-04-12', reason: 'test' }, null);

  const doubles = (await booksCheckService.run()).checks.find((c) => c.key === 'double_postings');
  assert.ok(!doubles.rows.some((row) => row.includes(`#${r.receipt_id}`)), `receipt #${r.receipt_id} wrongly flagged: ${doubles.rows.join(' | ')}`);
});

test.after(async () => {
  await closePool();
});
