// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/businessAccounts.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');

// Cross-feature reads go through here rather than another feature reaching into
// businessAccounts.repository.js directly (e.g. transfers.service.js validating from_ba_id/to_ba_id).
async function getById(baId) {
  const account = await repository.findById(baId);
  if (!account) throw ApiError.notFound('Business account not found');
  return account;
}

function list(filters) {
  return repository.list(filters);
}

// Auto-creates a business_accounts row under a reserved chart account (UC-08/UC-09 pattern: a
// vendor/customer/bank never exposes a separate account-setup step — one row appears here,
// linked via the party's own ba_id, the moment the party is created). §3.2 composition: code =
// parent chart code + 4-digit zero-padded serial, serial = MAX(existing under that parent) + 1.
// Takes the CALLER's transaction (e.g. vendors.service.js:create()) and returns just the new
// ba_id, not a fetched row — the account and the party that owns it must commit or roll back
// together, so this never reads back through a separate connection mid-transaction.
async function createUnderChartCode(transaction, chartCode, name, extra = {}) {
  const chartAccount = await chartAccountsRepository.findByCode(chartCode);
  if (!chartAccount) {
    throw new Error(`Reserved chart account (code ${chartCode}) not found — run npm run seed`);
  }
  const serial = await repository.nextSerial(transaction, chartCode);
  const code = chartCode + String(serial).padStart(4, '0');
  return repository.insert(transaction, { code, name, ac_id: chartAccount.ac_id, ...extra });
}

// UC-08 step 6 / UC-09 equivalent: renaming the party keeps the linked account's name in sync.
function renameLinked(baId, name) {
  return repository.updateName(baId, name);
}

module.exports = { createUnderChartCode, renameLinked, getById, list };
