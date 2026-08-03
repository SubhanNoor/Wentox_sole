// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/products.repository');
const categoriesService = require('./categories.service');
const vendorsService = require('./vendors.service');
const ApiError = require('../errors/ApiError');

function validate(payload) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (!payload.category_id) throw ApiError.badRequest('category_id is required');
  if (!payload.packing || payload.packing <= 0) throw ApiError.badRequest('packing must be > 0');
}

// vendor_id is required only at creation (§ batch numbering — batch_no is generated per vendor,
// so there must always be one to scope against). Not re-validated on update() since vendor_id is
// immutable there.
function validateVendor(payload) {
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
}

function list(filters) {
  return repository.list(filters);
}

async function getById(articleId) {
  const article = await repository.findById(articleId);
  if (!article) throw ApiError.notFound('Product not found');
  return article;
}

// UC-07 step 3: code (e.g. 'P-101') is system-generated on category selection, not typed by hand.
// batch_no is likewise system-generated, scoped per vendor (per client instruction) — never typed
// by hand, and immutable once assigned (see products.repository.js:update()).
async function create(payload) {
  validate(payload);
  validateVendor(payload);
  await categoriesService.getById(payload.category_id); // 404s if the category doesn't exist
  await vendorsService.getById(payload.vendor_id); // 404s if the vendor doesn't exist

  const code = await repository.nextCode();
  const batchNo = await repository.nextBatchNo(payload.vendor_id);
  const id = await repository.insert({ ...payload, code, batch_no: batchNo });
  return repository.findById(id);
}

async function update(articleId, payload) {
  await getById(articleId);
  validate(payload);
  await categoriesService.getById(payload.category_id);

  await repository.update(articleId, payload);
  return repository.findById(articleId);
}

// Soft delete — is_active = 0, never a hard DELETE (sale_bill_items/stock_movements reference
// this article's variants historically).
async function remove(articleId) {
  await getById(articleId);
  await repository.setActive(articleId, false);
  return { ok: true };
}

module.exports = { list, getById, create, update, remove };
