// Regression: a cheque that bounced and was then entered AGAIN left two records for one piece of
// paper, and the old BOUNCED one kept showing as an open, fully unallocated cheque (client,
// 2026-11-17: the directory's Unallocated total ran 100,000 ahead of CHEQUES IN HAND). The ledger
// was right — a bounce reverses the receipt — only the stale record's status misled the screen.
// cheques.list() now flags such a record `reentered`; migration 049 settles the existing ones.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const chequesService = require('../src/services/cheques.service');
const { setupChequeFixtures, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

async function postCheque(customer, chequeNo, amount, date, extra = {}) {
  const receipt = await receiptsService.create({
    ba_id: customer.ba_id, receipt_date: date, amount, payment_mode: 'CHEQUE',
    cheque_no: chequeNo, cheque_date: date, ...extra,
  }, null, undefined);
  await receiptsService.post(receipt.receipt_id, undefined);
  const posted = await receiptsService.getById(receipt.receipt_id);
  return { receiptId: receipt.receipt_id, chequeId: posted.cheque_id };
}

async function flagsFor(chequeNo) {
  const rows = (await chequesService.list({})).filter((c) => c.cheque_no === chequeNo);
  return Object.fromEntries(rows.map((c) => [c.cheque_id, { status: c.cheque_status, reentered: !!c.reentered }]));
}

// After-hooks run in the order they were registered, and the extra receipts made here must go
// BEFORE the bank and customer they point at — so call this BEFORE setupChequeFixtures(t).
function trackExtra(t, ids) {
  t.after(async () => { for (const id of ids) await cleanupFixtures({ receiptId: id }); });
}

test('bounced, then entered again and deposited: only the old record is flagged', async (t) => {
  const extra = [];
  trackExtra(t, extra); // registered first so it runs before the fixtures' own cleanup
  const { customer, bank, created } = await setupChequeFixtures(t);
  const no = uniqueName('ABC');
  const old = await postCheque(customer, no, 100000, '2026-09-20');
  created.receiptId = old.receiptId;
  await chequesService.bounce(old.chequeId, { bounced_date: '2026-09-22' }, null);
  const fresh = await postCheque(customer, no, 100000, '2026-09-22', { allow_duplicate_cheque: true });
  extra.push(fresh.receiptId);
  await chequesService.deposit(fresh.chequeId, { bank_id: bank.bank_id, allocation_date: '2026-11-04' }, null, undefined);

  const flags = await flagsFor(no);
  assert.deepEqual(flags[old.chequeId], { status: 'BOUNCED', reentered: true }, 'the stale bounced record is flagged');
  assert.deepEqual(flags[fresh.chequeId], { status: 'DEPOSITED', reentered: false }, 'the live deposited one is not');
});

test('bounced and never entered again: still a live, reusable cheque (not flagged)', async (t) => {
  const { customer, created } = await setupChequeFixtures(t);
  const no = uniqueName('ABC');
  const old = await postCheque(customer, no, 40000, '2026-09-20');
  created.receiptId = old.receiptId;
  await chequesService.bounce(old.chequeId, { bounced_date: '2026-09-22' }, null);

  assert.deepEqual((await flagsFor(no))[old.chequeId], { status: 'BOUNCED', reentered: false });
});

test('bounced twice (re-entry bounced too): the older record is flagged, the newest is not', async (t) => {
  const extra = [];
  trackExtra(t, extra); // registered first so it runs before the fixtures' own cleanup
  const { customer, created } = await setupChequeFixtures(t);
  const no = uniqueName('ABC');
  const first = await postCheque(customer, no, 70000, '2026-09-20');
  created.receiptId = first.receiptId;
  await chequesService.bounce(first.chequeId, { bounced_date: '2026-09-22' }, null);
  const second = await postCheque(customer, no, 70000, '2026-09-23', { allow_duplicate_cheque: true });
  extra.push(second.receiptId);
  await chequesService.bounce(second.chequeId, { bounced_date: '2026-09-25' }, null);

  const flags = await flagsFor(no);
  assert.equal(flags[first.chequeId].reentered, true, 'superseded by the later record');
  assert.equal(flags[second.chequeId].reentered, false, 'two bounced records never hide each other');
});

test('the re-entry is unposted: the old bounced record is live again', async (t) => {
  const extra = [];
  trackExtra(t, extra); // registered first so it runs before the fixtures' own cleanup
  const { customer, created } = await setupChequeFixtures(t);
  const no = uniqueName('ABC');
  const old = await postCheque(customer, no, 30000, '2026-09-20');
  created.receiptId = old.receiptId;
  await chequesService.bounce(old.chequeId, { bounced_date: '2026-09-22' }, null);
  const fresh = await postCheque(customer, no, 30000, '2026-09-22', { allow_duplicate_cheque: true });
  extra.push(fresh.receiptId);
  assert.equal((await flagsFor(no))[old.chequeId].reentered, true);

  await receiptsService.unpost(fresh.receiptId, undefined);
  assert.equal((await flagsFor(no))[old.chequeId].reentered, false, 'no live re-entry left, so nothing supersedes it');
});

test.after(() => closePool());
