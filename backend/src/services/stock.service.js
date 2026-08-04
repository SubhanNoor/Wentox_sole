// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/stock.repository');
const productColorsService = require('../services/productColors.service');
const productsService = require('./products.service');
const vendorsService = require('./vendors.service');
const materialsRepository = require('../repositories/materials.repository');
const ApiError = require('../errors/ApiError');

// Resolves a variant either directly (variant_id) or by article_id+color (creating the color the
// first time it's logged, per UC-28 — see productColors.repository.js's own comment on this).
async function resolveVariant(payload) {
  if (payload.variant_id) return productColorsService.getById(payload.variant_id);
  if (!payload.article_id) throw ApiError.badRequest('article_id or variant_id is required');
  return productColorsService.resolveOrCreate(payload.article_id, payload.color, payload.packing);
}

// PRODUCTION movement — input_qty + input_unit (CARTONS|PAIRS) normalized to qty_pairs here in
// the main process (UC-28), packing snapshotted regardless of unit (schema comment: "PRODUCTION
// only: packing snapshot" — kept for audit even when the operator typed pairs directly).
async function logProduction(payload, userId) {
  if (!payload.movement_date) throw ApiError.badRequest('movement_date is required');
  if (!payload.input_qty || payload.input_qty <= 0) throw ApiError.badRequest('input_qty must be > 0');
  if (payload.input_unit !== 'CARTONS' && payload.input_unit !== 'PAIRS') {
    throw ApiError.badRequest("input_unit must be 'CARTONS' or 'PAIRS'");
  }

  const variant = await resolveVariant(payload);
  const packing = variant.packing ?? (await productsService.getById(variant.article_id)).packing;
  const qtyPairs = payload.input_unit === 'CARTONS' ? payload.input_qty * packing : payload.input_qty;

  const movementId = await repository.insertMovement({
    variant_id: variant.variant_id,
    movement_type: 'PRODUCTION',
    qty_pairs: qtyPairs,
    movement_date: payload.movement_date,
    input_qty: payload.input_qty,
    input_unit: payload.input_unit,
    packing,
    created_by: userId,
  });

  return { movement_id: movementId, variant_id: variant.variant_id, qty_pairs: qtyPairs };
}

// OPENING/ADJUSTMENT — signed qty, no input_qty/input_unit/packing (those are PRODUCTION-only per
// schema.sql's own column comments).
async function adjust(payload, userId) {
  if (!payload.movement_date) throw ApiError.badRequest('movement_date is required');
  if (payload.movement_type !== 'OPENING' && payload.movement_type !== 'ADJUSTMENT') {
    throw ApiError.badRequest("movement_type must be 'OPENING' or 'ADJUSTMENT'");
  }
  if (payload.qty_pairs === undefined || payload.qty_pairs === null || payload.qty_pairs === 0) {
    throw ApiError.badRequest('qty_pairs is required and must not be 0');
  }

  const variant = await resolveVariant(payload);

  const movementId = await repository.insertMovement({
    variant_id: variant.variant_id,
    movement_type: payload.movement_type,
    qty_pairs: payload.qty_pairs,
    movement_date: payload.movement_date,
    created_by: userId,
  });

  return { movement_id: movementId, variant_id: variant.variant_id, qty_pairs: payload.qty_pairs };
}

// Movement history (payload: { article_id } or { variant_id }) — "the Product Ledger *is* this
// movement table, filtered by variant_id" per article_colors.repository.js's own comment; article_id
// widens that to every color of the article.
function movements(filters = {}) {
  if (!filters.article_id && !filters.variant_id) {
    throw ApiError.badRequest('article_id or variant_id is required');
  }
  return repository.movements(filters);
}

// Current stock per variant, cartons + extra pairs via effective packing (Current Stock tab).
async function currentStock(filters = {}) {
  const rows = await repository.currentStock(filters);
  return rows.map((row) => {
    const packing = row.effective_packing || 1; // guard div-by-zero; packing is NOT NULL on articles
    return {
      ...row,
      cartons: Math.trunc(row.total_pairs / packing),
      extra_pairs: row.total_pairs % packing,
    };
  });
}

// UC-30 step 2 — records that some quantity of a vendor's material has been used, as a negative
// CONSUMPTION row (source_type NULL — manual, not tied to a purchase/return document). Rejected
// if it would take on-hand negative, same guard a real stock count would need.
async function reduceVendorStock(payload, userId) {
  if (!payload.vendor_id) throw ApiError.badRequest('vendor_id is required');
  if (!payload.material_id) throw ApiError.badRequest('material_id is required');
  if (!payload.unit) throw ApiError.badRequest('unit is required');
  if (!payload.qty || payload.qty <= 0) throw ApiError.badRequest('qty must be > 0');
  if (!payload.movement_date) throw ApiError.badRequest('movement_date is required');

  await vendorsService.getById(payload.vendor_id); // 404s if it doesn't exist
  const material = await materialsRepository.findById(payload.material_id);
  if (!material) throw ApiError.notFound('Material not found');

  const onHand = await repository.vendorMaterialOnHand(payload.vendor_id, payload.material_id, payload.unit);
  if (payload.qty > onHand) {
    throw ApiError.conflict(`Only ${onHand} ${payload.unit} on hand for this vendor/material`, 'INSUFFICIENT_STOCK');
  }

  const movementId = await repository.insertVendorStockConsumption({
    vendor_id: payload.vendor_id,
    material_id: payload.material_id,
    unit: payload.unit,
    qty: -payload.qty,
    movement_date: payload.movement_date,
    created_by: userId,
  });
  return { movement_id: movementId };
}

module.exports = { logProduction, adjust, movements, currentStock, reduceVendorStock };
