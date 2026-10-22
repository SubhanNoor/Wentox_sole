// Regression suite for the most bug-dense module in the whole history
// (System_architecture/testing_priority_plan.md Top 8 #3/#4 combined) — cheques.service.js's
// disposal state machine. Covers, concretely:
//   - 2026-08-10: deposit() wrote no ledger row at all (a deposited/cleared cheque never reached
//     the bank and never left CHEQUES IN HAND).
//   - 2026-08-04: reversing a DEPOSIT allocation crashed on CK_ledger_entries_one, because a
//     deposit's "other side" (the bank) lives on the cheque, not the allocation, and that lookup
//     was missing — exercised here via a full deposit-then-bounce flow.
//   - 2026-08-04: recomputeStatus() read active allocations via the plain pool instead of the
//     in-flight transaction (a stale read of its own uncommitted insert) — exercised implicitly by
//     asserting the cheque's status is correct immediately after each disposal call returns.
//   - the "never touch status, only add offsetting entries" reversal philosophy: bounce()/
//     reverseAllocation() must never flip the underlying receipt back to DRAFT.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const chequesService = require('../src/services/cheques.service');
const { setupChequeFixtures, uniqueName } = require('../testlib/fixtures');

async function trialBalance() {
  const result = await query(
    'SELECT ISNULL(SUM(debit), 0) AS total_debit, ISNULL(SUM(credit), 0) AS total_credit FROM dbo.ledger_entries',
  );
  const { total_debit: debit, total_credit: credit } = result.recordset[0];
  return { debit: Number(debit), credit: Number(credit) };
}

async function allocationRowsFor(receiptId) {
  const result = await query(
    'SELECT allocation_id, disposition_type, amount, status FROM dbo.cheque_allocations WHERE receipt_id = @id',
    { id: receiptId },
  );
  return result.recordset;
}

async function chequeAllocationLedgerRowsFor(allocationId) {
  const result = await query(
    "SELECT debit, credit, ba_id, ac_id FROM dbo.ledger_entries WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @id",
    { id: allocationId },
  );
  return result.recordset;
}

// Creates + posts a CHEQUE receipt, returning the cheque row (already re-fetched via
// chequesService so it carries receipt_status/receipt_amount) plus the receiptId.
async function makePostedChequeReceipt(customer, amount) {
  const receipt = await receiptsService.create({
    ba_id: customer.ba_id,
    receipt_date: '2026-01-10',
    amount,
    payment_mode: 'CHEQUE',
    cheque_no: uniqueName('CHQ'),
    cheque_date: '2026-01-09',
  }, null, undefined);
  await receiptsService.post(receipt.receipt_id, undefined);
  const posted = await receiptsService.getById(receipt.receipt_id);
  const cheque = await chequesService.getById(posted.cheque_id);
  return { cheque, receiptId: receipt.receipt_id };
}

test('cheques: deposit() writes a balanced Dr bank / Cr Cheques In Hand pair and marks the cheque DEPOSITED', async (t) => {
  const { customer, bank, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 5000);
  created.receiptId = receiptId;

  assert.equal(cheque.cheque_status, 'PENDING');

  const deposited = await chequesService.deposit(cheque.cheque_id, {
    amount: 5000, bank_id: bank.bank_id, allocation_date: '2026-01-11',
  }, null, undefined);

  assert.equal(deposited.cheque_status, 'DEPOSITED', 'a fully-allocated deposit must close the cheque out as DEPOSITED, not PARTIALLY_ENDORSED (stale-read regression)');
  assert.equal(deposited.bank_id, bank.bank_id);

  const allocations = await allocationRowsFor(receiptId);
  assert.equal(allocations.length, 1);
  const ledgerRows = await chequeAllocationLedgerRowsFor(allocations[0].allocation_id);
  assert.equal(ledgerRows.length, 2, 'deposit() must write exactly one debit/credit pair — this is the 2026-08-10 bug (it used to write none)');
  const totalDebit = ledgerRows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = ledgerRows.reduce((s, r) => s + Number(r.credit), 0);
  assert.equal(totalDebit, 5000);
  assert.equal(totalCredit, 5000);
  const bankLeg = ledgerRows.find((r) => r.ba_id === bank.ba_id);
  assert.ok(bankLeg, 'the bank leg of the deposit must be keyed on the bank\'s own business account');
  assert.equal(Number(bankLeg.debit), 5000, 'depositing a cheque debits the bank (money arriving)');
});

