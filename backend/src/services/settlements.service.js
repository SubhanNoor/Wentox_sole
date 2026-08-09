// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
//
// Direct Settlement — a debtor of ours pays one of OUR creditors directly, instead of paying us and
// us then paying them. Both obligations shrink; nothing passes through cash, bank or the cheque
// drawer at any point. Distinct from cheque endorsement (cheques.service.js / dbo.cheque_allocations,
// UC-27), which needs a physical cheque already sitting in CHEQUES IN HAND — a settlement needs no
// instrument at all.
const repository = require('../repositories/settlements.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

async function validate(payload, session) {
  if (!payload.settlement_date) throw ApiError.badRequest('settlement_date is required');
  if (!payload.from_ba_id) throw ApiError.badRequest('from_ba_id is required');
  if (!payload.to_ba_id) throw ApiError.badRequest('to_ba_id is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  // CK_settlements_distinct blocks this at the DB level too — checked here for a clean 400 rather
  // than a raw constraint violation surfacing from the insert.
  if (payload.from_ba_id === payload.to_ba_id) {
    throw ApiError.badRequest('from_ba_id and to_ba_id must be different accounts');
  }
  // 404s if either side doesn't exist. Deliberately NO check that from_ba_id currently owes us the
  // amount: settling more than the present balance is legitimate (an advance, or a debt that has
  // not been billed yet), and blocking it would reject valid business.
  await businessAccountsService.getById(payload.from_ba_id);
  await businessAccountsService.getById(payload.to_ba_id);
  // UC-03 point 4 — BOTH sides. Endorsing to a Directors-Drawings account is exactly the hole a
  // channel-level role check would have left open.
  await businessAccountsService.assertAccessible(payload.from_ba_id, session);
  await businessAccountsService.assertAccessible(payload.to_ba_id, session);

  // payment_mode is INFORMATION about how the other two parties transacted — it selects no posting
  // target here (unlike receipts.payment_mode), so it is optional. When it IS given it must be a
  // real mode, and a cheque number only makes sense on a CHEQUE.
  if (payload.payment_mode && !['CASH', 'CHEQUE', 'ONLINE'].includes(payload.payment_mode)) {
    throw ApiError.badRequest("payment_mode must be 'CASH', 'ONLINE', or 'CHEQUE'");
  }
  if (payload.payment_mode !== 'CHEQUE' && (payload.cheque_no || payload.cheque_date)) {
    throw ApiError.badRequest('cheque_no/cheque_date are only valid when payment_mode is CHEQUE');
  }
}

function list(filters = {}) {
  return repository.list(filters);
}

async function getById(settlementId) {
  const settlement = await repository.findById(settlementId);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  return settlement;
}

function buildFields(payload) {
  return {
    settlement_date: payload.settlement_date,
    from_ba_id: payload.from_ba_id,
    to_ba_id: payload.to_ba_id,
    amount: payload.amount,
    payment_mode: payload.payment_mode || null,
    cheque_no: payload.payment_mode === 'CHEQUE' ? (payload.cheque_no || null) : null,
    cheque_date: payload.payment_mode === 'CHEQUE' ? (payload.cheque_date || null) : null,
    remarks: payload.remarks,
  };
}

// Always created DRAFT — post() is the only thing that writes ledger_entries, same shape as
// transfers/receipts/expenses/purchases.
async function create(payload, userId, session) {
  await validate(payload, session);
  const id = await withTransaction((transaction) => (
    repository.insert(transaction, { ...buildFields(payload), created_by: userId })
  ));
  return getById(id);
}

// Financial edits only while DRAFT — unpost first, same rule as every other posted document.
async function update(settlementId, payload, session) {
  const existing = await getById(settlementId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the settlement before editing', 'POSTED_LOCK');
  }
  await validate(payload, session);
  await repository.update(settlementId, buildFields(payload));
  return getById(settlementId);
}

// DRAFT-only hard delete — settlements is a transaction table, never soft-deleted.
async function remove(settlementId) {
  const existing = await getById(settlementId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the settlement before deleting', 'POSTED_LOCK');
  }
  await repository.remove(settlementId);
  return { ok: true };
}

// Post: Dr to_ba_id (our creditor) / Cr from_ba_id (our debtor), source_type 'SETTLEMENT'.
// Both legs are ba_id — no chart account is written, which is what structurally keeps this out of
// every cash/bank/cheque balance rather than relying on each report to remember to exclude it.
async function post(settlementId, userId) {
  const settlement = await getById(settlementId);
  if (settlement.status === 'CONFIRMED') {
    throw ApiError.conflict('Settlement is already posted', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, {
      settlementId,
      settlementDate: settlement.settlement_date,
      fromBaId: settlement.from_ba_id,
      toBaId: settlement.to_ba_id,
      fromName: settlement.from_name,
      toName: settlement.to_name,
      amount: settlement.amount,
    });
    await repository.setStatus(transaction, settlementId, 'CONFIRMED', userId);
  });

  return getById(settlementId);
}

async function unpost(settlementId, userId) {
  const settlement = await getById(settlementId);
  if (settlement.status !== 'CONFIRMED') {
    throw ApiError.conflict('Settlement is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, settlementId);
    await repository.setStatus(transaction, settlementId, 'DRAFT', userId);
  });

  return getById(settlementId);
}

module.exports = { list, getById, create, update, remove, post, unpost };
