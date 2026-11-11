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
const deletedNumbersRepository = require('../repositories/deletedDocumentNumbers.repository');
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
    // Already a real, posted row — meets the caller's intent, same as the old ALREADY_POSTED skip.
    if (line.status === 'CONFIRMED') continue;
    // A DRAFT-status line with no draft_id to confirm() should never happen — every unposted line
    // is supposed to live in dbo.draft_expenses — but it did (found 2026-09-16: old data inserted
    // straight into dbo.expenses with status='DRAFT' by an unused legacy path, expenses.service.js
    // #create(), never migrated). The old check here (`if (line.draft_id == null) continue`)
    // treated that exact case as "already posted" and silently skipped it — Post/Post All reported
    // success while the line sat stuck unposted forever, with no error and no trace. Report it as
    // a real failure instead, so it is at least visible.
    if (line.draft_id == null) {
      failed.push({
        expense_id: line.expense_id,
        draft_id: null,
        account_name: line.account_name,
        amount: Number(line.amount),
        message: 'This entry has no draft row to post from — its data needs to be repaired before it can post.',
        code: 'ORPHANED_LINE',
      });
      continue;
    }
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
// Records the deleted voucher_no — retired for good, since voucher_no comes from
// dbo.seq_expense_voucher_no (migration 042) and is never reused (2026-10-06). Only whole-voucher
// deletion touches voucher_no — deleting one line never reaches here.
async function remove(voucherId, userId) {
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
    await deletedNumbersRepository.record(transaction, 'EXPENSE_VOUCHER', voucher.voucher_no, userId);
  });
}

// Saves a whole voucher — header and every line — in ONE transaction (per the user, 2026-11-11:
// the Payments screen now works like the Journal Voucher one; Enter only adds a line on screen and
// Save/Done writes them all together, so a voucher is never left half-saved).
//
// payload: { voucher_id?, voucher_date, remarks, lines: [...] } — each line is a draft expense's
// fields (draft_id when it already exists). `unchanged: true` on an existing line means "keep it
// as it is". An existing line left out of `lines` is deleted.
//
// Only while the voucher is entirely UNPOSTED, the same rule as update()/remove(). A line stuck
// from an earlier failed post (pending_expense_id) may be kept, but not changed or deleted — the
// same guard draftExpenses.update()/remove() apply to it.
async function saveWithLines(payload, userId, session) {
  validateHeader(payload);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length === 0) throw ApiError.badRequest('Add at least one entry before saving', 'EMPTY_VOUCHER');

  let existing = null;
  if (payload.voucher_id) {
    existing = await getById(payload.voucher_id);
    if (existing.status !== 'UNPOSTED') {
      throw ApiError.conflict('Unpost this voucher before changing it', 'POSTED_LOCK');
    }
  }
  const existingDrafts = new Set((existing?.lines ?? []).filter((l) => l.draft_id != null).map((l) => l.draft_id));

  const assertNotStuck = async (draftId) => {
    const draft = await draftExpensesRepository.findById(draftId);
    if (draft && draft.pending_expense_id) {
      throw ApiError.conflict(
        `this entry has a stuck expense (#${draft.pending_expense_id}) from an earlier post attempt — resolve it before changing or removing the entry`,
        'PENDING_EXPENSE_UNRESOLVED',
      );
    }
  };

  // Validate every line before writing anything, with the same rules a single line always had.
  const date = payload.voucher_date;
  const kept = new Set();
  const prepared = [];
  for (const [index, line] of lines.entries()) {
    try {
      const id = line.draft_id ?? null;
      if (id != null && !existingDrafts.has(id)) throw ApiError.badRequest('this entry is not on this voucher');
      if (id != null) kept.add(id);
      if (id != null && line.unchanged) continue;
      if (id != null) await assertNotStuck(id);
      const body = { ...line, expense_date: date };
      draftExpensesService.validateHeader(body);
      const baId = await draftExpensesService.resolveTarget(body, session);
      prepared.push({ id, fields: draftExpensesService.buildFields(body, baId) });
    } catch (err) {
      if (err instanceof ApiError) err.message = `Entry ${index + 1}: ${err.message}`;
      throw err;
    }
  }
  for (const draftId of existingDrafts) {
    if (!kept.has(draftId)) await assertNotStuck(draftId);
  }

  const voucherId = await withTransaction(async (transaction) => {
    let id = existing?.voucher_id;
    if (id == null) {
      const voucherNo = await repository.nextVoucherNo(transaction);
      id = await repository.insert(transaction, {
        voucher_no: voucherNo, voucher_date: date, remarks: payload.remarks, created_by: userId,
      });
    } else {
      await repository.updateHeader(transaction, id, { voucher_date: date, remarks: payload.remarks, updated_by: userId });
      await draftExpensesRepository.syncVoucherLineDates(transaction, id, date);
    }
    // Lines taken off the voucher on screen.
    for (const draftId of existingDrafts) {
      if (!kept.has(draftId)) await draftExpensesRepository.deleteDraft(transaction, draftId);
    }
    // Changed and new lines, in screen order — a new line's place in the voucher is its insert order.
    for (const line of prepared) {
      if (line.id != null) await draftExpensesRepository.updateHeader(transaction, line.id, line.fields);
      else await draftExpensesRepository.insert(transaction, { ...line.fields, voucher_id: id, created_by: userId });
    }
    return id;
  });

  return getById(voucherId);
}

function listDeletedNumbers() {
  return deletedNumbersRepository.listByType('EXPENSE_VOUCHER');
}

module.exports = {
  list, getById, create, update, saveWithLines, post, unpost, remove, deriveStatus, listDeletedNumbers,
};
