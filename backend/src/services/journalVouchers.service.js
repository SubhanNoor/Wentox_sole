// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
//
// Journal Voucher — a real multi-line double-entry journal (legacy Journal Entry screen): N
// lines, each against its own business account, each a debit OR a credit, that must net to zero.
// There is no fixed counter-account anymore — every line names a real account, so each one's own
// ledger shows exactly what a JV moved through it and why.
const repository = require('../repositories/journalVouchers.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const { buildLines, validateBalance } = require('./journalVouchers.math');

function validateHeader(payload) {
  if (!payload.jv_date) throw ApiError.badRequest('jv_date is required');
  // Required, not optional: an unexplained write-off against a party's balance is precisely the
  // entry someone will question later, so it must carry its reason from the start.
  if (!payload.reason || !payload.reason.trim()) throw ApiError.badRequest('reason is required');
}

async function resolveLines(payload, session) {
  validateHeader(payload);
  const lines = buildLines(payload.lines);
  validateBalance(lines);

  for (const line of lines) {
    await businessAccountsService.getById(line.ba_id); // 404s if it doesn't exist
    // UC-03 point 4 — same account-level guard every other money-writing document applies.
    await businessAccountsService.assertAccessible(line.ba_id, session);
  }

  return lines;
}

function buildHeaderFields(payload) {
  return {
    jv_date: payload.jv_date,
    // Optional, unvalidated — a manual voucher number for the office's own cross-referencing,
    // matching the legacy Journal Entry screen's "Number" field. Nothing downstream depends on
    // it being present or unique (jv_id is the real identity, same as bilty_no/gp_no elsewhere).
    voucher_no: payload.voucher_no ? payload.voucher_no.trim() : null,
    reason: payload.reason.trim(),
    remarks: payload.remarks,
  };
}

function list(filters = {}) {
  return repository.list(filters);
}

async function getById(jvId) {
  const jv = await repository.findById(jvId);
  if (!jv) throw ApiError.notFound('Journal Voucher not found');
  return jv;
}

// Always created DRAFT — post() is the only thing that writes ledger_entries.
async function create(payload, userId, session) {
  const lines = await resolveLines(payload, session);
  const id = await withTransaction(async (transaction) => {
    const jvId = await repository.insert(transaction, { ...buildHeaderFields(payload), created_by: userId });
    await repository.insertLines(transaction, jvId, lines);
    return jvId;
  });
  return getById(id);
}

// Financial edits only while DRAFT — unpost first, same rule as every other posted document.
async function update(jvId, payload, session) {
  const existing = await getById(jvId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the Journal Voucher before editing', 'POSTED_LOCK');
  }
  const lines = await resolveLines(payload, session);
  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, jvId, buildHeaderFields(payload));
    await repository.deleteLines(transaction, jvId);
    await repository.insertLines(transaction, jvId, lines);
  });
  return getById(jvId);
}

// DRAFT-only hard delete — journal_vouchers is a transaction table, never soft-deleted.
async function remove(jvId) {
  const existing = await getById(jvId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the Journal Voucher before deleting', 'POSTED_LOCK');
  }
  await repository.remove(jvId);
  return { ok: true };
}

// The account guard runs again here, not only on create/update: posting is the moment the money
// actually moves, and the document being posted may have been created by somebody else. Without it
// an ADMIN could leave a draft against a restricted account for a USER to post.
async function post(jvId, userId, session) {
  const jv = await getById(jvId);
  if (jv.status === 'CONFIRMED') {
    throw ApiError.conflict('Journal Voucher is already posted', 'ALREADY_POSTED');
  }
  for (const line of jv.lines) {
    await businessAccountsService.assertAccessible(line.ba_id, session);
  }
  // Defensive re-check: the lines were valid when saved, but re-validate before the money moves.
  validateBalance(jv.lines);

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, {
      jvId, jvDate: jv.jv_date, lines: jv.lines, reason: jv.reason,
    });
    await repository.setStatus(transaction, jvId, 'CONFIRMED', userId);
  });

  return getById(jvId);
}

async function unpost(jvId, userId, session) {
  const jv = await getById(jvId);
  for (const line of jv.lines) {
    await businessAccountsService.assertAccessible(line.ba_id, session);
  }
  if (jv.status !== 'CONFIRMED') {
    throw ApiError.conflict('Journal Voucher is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, jvId);
    await repository.setStatus(transaction, jvId, 'DRAFT', userId);
  });

  return getById(jvId);
}

module.exports = { list, getById, create, update, remove, post, unpost };
