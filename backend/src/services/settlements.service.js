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
const receiptVouchersRepository = require('../repositories/receiptVouchers.repository');
// Same weekly/monthly window as receipts.list() — the Receipts records tabs fetch both and put a
// voucher's endorsed lines on its card, so the two must cover exactly the same dates.
const { resolveDateRange } = require('./receipts.service');
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
  return repository.list({ ...filters, ...resolveDateRange(filters) });
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
//
// `voucher_id` (optional): the receipt voucher this endorsement is a line of (migration 041). It
// then takes the voucher's date — the header owns the date on that screen, same as a receipt line —
// and posts/unposts/deletes with the voucher (receiptVouchers.service.js).
async function create(payload, userId, session) {
  await validate(payload, session);
  const fields = buildFields(payload);
  let voucherId = null;
  if (payload.voucher_id) {
    const voucher = await receiptVouchersRepository.findById(payload.voucher_id);
    if (!voucher) throw ApiError.notFound('Receipt voucher not found');
    voucherId = voucher.voucher_id;
    fields.settlement_date = voucher.voucher_date;
  }
  const id = await withTransaction((transaction) => (
    repository.insert(transaction, { ...fields, created_by: userId, voucher_id: voucherId })
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
  const fields = buildFields(payload);
  // A voucher line keeps the voucher's date whatever the entry row sent.
  if (existing.voucher_id != null) fields.settlement_date = existing.settlement_date;
  await repository.update(settlementId, fields);
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
// The account guard runs again here, not only on create/update: posting is the moment the money
// actually moves, and the document being posted may have been created by somebody else. Without it
// an ADMIN could leave a draft against a restricted account for a USER to post.
async function post(settlementId, userId, session) {
  const settlement = await getById(settlementId);
  await businessAccountsService.assertAccessible(settlement.from_ba_id, session);
  await businessAccountsService.assertAccessible(settlement.to_ba_id, session);
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
    // Conditional flip — if a concurrent post already flipped it, this throws and the ledger rows
    // inserted above roll back with the transaction.
    const changed = await repository.setStatus(transaction, settlementId, 'CONFIRMED', userId);
    if (!changed) throw ApiError.conflict('Settlement is already posted', 'ALREADY_POSTED');
  });

  return getById(settlementId);
}

async function unpost(settlementId, userId, session) {
  const settlement = await getById(settlementId);
  await businessAccountsService.assertAccessible(settlement.from_ba_id, session);
  await businessAccountsService.assertAccessible(settlement.to_ba_id, session);
  if (settlement.status !== 'CONFIRMED') {
    throw ApiError.conflict('Settlement is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    const changed = await repository.setStatus(transaction, settlementId, 'DRAFT', userId);
    if (!changed) throw ApiError.conflict('Settlement is not posted', 'NOT_POSTED');
    await repository.deleteLedgerEntries(transaction, settlementId);
  });

  return getById(settlementId);
}

module.exports = { list, getById, create, update, remove, post, unpost };
