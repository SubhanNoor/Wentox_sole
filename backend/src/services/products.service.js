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

// Every article belongs to the single system vendor (migration 017) — the business manufactures
// its own product, so there is no supplier to choose. Resolved by its flag rather than by name:
// dbo.vendors has no code column and deliberately no UNIQUE(name), so a name match would break the
// moment someone added a second "Manufacturing Product".
//
// vendor_id still matters structurally even though it is now constant — it scopes batch numbering
// (UQ_articles_vendor_batch) and the duplicate-name rule, both of which simply become global.
async function systemVendorId() {
  const [vendor] = await vendorsService.list({ includeSystem: true, includeInactive: true })
    .then((rows) => rows.filter((v) => v.is_system));
  if (!vendor) {
    throw new Error('System vendor "Manufacturing Product" not found — run npm run seed');
  }
  return vendor.vendor_id;
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
  await categoriesService.getById(payload.category_id); // 404s if the category doesn't exist
  // The business manufactures its own product, so every article is attributed to the single system
  // vendor (migration 017) — whatever vendor_id a client sends is ignored rather than validated.
  // Enforced here, not by the form's disabled input, so the lock cannot be bypassed over IPC.
  payload.vendor_id = await systemVendorId();

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
  const mfgVendorId = await systemVendorId();

  const fieldErrors = [];
  articles.forEach((article, index) => {
    try {
      validate({ ...article, category_id: categoryId });
    } catch (err) {
      fieldErrors.push({ index, message: err.message });
    }
  });
  if (fieldErrors.length) {
    throw ApiError.badRequest('One or more articles are invalid', 'BATCH_VALIDATION_FAILED', { errors: fieldErrors });
  }

  // No vendor validation: every article is forced onto the system vendor a few lines above, exactly
  // as create() does. This used to 404 "Vendor not found" on whatever vendor_id the caller sent —
  // a value it then discarded — so a batch save failed outright whenever the form had not finished
  // loading its vendor list and fell back to `?? 0`. A check that can only ever reject valid input.
  const seenInBatch = new Set();
  const names = articles.map((a) => a.name.trim());
  for (let index = 0; index < articles.length; index += 1) {
    const name = names[index];
    // Keyed on the vendor the rows will actually be written with, not the one the caller sent.
    const key = `${name.toLowerCase()}::${mfgVendorId}`;
    if (seenInBatch.has(key)) {
      throw ApiError.conflict(
        `Duplicate article "${name}" for the same vendor within this batch`,
        'BATCH_DUPLICATE_IN_REQUEST',
        { index },
      );
    }
    seenInBatch.add(key);

    const existing = await repository.findByNameAndVendor(name, mfgVendorId);
    if (existing) {
      if (existing.is_active) {
        // article_id/name included so the caller can act on the collision rather than only report
        // it — Product Setup uses it to add a new COLOUR to the existing article, which is the
        // normal reason the same name is entered twice (INACTIVE_DUPLICATE below already did this).
        throw ApiError.conflict('A product with this name already exists for this vendor', 'DUPLICATE_NAME', {
          index, article_id: existing.article_id, name: existing.name,
        });
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
      const batchNo = await repository.nextBatchNo(transaction, mfgVendorId);
      const id = await repository.insert(transaction, {
        ...articles[index],
        vendor_id: mfgVendorId,
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
