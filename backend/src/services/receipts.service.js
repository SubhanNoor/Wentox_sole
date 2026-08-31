// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/receipts.repository');
const chequesRepository = require('../repositories/cheques.repository');
const bankAccountsService = require('./bankAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');
const { toISODate } = require('../utils/dates');
const businessAccountsService = require('./businessAccounts.service');
// Repository, not service — draftReceipts.service.js already requires this service the other way
// (its confirm() calls insertReceipt()/postWithinTransaction()), so requiring its SERVICE back here
// would be circular. Same reasoning as saleBills.service.js#unconfirm().
const draftReceiptsRepository = require('../repositories/draftReceipts.repository');

function validateHeader(payload) {
  if (!payload.ba_id) throw ApiError.badRequest('ba_id is required');
  if (!payload.receipt_date) throw ApiError.badRequest('receipt_date is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (payload.commission !== undefined && payload.commission < 0) {
    throw ApiError.badRequest('commission must be >= 0');
  }
  if (!['CASH', 'ONLINE', 'CHEQUE'].includes(payload.payment_mode)) {
    throw ApiError.badRequest("payment_mode must be 'CASH', 'ONLINE', or 'CHEQUE'");
  }
  // ONLINE names EITHER a bank (bank_id, the original path every existing row uses) OR any
  // business account (online_ba_id, migration 028). Never both — they are alternatives, and the
  // CHECK on dbo.receipts enforces the same rule at the database level.
  if (payload.payment_mode === 'ONLINE' && !payload.bank_id && !payload.online_ba_id) {
    throw ApiError.badRequest('An ONLINE receipt needs an account — pass bank_id or online_ba_id');
  }
  if (payload.bank_id && payload.online_ba_id) {
    throw ApiError.badRequest('Pass either bank_id or online_ba_id for an ONLINE receipt, not both');
  }
  if (payload.payment_mode === 'CHEQUE') {
    if (!payload.cheque_no) throw ApiError.badRequest('cheque_no is required for a CHEQUE receipt');
    if (!payload.cheque_date) throw ApiError.badRequest('cheque_date is required for a CHEQUE receipt');
  }
}

function buildFields(payload) {
  return {
    receipt_date: payload.receipt_date,
    ba_id: payload.ba_id,
    amount: payload.amount,
    commission: payload.commission || 0,
    payment_mode: payload.payment_mode,
    details: payload.details,
    bank_id: payload.payment_mode === 'ONLINE' ? (payload.bank_id ?? null) : null,
    online_ba_id: payload.payment_mode === 'ONLINE' ? (payload.online_ba_id ?? null) : null,
    remarks: payload.remarks,
    // RJ-03: which voucher this entry belongs to. Only insert() reads it — updateHeader
    // deliberately does not, so editing a line can never move it to another voucher.
    voucher_id: payload.voucher_id,
  };
}

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins) — same
// convention as saleBills.service.js/purchases.service.js#resolveDateRange. (Corrected: an earlier
// PROGRESS.md entry claimed this already existed here — it didn't; caught while adding the
// equivalent to expenses.service.js and checking for consistency.)
function resolveDateRange(filters) {
  if (filters.date_from || filters.date_to) {
    return { date_from: filters.date_from, date_to: filters.date_to };
  }
  const today = new Date();
  if (filters.range === 'weekly') {
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    return { date_from: toISODate(from), date_to: toISODate(today) };
  }
  if (filters.range === 'monthly') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_from: toISODate(from), date_to: toISODate(today) };
  }
  return {}; // 'overall' or unspecified — no date filter
}

function list(filters = {}) {
  return repository.list({
    ba_id: filters.ba_id,
    customer_id: filters.customer_id,
    payment_mode: filters.payment_mode,
    status: filters.status,
    ...resolveDateRange(filters),
  });
}

async function getById(receiptId) {
  const receipt = await repository.findById(receiptId);
  if (!receipt) throw ApiError.notFound('Receipt not found');
  return receipt;
}

