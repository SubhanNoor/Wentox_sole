// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
// Naming note (milestone6.md): the feature/screen is "products"/"Product Details" but the real
// table is dbo.articles (PK article_id) — database_schema_v4.3.md's products/product_id shape is
// stale here.
const { sql, query } = require('../db/pool');

const COST_FIELDS = [
  'cutting', 'edging', 'up_stitch', 'bending', 'stubble_dori', 'shape_form',
  'chipkai', 'bottom', 'machine', 'trimming', 'sock_stitch', 'finish',
];

function costParams(article) {
  const params = {};
  for (const field of COST_FIELDS) {
    params[field] = { type: sql.Decimal(12, 2), value: article[field] || 0 };
  }
  return params;
}

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['a.is_active = 1'];
  const params = {};

  if (filters.category_id) {
    conditions.push('a.category_id = @categoryId');
    params.categoryId = { type: sql.Int, value: filters.category_id };
  }
  if (filters.vendor_id) {
    conditions.push('a.vendor_id = @vendorId');
    params.vendorId = { type: sql.Int, value: filters.vendor_id };
  }
  if (filters.search) {
    conditions.push('(a.name LIKE @search OR a.code LIKE @search)');
    params.search = { type: sql.NVarChar(150), value: `%${filters.search}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT a.*, c.name AS category_name, v.name AS vendor_name
     FROM dbo.articles a
     JOIN dbo.product_categories c ON c.category_id = a.category_id
     LEFT JOIN dbo.vendors v ON v.vendor_id = a.vendor_id
     ${where}
     ORDER BY a.name`,
    params,
  );
  return result.recordset;
}

async function findById(articleId) {
  const result = await query(
    `SELECT a.*, c.name AS category_name, v.name AS vendor_name
     FROM dbo.articles a
     JOIN dbo.product_categories c ON c.category_id = a.category_id
     LEFT JOIN dbo.vendors v ON v.vendor_id = a.vendor_id
     WHERE a.article_id = @articleId`,
    { articleId: { type: sql.Int, value: articleId } },
  );
  if (!result.recordset[0]) return null;

  const colorsResult = await query(
    'SELECT * FROM dbo.article_colors WHERE article_id = @articleId AND is_active = 1 ORDER BY color',
    { articleId: { type: sql.Int, value: articleId } },
  );
  return { ...result.recordset[0], colors: colorsResult.recordset };
}

// Highest numeric suffix among existing 'P-<n>' codes, so a fresh install starts at P-101 (the
// documented UC-07 example) and every later article increments from whatever's already there.
async function nextCode() {
  const result = await query(
    `SELECT MAX(TRY_CAST(SUBSTRING(code, 3, 30) AS INT)) AS maxNum
     FROM dbo.articles WHERE code LIKE 'P-%'`,
  );
  const maxNum = result.recordset[0].maxNum;
  return `P-${(maxNum || 100) + 1}`;
}

// batch_no is scoped per vendor (per client instruction — each vendor has its own batch
// sequence, e.g. Ali's batches and Abdullah's don't share a counter), starting at 1. Backed by
// UQ_articles_vendor_batch UNIQUE (vendor_id, batch_no).
async function nextBatchNo(vendorId) {
  const result = await query(
    `SELECT MAX(batch_no) AS maxBatch FROM dbo.articles WHERE vendor_id = @vendorId`,
    { vendorId: { type: sql.Int, value: vendorId } },
  );
  return (result.recordset[0].maxBatch || 0) + 1;
}

async function insert(article) {
  const params = {
    code: { type: sql.VarChar(30), value: article.code },
    name: { type: sql.NVarChar(150), value: article.name },
    categoryId: { type: sql.Int, value: article.category_id },
    vendorId: { type: sql.Int, value: article.vendor_id },
    batchNo: { type: sql.Int, value: article.batch_no },
    packing: { type: sql.Int, value: article.packing },
    salePrice: { type: sql.Decimal(12, 2), value: article.sale_price || 0 },
    ...costParams(article),
  };

  const costCols = COST_FIELDS.join(', ');
  const costVals = COST_FIELDS.map((f) => `@${f}`).join(', ');
  const result = await query(`
    INSERT INTO dbo.articles (
      code, name, category_id, vendor_id, batch_no, packing, sale_price, ${costCols}
    )
    OUTPUT inserted.article_id
    VALUES (
      @code, @name, @categoryId, @vendorId, @batchNo, @packing, @salePrice, ${costVals}
    )
  `, params);
  return result.recordset[0].article_id;
}

// vendor_id and batch_no are immutable after creation — batch_no is a per-vendor auto-generated
// sequence (§ batch numbering), so changing the vendor later would orphan the article's batch
// number from the sequence it was actually drawn from. Neither is part of this SET clause.
async function update(articleId, article) {
  const params = {
    articleId: { type: sql.Int, value: articleId },
    name: { type: sql.NVarChar(150), value: article.name },
    categoryId: { type: sql.Int, value: article.category_id },
    packing: { type: sql.Int, value: article.packing },
    salePrice: { type: sql.Decimal(12, 2), value: article.sale_price || 0 },
    ...costParams(article),
  };

  const costSets = COST_FIELDS.map((f) => `${f} = @${f}`).join(', ');
  await query(`
    UPDATE dbo.articles SET
      name = @name, category_id = @categoryId,
      packing = @packing, sale_price = @salePrice, ${costSets}
    WHERE article_id = @articleId
  `, params);
}

async function setActive(articleId, isActive) {
  await query(
    'UPDATE dbo.articles SET is_active = @isActive WHERE article_id = @articleId',
    {
      articleId: { type: sql.Int, value: articleId },
      isActive: { type: sql.Bit, value: isActive },
    },
  );
}

module.exports = { list, findById, nextCode, nextBatchNo, insert, update, setActive };
