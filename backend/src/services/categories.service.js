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

async function create(payload) {
  if (!payload.name || !payload.name.trim()) {
    throw ApiError.badRequest('name is required');
  }
  const existing = await repository.findByName(payload.name.trim());
  if (existing) throw ApiError.conflict('A category with this name already exists', 'DUPLICATE_NAME');

  const id = await repository.insert({ name: payload.name.trim() });
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

module.exports = { list, getById, create, update, remove };