test('cheques: endorseToVendor() writes Dr vendor / Cr Cheques In Hand and marks the cheque ENDORSED', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 3000);
  created.receiptId = receiptId;

  const endorsed = await chequesService.endorseToVendor(cheque.cheque_id, {
    vendor_id: vendor.vendor_id, allocation_date: '2026-01-12',
  }, null, undefined);

  assert.equal(endorsed.cheque_status, 'ENDORSED');

  const allocations = await allocationRowsFor(receiptId);
  const ledgerRows = await chequeAllocationLedgerRowsFor(allocations[0].allocation_id);
  const vendorLeg = ledgerRows.find((r) => r.ba_id === vendor.ba_id);
  assert.ok(vendorLeg, 'the vendor leg must be keyed on the vendor\'s own business account');
  assert.equal(Number(vendorLeg.debit), 3000, 'handing the cheque to a vendor debits the vendor (money paid out to them)');
});

test('cheques: bounce() reverses the deposit AND the original receipt, keeps the trial balance at zero, never un-posts the receipt', async (t) => {
  const { customer, bank, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 7000);
  created.receiptId = receiptId;

  await chequesService.deposit(cheque.cheque_id, {
    amount: 7000, bank_id: bank.bank_id, allocation_date: '2026-01-11',
  }, null, undefined);

  const before = await trialBalance();
  assert.equal(before.debit, before.credit, 'sanity check: balanced before the bounce too');

  // This is exactly the path that crashed on CK_ledger_entries_one (2026-08-04): reversing a
  // DEPOSIT allocation has to look the bank up via the CHEQUE (cheque_allocations has no bank
  // column), not via the allocation row itself.
  // One bounce = one step back: the deposit is undone and the cheque is back in hand, still
  // marked bounced, with the receipt (customer credit) standing. A second bounce reverses the receipt.
  const stepBack = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null);
  assert.equal(stepBack.cheque_status, 'PENDING');
  assert.ok(stepBack.bounced_date, 'bounced_date must be recorded on every bounce');
  assert.equal((await receiptsService.getById(receiptId)).status, 'CONFIRMED');
  const bounced = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-16' }, null);

  assert.equal(bounced.cheque_status, 'BOUNCED');

  const allocations = await allocationRowsFor(receiptId);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].status, 'REVERSED', 'the deposit allocation itself must be marked REVERSED, not deleted (reverse-never-erase)');

  const after = await trialBalance();
  assert.equal(after.debit, after.credit, 'a bounce must never leave the books unbalanced — every reversal is a real balanced counter-pair');

  const receiptAfter = await receiptsService.getById(receiptId);
  assert.equal(receiptAfter.status, 'CONFIRMED', 'bounce() must never flip the receipt back to DRAFT — it reverses via new entries, never un-posts');
});

