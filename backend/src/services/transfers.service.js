// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/transfers.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

async function validate(payload) {
  if (!payload.transfer_date) throw ApiError.badRequest('transfer_date is required');
  if (!payload.from_ba_id) throw ApiError.badRequest('from_ba_id is required');
  if (!payload.to_ba_id) throw ApiError.badRequest('to_ba_id is required');
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  // CK_transfers_distinct already blocks this at the DB level — validated here too for a clean
  // 400 instead of a raw constraint-violation error surfacing from the insert.
  if (payload.from_ba_id === payload.to_ba_id) {
    throw ApiError.badRequest('from_ba_id and to_ba_id must be different accounts');
  }
  // 404s if either account doesn't exist — cash_and_bank.md §7 covers cash<->bank and bank<->bank,
  // both are just business_accounts rows, no party-specific check beyond existing.
  await businessAccountsService.getById(payload.from_ba_id);
  await businessAccountsService.getById(payload.to_ba_id);
}

function list(filters) {
  return repository.list(filters);
}

async function getById(transferId) {
  const transfer = await repository.findById(transferId);
  if (!transfer) throw ApiError.notFound('Transfer not found');
  return transfer;
}

function buildFields(payload) {
  return {
    transfer_date: payload.transfer_date,
    from_ba_id: payload.from_ba_id,
    to_ba_id: payload.to_ba_id,
    amount: payload.amount,
    remarks: payload.remarks,
  };
}

// Always created DRAFT — post() is the only thing that moves money (cash_and_bank.md §7: a
// transfer must never appear in income/expense totals, so an unposted transfer must have no
// ledger footprint at all, same as receipts/expenses/purchases).
async function create(payload, userId) {
  await validate(payload);
  const id = await withTransaction(async (transaction) => {
    return repository.insert(transaction, { ...buildFields(payload), created_by: userId });
  });
  return getById(id);
}

// Financial edits only while DRAFT — same rule as purchases.service.js:update() (no
// edit-a-posted-document flow; unpost first).
async function update(transferId, payload) {
  const existing = await getById(transferId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the transfer before editing', 'POSTED_LOCK');
  }
  await validate(payload);
  await repository.update(transferId, buildFields(payload));
  return getById(transferId);
}

// DRAFT-only — a CONFIRMED transfer must be unposted first, same as any other posted document
// (transfers is a transaction table, never soft-deleted — schema.sql §"Soft delete on lookup/setup
// tables only. Transactions ... live in DRAFT or get edited.").
async function remove(transferId) {
  const existing = await getById(transferId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the transfer before deleting', 'POSTED_LOCK');
  }
  await repository.remove(transferId);
  return { ok: true };
}

// Post: Dr to_ba_id / Cr from_ba_id, source_type = 'TRANSFER' (cash_and_bank.md §7).
async function post(transferId, userId) {
  const transfer = await getById(transferId);
  if (transfer.status === 'CONFIRMED') {
    throw ApiError.conflict('Transfer is already posted', 'ALREADY_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, {
      transferId,
      transferDate: transfer.transfer_date,
      fromBaId: transfer.from_ba_id,
      toBaId: transfer.to_ba_id,
      amount: transfer.amount,
    });
    await repository.setStatus(transaction, transferId, 'CONFIRMED', userId);
  });

  return getById(transferId);
}

async function unpost(transferId, userId) {
  const transfer = await getById(transferId);
  if (transfer.status !== 'CONFIRMED') {
    throw ApiError.conflict('Transfer is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, transferId);
    await repository.setStatus(transaction, transferId, 'DRAFT', userId);
  });

  return getById(transferId);
}

module.exports = { list, getById, create, update, remove, post, unpost };
