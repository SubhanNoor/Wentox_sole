// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/stores.repository');
const ApiError = require('../errors/ApiError');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(storeId) {
  const store = await repository.findById(storeId);
  if (!store) throw ApiError.notFound('Store not found');
  return store;
}

async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const existing = await repository.findByName(name);
  if (existing) throw ApiError.conflict('A store with this name already exists', 'DUPLICATE_NAME');

  const id = await repository.insert({ name });
  return repository.findById(id);
}

async function update(storeId, payload) {
  await getById(storeId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.store_id !== storeId) {
    throw ApiError.conflict('A store with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(storeId, { name });
  return repository.findById(storeId);
}

// Soft delete — is_active = 0, never a hard DELETE. Note sale_bills.store_id/sale_returns.store_id
// are ON DELETE SET NULL at the FK level (so a hard-deleted store never blocks historical bills),
// but this app never hard-deletes anyway — soft delete keeps the store out of new-bill dropdowns
// while historical bills keep displaying its name via the still-existing row.
async function remove(storeId) {
  await getById(storeId);
  await repository.setActive(storeId, false);
  return { ok: true };
}

module.exports = { list, getById, create, update, remove };
