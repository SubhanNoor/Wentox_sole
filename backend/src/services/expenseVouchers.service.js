// Business logic for payment (Naam) vouchers — PN-01, the Payments counterpart of
// receiptVouchers.service.js. Same shape deliberately: a header (date, C.Book No, remarks) over
// many entry lines, each line naming its own account, posted as one action.
//
// Kept as its own file rather than sharing a generic "voucher service" with receipts, because the
// two differ where it matters: expenses carry four payment modes (two of them cheque mechanics that
// have nothing in common), and expenses.service#post takes a userId that receipts.service#post
// does not. A shared abstraction would have to branch on document type in every method.
const repository = require('../repositories/expenseVouchers.repository');
const expensesRepository = require('../repositories/expenses.repository');
const expensesService = require('./expenses.service');
// A voucher's lines are split across two tables now: unposted ones in dbo.draft_expenses, posted
// ones in dbo.expenses. Posting a line is draftExpenses.confirm() (draft -> real), unposting it is
// expenses.unconfirm() (real -> draft); the per-line isolation and reporting below are unchanged.
const draftExpensesService = require('./draftExpenses.service');
const draftExpensesRepository = require('../repositories/draftExpenses.repository');
const { withTransaction } = require('../db/pool');
const ApiError = require('../errors/ApiError');
const { today } = require('../utils/dates');

// PN-01: derived, never stored — posting is per line and a voucher can legitimately sit
// half-posted, so a stored column would be a second source of truth (see migration 022).
// An empty voucher reads UNPOSTED, not POSTED: "every line confirmed" is vacuously true of no
// lines, which would otherwise label a brand-new empty voucher as posted.
function deriveStatus({ line_count, confirmed_lines }) {
  const lines = Number(line_count) || 0;
  const confirmed = Number(confirmed_lines) || 0;
  if (lines === 0 || confirmed === 0) return 'UNPOSTED';
  if (confirmed === lines) return 'POSTED';
  return 'PARTIAL';
}

// Totals for the Total Cash / Cheque / Online footer. Both cheque modes count as cheque:
// CHEQUE_ISSUED (a cheque we wrote) and CHEQUE_ENDORSED (one we received and handed on) are
// different mechanics but both are "paid by cheque" to someone reading the voucher.
function summariseLines(lines) {
  const sumWhere = (predicate) => lines
    .filter(predicate)
    .reduce((acc, l) => acc + Number(l.amount), 0);
  return {
    total_cash: sumWhere((l) => l.payment_mode === 'CASH'),
    total_cheque: sumWhere((l) => l.payment_mode === 'CHEQUE_ISSUED' || l.payment_mode === 'CHEQUE_ENDORSED'),
    total_online: sumWhere((l) => l.payment_mode === 'ONLINE'),
    total_amount: lines.reduce((acc, l) => acc + Number(l.amount), 0),
  };
}

function validateHeader(payload) {
  if (!payload.voucher_date) throw ApiError.badRequest('Voucher date is required');
}

async function getById(voucherId) {
  const voucher = await repository.findById(voucherId);
  if (!voucher) throw ApiError.notFound('Payment voucher not found');
  const lines = await repository.listLines(voucherId);
  return {
    ...voucher,
    lines,
    ...summariseLines(lines),
    status: deriveStatus({
      line_count: lines.length,
      confirmed_lines: lines.filter((l) => l.status === 'CONFIRMED').length,
    }),
  };
}

async function list(filters = {}) {
  const rows = await repository.list(filters);
  return rows.map((row) => ({ ...row, status: deriveStatus(row) }));
}

// Opens empty; lines are added one at a time via the client's "Done" button. voucher_no is
// allocated inside the same transaction as the insert that consumes it.
async function create(payload, userId) {
  validateHeader(payload);
  const voucherId = await withTransaction(async (transaction) => {
    const voucherNo = await repository.nextVoucherNo(transaction);
    return repository.insert(transaction, {
      voucher_no: voucherNo,
      voucher_date: payload.voucher_date || today(),
      remarks: payload.remarks,
      created_by: userId,
    });
  });
  return getById(voucherId);
}

// Header only. The date is pushed onto every line in the same transaction. Blocked once anything is
// posted: a posted line has ledger_entries stamped with its date, so moving the header would leave
// the ledger disagreeing with the document.
async function update(voucherId, payload, userId) {
  const existing = await getById(voucherId);
  if (existing.status !== 'UNPOSTED') {
    throw ApiError.conflict(
      'Unpost this voucher before changing its date or remarks',
      'POSTED_LOCK',
    );
  }
  validateHeader(payload);

  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, voucherId, {
      voucher_date: payload.voucher_date,
      remarks: payload.remarks,
      updated_by: userId,
    });
    await repository.syncLineDates(transaction, voucherId, payload.voucher_date);
    // The unposted half of the voucher's lines lives in dbo.draft_expenses and has to move with
    // the header too — update() is only reachable while the voucher is entirely UNPOSTED, so in
    // practice this is the call that does the work and syncLineDates above is the no-op.
    await draftExpensesRepository.syncVoucherLineDates(transaction, voucherId, payload.voucher_date);
  });

  return getById(voucherId);
}