// Insert the receipt row (+ linked cheques row for CHEQUE mode) inside the CALLER's transaction —
// factored out of create() so draftReceipts.service.js#confirm() can share one transaction with
// postWithinTransaction() below instead of running create()+post() as two separate transactions
// (which left a real orphaned DRAFT receipt, and a duplicate-receipt risk on retry, if post()
// failed after create() had already committed — caught in debugger review).
async function insertReceipt(transaction, payload, userId) {
  const receiptId = await repository.insert(transaction, {
    ...buildFields(payload),
    created_by: userId,
    // Only draftReceipts.service#confirm() passes this, to keep a posted line in its original
    // place in the voucher's entry order; every other caller leaves it undefined (defaults to now).
    created_at: payload.created_at,
  });

  if (payload.payment_mode === 'CHEQUE') {
    const chequeId = await chequesRepository.insert(transaction, {
      receipt_id: receiptId,
      cheque_no: payload.cheque_no,
      cheque_date: payload.cheque_date,
      cheque_received_date: payload.cheque_received_date,
    });
    await repository.linkCheque(transaction, receiptId, chequeId);
  }

  return receiptId;
}

// Always created DRAFT — post() is the only thing that moves money, same shape as
// transfers/wage_runs/salary_runs. A CHEQUE-mode receipt also creates the linked cheques row here
// (PENDING) — the cheque physically exists once the customer hands it over, independent of
// whether this receipt has been posted to the ledger yet.
async function create(payload, userId, session) {
  validateHeader(payload);
  // UC-03 point 4 — receiving money INTO a restricted account is the same exposure as paying out
  // of one, and receipts:create was never covered by any role check.
  await businessAccountsService.assertAccessible(payload.ba_id, session);
  const id = await withTransaction((transaction) => insertReceipt(transaction, payload, userId));
  return getById(id);
}

// DRAFT-only — a CONFIRMED receipt is never edited in place (unpost first). Editing a CHEQUE
// receipt's cheque_no/cheque_date also updates the linked cheques row.
async function update(receiptId, payload, userId, session) {
  const existing = await getById(receiptId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the receipt before editing', 'POSTED_LOCK');
  }
  validateHeader(payload);
  await businessAccountsService.assertAccessible(payload.ba_id, session);

  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, receiptId, buildFields(payload));
    if (payload.payment_mode === 'CHEQUE' && existing.payment_mode === 'CHEQUE') {
      const cheque = await chequesRepository.findByReceiptId(receiptId);
      await chequesRepository.updateDetails(transaction, cheque.cheque_id, {
        cheque_no: payload.cheque_no,
        cheque_date: payload.cheque_date,
        cheque_received_date: payload.cheque_received_date,
      });
    } else if (payload.payment_mode === 'CHEQUE' && existing.payment_mode !== 'CHEQUE') {
      // Switched INTO cheque mode on edit — create the cheque row now, same as create().
      const chequeId = await chequesRepository.insert(transaction, {
        receipt_id: receiptId,
        cheque_no: payload.cheque_no,
        cheque_date: payload.cheque_date,
        cheque_received_date: payload.cheque_received_date,
      });
      await repository.linkCheque(transaction, receiptId, chequeId);
    } else if (payload.payment_mode !== 'CHEQUE' && existing.payment_mode === 'CHEQUE') {
      // Switched OUT of cheque mode — the old cheque never went anywhere (still DRAFT), safe to
      // drop it entirely: unlink first (breaks the circular FK), then delete the orphaned cheque.
      const cheque = await chequesRepository.findByReceiptId(receiptId);
      await repository.unlinkCheque(transaction, receiptId);
      await chequesRepository.deleteCheque(transaction, cheque.cheque_id);
    }
  });

  return getById(receiptId);
}

// DRAFT-only, hard DELETE — receipts is a transaction table, never soft-deleted. A cheque-mode
// receipt's linked cheques row is dropped too (the circular FK pair means receipts.cheque_id must
// be nulled out before the cheques row, then the cheques row, then this receipts row).
async function remove(receiptId) {
  const existing = await getById(receiptId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the receipt before deleting', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    if (existing.payment_mode === 'CHEQUE') {
      const cheque = await chequesRepository.findByReceiptId(receiptId);
      await repository.unlinkCheque(transaction, receiptId);
      await chequesRepository.deleteCheque(transaction, cheque.cheque_id);
    }
    await repository.remove(transaction, receiptId);
  });

  return { ok: true };
}

