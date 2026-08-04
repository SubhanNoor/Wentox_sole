// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

async function list(filters = {}) {
  const where = filters.includeInactive ? '' : 'WHERE is_active = 1';
  const result = await query(`SELECT * FROM dbo.stores ${where} ORDER BY name`);
  return result.recordset;
}

async function findById(storeId) {
  const result = await query(
    'SELECT * FROM dbo.stores WHERE store_id = @storeId',
    { storeId: { type: sql.Int, value: storeId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive on purpose (explicit LOWER(), not relying on DB collation).
async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.stores WHERE LOWER(name) = LOWER(@name)',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

async function insert(store) {
  const result = await query(
    `INSERT INTO dbo.stores (name) OUTPUT inserted.store_id VALUES (@name)`,
    { name: { type: sql.NVarChar(100), value: store.name } },
  );
  return result.recordset[0].store_id;
}

async function update(storeId, store) {
  await query(
    'UPDATE dbo.stores SET name = @name WHERE store_id = @storeId',
    {
      storeId: { type: sql.Int, value: storeId },
      name: { type: sql.NVarChar(100), value: store.name },
    },
  );
}

async function setActive(storeId, isActive) {
  await query(
    'UPDATE dbo.stores SET is_active = @isActive WHERE store_id = @storeId',
    { storeId: { type: sql.Int, value: storeId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
