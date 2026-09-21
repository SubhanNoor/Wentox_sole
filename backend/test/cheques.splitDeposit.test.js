// Regression test for a client-requested change (2026-09-22): a cheque's balance must be
// depositable across more than one bank. Before migration 037, cheques.service.js#deposit()
// rejected a second deposit that named a different bank than the cheque's first one
// ("This cheque is already tied to a different bank — one cheque is never split across banks"),
// because the bank lived once on dbo.cheques.bank_id. The fix moves the bank onto each
// cheque_allocations row instead. The sharpest way this regresses silently is reverseCheque()
// (bounce/return): if it ever goes back to reading cheque.bank_id instead of the allocation's own
// bank_id, every reversed deposit resolves to whichever bank got deposited into FIRST, crediting
// the wrong bank back on a bounce — covered explicitly below.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const receiptsService = require('../src/services/receipts.service');
const chequesService = require('../src/services/cheques.service');
const { setupChequeFixtures, makeBank, uniqueName } = require('../testlib/fixtures');
const { cleanupFixtures } = require('../testlib/cleanup');

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

async function allocationRowsFor(receiptId) {
  const result = await query(
    'SELECT allocation_id, disposition_type, amount, bank_id, status FROM dbo.cheque_allocations WHERE receipt_id = @id ORDER BY allocation_id',
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

test('cheques: a single cheque CAN be deposited across two different banks', async (t) => {
  const { customer, bank: bankA, created } = await setupChequeFixtures(t);
  const bankB = await makeBank();
  t.after(() => cleanupFixtures({ bankId: bankB.bank_id }));

  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 40000);
  created.receiptId = receiptId;

  const afterFirst = await chequesService.deposit(cheque.cheque_id, {
    amount: 15000, bank_id: bankA.bank_id, allocation_date: '2026-01-11',
  }, null, undefined);
  assert.equal(afterFirst.cheque_status, 'PARTIALLY_ENDORSED');

  // This is exactly the call that used to throw "already tied to a different bank" — must now succeed.
  const afterSecond = await chequesService.deposit(cheque.cheque_id, {
    amount: 25000, bank_id: bankB.bank_id, allocation_date: '2026-01-12',
  }, null, undefined);
  assert.equal(afterSecond.cheque_status, 'DEPOSITED', 'fully allocated once both banks share the whole amount');

  const allocations = await allocationRowsFor(receiptId);
  assert.equal(allocations.length, 2);
  assert.equal(allocations[0].bank_id, bankA.bank_id, 'first allocation must record its own bank');
  assert.equal(allocations[1].bank_id, bankB.bank_id, 'second allocation must record its own (different) bank, not be rejected');

  const legsA = await chequeAllocationLedgerRowsFor(allocations[0].allocation_id);
  const legsB = await chequeAllocationLedgerRowsFor(allocations[1].allocation_id);
  const bankALeg = legsA.find((r) => r.ba_id === bankA.ba_id);
  const bankBLeg = legsB.find((r) => r.ba_id === bankB.ba_id);
  assert.ok(bankALeg, 'first deposit must debit bank A\'s own ledger account');
  assert.equal(Number(bankALeg.debit), 15000);
  assert.ok(bankBLeg, 'second deposit must debit bank B\'s own ledger account, not bank A\'s');
  assert.equal(Number(bankBLeg.debit), 25000);
});

test('cheques: bouncing a cheque split across two banks reverses EACH deposit against its OWN bank', async (t) => {
  const { customer, bank: bankA, created } = await setupChequeFixtures(t);
  const bankB = await makeBank();
  t.after(() => cleanupFixtures({ bankId: bankB.bank_id }));

  const { cheque, receiptId } = await makePostedChequeReceipt(customer, 10000);
  created.receiptId = receiptId;

  await chequesService.deposit(cheque.cheque_id, {
    amount: 4000, bank_id: bankA.bank_id, allocation_date: '2026-01-11',
  }, null, undefined);
  await chequesService.deposit(cheque.cheque_id, {
    amount: 6000, bank_id: bankB.bank_id, allocation_date: '2026-01-12',
  }, null, undefined);

  const bounced = await chequesService.bounce(cheque.cheque_id, { bounced_date: '2026-01-20' }, null);
  assert.equal(bounced.cheque_status, 'BOUNCED');

  const allocations = await allocationRowsFor(receiptId);
  assert.equal(allocations.length, 2);
  assert.ok(allocations.every((a) => a.status === 'REVERSED'));

  // The reversal's counter-leg must land back on the SAME bank each allocation was originally
  // deposited into — this is the exact case that regresses to "always bank A" if reverseCheque()
  // ever goes back to reading cheque.bank_id instead of allocation.bank_id.
  const legsA = await chequeAllocationLedgerRowsFor(allocations[0].allocation_id);
  const legsB = await chequeAllocationLedgerRowsFor(allocations[1].allocation_id);

  const bankACredits = legsA.filter((r) => r.ba_id === bankA.ba_id && Number(r.credit) > 0);
  assert.equal(bankACredits.length, 1, 'bank A\'s allocation must be reversed back onto bank A');
  assert.equal(Number(bankACredits[0].credit), 4000);

  const bankBCredits = legsB.filter((r) => r.ba_id === bankB.ba_id && Number(r.credit) > 0);
  assert.equal(bankBCredits.length, 1, 'bank B\'s allocation must be reversed back onto bank B, not bank A');
  assert.equal(Number(bankBCredits[0].credit), 6000);

  // Nothing must have been credited back onto the WRONG bank.
  const bankAWrongCredits = legsB.filter((r) => r.ba_id === bankA.ba_id && Number(r.credit) > 0);
  assert.equal(bankAWrongCredits.length, 0, 'bank B\'s deposit must never reverse against bank A');
});

test.after(async () => {
  await closePool();
});
