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
// Identical to expenses.service.js#resolveTarget, including the UC-03 point 4 access guard — this
// is now the path a new expense actually takes, so the guard has to be applied here, not only on
// the real table's create().
async function resolveTarget(payload, session) {
  if (payload.vendor_id) {
    const vendor = await vendorsService.getById(payload.vendor_id);
    if (!vendor.ba_id) throw ApiError.conflict('Vendor has no linked account yet', 'NO_VENDOR_ACCOUNT');
    return vendor.ba_id;
  }
  if (payload.ba_id) {
    const account = await businessAccountsService.getById(payload.ba_id); // 404s if it doesn't exist
    await businessAccountsService.assertAccessible(account.ba_id, session);
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
  // Same rule as expenses.service.js, kept in step so a draft can never hold something confirm()
  // would reject: ONLINE takes a bank OR any business account; CHEQUE_ISSUED stays bank-only.
  if (payload.payment_mode === 'ONLINE' && !payload.bank_id && !payload.online_ba_id) {
    throw ApiError.badRequest('An ONLINE expense needs an account — pass bank_id or online_ba_id');
  }
  if (payload.bank_id && payload.online_ba_id) {
    throw ApiError.badRequest('Pass either bank_id or online_ba_id, not both');
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

function buildFields(payload, baId) {
  return {
    expense_date: payload.expense_date,
    ba_id: baId,
    amount: payload.amount,
    payment_mode: payload.payment_mode,
    details: payload.details,
    cheque_id: payload.payment_mode === 'CHEQUE_ENDORSED' ? payload.cheque_id : null,
    bank_id: (payload.payment_mode === 'ONLINE' || payload.payment_mode === 'CHEQUE_ISSUED') ? (payload.bank_id ?? null) : null,
    online_ba_id: payload.payment_mode === 'ONLINE' ? (payload.online_ba_id ?? null) : null,
    issued_cheque_no: payload.payment_mode === 'CHEQUE_ISSUED' ? payload.issued_cheque_no : null,
    issued_cheque_date: payload.payment_mode === 'CHEQUE_ISSUED' ? payload.issued_cheque_date : null,
    remarks: payload.remarks,
  };
}

// This is the channel every NEW expense comes in through now — an unposted expense lives here and
// only moves into dbo.expenses when it is posted (confirm).
//
// UC-03 point 4 — a USER must not be able to pay a Bank Accounts or Directors-Drawings account
// just because the screen that lists them is hidden. expenses.service#resolveTarget() applies this
// on the real-table path; the same guard has to hold here, since this is now where an expense is
// actually created. (resolveTarget below takes the session for exactly this reason.)
async function create(payload, userId, session) {
  validateHeader(payload);
  const baId = await resolveTarget(payload, session);

  const draftId = await withTransaction((transaction) => repository.insert(transaction, {
    ...buildFields(payload, baId),
    // PN-01: the voucher this line belongs to, if it was entered on one.
    voucher_id: payload.voucher_id,
    created_by: userId,
  }));
  return getById(draftId);
}

// Editing an unposted expense — the normal edit path now. Mirrors expenses.service.js#update()'s
// rules, minus the POSTED_LOCK check: a draft is unposted by definition, so there is nothing to
// lock.
//
// Blocked while pending_expense_id is set, for the same reason remove() is: a prior confirm()
// attempt left a real expense (and possibly a real cheque disposition) that this draft is the only
// pointer to, and editing the draft would silently desynchronise the two. Retry confirming it, or
// resolve the stuck expense, first.
async function update(draftId, payload, userId, session) {
  const draft = await getById(draftId);
  if (draft.pending_expense_id) {
    throw ApiError.conflict(
      'This draft has a stuck expense from a previous confirm attempt — retry confirming it, or resolve expense #' +
      `${draft.pending_expense_id} directly, before editing this draft`,
      'PENDING_EXPENSE_UNRESOLVED',
    );
  }
  validateHeader(payload);
  const baId = await resolveTarget(payload, session);

  await withTransaction((transaction) => repository.updateHeader(transaction, draftId, buildFields(payload, baId)));
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
async function confirm(draftId, userId, session) {
  const draft = await getById(draftId);

  // Same reasoning as draftReceipts.service.js#confirm: draft_expenses carries no CHECK, so an
  // ONLINE draft naming neither account only fails at the INSERT into dbo.expenses, as a raw
  // constraint error that wrap.js can report only as "Unexpected error". Say what to fix instead.
  if (draft.payment_mode === 'ONLINE' && !draft.bank_id && !draft.online_ba_id) {
    throw ApiError.badRequest(
      'This ONLINE entry names no account to pay from. Open it, pick the account, save, then post.',
    );
  }

  const payload = {
    expense_date: draft.expense_date,
    ba_id: draft.ba_id,
    amount: draft.amount,
    payment_mode: draft.payment_mode,
    details: draft.details,
    cheque_id: draft.cheque_id,
    bank_id: draft.bank_id,
    online_ba_id: draft.online_ba_id,
    issued_cheque_no: draft.issued_cheque_no,
    issued_cheque_date: draft.issued_cheque_date,
    remarks: draft.remarks,
    // PN-01: the posted line stays on the voucher it was entered on, and keeps its place in that
    // voucher's entry order.
    voucher_id: draft.voucher_id,
    created_at: draft.created_at,
  };

  let expenseId;
  if (draft.payment_mode === 'CHEQUE_ENDORSED' && draft.pending_expense_id) {
    // Resuming a prior attempt — the expense already exists, don't create another one.
    expenseId = draft.pending_expense_id;
  } else {
    const expense = await expensesService.create(payload, userId, session);
    expenseId = expense.expense_id;
    if (draft.payment_mode === 'CHEQUE_ENDORSED') {
      await withTransaction((transaction) => repository.setPendingExpenseId(transaction, draftId, expenseId));
    }
  }

  let posted;
  try {
    posted = await expensesService.post(expenseId, userId, session);
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

module.exports = { create, getById, list, update, remove, confirm };
