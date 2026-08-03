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
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const existing = await repository.findByName(name);
  if (existing) throw ApiError.conflict('A customer with this name already exists', 'DUPLICATE_NAME');

  const id = await withTransaction(async (transaction) => {
    const baId = await businessAccountsService.createUnderChartCode(transaction, CODES.CUSTOMERS_ACCOUNTS, name, {
      region_id: payload.region_id,
      city_id: payload.city_id,
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

  return repository.findById(customerId);
}

// Soft delete — is_active = 0, never a hard DELETE (sale_bills.customer_id references this row
// historically). The linked business_accounts row stays ACTIVE for ledger/history integrity.
async function remove(customerId) {
  await getById(customerId);
  await repository.setActive(customerId, false);
  return { ok: true };
}

module.exports = { list, getById, create, update, remove };