test('cheques: reverseAllocation() undoes one endorsement only, freeing the cheque\'s balance without touching the receipt', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 10000);
  created.receiptId = receiptId;

  // Partial endorsement — 6000 of 10000 — so the cheque should land on PARTIALLY_ENDORSED, not
  // ENDORSED, with 4000 still available.
  const afterEndorse = await chequesService.endorseToVendor(cheque.cheque_id, {
    vendor_id: vendor.vendor_id, amount: 6000, allocation_date: '2026-01-12',
  }, null, undefined);
  assert.equal(afterEndorse.cheque_status, 'PARTIALLY_ENDORSED');

  const [allocation] = await allocationRowsFor(receiptId);
  assert.equal(allocation.status, 'ACTIVE');

  const reversed = await chequesService.reverseAllocation(allocation.allocation_id, { date: '2026-01-20' }, null);
  assert.equal(reversed.status, 'REVERSED');

  const chequeAfter = await chequesService.getById(cheque.cheque_id);
  assert.equal(chequeAfter.cheque_status, 'PENDING', 'reversing the only active allocation must free the whole balance back up');

  const ledgerRows = await chequeAllocationLedgerRowsFor(allocation.allocation_id);
  // Two pairs now exist for this allocation: the original endorsement + this reversal.
  assert.equal(ledgerRows.length, 4);
  const totalDebit = ledgerRows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = ledgerRows.reduce((s, r) => s + Number(r.credit), 0);
  assert.equal(totalDebit, totalCredit, 'the endorsement and its reversal together must net to zero for this allocation');

  // The vendor has to see WHICH cheque came back: its number and due date, not the allocation id.
  const [{ narration }] = await query(
    "SELECT TOP 1 narration FROM dbo.ledger_entries WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @id AND narration LIKE '%reversal%'",
    { id: allocation.allocation_id },
  ).then((r) => r.recordset);
  assert.equal(narration, `Endorsement reversal — Cheque #${cheque.cheque_no} — Due 09/01/2026`);

  // Migration 039 rewrites reversals stored in the old "of allocation #N" wording the same way,
  // keeping any remarks. Put this row back to the old wording and run the migration's SQL on it.
  await query(
    "UPDATE dbo.ledger_entries SET narration = @old WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @id AND narration LIKE '%reversal%'",
    { id: allocation.allocation_id, old: `Endorsement reversal of allocation #${allocation.allocation_id} — returned by vendor` },
  );
  await query(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '039_cheque_reversal_narration.sql'), 'utf8'));
  const migrated = await query(
    "SELECT narration FROM dbo.ledger_entries WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @id AND narration LIKE '%reversal%'",
    { id: allocation.allocation_id },
  );
  assert.equal(migrated.recordset.length, 2);
  for (const row of migrated.recordset) {
    assert.equal(row.narration, `Endorsement reversal — Cheque #${cheque.cheque_no} — Due 09/01/2026 — returned by vendor`);
  }

  const receiptAfter = await receiptsService.getById(receiptId);
  assert.equal(receiptAfter.status, 'CONFIRMED', 'reverseAllocation() must never touch the underlying receipt');
});

test('cheques: a bounced cheque can be deposited again (append-only re-credit), then bounced a second time', async (t) => {
  const { customer, bank, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 4000);
  created.receiptId = receiptId;

  await chequesService.deposit(cheque.cheque_id, { amount: 4000, bank_id: bank.bank_id, allocation_date: '2026-01-11' }, null, undefined);
  await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null); // undoes the deposit
  await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null); // reverses the receipt
  const afterBounce = await query('SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = \'RECEIPT\' AND source_id = @id', { id: receiptId });

  await assert.rejects(
    chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-16' }, null),
    { code: 'CHEQUE_ALREADY_BOUNCED' },
    'bouncing an already-bounced (not re-used) cheque makes no sense',
  );

  const redeposited = await chequesService.deposit(cheque.cheque_id, { amount: 4000, bank_id: bank.bank_id, allocation_date: '2026-01-20' }, null, undefined);
  assert.equal(redeposited.cheque_status, 'DEPOSITED');
  assert.ok(redeposited.bounced_date, 'the bounce marker must survive re-use');

  const afterRedeposit = await query('SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = \'RECEIPT\' AND source_id = @id', { id: receiptId });
  assert.equal(afterRedeposit.recordset[0].n, afterBounce.recordset[0].n + 2, 're-credit adds a new pair; the bounce rows stay untouched');
  const tb = await trialBalance();
  assert.equal(tb.debit, tb.credit);

  const stepBackAgain = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-25' }, null);
  assert.equal(stepBackAgain.cheque_status, 'PENDING', 'a second bounce again undoes only the latest step (the new deposit)');
  const bouncedAgain = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-26' }, null);
  assert.equal(bouncedAgain.cheque_status, 'BOUNCED');
  const tb2 = await trialBalance();
  assert.equal(tb2.debit, tb2.credit);
});

