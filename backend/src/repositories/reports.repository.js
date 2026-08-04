// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// PRODUCTION-only movement log, with date range + article/category search (Module 5.1's
// reports:production — daily/weekly/monthly/overall filters are resolved to date_from/date_to by
// the service, same convention as saleBills.service.js#resolveDateRange).
async function productionLog(filters = {}) {
  const conditions = ["sm.movement_type = 'PRODUCTION'"];
  const params = {};

  if (filters.article_id) {
    conditions.push('a.article_id = @articleId');
    params.articleId = { type: sql.Int, value: filters.article_id };
  }
  if (filters.category_id) {
    conditions.push('a.category_id = @categoryId');
    params.categoryId = { type: sql.Int, value: filters.category_id };
  }
  if (filters.search) {
    conditions.push('(a.name LIKE @search OR a.code LIKE @search)');
    params.search = { type: sql.NVarChar(150), value: `%${filters.search}%` };
  }
  if (filters.date_from) {
    conditions.push('sm.movement_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('sm.movement_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await query(
    `SELECT sm.*, ac.color, a.code AS article_code, a.name AS article_name, c.name AS category_name
     FROM dbo.stock_movements sm
     JOIN dbo.article_colors ac ON ac.variant_id = sm.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     JOIN dbo.product_categories c ON c.category_id = a.category_id
     ${where}
     ORDER BY sm.movement_date DESC, sm.movement_id DESC`,
    params,
  );
  return result.recordset;
}

module.exports = { productionLog };
