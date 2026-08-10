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

  // Duplicate = same name (case-insensitive) AND same phone — two vendors CAN share just a name
  // (e.g. two different "Ali Traders" with different numbers), so name alone can't be the key.
  // An ACTIVE match blocks creation outright; an INACTIVE match (soft-deleted earlier) offers the
  // frontend a choice instead of silently failing or creating a confusing second row — the id/name
  // of the colliding row rides on `details` so the popup can call vendors:reactivate directly.
  const phone = payload.phone ?? null;
  const existing = await repository.findByNameAndPhone(name, phone);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('A vendor with this name and phone already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive vendor with this name and phone already exists',
      'INACTIVE_DUPLICATE',
      { vendor_id: existing.vendor_id, name: existing.name, phone: existing.phone },
    );
  }

  // Opening balance belongs to the auto-created business account (same as bankAccounts.service.js).
  // Validated before the transaction opens so a mismatched pair fails as a clean 400.
  const opening = businessAccountsService.validateOpeningPair(payload);

  const id = await withTransaction(async (transaction) => {
    const baId = await businessAccountsService.createUnderChartCode(transaction, CODES.VENDORS_ACCOUNTS, name, {
      region_id: payload.region_id,
      city_id: payload.city_id,
      ...opening,
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

  const phone = payload.phone ?? null;
  const duplicate = await repository.findByNameAndPhone(name, phone);
  if (duplicate && duplicate.vendor_id !== vendorId) {
    throw ApiError.conflict('A vendor with this name and phone already exists', 'DUPLICATE_NAME');
  }

  await repository.update(vendorId, { ...payload, name });
  if (existing.ba_id && name !== existing.name) {
    await businessAccountsService.renameLinked(existing.ba_id, name);
  }
  // The opening balance lives on the linked business account, not on this row.
  if (existing.ba_id) await businessAccountsService.setOpening(existing.ba_id, payload);

  return repository.findById(vendorId);
}

// Soft delete — is_active = 0, never a hard DELETE (purchases.vendor_id references this row
// historically). The linked business_accounts row stays ACTIVE for ledger/history integrity.
async function remove(vendorId) {
  await getById(vendorId);
  await repository.setActive(vendorId, false);
  return { ok: true };
}

// Frontend calls this instead of create() when the user confirms "reactivate the existing one"
// off an INACTIVE_DUPLICATE conflict. findById (not getById) skips the active check on purpose —
// we're reactivating something that's currently inactive.
async function reactivate(vendorId) {
  const vendor = await repository.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  await repository.setActive(vendorId, true);
  return repository.findById(vendorId);
}

module.exports = { list, getById, create, update, remove, reactivate };
