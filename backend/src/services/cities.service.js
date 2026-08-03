// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/cities.repository');
const ApiError = require('../errors/ApiError');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(cityId) {
  const city = await repository.findById(cityId);
  if (!city) throw ApiError.notFound('City not found');
  return city;
}

// UC-11: region_id is optional ("optionally attach it to a region").
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const existing = await repository.findByName(name);
  if (existing) throw ApiError.conflict('A city with this name already exists', 'DUPLICATE_NAME');

  const id = await repository.insert({ name, region_id: payload.region_id });
  return repository.findById(id);
}

async function update(cityId, payload) {
  await getById(cityId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.city_id !== cityId) {
    throw ApiError.conflict('A city with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(cityId, { name, region_id: payload.region_id });
  return repository.findById(cityId);
}

// Soft delete — is_active = 0, never a hard DELETE (customers/vendors/sub_customers/addas.city_id
// reference this row historically).
async function remove(cityId) {
  await getById(cityId);
  await repository.setActive(cityId, false);
  return { ok: true };
}

module.exports = { list, getById, create, update, remove };
