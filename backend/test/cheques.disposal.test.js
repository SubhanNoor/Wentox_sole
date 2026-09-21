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
  const bounced = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-15' }, null);

  assert.equal(bounced.cheque_status, 'BOUNCED');
  assert.ok(bounced.bounced_date, 'bounced_date must be recorded');

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

  const receiptAfter = await receiptsService.getById(receiptId);
  assert.equal(receiptAfter.status, 'CONFIRMED', 'reverseAllocation() must never touch the underlying receipt');
});

test.after(async () => {
  await closePool();
});
