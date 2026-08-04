// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// Effective packing per variant is COALESCE(article_colors.packing, articles.packing) — same rule
// saleBills.repository.js#getVariantPackings uses.
async function getEffectivePacking(variantId) {
  const result = await query(
    `SELECT COALESCE(ac.packing, a.packing) AS effective_packing
     FROM dbo.article_colors ac
     JOIN dbo.articles a ON a.article_id = ac.article_id
     WHERE ac.variant_id = @variantId`,
    { variantId: { type: sql.Int, value: variantId } },
  );
  return result.recordset[0]?.effective_packing ?? null;
}

// Generic single-row insert — used by both log-production (movement_type='PRODUCTION') and
// adjust (movement_type='OPENING'|'ADJUSTMENT'). No transaction param: unlike a sale bill, a stock
// log/adjustment is always exactly one write, nothing else to keep atomic with it.
async function insertMovement(movement) {
  const result = await query(
    `INSERT INTO dbo.stock_movements (
       variant_id, movement_type, qty_pairs, movement_date, input_qty, input_unit, packing,
       source_type, source_id, created_by
     )
     OUTPUT inserted.movement_id
     VALUES (
       @variantId, @movementType, @qtyPairs, @movementDate, @inputQty, @inputUnit, @packing,
       NULL, NULL, @createdBy
     )`,
    {
      variantId: { type: sql.Int, value: movement.variant_id },
      movementType: { type: sql.VarChar(15), value: movement.movement_type },
      qtyPairs: { type: sql.Int, value: movement.qty_pairs },
      movementDate: { type: sql.Date, value: movement.movement_date },
      inputQty: { type: sql.Int, value: movement.input_qty ?? null },
      inputUnit: { type: sql.VarChar(10), value: movement.input_unit ?? null },
      packing: { type: sql.Int, value: movement.packing ?? null },
      createdBy: { type: sql.Int, value: movement.created_by ?? null },
    },
  );
  return result.recordset[0].movement_id;
}

// Movement history — "product ledger" per the article_colors comment. Accepts either variant_id
// (one color) or article_id (every color of that article), at least one required by the service.
async function movements(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.variant_id) {
    conditions.push('sm.variant_id = @variantId');
    params.variantId = { type: sql.Int, value: filters.variant_id };
  }
  if (filters.article_id) {
    conditions.push('ac.article_id = @articleId');
    params.articleId = { type: sql.Int, value: filters.article_id };
  }
  if (filters.movement_type) {
    conditions.push('sm.movement_type = @movementType');
    params.movementType = { type: sql.VarChar(15), value: filters.movement_type };
  }
  if (filters.date_from) {
    conditions.push('sm.movement_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('sm.movement_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT sm.*, ac.color, a.article_id, a.code AS article_code, a.name AS article_name
     FROM dbo.stock_movements sm
     JOIN dbo.article_colors ac ON ac.variant_id = sm.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     ${where}
     ORDER BY sm.movement_date DESC, sm.movement_id DESC`,
    params,
  );
  return result.recordset;
}

// Current stock — one row per (active) variant, SUM(qty_pairs) rolled up regardless of movement
// type. Cartons/extra-pairs conversion happens in the service (needs the same effective-packing
// COALESCE this file already does elsewhere, cheaper to compute once in JS per row than repeat the
// COALESCE expression a second time here).
async function currentStock(filters = {}) {
  const conditions = ['ac.is_active = 1'];
  const params = {};

  if (filters.article_id) {
    conditions.push('a.article_id = @articleId');
    params.articleId = { type: sql.Int, value: filters.article_id };
  }
  if (filters.category_id) {
    conditions.push('a.category_id = @categoryId');
    params.categoryId = { type: sql.Int, value: filters.category_id };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT
       ac.variant_id, ac.color, a.article_id, a.code AS article_code, a.name AS article_name,
       c.name AS category_name, COALESCE(ac.packing, a.packing) AS effective_packing,
       ISNULL(SUM(sm.qty_pairs), 0) AS total_pairs
     FROM dbo.article_colors ac
     JOIN dbo.articles a ON a.article_id = ac.article_id
     JOIN dbo.product_categories c ON c.category_id = a.category_id
     LEFT JOIN dbo.stock_movements sm ON sm.variant_id = ac.variant_id
     ${where}
     GROUP BY ac.variant_id, ac.color, a.article_id, a.code, a.name, c.name,
              COALESCE(ac.packing, a.packing)
     ORDER BY a.name, ac.color`,
    params,
  );
  return result.recordset;
}

module.exports = { getEffectivePacking, insertMovement, movements, currentStock };
