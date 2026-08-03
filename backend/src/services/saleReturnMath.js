// Shared pairs/discount/totals math and line validation for sale_returns and draft_sale_returns —
// identical rules on both tables (schema §5.6/§5.6.2), factored out so they're defined once.
// Same math as saleBillMath.js; kept as its own copy since sale_returns has no delivery_type/
// sub_customer delivery constraint to validate (no CK_sale_returns_custdlv in the schema).
const ApiError = require('../errors/ApiError');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Computes one line's pairs/value/discount from its effective packing (from
// saleReturns.repository.getVariantPackings / draftSaleReturns.repository.getVariantPackings).
function buildLine(item, effectivePacking) {
  const cartons = item.cartons;
  const discountPercent = item.discount_percent || 0;
  const pairs = cartons * effectivePacking;
  const value = round2(item.rate * pairs);
  const discountValue = round2((value * discountPercent) / 100);
  const netValue = round2(value - discountValue);

  return {
    variant_id: item.variant_id,
    cartons,
    pairs,
    rate: item.rate,
    discount_percent: discountPercent,
    discount_value: discountValue,
    value: netValue,
    _grossValue: value,
  };
}

// Rolls a set of built lines up into return-header totals.
function buildTotals(lines, invoiceDiscount) {
  const totalCartons = lines.reduce((sum, l) => sum + l.cartons, 0);
  const totalPairs = lines.reduce((sum, l) => sum + l.pairs, 0);
  const grossValue = round2(lines.reduce((sum, l) => sum + l._grossValue, 0));
  const lineDiscounts = round2(lines.reduce((sum, l) => sum + l.discount_value, 0));
  const netValue = round2(grossValue - lineDiscounts - (invoiceDiscount || 0));

  return { totalCartons, totalPairs, grossValue, netValue };
}

// Shared item-level validation (schema's CK_sale_return_items_pairs / CK_draft_sale_return_items_pairs
// both require pairs > 0, and pairs = cartons * packing) plus unknown-variant detection.
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one item is required');
  }
  for (const item of items) {
    if (!item.cartons || item.cartons <= 0) {
      throw ApiError.badRequest('Each item must have cartons > 0');
    }
  }
}

function checkKnownVariants(variantIds, packings) {
  for (const id of variantIds) {
    if (!packings.has(id)) throw ApiError.badRequest(`Unknown product variant: ${id}`);
  }
}

module.exports = {
  round2, buildLine, buildTotals, validateItems, checkKnownVariants,
};
