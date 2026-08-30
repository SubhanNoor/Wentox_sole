// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/expenses.repository');
const draftExpensesRepository = require('../repositories/draftExpenses.repository');
const chequesService = require('./cheques.service');
const chequesRepository = require('../repositories/cheques.repository');
const vendorsService = require('./vendors.service');
const businessAccountsService = require('./businessAccounts.service');
const bankAccountsService = require('./bankAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');
const { toISODate } = require('../utils/dates');

// Resolves who gets paid — either a vendor (pick a vendor, resolves to vendors.ba_id) or any other
// business account directly (a generic expense head). Either way expenses.ba_id ends up holding
// the resolved account; which path was used doesn't need to be remembered afterward.
async function resolveTarget(payload, session) {
  if (payload.vendor_id) {
    const vendor = await vendorsService.getById(payload.vendor_id);
    if (!vendor.ba_id) throw ApiError.conflict('Vendor has no linked account yet', 'NO_VENDOR_ACCOUNT');
    return vendor.ba_id;
  }
  if (payload.ba_id) {
    const account = await businessAccountsService.getById(payload.ba_id); // 404s if it doesn't exist
    // UC-03 point 4 — a USER must not be able to pay a Bank Accounts or Directors-Drawings account
    // just because the screen that lists them is hidden.
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
  // ONLINE names EITHER a bank OR any business account (online_ba_id, migration 028).
  // CHEQUE_ISSUED deliberately keeps requiring a real bank below: an issued cheque is drawn on a
  // bank's cheque book, so a non-bank account has no meaning there.
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
    // PN-01: which voucher this entry belongs to. Only insert() reads it — updateHeader
    // deliberately does not, so editing a line can never move it to another voucher.
    voucher_id: payload.voucher_id,
  };
}

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins) — same
// convention as receipts.service.js/saleBills.service.js/purchases.service.js#resolveDateRange.
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
    payment_mode: filters.payment_mode,
    status: filters.status,
    ...resolveDateRange(filters),
  });
}

async function getById(expenseId) {
  const expense = await repository.findById(expenseId);
  if (!expense) throw ApiError.notFound('Expense not found');
  return expense;
}

// Always created DRAFT — post() is the only thing that moves money. CHEQUE_ENDORSED doesn't
// reserve any of the cheque's balance at create time — that only happens on post(), matching
// every other module's "posting is what moves money" convention.
async function create(payload, userId, session) {
  validateHeader(payload);
  const baId = await resolveTarget(payload, session);

  const id = await withTransaction((transaction) => repository.insert(transaction, {
    ...buildFields(payload, baId),
    created_by: userId,
    // Only draftExpenses.service#confirm() passes this, to keep a posted line in its original place
    // in the voucher's entry order; every other caller leaves it undefined (defaults to now).
    created_at: payload.created_at,
  }));
  return getById(id);
}

// DRAFT-only — a CONFIRMED expense is never edited in place (unpost first).
async function update(expenseId, payload, userId, session) {
  const existing = await getById(expenseId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the expense before editing', 'POSTED_LOCK');
  }
  validateHeader(payload);
  const baId = await resolveTarget(payload, session);

  await withTransaction((transaction) => repository.updateHeader(transaction, expenseId, buildFields(payload, baId)));
  return getById(expenseId);
}

// DRAFT-only, hard DELETE — expenses is a transaction table, never soft-deleted. Normally safe for
// a DRAFT CHEQUE_ENDORSED expense (no cheque_allocations row exists until post() runs) — EXCEPT a
// draftExpenses:confirm() attempt can leave a DRAFT expense with a real allocation already created
// (see draftExpenses.service.js's pending_expense_id note) — the draft that created it still points
// back via pending_expense_id, and FK_draft_expenses_pending_expense would otherwise turn this into
// an opaque SQL error. Checked here for a clear message instead.
async function remove(expenseId) {
  const existing = await getById(expenseId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the expense before deleting', 'POSTED_LOCK');
  }
  const stuckDraft = await draftExpensesRepository.findByPendingExpenseId(expenseId);
  if (stuckDraft) {
    throw ApiError.conflict(
      `This expense is still tied to draft #${stuckDraft.draft_id} from a confirm attempt — resolve or delete that draft first`,
      'PENDING_DRAFT_UNRESOLVED',
    );
  }
  await withTransaction((transaction) => repository.remove(transaction, expenseId));
  return { ok: true };
}