// PN-01: post the whole voucher.
//
// **Each line keeps its own transaction** (expensesService.post wraps one) rather than the voucher
// sharing one — decided explicitly with the client: one line that cannot post must not roll back
// the lines that already did. So this RESOLVES with a per-line breakdown instead of throwing on the
// first failure. Callers must read `failed`; ok does NOT mean the whole voucher posted.
//
// Sequential, not Promise.all: posting reads and writes live ledger/bank state, and concurrent
// lines against the same bank account would interleave those reads.
async function post(voucherId, session) {
  const voucher = await getById(voucherId);
  if (voucher.lines.length === 0) {
    throw ApiError.badRequest('This voucher has no entries to post', 'EMPTY_VOUCHER');
  }

  const posted = [];
  const failed = [];

  for (const line of voucher.lines) {
    // Already a real (posted) row — meets the caller's intent, same as the old ALREADY_POSTED skip.
    if (line.draft_id == null) continue;
    try {
      const expense = await draftExpensesService.confirm(line.draft_id, session.userId, session);
      posted.push({ expense_id: expense.expense_id, draft_id: line.draft_id, amount: Number(line.amount) });
    } catch (err) {
      if (err.code === 'ALREADY_POSTED') continue;
      if (!err.status) console.error(`expenseVouchers.post: unexpected failure on line ${line.draft_id}:`, err);
      failed.push({
        expense_id: null,
        draft_id: line.draft_id,
        account_name: line.account_name,
        amount: Number(line.amount),
        message: err.status ? err.message : 'Unexpected error while posting this entry.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { voucher: await getById(voucherId), posted, failed, attempted: voucher.lines.length };
}

// Reverses the whole voucher, line by line, with the same per-line isolation and reporting as
// post(). A line that refuses to unpost is reported and leaves the rest reversed — the voucher then
// reads PARTIAL, which is the truth.
// `reverseEndorsement` rides through to each line. A CHEQUE_ENDORSED line refuses to unpost on its
// own — its money movement belongs to a cheque allocation, not to the expense — and this flag is
// the caller confirming the operator agreed to undo that allocation too. Off by default, so the
// refusal stands for anything that hasn't asked.
async function unpost(voucherId, session, { reverseEndorsement = false } = {}) {
  const voucher = await getById(voucherId);

  const unposted = [];
  const failed = [];

  for (const line of voucher.lines) {
    if (line.status !== 'CONFIRMED') continue;
    try {
      await expensesService.unconfirm(line.expense_id, session, { reverseEndorsement }, session?.userId ?? null);
      unposted.push({ expense_id: line.expense_id, amount: Number(line.amount) });
    } catch (err) {
      if (!err.status) console.error(`expenseVouchers.unpost: unexpected failure on line ${line.expense_id}:`, err);
      failed.push({
        expense_id: line.expense_id,
        account_name: line.account_name,
        amount: Number(line.amount),
        message: err.status ? err.message : 'Unexpected error while unposting this entry.',
        code: err.code || 'INTERNAL',
      });
    }
  }

  return { voucher: await getById(voucherId), unposted, failed };
}

// Only an entirely unposted voucher can be deleted, and its lines go with it. The FK on
// expenses.voucher_id is deliberately NOT ON DELETE CASCADE — a cascade would silently delete
// posted lines and strand their ledger entries.
async function remove(voucherId) {
  const voucher = await getById(voucherId);
  if (voucher.status !== 'UNPOSTED') {
    throw ApiError.conflict('Unpost this voucher before deleting it', 'POSTED_LOCK');
  }

  await withTransaction(async (transaction) => {
    for (const line of voucher.lines) {
      // An UNPOSTED voucher's lines are all drafts by the invariant; the real-row branch is kept
      // so this stays correct for any row that predates the draft/real split.
      if (line.draft_id != null) {
        await draftExpensesRepository.deleteDraft(transaction, line.draft_id);
      } else {
        await expensesRepository.remove(transaction, line.expense_id);
      }
    }
    await repository.remove(transaction, voucherId);
  });
}

module.exports = {
  list, getById, create, update, post, unpost, remove, deriveStatus,
};
