// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/vendors.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(vendorId) {
  const vendor = await repository.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  return vendor;
}

// UC-08: on create, auto-creates the vendor's ledger account under the reserved VENDORS ACCOUNTS
// chart account and links it via vendors.ba_id — the user never sees a separate account-setup
// step. Both writes share one transaction, so a failure partway through never leaves an orphaned
// business_accounts row with no vendor pointing at it.
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const existing = await repository.findByName(name);
  if (existing) throw ApiError.conflict('A vendor with this name already exists', 'DUPLICATE_NAME');

  const id = await withTransaction(async (transaction) => {
    const baId = await businessAccountsService.createUnderChartCode(transaction, CODES.VENDORS_ACCOUNTS, name, {
      region_id: payload.region_id,
      city_id: payload.city_id,
    });
    return repository.insert(transaction, { ...payload, name, ba_id: baId });
  });

  return repository.findById(id);
}

// UC-08 step 6: renaming a vendor keeps the linked account's name in sync.
async function update(vendorId, payload) {
  const existing = await getById(vendorId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.vendor_id !== vendorId) {
    throw ApiError.conflict('A vendor with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(vendorId, { ...payload, name });
  if (existing.ba_id && name !== existing.name) {
    await businessAccountsService.renameLinked(existing.ba_id, name);
  }

  return repository.findById(vendorId);
}

// Soft delete — is_active = 0, never a hard DELETE (purchases.vendor_id references this row
// historically). The linked business_accounts row stays ACTIVE for ledger/history integrity.
async function remove(vendorId) {
  await getById(vendorId);
  await repository.setActive(vendorId, false);
  return { ok: true };
}

module.exports = { list, getById, create, update, remove };
