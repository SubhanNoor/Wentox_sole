// The one definition of a valid carton quantity, shared by every path that accepts one
// (sale bills, sale returns, stock vouchers, wage runs, stock movements).
//
// Cartons became DECIMAL(12,1) in migration 030 so part-cartons can be recorded. Two rules come
// with that, and both have to live here rather than being restated per service:
//
//   1. AT MOST ONE DECIMAL PLACE. DECIMAL(12,1) silently ROUNDS anything finer — 2.55 is stored
//      as 2.6 — so the value has to be rejected before it reaches SQL Server, or the number the
//      user typed is not the number that gets saved.
//
//   2. cartons * packing MUST COME TO A WHOLE NUMBER OF PAIRS. Stock is held in pairs
//      (stock_movements.qty_pairs, still INT) and a pair is indivisible. Chosen explicitly by the
//      user over rounding the pairs, so nothing drifts between the carton figure on a document and
//      the pairs that actually moved.
const ApiError = require('../errors/ApiError');

// 1e-9, not ===: cartons arrives as a float over JSON, and 0.1 * 3 is 0.30000000000000004 in IEEE
//754. Comparing exactly would reject quantities that are whole to any meaningful precision.
const EPSILON = 1e-9;

function isWhole(n) {
  return Math.abs(n - Math.round(n)) < EPSILON;
}

/** True when `value` has at most one decimal place. */
function hasAtMostOneDecimal(value) {
  return isWhole(value * 10);
}

/**
 * Throws ApiError unless `cartons` is a usable quantity for an item of this packing.
 * `label` names the line in the message, e.g. an article name.
 */
function assertValidCartons(cartons, packing, label = 'this line') {
  const n = Number(cartons);
  if (!Number.isFinite(n)) {
    throw ApiError.badRequest(`Cartons for ${label} must be a number`);
  }
  if (!hasAtMostOneDecimal(n)) {
    throw ApiError.badRequest(
      `Cartons for ${label} can have at most one decimal place — ${n} would be rounded when saved`,
    );
  }
  const pairs = n * packing;
  if (!isWhole(pairs)) {
    throw ApiError.badRequest(
      `${n} cartons of ${packing} pairs each comes to ${round1(pairs)} pairs for ${label}. `
      + 'Stock is counted in whole pairs — enter a carton quantity that divides evenly.',
    );
  }
}

/** cartons * packing, snapped to the integer it is already within EPSILON of. */
function pairsFor(cartons, packing) {
  return Math.round(Number(cartons) * packing);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = { assertValidCartons, pairsFor, hasAtMostOneDecimal, isWhole, round1 };
