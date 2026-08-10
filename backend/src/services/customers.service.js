// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/customers.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.region_id) throw ApiError.badRequest('region_id is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(customerId) {
  const customer = await repository.findById(customerId);
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}

// UC-09: on create, auto-creates the customer's ledger account under the reserved CUSTOMERS
// ACCOUNTS chart account and links it via customers.ba_id — same pattern as UC-08 for vendors.
// Both writes share one transaction (see vendors.service.js:create() for the reasoning — a
// debugger review on the Vendors module caught this exact gap).
// Unlike vendors, a same-name ACTIVE customer never blocks create() — real people share names.
// The frontend is expected to call checkName() first and show its own "already exists, continue?"
// / "reactivate the inactive one instead?" prompt; create() itself just creates.
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  // Opening balance belongs to the auto-created business account (same as bankAccounts.service.js).
  // Validated before the transaction opens so a mismatched pair fails as a clean 400.
  const opening = businessAccountsService.validateOpeningPair(payload);

  const id = await withTransaction(async (transaction) => {
    const baId = await businessAccountsService.createUnderChartCode(transaction, CODES.CUSTOMERS_ACCOUNTS, name, {
      region_id: payload.region_id,
      city_id: payload.city_id,
      ...opening,
    });
    return repository.insert(transaction, { ...payload, name, ba_id: baId });
  });

  return repository.findById(id);
}

// Renaming a customer keeps the linked account's name in sync (same as vendors — UC-08 step 6).
async function update(customerId, payload) {
  const existing = await getById(customerId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.customer_id !== customerId) {
    throw ApiError.conflict('A customer with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(customerId, { ...payload, name });
  if (existing.ba_id && name !== existing.name) {
    await businessAccountsService.renameLinked(existing.ba_id, name);
  }
  // The opening balance lives on the linked business account, not on this row.
  if (existing.ba_id) await businessAccountsService.setOpening(existing.ba_id, payload);

  return repository.findById(customerId);
}

// Soft delete — is_active = 0, never a hard DELETE (sale_bills.customer_id references this row
// historically). The linked business_accounts row stays ACTIVE for ledger/history integrity.
async function remove(customerId) {
  await getById(customerId);
  await repository.setActive(customerId, false);
  return { ok: true };
}

// Frontend calls this BEFORE create() so it can show the right prompt:
//  - 'none'      → no name match at all, create() straight away.
//  - 'active'    → one or more active customers already have this name — advisory only
//                  ("this name already exists, continue anyway?"), never blocks.
//  - 'inactive'  → one or more inactive (soft-deleted) customers have this name — frontend
//                  offers "activate one of these" (call reactivate(id)) or "create new anyway"
//                  (call create()).
// `inactive` wins over `active` when both exist, since it's the only status needing a decision.
async function checkName(name) {
  if (!name || !name.trim()) throw ApiError.badRequest('name is required');
  const matches = await repository.findAllByName(name.trim());
  if (matches.length === 0) return { status: 'none', matches: [] };

  const inactive = matches.filter((m) => !m.is_active);
  if (inactive.length > 0) return { status: 'inactive', matches: inactive };

  return { status: 'active', matches };
}

// Frontend calls this instead of create() when the user picks "reactivate" off a checkName()
// 'inactive' result. findById (not getById) skips the active check on purpose.
async function reactivate(customerId) {
  const customer = await repository.findById(customerId);
  if (!customer) throw ApiError.notFound('Customer not found');
  await repository.setActive(customerId, true);
  return repository.findById(customerId);
}

module.exports = { list, getById, create, update, remove, checkName, reactivate };
