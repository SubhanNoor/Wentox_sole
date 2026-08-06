// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/deposits.repository');
const businessAccountsService = require('./businessAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

async function validate(payload) {
  if (!payload.deposit_date) throw ApiError.badRequest('deposit_date is required');
  if (!payload.to_ba_id) throw ApiError.badRequest('to_ba_id is required');
  if (payload.direction !== 'CREDIT' && payload.direction !== 'DEBIT') {
    throw ApiError.badRequest("direction must be 'CREDIT' or 'DEBIT'");
  }
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  if (!payload.source || !payload.source.trim()) throw ApiError.badRequest('source is required');

  // 404s if the account doesn't exist.
  await businessAccountsService.getById(payload.to_ba_id);
}

function list(filters) {
  return repository.list(filters);
}

async function getById(depositId) {
  const deposit = await repository.findById(depositId);
  if (!deposit) throw ApiError.notFound('Deposit not found');
  return deposit;
}

function buildFields(payload) {
  return {
    deposit_date: payload.deposit_date,
    to_ba_id: payload.to_ba_id,
    direction: payload.direction,
    amount: payload.amount,
    source: payload.source.trim(),
    remarks: payload.remarks,
  };
}

// Always created DRAFT — post() is the only thing that moves money (same reasoning as
// transfers.service.js: an unposted deposit must have no ledger footprint at all).
async function create(payload, userId) {
  await validate(payload);
  const id = await withTransaction(async (transaction) => {
    return repository.insert(transaction, { ...buildFields(payload), created_by: userId });
  });
  return getById(id);
}

// Financial edits only while DRAFT — same rule as transfers.service.js:update().
async function update(depositId, payload) {
  const existing = await getById(depositId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the deposit before editing', 'POSTED_LOCK');
  }
  await validate(payload);
  await repository.update(depositId, buildFields(payload));
  return getById(depositId);
}

// DRAFT-only — a CONFIRMED deposit must be unposted first, same as transfers (transaction table,
// never soft-deleted).
async function remove(depositId) {
  const existing = await getById(depositId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the deposit before deleting', 'POSTED_LOCK');
  }
  await repository.remove(depositId);
  return { ok: true };
}

// Post: CREDIT -> Dr to_ba_id / Cr MISC_ADJUSTMENTS; DEBIT -> Dr MISC_ADJUSTMENTS / Cr to_ba_id.
// source_type = 'DEPOSIT'.
async function post(depositId, userId) {
  const deposit = await getById(depositId);
  if (deposit.status === 'CONFIRMED') {
    throw ApiError.conflict('Deposit is already posted', 'ALREADY_POSTED');
  }

  const adjustmentsAccount = await chartAccountsRepository.findByCode(CODES.MISC_ADJUSTMENTS);
  if (!adjustmentsAccount) {
    throw new Error(`Reserved chart account MISC_ADJUSTMENTS (code ${CODES.MISC_ADJUSTMENTS}) not found — run npm run seed`);
  }

  await withTransaction(async (transaction) => {
    const narration = `Deposit #${depositId}: ${deposit.source}`;
    const rows = deposit.direction === 'CREDIT'
      ? [
        { entry_date: deposit.deposit_date, ba_id: deposit.to_ba_id, debit: deposit.amount, credit: 0, source_type: 'DEPOSIT', source_id: depositId, narration },
        { entry_date: deposit.deposit_date, ac_id: adjustmentsAccount.ac_id, debit: 0, credit: deposit.amount, source_type: 'DEPOSIT', source_id: depositId, narration },
      ]
      : [
        { entry_date: deposit.deposit_date, ac_id: adjustmentsAccount.ac_id, debit: deposit.amount, credit: 0, source_type: 'DEPOSIT', source_id: depositId, narration },
        { entry_date: deposit.deposit_date, ba_id: deposit.to_ba_id, debit: 0, credit: deposit.amount, source_type: 'DEPOSIT', source_id: depositId, narration },
      ];

    await repository.insertLedgerEntries(transaction, rows);
    await repository.setStatus(transaction, depositId, 'CONFIRMED', userId);
  });

  return getById(depositId);
}

async function unpost(depositId, userId) {
  const deposit = await getById(depositId);
  if (deposit.status !== 'CONFIRMED') {
    throw ApiError.conflict('Deposit is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, depositId);
    await repository.setStatus(transaction, depositId, 'DRAFT', userId);
  });

  return getById(depositId);
}

module.exports = { list, getById, create, update, remove, post, unpost };
