// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
//
// Journal Voucher — goodwill written off a party's balance ("eidi" on what a customer owes, a
// concession a vendor grants us). The party's balance moves and the JOURNAL VOUCHER business
// account carries the other side, so "what have we given away in JVs" is an openable ledger.
//
// NOT commission: receipts.commission (§7) only exists attached to a receipt and only for a
// customer. NOT a Deposit either: dbo.deposits counters against the MISCELLANEOUS ADJUSTMENTS
// chart account for owner capital and bank fees — a mixed head with no ledger of its own.
const repository = require('../repositories/journalVouchers.repository');
const businessAccountsService = require('./businessAccounts.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

// The single business account seeded under the JOURNAL VOUCHER chart head (db/seeds/run.js).
// Resolved by reserved code rather than a hardcoded id, same as every other reserved lookup.
async function getJvAccount() {
  const chartAccount = await chartAccountsRepository.findByCode(CODES.JOURNAL_VOUCHER);
  if (!chartAccount) throw new Error(`Reserved chart account JOURNAL VOUCHER (code ${CODES.JOURNAL_VOUCHER}) not found — run npm run seed`);
  const account = await businessAccountsService.getByAcId(chartAccount.ac_id);
  if (!account) throw new Error('JOURNAL VOUCHER business account not found — run npm run seed');
  return account;
}

async function validate(payload, session) {
  if (!payload.jv_date) throw ApiError.badRequest('jv_date is required');
  if (!payload.ba_id) throw ApiError.badRequest('ba_id is required');
  if (payload.direction !== 'CREDIT' && payload.direction !== 'DEBIT') {
    throw ApiError.badRequest("direction must be 'CREDIT' or 'DEBIT'");
  }
  if (!payload.amount || payload.amount <= 0) throw ApiError.badRequest('amount must be > 0');
  // Required, not optional: an unexplained write-off against a party's balance is precisely the
  // entry someone will question later, so it must carry its reason from the start.
  if (!payload.reason || !payload.reason.trim()) throw ApiError.badRequest('reason is required');

  await businessAccountsService.getById(payload.ba_id); // 404s if it doesn't exist

  // A JV against the JOURNAL VOUCHER account itself would post both legs to the same account —
  // a no-op that still writes two rows and muddies its ledger.
  const jvAccount = await getJvAccount();
  if (payload.ba_id === jvAccount.ba_id) {
    throw ApiError.badRequest('Cannot raise a Journal Voucher against the Journal Voucher account itself');
  }

  // UC-03 point 4 — same account-level guard every other money-writing document applies.
  await businessAccountsService.assertAccessible(payload.ba_id, session);
}

function list(filters = {}) {
  return repository.list(filters);
}

async function getById(jvId) {
  const jv = await repository.findById(jvId);
  if (!jv) throw ApiError.notFound('Journal Voucher not found');
  return jv;
}

function buildFields(payload) {
  return {
    jv_date: payload.jv_date,
    ba_id: payload.ba_id,
    direction: payload.direction,
    amount: payload.amount,
    reason: payload.reason.trim(),
    remarks: payload.remarks,
  };
}

// Always created DRAFT — post() is the only thing that writes ledger_entries.
async function create(payload, userId, session) {
  await validate(payload, session);
  const id = await withTransaction((transaction) => (
    repository.insert(transaction, { ...buildFields(payload), created_by: userId })
  ));
  return getById(id);
}

// Financial edits only while DRAFT — unpost first, same rule as every other posted document.
async function update(jvId, payload, session) {
  const existing = await getById(jvId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the Journal Voucher before editing', 'POSTED_LOCK');
  }
  await validate(payload, session);
  await repository.update(jvId, buildFields(payload));
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
  await businessAccountsService.assertAccessible(jv.ba_id, session);
  if (jv.status === 'CONFIRMED') {
    throw ApiError.conflict('Journal Voucher is already posted', 'ALREADY_POSTED');
  }
  const jvAccount = await getJvAccount();

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, {
      jvId,
      jvDate: jv.jv_date,
      baId: jv.ba_id,
      jvBaId: jvAccount.ba_id,
      direction: jv.direction,
      amount: jv.amount,
      reason: jv.reason,
      partyName: jv.ba_name,
    });
    await repository.setStatus(transaction, jvId, 'CONFIRMED', userId);
  });

  return getById(jvId);
}

async function unpost(jvId, userId, session) {
  const jv = await getById(jvId);
  await businessAccountsService.assertAccessible(jv.ba_id, session);
  if (jv.status !== 'CONFIRMED') {
    throw ApiError.conflict('Journal Voucher is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, jvId);
    await repository.setStatus(transaction, jvId, 'DRAFT', userId);
  });

  return getById(jvId);
}

module.exports = { list, getById, create, update, remove, post, unpost, getJvAccount };
