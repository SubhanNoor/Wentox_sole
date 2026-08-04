// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/categories.repository');
const ApiError = require('../errors/ApiError');

function list(filters) {
  return repository.list(filters);
}

async function getById(categoryId) {
  const category = await repository.findById(categoryId);
  if (!category) throw ApiError.notFound('Category not found');
  return category;
}

// Case-insensitive name collision. ACTIVE match blocks creation outright; INACTIVE match
// (soft-deleted earlier) throws INACTIVE_DUPLICATE with the existing row's id/name in `details`,
// so the frontend can offer "reactivate?" instead of creating a confusing second row.
async function create(payload) {
  if (!payload.name || !payload.name.trim()) {
    throw ApiError.badRequest('name is required');
  }
  const name = payload.name.trim();
  const existing = await repository.findByName(name);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('A category with this name already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive category with this name already exists',
      'INACTIVE_DUPLICATE',
      { category_id: existing.category_id, name: existing.name },
    );
  }

  const id = await repository.insert({ name });
  return repository.findById(id);
}

async function update(categoryId, payload) {
  await getById(categoryId);
  if (!payload.name || !payload.name.trim()) {
    throw ApiError.badRequest('name is required');
  }
  const existing = await repository.findByName(payload.name.trim());
  if (existing && existing.category_id !== categoryId) {
    throw ApiError.conflict('A category with this name already exists', 'DUPLICATE_NAME');
  }

  await repository.update(categoryId, { name: payload.name.trim() });
  return repository.findById(categoryId);
}

// Soft delete — is_active = 0, never a hard DELETE (articles.category_id references this row).
async function remove(categoryId) {
  await getById(categoryId);
  await repository.setActive(categoryId, false);
  return { ok: true };
}

async function reactivate(categoryId) {
  const category = await repository.findById(categoryId);
  if (!category) throw ApiError.notFound('Category not found');
  await repository.setActive(categoryId, true);
  return repository.findById(categoryId);
}

module.exports = { list, getById, create, update, remove, reactivate };