test('cheques: a chain ABC -> XYZ -> AABB bounces back ONE hop at a time; bounceAllocation() does the same from the Return page', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 9000);
  created.receiptId = receiptId;

  await chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, amount: 5000, allocation_date: '2026-01-11' }, null, undefined);
  await chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, amount: 4000, allocation_date: '2026-01-12' }, null, undefined);
  let rows = await allocationRowsFor(receiptId);

  const afterFirst = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-20' }, null);
  rows = await allocationRowsFor(receiptId);
  assert.deepEqual(rows.map((r) => r.status), ['ACTIVE', 'REVERSED'], 'only the LATEST hop is undone');
  assert.equal(afterFirst.cheque_status, 'PARTIALLY_ENDORSED');

  // Return-page path: bounce ONE named allocation (the remaining one).
  await chequesService.bounceAllocation(rows[0].allocation_id, { date: '2026-01-21' });
  rows = await allocationRowsFor(receiptId);
  assert.ok(rows.every((r) => r.status === 'REVERSED'));
  const cheque2 = await chequesService.getById(cheque.cheque_id);
  assert.equal(cheque2.cheque_status, 'PENDING');
  assert.ok(cheque2.bounced_date);
  assert.equal((await receiptsService.getById(receiptId)).status, 'CONFIRMED');

  const ledger = await query(
    "SELECT narration FROM dbo.ledger_entries WHERE source_type = 'CHEQUE_ALLOCATION' AND source_id = @id AND narration LIKE 'BOUNCED reversal%'",
    { id: rows[0].allocation_id },
  );
  assert.equal(ledger.recordset.length, 2);
  const tb = await trialBalance();
  assert.equal(tb.debit, tb.credit);
});

test('cheques: two simultaneous bounces of one allocation post the reversal only once', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 3000);
  created.receiptId = receiptId;
  await chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-01-11' }, null, undefined);
  const [alloc] = await allocationRowsFor(receiptId);

  const results = await Promise.allSettled([
    chequesService.bounceAllocation(alloc.allocation_id, { date: '2026-01-15' }),
    chequesService.bounceAllocation(alloc.allocation_id, { date: '2026-01-15' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one call may win');
  assert.equal((await chequeAllocationLedgerRowsFor(alloc.allocation_id)).length, 4, 'original pair + ONE reversal pair');
});

test('cheques: two simultaneous first actions on a bounced cheque re-credit the receipt only once', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 2000);
  created.receiptId = receiptId;
  await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null); // no allocations: receipt reversed
  const rowsBefore = (await query("SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = 'RECEIPT' AND source_id = @id", { id: receiptId })).recordset[0].n;

  await Promise.allSettled([
    chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, amount: 1000, allocation_date: '2026-01-20' }, null, undefined),
    chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, amount: 1000, allocation_date: '2026-01-20' }, null, undefined),
  ]);
  const rowsAfter = (await query("SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = 'RECEIPT' AND source_id = @id", { id: receiptId })).recordset[0].n;
  assert.equal(rowsAfter, rowsBefore + 2, 'exactly one re-credit pair, however many actions race');
});

test('cheques: a bounce undoes the most recently ENTERED step even if an earlier-entered one has a later date', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 9000);
  created.receiptId = receiptId;
  await chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, amount: 5000, allocation_date: '2026-01-20' }, null, undefined);
  await chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, amount: 4000, allocation_date: '2026-01-15' }, null, undefined);
  await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-25' }, null);
  const rows = await allocationRowsFor(receiptId);
  assert.deepEqual(rows.map((r) => r.status), ['ACTIVE', 'REVERSED'], 'the back-dated 4000 was entered last, so it is the one undone');
});

