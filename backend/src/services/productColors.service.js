// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/productColors.repository');
const productsService = require('./products.service');
const ApiError = require('../errors/ApiError');

function listByArticle(articleId, filters) {
  return repository.listByArticle(articleId, filters);
}

async function getById(variantId) {
  const variant = await repository.findById(variantId);
  if (!variant) throw ApiError.notFound('Product color not found');
  return variant;
}

// UC-07/§4.3: a new color is created the first time stock of that color is added (the Current
// Stock "Add" dialog, UC-28) — re-typing an existing color for the same article resolves to the
// existing row rather than creating a duplicate (schema's UQ_article_colors_acolor).
async function resolveOrCreate(articleId, color, packing) {
  await productsService.getById(articleId); // 404s if the article doesn't exist
  if (!color || !color.trim()) throw ApiError.badRequest('color is required');

  const existing = await repository.findByArticleAndColor(articleId, color.trim());
  if (existing) return existing;

  const id = await repository.insert({ article_id: articleId, color: color.trim(), packing });
  return repository.findById(id);
}

async function update(variantId, payload) {
  const existing = await getById(variantId);
  if (!payload.color || !payload.color.trim()) throw ApiError.badRequest('color is required');

  const duplicate = await repository.findByArticleAndColor(existing.article_id, payload.color.trim());
  if (duplicate && duplicate.variant_id !== variantId) {
    throw ApiError.conflict('This article already has a color with this name', 'DUPLICATE_COLOR');
  }

  await repository.update(variantId, { color: payload.color.trim(), packing: payload.packing });
  return repository.findById(variantId);
}

// Soft delete — is_active = 0, never a hard DELETE (sale_bill_items/stock_movements reference
// this variant historically).
async function remove(variantId) {
  await getById(variantId);
  await repository.setActive(variantId, false);
  return { ok: true };
}

module.exports = { listByArticle, getById, resolveOrCreate, update, remove };
