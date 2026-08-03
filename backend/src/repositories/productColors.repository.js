// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
// Colors as a real child table (dbo.article_colors) — per UC-07, not created from the Product
// Details form itself; the actual UI trigger is the Current Stock "Add" dialog (UC-28, Milestone
// 5), which is what calls create() below the first time an unseen color is entered.
const { sql, query } = require('../db/pool');

async function listByArticle(articleId, filters = {}) {
  const where = filters.includeInactive ? '' : 'AND is_active = 1';
  const result = await query(
    `SELECT * FROM dbo.article_colors WHERE article_id = @articleId ${where} ORDER BY color`,
    { articleId: { type: sql.Int, value: articleId } },
  );
  return result.recordset;
}

async function findById(variantId) {
  const result = await query(
    'SELECT * FROM dbo.article_colors WHERE variant_id = @variantId',
    { variantId: { type: sql.Int, value: variantId } },
  );
  return result.recordset[0] || null;
}

async function findByArticleAndColor(articleId, color) {
  const result = await query(
    'SELECT * FROM dbo.article_colors WHERE article_id = @articleId AND color = @color',
    {
      articleId: { type: sql.Int, value: articleId },
      color: { type: sql.NVarChar(50), value: color },
    },
  );
  return result.recordset[0] || null;
}

async function insert(variant) {
  const result = await query(
    `INSERT INTO dbo.article_colors (article_id, color, packing)
     OUTPUT inserted.variant_id
     VALUES (@articleId, @color, @packing)`,
    {
      articleId: { type: sql.Int, value: variant.article_id },
      color: { type: sql.NVarChar(50), value: variant.color },
      packing: { type: sql.Int, value: variant.packing ?? null },
    },
  );
  return result.recordset[0].variant_id;
}

async function update(variantId, variant) {
  await query(
    `UPDATE dbo.article_colors SET color = @color, packing = @packing WHERE variant_id = @variantId`,
    {
      variantId: { type: sql.Int, value: variantId },
      color: { type: sql.NVarChar(50), value: variant.color },
      packing: { type: sql.Int, value: variant.packing ?? null },
    },
  );
}

async function setActive(variantId, isActive) {
  await query(
    'UPDATE dbo.article_colors SET is_active = @isActive WHERE variant_id = @variantId',
    {
      variantId: { type: sql.Int, value: variantId },
      isActive: { type: sql.Bit, value: isActive },
    },
  );
}

module.exports = {
  listByArticle, findById, findByArticleAndColor, insert, update, setActive,
};
