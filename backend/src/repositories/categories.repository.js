// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

async function list(filters = {}) {
  const where = filters.includeInactive ? '' : 'WHERE is_active = 1';
  const result = await query(
    `SELECT * FROM dbo.product_categories ${where} ORDER BY name`,
  );
  return result.recordset;
}

async function findById(categoryId) {
  const result = await query(
    'SELECT * FROM dbo.product_categories WHERE category_id = @categoryId',
    { categoryId: { type: sql.Int, value: categoryId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive on purpose (explicit LOWER(), not relying on DB collation).
async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.product_categories WHERE LOWER(name) = LOWER(@name)',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

async function insert(category) {
  const result = await query(
    `INSERT INTO dbo.product_categories (name)
     OUTPUT inserted.category_id
     VALUES (@name)`,
    { name: { type: sql.NVarChar(100), value: category.name } },
  );
  return result.recordset[0].category_id;
}

async function update(categoryId, category) {
  await query(
    `UPDATE dbo.product_categories SET name = @name WHERE category_id = @categoryId`,
    {
      categoryId: { type: sql.Int, value: categoryId },
      name: { type: sql.NVarChar(100), value: category.name },
    },
  );
}

async function setActive(categoryId, isActive) {
  await query(
    `UPDATE dbo.product_categories SET is_active = @isActive WHERE category_id = @categoryId`,
    {
      categoryId: { type: sql.Int, value: categoryId },
      isActive: { type: sql.Bit, value: isActive },
    },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