// Resolves which chart account / business account gets debited for a given payment_mode — the
// same lookup used both when posting a receipt and when reversing it on bounce/return, so a
// reversal always lands back exactly where the original posting came from.
async function resolveDebitSide(paymentMode, bankId, onlineBaId = null) {
  if (paymentMode === 'CASH') {
    const cash = await chartAccountsRepository.findByCode(CODES.CASH_IN_HAND);
    if (!cash) throw new Error(`Reserved chart account CASH IN HAND (code ${CODES.CASH_IN_HAND}) not found — run npm run seed`);
    return { ac_id: cash.ac_id };
  }
  if (paymentMode === 'ONLINE') {
    // A directly-named business account wins when present (migration 028). Everything recorded
    // before that migration has online_ba_id NULL and falls through to the bank lookup below —
    // the exact path it originally posted through, so reversals still land where they came from.
    if (onlineBaId) return { ba_id: onlineBaId };
    // Neither column set. The CHECK constraint makes this unreachable for a CONFIRMED row, but a
    // DRAFT carries no such constraint, so a bad draft reached here and failed inside the bank
    // lookup as a raw driver/type error — which wrap.js correctly sanitizes to "Unexpected error",
    // telling the user nothing (reported 2026-08-31). Name the real problem instead.
    if (!bankId) {
      throw ApiError.badRequest('This ONLINE entry names no account to receive the money — open it, pick an account and save, then post.');
    }
    const bank = await bankAccountsService.getById(bankId);
    if (!bank.ba_id) throw ApiError.conflict('Bank account has no linked ledger account yet', 'NO_BANK_ACCOUNT');
    return { ba_id: bank.ba_id };
  }
  // CHEQUE
  const cheques = await chartAccountsRepository.findByCode(CODES.CHEQUES_IN_HAND);
  if (!cheques) throw new Error(`Reserved chart account CHEQUES IN HAND (code ${CODES.CHEQUES_IN_HAND}) not found — run npm run seed`);
  return { ac_id: cheques.ac_id };
}

// Does the actual ledger-writing + status flip inside the CALLER's transaction — factored out of
// post() for the same reason as insertReceipt() above: draftReceipts.service.js#confirm() needs
// this in the SAME transaction as insertReceipt(), not a second one.
async function postWithinTransaction(transaction, receiptId, receipt) {
  // The credited side is whatever business account the receipt names (migration 014) — a customer's,
  // a director's, an employee's, a vendor's or a bank's. No customer lookup is needed any more:
  // receipts.ba_id is a NOT NULL FK, so the account is guaranteed to exist, which is what the old
  // NO_CUSTOMER_ACCOUNT guard was compensating for.
  const debitSide = await resolveDebitSide(receipt.payment_mode, receipt.bank_id, receipt.online_ba_id);

  const rows = [
    { entry_date: receipt.receipt_date, ...debitSide, debit: receipt.amount, credit: 0, source_type: 'RECEIPT', source_id: receiptId, narration: `Receipt #${receiptId}` },
    { entry_date: receipt.receipt_date, ba_id: receipt.ba_id, debit: 0, credit: receipt.amount, source_type: 'RECEIPT', source_id: receiptId, narration: `Receipt #${receiptId}` },
  ];
  if (receipt.commission > 0) {
    const commissionAccount = await chartAccountsRepository.findByCode(CODES.COMMISSION_ALLOWED);
    if (!commissionAccount) throw new Error(`Reserved chart account COMMISSION ALLOWED (code ${CODES.COMMISSION_ALLOWED}) not found — run npm run seed`);
    rows.push(
      { entry_date: receipt.receipt_date, ac_id: commissionAccount.ac_id, debit: receipt.commission, credit: 0, source_type: 'COMMISSION', source_id: receiptId, narration: `Receipt #${receiptId} commission` },
      { entry_date: receipt.receipt_date, ba_id: receipt.ba_id, debit: 0, credit: receipt.commission, source_type: 'COMMISSION', source_id: receiptId, narration: `Receipt #${receiptId} commission` },
    );
  }
  await repository.insertLedgerEntries(transaction, rows);
  await repository.setStatus(transaction, receiptId, 'CONFIRMED');
}

// Post: Dr <cash/bank/cheques-in-hand> / Cr the receipt's business account for `amount`, plus a
// second Dr COMMISSION ALLOWED / Cr that same account pair when commission > 0 — the sale bill
// itself is never touched
// (database_schema_v4.3.md §6/§7).
// The account guard runs again here, not only on create/update: posting is the moment the money
// actually moves, and the document being posted may have been created by somebody else. Without it
// an ADMIN could leave a draft against a restricted account for a USER to post.
async function post(receiptId, session) {
  const receipt = await getById(receiptId);
  await businessAccountsService.assertAccessible(receipt.ba_id, session);
  if (receipt.status === 'CONFIRMED') {
    throw ApiError.conflict('Receipt is already posted', 'ALREADY_POSTED');
  }

  await withTransaction((transaction) => postWithinTransaction(transaction, receiptId, receipt));

  return getById(receiptId);
}