// CASH/ONLINE/CHEQUE_ISSUED: Dr ba_id / Cr CASH_IN_HAND or the selected bank's ba_id — same
// resolution shape as receipts.service.js#resolveDebitSide, just credited instead of debited
// (money going OUT here, not in). CHEQUE_ISSUED debits the same bank as ONLINE would — the bank is
// deducted the day the cheque is written (deduct-on-write, cash_and_bank.md §6), issued_cheque_no/
// issued_cheque_date are already stored on the row for the record, no separate cheques row (that
// table is for cheques RECEIVED, not written).
async function resolveCreditSide(paymentMode, bankId, onlineBaId = null) {
  if (paymentMode === 'CASH') {
    const cash = await chartAccountsRepository.findByCode(CODES.CASH_IN_HAND);
    if (!cash) throw new Error(`Reserved chart account CASH IN HAND (code ${CODES.CASH_IN_HAND}) not found — run npm run seed`);
    return { ac_id: cash.ac_id };
  }
  // An ONLINE expense that named a business account directly (migration 028) credits it as-is.
  // Anything recorded before that has online_ba_id NULL and falls through to the bank lookup —
  // the same path it originally posted through. CHEQUE_ISSUED never reaches this branch with a
  // value set, since validate() only accepts online_ba_id for ONLINE.
  if (paymentMode === 'ONLINE' && onlineBaId) return { ba_id: onlineBaId };
  // ONLINE (bank-named) or CHEQUE_ISSUED
  const bank = await bankAccountsService.getById(bankId);
  if (!bank.ba_id) throw ApiError.conflict('Bank account has no linked ledger account yet', 'NO_BANK_ACCOUNT');
  return { ba_id: bank.ba_id };
}

// Post: CASH/ONLINE/CHEQUE_ISSUED write their own Dr ba_id / Cr <cash/bank> ledger pair here
// (source_type='EXPENSE'). CHEQUE_ENDORSED does NOT — it delegates entirely to
// cheques.service.js#endorseToExpense(), which is the exact same code the standalone Cheques page
// uses, so there is only ever ONE ledger trail for a given cheque no matter which screen disposed
// of it, and the existing bounce/return reversal already handles it correctly with no new
// reversal logic needed (this was a deliberate design decision after finding the two screens would
// otherwise describe the same real-world action through two disconnected mechanisms).
// The account guard runs again here, not only on create/update: posting is the moment the money
// actually moves, and the document being posted may have been created by somebody else. Without it
// an ADMIN could leave a draft against a restricted account for a USER to post.
async function post(expenseId, userId, session) {
  const expense = await getById(expenseId);
  if (expense.ba_id) await businessAccountsService.assertAccessible(expense.ba_id, session);
  if (expense.status === 'CONFIRMED') {
    throw ApiError.conflict('Expense is already posted', 'ALREADY_POSTED');
  }

  if (expense.payment_mode === 'CHEQUE_ENDORSED') {
    // endorseToExpense() commits its own transaction (the real money movement); the status flip
    // below is a SEPARATE transaction. If that second step fails after the first already
    // committed, a naive retry would call endorseToExpense() again and double-dispose the cheque.
    // Checking for an existing allocation tied to THIS expense first makes retrying post() safe —
    // caught in debugger review, not by the original manual testing (needs a failure in the exact
    // window between the two commits, which a happy-path run can't hit).
    const existingAllocation = await chequesRepository.findAllocationByExpenseId(expenseId);
    if (!existingAllocation) {
      await chequesService.endorseToExpense(expense.cheque_id, {
        target_ba_id: expense.ba_id,
        allocation_date: expense.expense_date,
        amount: expense.amount,
        remarks: expense.remarks,
        expense_id: expenseId,
      }, userId);
    }
    await withTransaction((transaction) => repository.setStatus(transaction, expenseId, 'CONFIRMED', userId));
    return getById(expenseId);
  }

  const creditSide = await resolveCreditSide(expense.payment_mode, expense.bank_id, expense.online_ba_id);

  await withTransaction(async (transaction) => {
    const narration = `Expense #${expenseId}`;
    await repository.insertLedgerEntries(transaction, [
      { entry_date: expense.expense_date, ba_id: expense.ba_id, debit: expense.amount, credit: 0, source_type: 'EXPENSE', source_id: expenseId, narration },
      { entry_date: expense.expense_date, ...creditSide, debit: 0, credit: expense.amount, source_type: 'EXPENSE', source_id: expenseId, narration },
    ]);
    await repository.setStatus(transaction, expenseId, 'CONFIRMED', userId);
  });

  return getById(expenseId);
}

