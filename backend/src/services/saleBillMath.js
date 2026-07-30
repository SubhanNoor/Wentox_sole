// Shared pairs/discount/totals math and line validation for sale_bills and draft_sale_bills —
// identical rules on both tables (schema §5.6/§5.6.1), factored out so they're defined once.
const ApiError = require('../errors/ApiError');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Computes one line's pairs/value/discount from its effective packing (from
// saleBills.repository.getVariantPackings / draftSaleBills.repository.getVariantPackings).
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

// Rolls a set of built lines up into bill-header totals.
function buildTotals(lines, invoiceDiscount) {
  const totalCartons = lines.reduce((sum, l) => sum + l.cartons, 0);
  const totalPairs = lines.reduce((sum, l) => sum + l.pairs, 0);
  const grossValue = round2(lines.reduce((sum, l) => sum + l._grossValue, 0));
  const lineDiscounts = round2(lines.reduce((sum, l) => sum + l.discount_value, 0));
  const netValue = round2(grossValue - lineDiscounts - (invoiceDiscount || 0));

  return { totalCartons, totalPairs, grossValue, netValue };
}

// Shared item-level validation (schema's CK_sale_bill_items_pairs / CK_draft_sale_bill_items_pairs
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

// Schema's CK_sale_bills_custdlv: sub_customer_id required unless delivery_type is 'SAME'.
// draft_sale_bills has no such constraint (a draft may be saved incomplete), but sale_bills does —
// so this must run before anything is written into sale_bills, whether from a normal create() or
// from draftSaleBills.confirm().
function validateDeliveryCustomer({ delivery_type: deliveryType, sub_customer_id: subCustomerId }) {
  if (deliveryType && deliveryType !== 'SAME' && !subCustomerId) {
    throw ApiError.badRequest('sub_customer_id is required when delivery_type is not SAME');
  }
}

module.exports = {
  round2, buildLine, buildTotals, validateItems, checkKnownVariants, validateDeliveryCustomer,
};
