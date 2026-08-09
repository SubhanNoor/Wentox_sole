// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/products.repository');
const categoriesService = require('./categories.service');
const vendorsService = require('./vendors.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');

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

  // Case-insensitive name+vendor collision (§ products.repository.js#findByNameAndVendor — not
  // name alone, since the same product name legitimately recurs across different vendors). ACTIVE
  // match blocks; INACTIVE match (soft-deleted earlier) throws INACTIVE_DUPLICATE with the
  // existing row's id/name in `details` so the frontend can offer "reactivate?" instead.
  const name = payload.name.trim();
  const existing = await repository.findByNameAndVendor(name, payload.vendor_id);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('A product with this name already exists for this vendor', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive product with this name already exists for this vendor',
      'INACTIVE_DUPLICATE',
      { article_id: existing.article_id, name: existing.name },
    );
  }

  const id = await withTransaction(async (transaction) => {
    const code = await repository.nextCode(transaction);
    const batchNo = await repository.nextBatchNo(transaction, payload.vendor_id);
    return repository.insert(transaction, { ...payload, name, code, batch_no: batchNo });
  });
  return repository.findById(id);
}

// UC-07 "multi-article entry": one category selected once, several articles registered under it
// in a single save. Same rules as create() per article (name/packing/vendor validation, category
// existence, name+vendor duplicate check — including duplicates *within* the batch itself, since
// two rows for the same vendor+name in one submission would otherwise both pass the DB-lookup
// check and collide on insert). Validates every article before writing any of them, so a bad row
// doesn't leave a partial batch committed; codes/batch_nos are drawn inside one transaction so
// concurrent rows in the same batch never race each other for the same number (see
// products.repository.js#nextCode/#nextBatchNo).
async function createBatch(payload) {
  const categoryId = payload.category_id;
  if (!categoryId) throw ApiError.badRequest('category_id is required');
  const articles = payload.articles;
  if (!Array.isArray(articles) || articles.length === 0) {
    throw ApiError.badRequest('articles must be a non-empty array');
  }

  await categoriesService.getById(categoryId);

  const fieldErrors = [];
  articles.forEach((article, index) => {
    try {
      validate({ ...article, category_id: categoryId });
      validateVendor(article);
    } catch (err) {
      fieldErrors.push({ index, message: err.message });
    }
  });
  if (fieldErrors.length) {
    throw ApiError.badRequest('One or more articles are invalid', 'BATCH_VALIDATION_FAILED', { errors: fieldErrors });
  }

  const vendorIds = [...new Set(articles.map((a) => a.vendor_id))];
  for (const vendorId of vendorIds) {
    await vendorsService.getById(vendorId); // 404s if any referenced vendor doesn't exist
  }

  const seenInBatch = new Set();
  const names = articles.map((a) => a.name.trim());
  for (let index = 0; index < articles.length; index += 1) {
    const name = names[index];
    const key = `${name.toLowerCase()}::${articles[index].vendor_id}`;
    if (seenInBatch.has(key)) {
      throw ApiError.conflict(
        `Duplicate article "${name}" for the same vendor within this batch`,
        'BATCH_DUPLICATE_IN_REQUEST',
        { index },
      );
    }
    seenInBatch.add(key);

    const existing = await repository.findByNameAndVendor(name, articles[index].vendor_id);
    if (existing) {
      if (existing.is_active) {
        throw ApiError.conflict('A product with this name already exists for this vendor', 'DUPLICATE_NAME', { index });
      }
      throw ApiError.conflict(
        'An inactive product with this name already exists for this vendor',
        'INACTIVE_DUPLICATE',
        { index, article_id: existing.article_id, name: existing.name },
      );
    }
  }

  const ids = await withTransaction(async (transaction) => {
    const inserted = [];
    for (let index = 0; index < articles.length; index += 1) {
      const code = await repository.nextCode(transaction);
      const batchNo = await repository.nextBatchNo(transaction, articles[index].vendor_id);
      const id = await repository.insert(transaction, {
        ...articles[index],
        name: names[index],
        category_id: categoryId,
        code,
        batch_no: batchNo,
      });
      inserted.push(id);
    }
    return inserted;
  });

  return Promise.all(ids.map((id) => repository.findById(id)));
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

async function reactivate(articleId) {
  const article = await repository.findById(articleId);
  if (!article) throw ApiError.notFound('Product not found');
  await repository.setActive(articleId, true);
  return repository.findById(articleId);
}

module.exports = { list, getById, create, createBatch, update, remove, reactivate };