// CASH/ONLINE/CHEQUE_ISSUED unpost normally. CHEQUE_ENDORSED is deliberately NOT unpostable here —
// its real ledger effect belongs to a cheque_allocations row, and the only correct way to undo a
// cheque disposition is the cheque's own bounce/return-to-sender flow (which already knows how to
// reverse it), not a generic unpost on this document. Attempting it is rejected with a clear
// pointer to the right place. A CHEQUE_ISSUED expense that has already bounced/been returned is
// blocked the same way — deleteLedgerEntries() matches on source_type/source_id alone, with no way
// to tell the original post's rows apart from bounceIssuedCheque()/returnIssuedCheque()'s reversal
// rows, so an unguarded unpost would erase the reversal history too and strand issued_cheque_status
// at a terminal value on a DRAFT row (same class of bug receipts.service.js#unpost() already guards
// against for a disposed-of received cheque).
async function unpost(expenseId, session) {
  const expense = await getById(expenseId);
  if (expense.ba_id) await businessAccountsService.assertAccessible(expense.ba_id, session);
  if (expense.status !== 'CONFIRMED') {
    throw ApiError.conflict('Expense is not posted', 'NOT_POSTED');
  }
  if (expense.payment_mode === 'CHEQUE_ENDORSED') {
    throw ApiError.conflict(
      'A cheque-endorsed expense cannot be unposted directly — bounce or return the cheque itself instead',
      'USE_CHEQUE_REVERSAL',
    );
  }
  if (expense.payment_mode === 'CHEQUE_ISSUED' && expense.issued_cheque_status !== 'PENDING') {
    throw ApiError.conflict(
      `This cheque has already been ${expense.issued_cheque_status.toLowerCase()} — its ledger history cannot be unposted`,
      'ISSUED_CHEQUE_TERMINAL',
    );
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, expenseId);
    await repository.setStatus(transaction, expenseId, 'DRAFT');
  });

  return getById(expenseId);
}

// Reverse of draftExpenses.service.js#confirm(): moves a posted expense back out of dbo.expenses
// and into dbo.draft_expenses, so the real table strictly only ever holds posted documents (same
// architecture as saleBills/purchases/receipts #unconfirm()).
//
// Every guard unpost() applies still applies here, unchanged and for exactly the same reasons —
// this is the same reversal, it just doesn't leave the row behind:
//   - must be CONFIRMED
//   - CHEQUE_ENDORSED is refused outright (USE_CHEQUE_REVERSAL): its real ledger effect belongs to
//     a cheque_allocations row, and the only correct way to undo a cheque disposition is the
//     cheque's own bounce/return-to-sender flow. Nothing about endorsement changes here.
//   - a CHEQUE_ISSUED cheque that has already bounced/been returned is refused
//     (ISSUED_CHEQUE_TERMINAL): deleteLedgerEntries() cannot tell the original post's rows apart
//     from the reversal's, so unposting would erase the reversal history too.
async function unconfirm(expenseId, session) {
  const expense = await getById(expenseId);
  if (expense.ba_id) await businessAccountsService.assertAccessible(expense.ba_id, session);
  if (expense.status !== 'CONFIRMED') {
    throw ApiError.conflict('Expense is not posted', 'NOT_POSTED');
  }
  if (expense.payment_mode === 'CHEQUE_ENDORSED') {
    throw ApiError.conflict(
      'A cheque-endorsed expense cannot be unposted directly — bounce or return the cheque itself instead',
      'USE_CHEQUE_REVERSAL',
    );
  }
  if (expense.payment_mode === 'CHEQUE_ISSUED' && expense.issued_cheque_status !== 'PENDING') {
    throw ApiError.conflict(
      `This cheque has already been ${expense.issued_cheque_status.toLowerCase()} — its ledger history cannot be unposted`,
      'ISSUED_CHEQUE_TERMINAL',
    );
  }

  const draftId = await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, expenseId);

    const newDraftId = await draftExpensesRepository.insert(transaction, {
      expense_date: expense.expense_date,
      ba_id: expense.ba_id,
      amount: expense.amount,
      payment_mode: expense.payment_mode,
      details: expense.details,
      cheque_id: expense.cheque_id,
      bank_id: expense.bank_id,
      issued_cheque_no: expense.issued_cheque_no,
      issued_cheque_date: expense.issued_cheque_date,
      remarks: expense.remarks,
      voucher_id: expense.voucher_id,
      created_by: expense.created_by,
      // Keeps the line where it was in its voucher's entry order.
      created_at: expense.created_at,
    });

    await repository.remove(transaction, expenseId);
    return newDraftId;
  });

  return draftExpensesRepository.findById(draftId);
}