test('cheques: two simultaneous full bounces (a double-click) reverse the receipt only once', async (t) => {
  const { customer, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 1000);
  created.receiptId = receiptId;
  const receiptRows = async () => (await query("SELECT COUNT(*) AS n FROM dbo.ledger_entries WHERE source_type = 'RECEIPT' AND source_id = @id", { id: receiptId })).recordset[0].n;
  const before = await receiptRows();

  const results = await Promise.allSettled([
    chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null),
    chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one bounce may win');
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CHEQUE_CHANGED');
  assert.equal(await receiptRows(), before + 2, 'ONE reversal pair, not two');
});

test('cheques: a Return of a bounced cheque racing its re-deposit leaves one consistent outcome', async (t) => {
  const { customer, bank, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 1000);
  created.receiptId = receiptId;
  await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null);

  const results = await Promise.allSettled([
    chequesService.returnToSender(cheque.cheque_id, { returned_date: '2026-01-20' }, null),
    chequesService.deposit(cheque.cheque_id, { amount: 1000, bank_id: bank.bank_id, allocation_date: '2026-01-20' }, null, undefined),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one action may win');
  const after = await chequesService.getById(cheque.cheque_id);
  const active = (await allocationRowsFor(receiptId)).filter((r) => r.status === 'ACTIVE');
  if (after.cheque_status === 'RETURNED') assert.equal(active.length, 0, 'a returned cheque holds no live deposit');
  else assert.equal(after.cheque_status, 'DEPOSITED');
  const tb = await trialBalance();
  assert.equal(tb.debit, tb.credit);
});

test('cheques: a bounce cannot be dated before the step it undoes, nor a re-use before the bounce', async (t) => {
  const { customer, vendor, bank, created } = await setupChequeFixtures(t);
  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 3000);
  created.receiptId = receiptId;
  await chequesService.endorseToVendor(cheque.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-01-15' }, null, undefined);
  const [alloc] = await allocationRowsFor(receiptId);

  await assert.rejects(
    chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-14' }, null),
    /before the endorsement it undoes \(15\/01\/2026\)/,
  );
  await assert.rejects(chequesService.bounceAllocation(alloc.allocation_id, { date: '2026-01-14' }), /before the endorsement/);
  assert.equal((await allocationRowsFor(receiptId))[0].status, 'ACTIVE', 'a refused bounce must change nothing');

  await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null); // same day is fine
  await assert.rejects(
    chequesService.deposit(cheque.cheque_id, { amount: 3000, bank_id: bank.bank_id, allocation_date: '2026-01-14' }, null, undefined),
    /before the bounce date \(15\/01\/2026\)/,
  );
  const redeposited = await chequesService.deposit(cheque.cheque_id, { amount: 3000, bank_id: bank.bank_id, allocation_date: '2026-01-15' }, null, undefined);
  assert.equal(redeposited.cheque_status, 'DEPOSITED');
});

test('receipts: un-post and un-confirm are refused once the cheque has any history, even back on PENDING', async (t) => {
  const { customer, vendor, created } = await setupChequeFixtures(t);

  // Endorsed then returned: PENDING again, but its allocation history must keep the receipt posted.
  const returned = await makePostedChequeReceipt(customer, 2000);
  created.receiptId = returned.receiptId;
  await chequesService.endorseToVendor(returned.cheque.cheque_id, { vendor_id: vendor.vendor_id, allocation_date: '2026-01-11' }, null, undefined);
  const [alloc] = await allocationRowsFor(returned.receiptId);
  await chequesService.reverseAllocation(alloc.allocation_id, { date: '2026-01-12' }, null);
  assert.equal((await chequesService.getById(returned.cheque.cheque_id)).cheque_status, 'PENDING');
  await assert.rejects(receiptsService.unpost(returned.receiptId, undefined), { code: 'CHEQUE_IN_USE' });
  await assert.rejects(receiptsService.unconfirm(returned.receiptId, undefined), { code: 'CHEQUE_IN_USE' });
  assert.equal((await receiptsService.getById(returned.receiptId)).status, 'CONFIRMED');
});

test('receipts: un-post of an untouched cheque receipt still works', async (t) => {
  const { customer, created } = await setupChequeFixtures(t);
  const { receiptId } = await makePostedChequeReceipt(customer, 1500);
  created.receiptId = receiptId;
  const unposted = await receiptsService.unpost(receiptId, undefined);
  assert.equal(unposted.status, 'DRAFT');
});

test.after(async () => {
  await closePool();
});
