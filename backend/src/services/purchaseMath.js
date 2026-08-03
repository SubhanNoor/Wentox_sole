// Shared line/total math and validation for purchases, purchase_returns, and their draft mirrors —
// identical rules on all four tables. Simpler than sale bill math: no packing/discount concept,
// just quantity × price_per_unit per line (schema §7).
const ApiError = require('../errors/ApiError');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Computes one line's total_price. weight is optional and informational only (not part of the
// total_price calculation).
function buildLine(item) {
  const quantity = item.quantity;
  const pricePerUnit = item.price_per_unit;
  const totalPrice = round2(quantity * pricePerUnit);

  return {
    material_id: item.material_id,
    unit: item.unit,
    quantity,
    weight: item.weight ?? null,
    price_per_unit: pricePerUnit,
    total_price: totalPrice,
  };
}

function buildTotals(lines) {
  const totalValue = round2(lines.reduce((sum, l) => sum + l.total_price, 0));
  return { totalValue };
}

// Schema's CK_purchase_items_qty/CK_*_price (and their draft/return mirrors) require quantity > 0
// and price_per_unit >= 0.
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one material line is required');
  }
  for (const item of items) {
    if (!item.unit) throw ApiError.badRequest('Each line must have a unit');
    if (!item.quantity || item.quantity <= 0) {
      throw ApiError.badRequest('Each line must have quantity > 0');
    }
    if (item.price_per_unit == null || item.price_per_unit < 0) {
      throw ApiError.badRequest('Each line must have price_per_unit >= 0');
    }
    if (!item.material_id && !item.material_name) {
      throw ApiError.badRequest('Each line must have a material_id or a material_name');
    }
  }
}

module.exports = { round2, buildLine, buildTotals, validateItems };
