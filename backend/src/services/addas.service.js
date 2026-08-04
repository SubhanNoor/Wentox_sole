// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/addas.repository');
const ApiError = require('../errors/ApiError');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.region_id) throw ApiError.badRequest('region_id is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(addaId) {
  const adda = await repository.findById(addaId);
  if (!adda) throw ApiError.notFound('Adda not found');
  return adda;
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
      throw ApiError.conflict('An adda with this name already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive adda with this name already exists',
      'INACTIVE_DUPLICATE',
      { adda_id: existing.adda_id, name: existing.name },
    );
  }

  const id = await repository.insert({ ...payload, name });
  return repository.findById(id);
}

async function update(addaId, payload) {
  await getById(addaId);
  validate(payload);
  const name = payload.name.trim();

  const duplicate = await repository.findByName(name);
  if (duplicate && duplicate.adda_id !== addaId) {
    throw ApiError.conflict('An adda with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(addaId, { ...payload, name });
  return repository.findById(addaId);
}

// UC-14: delete is blocked (409) when the adda is referenced by any sale bill/return (or their
// drafts) — deactivate (soft delete) instead. This is the one entity in this milestone with a
// real referential guard beyond "soft delete always succeeds," since adda_id is NOT NULL on every
// confirmed sale bill/return.
async function remove(addaId) {
  await getById(addaId);
  const referenced = await repository.isReferenced(addaId);
  if (referenced) {
    throw ApiError.conflict(
      'This adda is used by an existing sale bill or return — deactivate it instead of deleting',
      'ADDA_IN_USE',
    );
  }
  await repository.setActive(addaId, false);
  return { ok: true };
}

async function reactivate(addaId) {
  const adda = await repository.findById(addaId);
  if (!adda) throw ApiError.notFound('Adda not found');
  await repository.setActive(addaId, true);
  return repository.findById(addaId);
}

module.exports = { list, getById, create, update, remove, reactivate };
