// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/reports.repository');
const stockService = require('./stock.service');

// Weekly/monthly/overall convenience on top of explicit date_from/date_to (explicit wins) — same
// convention as saleBills.service.js/purchases.service.js#resolveDateRange.
function resolveDateRange(filters) {
  if (filters.date_from || filters.date_to) {
    return { date_from: filters.date_from, date_to: filters.date_to };
  }
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (filters.range === 'weekly') {
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    return { date_from: iso(from), date_to: iso(today) };
  }
  if (filters.range === 'monthly') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_from: iso(from), date_to: iso(today) };
  }
  return {}; // 'overall' or unspecified — no date filter
}

// Current Stock tab — thin pass-through to stock.service.js#currentStock (already does the
// cartons/extra-pairs conversion); kept as its own reports:stock channel per the milestone's
// naming, rather than folding the two modules together.
function stock(filters = {}) {
  return stockService.currentStock({ article_id: filters.article_id, category_id: filters.category_id });
}

function production(filters = {}) {
  return repository.productionLog({
    article_id: filters.article_id,
    category_id: filters.category_id,
    search: filters.search,
    ...resolveDateRange(filters),
  });
}

module.exports = { stock, production };