// Blocked once the underlying cheque has moved past PENDING (deposited/endorsed/etc. — unposting
// at that point would leave cheque_allocations pointing at ledger rows that no longer exist).
async function unpost(receiptId, session) {
  const receipt = await getById(receiptId);
  await businessAccountsService.assertAccessible(receipt.ba_id, session);
  if (receipt.status !== 'CONFIRMED') {
    throw ApiError.conflict('Receipt is not posted', 'NOT_POSTED');
  }
  if (receipt.payment_mode === 'CHEQUE' && receipt.cheque_status && receipt.cheque_status !== 'PENDING') {
    throw ApiError.conflict('This cheque has already been disposed of — reverse that first', 'CHEQUE_IN_USE');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, receiptId);
    await repository.setStatus(transaction, receiptId, 'DRAFT');
  });

  return getById(receiptId);
}

// Reverse of draftReceipts.service.js#confirm(): moves a posted receipt back out of dbo.receipts
// and into dbo.draft_receipts, so the real table strictly only ever holds posted documents (same
// architecture as saleBills/purchases/... #unconfirm()).
//
// Every guard unpost() applies still applies here, unchanged and for the same reasons — this is
// the same reversal, it just doesn't leave the row behind:
//   - must be CONFIRMED
//   - a CHEQUE receipt whose cheque has moved past PENDING is refused (CHEQUE_IN_USE): its
//     disposition owns ledger rows this would strand.
//
// Because that guard guarantees the cheque is still PENDING (never deposited, endorsed or
// allocated), the cheques row can safely be dropped and its details carried onto the draft as
// plain columns — exactly what remove() already does for an unposted cheque receipt, and the
// reverse of what confirm() does on the way in. Re-confirming re-creates the cheques row through
// insertReceipt(), the same single code path as always, so no cheque/endorse/bounce logic changes.
async function unconfirm(receiptId, session) {
  const receipt = await getById(receiptId);
  await businessAccountsService.assertAccessible(receipt.ba_id, session);
  if (receipt.status !== 'CONFIRMED') {
    throw ApiError.conflict('Receipt is not posted', 'NOT_POSTED');
  }
  if (receipt.payment_mode === 'CHEQUE' && receipt.cheque_status && receipt.cheque_status !== 'PENDING') {
    throw ApiError.conflict('This cheque has already been disposed of — reverse that first', 'CHEQUE_IN_USE');
  }

  const draftId = await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, receiptId);

    const newDraftId = await draftReceiptsRepository.insert(transaction, {
      receipt_date: receipt.receipt_date,
      ba_id: receipt.ba_id,
      amount: receipt.amount,
      commission: receipt.commission,
      payment_mode: receipt.payment_mode,
      details: receipt.details,
      bank_id: receipt.bank_id,
      // Must travel with bank_id, not instead of it: since migration 028 an ONLINE receipt names
      // EITHER a bank OR any business account, and dropping this on the way back turned an
      // unposted ONLINE receipt into a draft naming NEITHER — which then failed to re-post with an
      // "Unexpected error" (reported by the user, 2026-08-31, on a 3,400 receipt).
      online_ba_id: receipt.online_ba_id,
      remarks: receipt.remarks,
      // findById joins dbo.cheques, so these are the live cheque's own details for a CHEQUE
      // receipt and NULL for CASH/ONLINE.
      cheque_no: receipt.cheque_no,
      cheque_date: receipt.cheque_date,
      cheque_received_date: receipt.cheque_received_date,
      voucher_id: receipt.voucher_id,
      created_by: receipt.created_by,
      // Keeps the line where it was in its voucher's entry order.
      created_at: receipt.created_at,
    });

    if (receipt.payment_mode === 'CHEQUE' && receipt.cheque_id) {
      // Circular FK pair: null out receipts.cheque_id first, then the cheques row, then the
      // receipt itself — the same order remove() uses.
      await repository.unlinkCheque(transaction, receiptId);
      await chequesRepository.deleteCheque(transaction, receipt.cheque_id);
    }

    await repository.remove(transaction, receiptId);
    return newDraftId;
  });

  return draftReceiptsRepository.findById(draftId);
}

module.exports = {
  list, getById, create, update, remove, post, unpost, unconfirm, resolveDebitSide,
  insertReceipt, postWithinTransaction,
};
