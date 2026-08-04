// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/draftExpenses.repository');
const expensesRepository = require('../repositories/expenses.repository');
const expensesService = require('./expenses.service');
const vendorsService = require('./vendors.service');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

// All four payment modes are draftable (unlike draftReceipts — see migration
// 004_draft_expenses_parity.sql's note: a CHEQUE_ENDORSED draft references an ALREADY-EXISTING
// received cheque, so there's no chicken-egg problem the way a not-yet-existing CHEQUE receipt has).
async function resolveTarget(payload) {
  if (payload.vendor_id) {
    const vendor = await vendorsService.getById(payload.vendor_id);
    if (!vendor.ba_id) throw ApiError.conflict('Vendor has no linked account yet', 'NO_VENDOR_ACCOUNT');
    return vendor.ba_id;
  }
  if (payload.ba_id) {
    const account = await businessAccountsService.getById(payload.ba_id);
    return account.ba_id;
  }
  throw ApiError.badRequest('vendor_id or ba_id is required');
}

function validateHeader(payload) {
  if (!payload.expense_date) throw ApiError.badRequest('expense_date is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (!['CASH', 'ONLINE', 'CHEQUE_ENDORSED', 'CHEQUE_ISSUED'].includes(payload.payment_mode)) {
    throw ApiError.badRequest("payment_mode must be 'CASH', 'ONLINE', 'CHEQUE_ENDORSED', or 'CHEQUE_ISSUED'");
  }
  if (payload.payment_mode === 'ONLINE' && !payload.bank_id) {
    throw ApiError.badRequest('bank_id is required for an ONLINE expense');
  }
  if (payload.payment_mode === 'CHEQUE_ENDORSED' && !payload.cheque_id) {
    throw ApiError.badRequest('cheque_id is required for a CHEQUE_ENDORSED expense');
  }
  if (payload.payment_mode === 'CHEQUE_ISSUED') {
    if (!payload.bank_id) throw ApiError.badRequest('bank_id is required for a CHEQUE_ISSUED expense');
    if (!payload.issued_cheque_no) throw ApiError.badRequest('issued_cheque_no is required for a CHEQUE_ISSUED expense');
    if (!payload.issued_cheque_date) throw ApiError.badRequest('issued_cheque_date is required for a CHEQUE_ISSUED expense');
  }
}

async function create(payload, userId) {
  validateHeader(payload);
  const baId = await resolveTarget(payload);

  const draftId = await withTransaction((transaction) => repository.insert(transaction, {
    expense_date: payload.expense_date,
    ba_id: baId,
    amount: payload.amount,
    payment_mode: payload.payment_mode,
    details: payload.details,
    cheque_id: payload.payment_mode === 'CHEQUE_ENDORSED' ? payload.cheque_id : null,
    bank_id: (payload.payment_mode === 'ONLINE' || payload.payment_mode === 'CHEQUE_ISSUED') ? payload.bank_id : null,
    issued_cheque_no: payload.payment_mode === 'CHEQUE_ISSUED' ? payload.issued_cheque_no : null,
    issued_cheque_date: payload.payment_mode === 'CHEQUE_ISSUED' ? payload.issued_cheque_date : null,
    remarks: payload.remarks,
    created_by: userId,
  }));
  return getById(draftId);
}

async function getById(draftId) {
  const draft = await repository.findById(draftId);
  if (!draft) throw ApiError.notFound('Draft expense not found');
  return draft;
}

function list(filters) {
  return repository.list(filters);
}

// Blocked while pending_expense_id is set — a prior confirm() attempt left a real expense (and
// possibly a real cheque disposition) behind that this draft is the only pointer to. Deleting the
// draft here would orphan it with no way to resume. Retry confirm() (or resolve the stuck expense
// directly) first.
async function remove(draftId) {
  const draft = await getById(draftId);
  if (draft.pending_expense_id) {
    throw ApiError.conflict(
      'This draft has a stuck expense from a previous confirm attempt — retry confirming it, or resolve expense #' +
      `${draft.pending_expense_id} directly, before deleting this draft`,
      'PENDING_EXPENSE_UNRESOLVED',
    );
  }
  await withTransaction((transaction) => repository.deleteDraft(transaction, draftId));
  return { ok: true };
}

// Confirm = create the real expense, post it, delete the draft. Unlike draftReceipts.confirm()
// (which shares one transaction with receipts.service.js's insertReceipt()/postWithinTransaction()),
// this can't be a single shared transaction: CHEQUE_ENDORSED posting delegates to
// cheques.service.js#endorseToExpense(), which opens and owns its own transaction, and nesting
// transactions across service boundaries isn't supported by the underlying mssql Transaction API.
//
// For CASH/ONLINE/CHEQUE_ISSUED, post() is a single atomic transaction — a failure there means
// NOTHING committed, so the original create()-then-compensating-delete-on-failure shape is safe
// as-is.
//
// For CHEQUE_ENDORSED, post() is NOT atomic (endorseToExpense()'s commit and the status flip are
// two separate transactions — see expenses.service.js#post()). A first-pass fix made post() itself
// idempotent (checks for an existing allocation before re-disposing the cheque), but that alone
// wasn't enough: a naive retry of confirm() would still call create() again on every attempt,
// minting a brand-new expense_id each time — so post()'s idempotency check would never find the
// PRIOR attempt's allocation (it's keyed on the NEW expense_id, not the draft), and the cheque
// would still get double-disposed. Caught by debugger review verifying the first fix, not by the
// happy-path regression suite (needs a failure in the exact window between post()'s two commits).
//
// Fixed by recording pending_expense_id on the DRAFT itself, set right after create() succeeds but
// BEFORE post() is attempted — so ANY later confirm() call on this draft resumes against the SAME
// expense_id (whose post() is now genuinely idempotent) instead of creating another one. The draft
// is only ever deleted on full success.
async function confirm(draftId, userId) {
  const draft = await getById(draftId);
  const payload = {
    expense_date: draft.expense_date,
    ba_id: draft.ba_id,
    amount: draft.amount,
    payment_mode: draft.payment_mode,
    details: draft.details,
    cheque_id: draft.cheque_id,
    bank_id: draft.bank_id,
    issued_cheque_no: draft.issued_cheque_no,
    issued_cheque_date: draft.issued_cheque_date,
    remarks: draft.remarks,
  };

  let expenseId;
  if (draft.payment_mode === 'CHEQUE_ENDORSED' && draft.pending_expense_id) {
    // Resuming a prior attempt — the expense already exists, don't create another one.
    expenseId = draft.pending_expense_id;
  } else {
    const expense = await expensesService.create(payload, userId);
    expenseId = expense.expense_id;
    if (draft.payment_mode === 'CHEQUE_ENDORSED') {
      await withTransaction((transaction) => repository.setPendingExpenseId(transaction, draftId, expenseId));
    }
  }

  let posted;
  try {
    posted = await expensesService.post(expenseId, userId);
  } catch (err) {
    if (draft.payment_mode === 'CHEQUE_ENDORSED') {
      // Never delete here — pending_expense_id already guarantees a future confirm() (or a direct
      // expenses:post retry) resumes correctly against this same expense, whether or not any real
      // allocation was created yet.
      throw err;
    }
    // CASH/ONLINE/CHEQUE_ISSUED: post() is atomic, so a failure here means nothing committed —
    // safe to delete the just-created expense and let a retry start clean.
    await withTransaction((transaction) => expensesRepository.remove(transaction, expenseId));
    throw err;
  }

  await withTransaction((transaction) => repository.deleteDraft(transaction, draftId));
  return posted;
}

module.exports = { create, getById, list, remove, confirm };
