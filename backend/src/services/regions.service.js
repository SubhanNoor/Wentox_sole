// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/regions.repository');
const ApiError = require('../errors/ApiError');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(regionId) {
  const region = await repository.findById(regionId);
  if (!region) throw ApiError.notFound('Region not found');
  return region;
}

// Case-insensitive name collision. ACTIVE match blocks creation outright; INACTIVE match
// (soft-deleted earlier) throws INACTIVE_DUPLICATE with the existing row's id/name in `details`,
// so the frontend can offer "reactivate?" instead of creating a confusing second row.
async function create(payload) {
  validate(payload);
  const name = payload.name.trim();

  const existing = await repository.findByName(name);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('A region with this name already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive region with this name already exists',
      'INACTIVE_DUPLICATE',
      { region_id: existing.region_id, name: existing.name },
    );
  }

  const id = await repository.insert({ name });
  return repository.findById(id);
}

async function update(regionId, payload) {
  await getById(regionId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.region_id !== regionId) {
    throw ApiError.conflict('A region with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(regionId, { name });
  return repository.findById(regionId);
}

// Soft delete — is_active = 0, never a hard DELETE (customers/vendors/sub_customers/addas.region_id
// reference this row historically).
async function remove(regionId) {
  await getById(regionId);
  await repository.setActive(regionId, false);
  return { ok: true };
}

// Frontend calls this instead of create() when the user confirms "reactivate the existing one"
// off an INACTIVE_DUPLICATE conflict.
async function reactivate(regionId) {
  const region = await repository.findById(regionId);
  if (!region) throw ApiError.notFound('Region not found');
  await repository.setActive(regionId, true);
  return repository.findById(regionId);
}

module.exports = { list, getById, create, update, remove, reactivate };
