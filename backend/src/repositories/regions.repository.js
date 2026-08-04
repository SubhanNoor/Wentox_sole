// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

async function list(filters = {}) {
  const where = filters.includeInactive ? '' : 'WHERE is_active = 1';
  const result = await query(`SELECT * FROM dbo.regions ${where} ORDER BY name`);
  return result.recordset;
}

async function findById(regionId) {
  const result = await query(
    'SELECT * FROM dbo.regions WHERE region_id = @regionId',
    { regionId: { type: sql.Int, value: regionId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive on purpose (explicit LOWER(), not relying on DB collation).
async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.regions WHERE LOWER(name) = LOWER(@name)',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

async function insert(region) {
  const result = await query(
    `INSERT INTO dbo.regions (name) OUTPUT inserted.region_id VALUES (@name)`,
    { name: { type: sql.NVarChar(100), value: region.name } },
  );
  return result.recordset[0].region_id;
}

async function update(regionId, region) {
  await query(
    'UPDATE dbo.regions SET name = @name WHERE region_id = @regionId',
    {
      regionId: { type: sql.Int, value: regionId },
      name: { type: sql.NVarChar(100), value: region.name },
    },
  );
}

async function setActive(regionId, isActive) {
  await query(
    'UPDATE dbo.regions SET is_active = @isActive WHERE region_id = @regionId',
    { regionId: { type: sql.Int, value: regionId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
