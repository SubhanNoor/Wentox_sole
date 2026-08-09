// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/cheques.repository');
const receiptsService = require('./receipts.service');
const bankAccountsService = require('./bankAccounts.service');
const vendorsService = require('./vendors.service');
const businessAccountsService = require('./businessAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

// Terminal states — nothing further can happen to a cheque once here.
const TERMINAL_STATUSES = ['BOUNCED', 'RETURNED', 'CLEARED'];

function list(filters) {
  return repository.list(filters);
}

async function getById(chequeId) {
  const cheque = await repository.findById(chequeId);
  if (!cheque) throw ApiError.notFound('Cheque not found');
  return cheque;
}

// Full allocation history for one cheque's receipt (all disposition types, including DEPOSIT and
// REVERSED rows) — the Cheques tab's per-cheque history view. `listEndorsedAllocations` deliberately
// excludes DEPOSIT/REVERSED (it's the narrower "Cheque Return" undo-picker), so this is separate.
async function listAllocationsForReceipt(receiptId) {
  return repository.listAllocations(receiptId);
}

// receipt.amount minus every ACTIVE allocation against it — the balance still sitting in CHEQUES
// IN HAND for this cheque (cash_and_bank.md §10's derived-balance formula, one cheque at a time).
async function remainingBalance(cheque) {
  const allocated = await repository.sumActiveAllocations(cheque.receipt_id);
  return cheque.receipt_amount - allocated;
}

// Shared precondition for every disposal action (deposit / endorse to vendor / endorse to
// expense): the underlying receipt must be posted (CHEQUES IN HAND only holds money for a
// CONFIRMED receipt — see receipts.service.js#post()), the cheque must not be in a terminal state,
// and there must be balance left to allocate.
async function assertDisposable(cheque, requestedAmount) {
  if (cheque.receipt_status !== 'CONFIRMED') {
    throw ApiError.conflict('This receipt is not posted yet — post it before disposing of the cheque', 'RECEIPT_NOT_POSTED');
  }
  if (TERMINAL_STATUSES.includes(cheque.cheque_status)) {
    throw ApiError.conflict(`This cheque is ${cheque.cheque_status.toLowerCase()} and cannot be disposed of further`, 'CHEQUE_TERMINAL');
  }
  const remaining = await remainingBalance(cheque);
  if (remaining <= 0) {
    throw ApiError.conflict('This cheque has no remaining balance left to dispose of', 'CHEQUE_FULLY_ALLOCATED');
  }
  const amount = requestedAmount ?? remaining;
  if (amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (amount > remaining) {
    throw ApiError.badRequest(`amount exceeds the cheque's remaining balance (${remaining})`);
  }
  return amount;
}

// After any disposal action, the cheque's status reflects the CURRENT action if it fully closes
// out the remaining balance (DEPOSITED for a deposit, ENDORSED for a vendor/expense payment), or
// PARTIALLY_ENDORSED if balance is still left — regardless of what mix of disposition types came
// before. A cheque split across deposit + endorsement ends up labeled by whichever action closed
// it out; this is a simplification of the schema's genuinely mixed-disposition allowance, not a
// bug — the individual cheque_allocations rows are what actually record the true mix.
async function recomputeStatus(transaction, cheque, closingDispositionType) {
  const allocated = await repository.sumActiveAllocationsInTransaction(transaction, cheque.receipt_id);
  const remaining = cheque.receipt_amount - allocated;
  if (remaining > 0) {
    await repository.setStatus(transaction, cheque.cheque_id, 'PARTIALLY_ENDORSED');
  } else {
    const status = closingDispositionType === 'DEPOSIT' ? 'DEPOSITED' : 'ENDORSED';
    await repository.setStatus(transaction, cheque.cheque_id, status);
  }
}

// DEPOSIT — no ledger entry (the customer was already credited when the CHEQUE receipt posted;
// depositing just relocates it from the CHEQUES IN HAND holding bucket to a specific bank for
// balance-tracking purposes — cash_and_bank.md §10's derived-balance formula reads
// cheque_allocations directly, not a new ledger row). "One cheque is never deposited into two
// different banks" (§9.3) — if the cheque already carries a bank_id, a second deposit must use
// the same one.
async function deposit(chequeId, payload, userId) {
  const cheque = await getById(chequeId);
  const amount = await assertDisposable(cheque, payload.amount);
  if (!payload.bank_id) throw ApiError.badRequest('bank_id is required');
  if (cheque.bank_id && cheque.bank_id !== payload.bank_id) {
    throw ApiError.badRequest('This cheque is already tied to a different bank — one cheque is never split across banks');
  }
  await bankAccountsService.getById(payload.bank_id); // 404s if it doesn't exist
  if (!payload.allocation_date) throw ApiError.badRequest('allocation_date is required');

  await withTransaction(async (transaction) => {
    await repository.insertAllocation(transaction, {
      receipt_id: cheque.receipt_id,
      disposition_type: 'DEPOSIT',
      amount,
      allocation_date: payload.allocation_date,
      remarks: payload.remarks,
      created_by: userId,
    });
    if (!cheque.bank_id) await repository.setBank(transaction, chequeId, payload.bank_id);
    await recomputeStatus(transaction, cheque, 'DEPOSIT');
  });

  return getById(chequeId);
}

// VENDOR_PAYMENT — this DOES write a ledger entry: handing a received cheque to a vendor actually
// moves money out to someone else, unlike a deposit into your own bank. Dr VENDOR BA / Cr CHEQUES
// IN HAND.
async function endorseToVendor(chequeId, payload, userId) {
  const cheque = await getById(chequeId);
  const amount = await assertDisposable(cheque, payload.amount);
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
  if (!payload.allocation_date) throw ApiError.badRequest('allocation_date is required');

  const vendor = await vendorsService.getById(payload.vendor_id);
  if (!vendor.ba_id) throw ApiError.conflict('Vendor has no linked account yet', 'NO_VENDOR_ACCOUNT');
  const chequesInHand = await chartAccountsRepository.findByCode(CODES.CHEQUES_IN_HAND);
  if (!chequesInHand) throw new Error(`Reserved chart account CHEQUES IN HAND (code ${CODES.CHEQUES_IN_HAND}) not found — run npm run seed`);

  await withTransaction(async (transaction) => {
    const allocationId = await repository.insertAllocation(transaction, {
      receipt_id: cheque.receipt_id,
      disposition_type: 'VENDOR_PAYMENT',
      target_vendor_id: payload.vendor_id,
      amount,
      allocation_date: payload.allocation_date,
      remarks: payload.remarks,
      created_by: userId,
    });
    await repository.insertLedgerEntries(transaction, [
      { entry_date: payload.allocation_date, ba_id: vendor.ba_id, debit: amount, credit: 0, source_type: 'CHEQUE_ALLOCATION', source_id: allocationId, narration: `Cheque #${chequeId} to vendor` },
      { entry_date: payload.allocation_date, ac_id: chequesInHand.ac_id, debit: 0, credit: amount, source_type: 'CHEQUE_ALLOCATION', source_id: allocationId, narration: `Cheque #${chequeId} to vendor` },
    ]);
    await recomputeStatus(transaction, cheque, 'VENDOR_PAYMENT');
  });

  return getById(chequeId);
}

// EXPENSE_PAYMENT — same shape as endorseToVendor, target is any business_accounts row (an
// expense head) rather than a vendor. Dr target BA / Cr CHEQUES IN HAND.
async function endorseToExpense(chequeId, payload, userId) {
  const cheque = await getById(chequeId);
  const amount = await assertDisposable(cheque, payload.amount);
  if (!payload.target_ba_id) throw ApiError.badRequest('target_ba_id is required');
  if (!payload.allocation_date) throw ApiError.badRequest('allocation_date is required');

  const target = await businessAccountsService.getById(payload.target_ba_id);
  const chequesInHand = await chartAccountsRepository.findByCode(CODES.CHEQUES_IN_HAND);
  if (!chequesInHand) throw new Error(`Reserved chart account CHEQUES IN HAND (code ${CODES.CHEQUES_IN_HAND}) not found — run npm run seed`);

  await withTransaction(async (transaction) => {
    const allocationId = await repository.insertAllocation(transaction, {
      receipt_id: cheque.receipt_id,
      disposition_type: 'EXPENSE_PAYMENT',
      target_ba_id: payload.target_ba_id,
      expense_id: payload.expense_id ?? null,
      amount,
      allocation_date: payload.allocation_date,
      remarks: payload.remarks,
      created_by: userId,
    });
    await repository.insertLedgerEntries(transaction, [
      { entry_date: payload.allocation_date, ba_id: target.ba_id, debit: amount, credit: 0, source_type: 'CHEQUE_ALLOCATION', source_id: allocationId, narration: `Cheque #${chequeId} to expense` },
      { entry_date: payload.allocation_date, ac_id: chequesInHand.ac_id, debit: 0, credit: amount, source_type: 'CHEQUE_ALLOCATION', source_id: allocationId, narration: `Cheque #${chequeId} to expense` },
    ]);
    await recomputeStatus(transaction, cheque, 'EXPENSE_PAYMENT');
  });

  return getById(chequeId);
}

// A DEPOSITED cheque only, marking that the bank has actually confirmed it — pure status flip, no
// ledger effect (the money was already counted in the derived bank balance at deposit time).
async function markCleared(chequeId) {
  const cheque = await getById(chequeId);
  if (cheque.cheque_status !== 'DEPOSITED') {
    throw ApiError.conflict('Only a fully deposited cheque can be marked cleared', 'NOT_DEPOSITED');
  }
  await withTransaction((transaction) => repository.setStatus(transaction, chequeId, 'CLEARED'));
  return getById(chequeId);
}

// Shared reversal mechanics for both BOUNCED and RETURNED (database_schema_v4.3.md §6.1: a bounce
// reverses, never erases). Reverses every ACTIVE allocation (Dr CHEQUES IN HAND / Cr whatever it
// had debited — the opposite of the original entry), then reverses the original receipt itself
// (Dr customer BA / Cr whatever the receipt had originally debited, plus the commission leg if
// any) — all dated the bounce/return date, all new rows, nothing deleted or rewritten.
async function reverseCheque(chequeId, { date, reason, mode }, userId) {
  const cheque = await getById(chequeId);
  if (TERMINAL_STATUSES.includes(cheque.cheque_status)) {
    throw ApiError.conflict(`This cheque is already ${cheque.cheque_status.toLowerCase()}`, 'CHEQUE_TERMINAL');
  }
  if (!date) throw ApiError.badRequest('date is required');

  const receipt = await receiptsService.getById(cheque.receipt_id);
  const chequesInHand = await chartAccountsRepository.findByCode(CODES.CHEQUES_IN_HAND);
  if (!chequesInHand) throw new Error(`Reserved chart account CHEQUES IN HAND (code ${CODES.CHEQUES_IN_HAND}) not found — run npm run seed`);

  await withTransaction(async (transaction) => {
    const reversedAllocations = await repository.reverseAllocations(transaction, cheque.receipt_id);

    for (const allocation of reversedAllocations) {
      // DEPOSIT allocations never wrote a ledger entry in the first place (deposit.md decision:
      // depositing only relocates an already-credited cheque, no new row) — nothing to reverse on
      // the ledger side for those; reverseAllocations() above already flipped their status.
      if (allocation.disposition_type === 'DEPOSIT') continue;

      const targetBaId = allocation.target_vendor_id
        ? (await vendorsService.getById(allocation.target_vendor_id)).ba_id
        : allocation.target_ba_id;
      // Opposite of the original allocation entry (Dr target / Cr CHEQUES IN HAND): here we credit
      // target and debit CHEQUES IN HAND back.
      await repository.insertLedgerEntries(transaction, [
        { entry_date: date, ac_id: chequesInHand.ac_id, debit: allocation.amount, credit: 0, source_type: 'CHEQUE_ALLOCATION', source_id: allocation.allocation_id, narration: `${mode} reversal of allocation #${allocation.allocation_id}` },
        { entry_date: date, ba_id: targetBaId, debit: 0, credit: allocation.amount, source_type: 'CHEQUE_ALLOCATION', source_id: allocation.allocation_id, narration: `${mode} reversal of allocation #${allocation.allocation_id}` },
      ]);
    }

    // Only reverse the receipt's own ledger effect if it was actually posted — a DRAFT receipt's
    // cheque should never have reached disposal in the first place (assertDisposable() requires
    // CONFIRMED), but this guards defensively regardless.
    if (receipt.status === 'CONFIRMED') {
      const debitSide = await receiptsService.resolveDebitSide(receipt.payment_mode, receipt.bank_id);
      const narration = `${mode} reversal of receipt #${receipt.receipt_id}`;

      const rows = [
        { entry_date: date, ba_id: receipt.ba_id, debit: receipt.amount, credit: 0, source_type: 'RECEIPT', source_id: receipt.receipt_id, narration },
        { entry_date: date, ...debitSide, debit: 0, credit: receipt.amount, source_type: 'RECEIPT', source_id: receipt.receipt_id, narration },
      ];

      if (receipt.commission > 0) {
        const commissionAccount = await chartAccountsRepository.findByCode(CODES.COMMISSION_ALLOWED);
        if (!commissionAccount) throw new Error(`Reserved chart account COMMISSION ALLOWED (code ${CODES.COMMISSION_ALLOWED}) not found — run npm run seed`);
        rows.push(
          { entry_date: date, ba_id: receipt.ba_id, debit: receipt.commission, credit: 0, source_type: 'COMMISSION', source_id: receipt.receipt_id, narration: `${narration} commission` },
          { entry_date: date, ac_id: commissionAccount.ac_id, debit: 0, credit: receipt.commission, source_type: 'COMMISSION', source_id: receipt.receipt_id, narration: `${narration} commission` },
        );
      }
      await repository.insertLedgerEntries(transaction, rows);
    }

    if (mode === 'BOUNCED') {
      await repository.markBounced(transaction, chequeId, date);
    } else {
      await repository.markReturned(transaction, chequeId, date, reason);
    }
  });

  return getById(chequeId);
}

function bounce(chequeId, payload, userId) {
  return reverseCheque(chequeId, { date: payload.bounced_date, mode: 'BOUNCED' }, userId);
}

function returnToSender(chequeId, payload, userId) {
  return reverseCheque(chequeId, { date: payload.returned_date, reason: payload.reason, mode: 'RETURNED' }, userId);
}

// "Cheque Return" page (user-requested, beyond the original checklist): the "Endorsed Cheques"
// list — every ACTIVE endorsement (vendor or expense payment) that could still be undone. Excludes
// DEPOSIT on purpose (see repository comment — moving a deposit to a different bank is a separate
// concern) and excludes anything already REVERSED.
function listEndorsedAllocations(filters) {
  return repository.listEndorsedAllocations(filters);
}

// Undoes ONE specific endorsement — e.g. a vendor hands the cheque back, or an expense payment is
// cancelled — WITHOUT touching the cheque's other allocations or the underlying receipt at all.
// This is deliberately narrower than bounce()/returnToSender(): the cheque itself is fine, only
// this one disposition is being reversed, so its balance becomes available again for a different
// disposition. If the underlying disposition was a CHEQUE_ENDORSED expense, that expense's own
// status is never touched — same "never touch status, only add offsetting entries" philosophy as
// a receipt after a bounce (see reverseCheque()'s reasoning above).
async function reverseAllocation(allocationId, payload, userId) {
  const allocation = await repository.findAllocationById(allocationId);
  if (!allocation) throw ApiError.notFound('Allocation not found');
  if (allocation.status !== 'ACTIVE') {
    throw ApiError.conflict('This allocation has already been reversed', 'ALLOCATION_ALREADY_REVERSED');
  }
  if (allocation.disposition_type === 'DEPOSIT') {
    throw ApiError.badRequest('A deposit cannot be returned this way — see the deposit/bank flow instead');
  }
  if (TERMINAL_STATUSES.includes(allocation.cheque_status)) {
    throw ApiError.conflict(`This cheque is already ${allocation.cheque_status.toLowerCase()}`, 'CHEQUE_TERMINAL');
  }
  if (!payload.date) throw ApiError.badRequest('date is required');

  const chequesInHand = await chartAccountsRepository.findByCode(CODES.CHEQUES_IN_HAND);
  if (!chequesInHand) throw new Error(`Reserved chart account CHEQUES IN HAND (code ${CODES.CHEQUES_IN_HAND}) not found — run npm run seed`);

  const targetBaId = allocation.target_vendor_id
    ? (await vendorsService.getById(allocation.target_vendor_id)).ba_id
    : allocation.target_ba_id;
  const narration = `Endorsement reversal of allocation #${allocationId}${payload.remarks ? ` — ${payload.remarks}` : ''}`;

  await withTransaction(async (transaction) => {
    await repository.reverseOneAllocation(transaction, allocationId);
    await repository.insertLedgerEntries(transaction, [
      { entry_date: payload.date, ac_id: chequesInHand.ac_id, debit: allocation.amount, credit: 0, source_type: 'CHEQUE_ALLOCATION', source_id: allocationId, narration },
      { entry_date: payload.date, ba_id: targetBaId, debit: 0, credit: allocation.amount, source_type: 'CHEQUE_ALLOCATION', source_id: allocationId, narration },
    ]);

    // Balance freed up — status moves back toward PENDING (or PARTIALLY_ENDORSED if other
    // allocations are still active), the mirror image of recomputeStatus()'s forward direction.
    const cheque = await repository.findById(allocation.cheque_id);
    const stillAllocated = await repository.sumActiveAllocationsInTransaction(transaction, allocation.receipt_id);
    const newStatus = stillAllocated > 0 ? 'PARTIALLY_ENDORSED' : 'PENDING';
    await repository.setStatus(transaction, cheque.cheque_id, newStatus);
  });

  return repository.findAllocationById(allocationId);
}

module.exports = {
  list, getById, deposit, endorseToVendor, endorseToExpense, markCleared, bounce, returnToSender,
  listEndorsedAllocations, reverseAllocation, listAllocationsForReceipt,
};