// Shared reversal mechanics for a CHEQUE_ISSUED expense that bounces or is returned unpaid — the
// mirror image of cheques.service.js#reverseCheque(), but for a cheque WE wrote instead of one we
// endorsed on: there is no cheques/cheque_allocations row to touch, just this expense's own ledger
// effect and its own issued_cheque_status. Reverses the original Dr ba_id / Cr bank ba_id entry
// (Dr bank ba_id / Cr ba_id here), dated the bounce/return date — nothing deleted or rewritten,
// same reverse-never-delete rule as receipts/cheques bounce.
async function reverseIssuedCheque(expenseId, { date, reason, mode }, userId) {
  const expense = await getById(expenseId);
  if (expense.payment_mode !== 'CHEQUE_ISSUED') {
    throw ApiError.badRequest('Only a CHEQUE_ISSUED expense can be bounced or returned this way');
  }
  if (expense.status !== 'CONFIRMED') {
    throw ApiError.conflict('Post the expense before bouncing or returning its cheque', 'EXPENSE_NOT_POSTED');
  }
  if (expense.issued_cheque_status !== 'PENDING') {
    throw ApiError.conflict(`This cheque is already ${expense.issued_cheque_status.toLowerCase()}`, 'ISSUED_CHEQUE_TERMINAL');
  }
  if (!date) throw ApiError.badRequest('date is required');

  const bank = await bankAccountsService.getById(expense.bank_id);
  if (!bank.ba_id) throw ApiError.conflict('Bank account has no linked ledger account yet', 'NO_BANK_ACCOUNT');

  const narration = `${mode} reversal of expense #${expenseId}`;

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, [
      { entry_date: date, ba_id: bank.ba_id, debit: expense.amount, credit: 0, source_type: 'EXPENSE', source_id: expenseId, narration },
      { entry_date: date, ba_id: expense.ba_id, debit: 0, credit: expense.amount, source_type: 'EXPENSE', source_id: expenseId, narration },
    ]);
    if (mode === 'BOUNCED') {
      await repository.markIssuedChequeBounced(transaction, expenseId, date);
    } else {
      await repository.markIssuedChequeReturned(transaction, expenseId, date, reason);
    }
  });

  return getById(expenseId);
}

function bounceIssuedCheque(expenseId, payload, userId) {
  return reverseIssuedCheque(expenseId, { date: payload.bounced_date, mode: 'BOUNCED' }, userId);
}

function returnIssuedCheque(expenseId, payload, userId) {
  return reverseIssuedCheque(expenseId, { date: payload.returned_date, reason: payload.reason, mode: 'RETURNED' }, userId);
}

// "Cheque" page's issued-cheque list — every posted CHEQUE_ISSUED expense whose cheque
// hasn't bounced/been returned yet, alongside the existing endorsed-allocations list.
function listReturnableIssuedCheques(filters) {
  return repository.listReturnableIssuedCheques(filters);
}

// "Cheque" page's Ledger tab — every posted CHEQUE_ISSUED expense regardless of status (pending,
// bounced, or returned), for the full-history register alongside listEndorsedAllocations()/
// cheques.service.js#list() (received cheques).
function listIssuedCheques(filters) {
  return repository.listIssuedCheques(filters);
}

module.exports = {
  list, getById, create, update, remove, post, unpost, unconfirm,
  bounceIssuedCheque, returnIssuedCheque, listReturnableIssuedCheques, listIssuedCheques,
};
