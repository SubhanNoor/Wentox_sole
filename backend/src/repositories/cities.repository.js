// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['c.is_active = 1'];
  const params = {};

  if (filters.region_id) {
    conditions.push('c.region_id = @regionId');
    params.regionId = { type: sql.Int, value: filters.region_id };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT c.*, r.name AS region_name
     FROM dbo.cities c
     LEFT JOIN dbo.regions r ON r.region_id = c.region_id
     ${where}
     ORDER BY c.name`,
    params,
  );
  return result.recordset;
}

async function findById(cityId) {
  const result = await query(
    `SELECT c.*, r.name AS region_name
     FROM dbo.cities c
     LEFT JOIN dbo.regions r ON r.region_id = c.region_id
     WHERE c.city_id = @cityId`,
    { cityId: { type: sql.Int, value: cityId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive on purpose (explicit LOWER(), not relying on DB collation).
async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.cities WHERE LOWER(name) = LOWER(@name)',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

async function insert(city) {
  const result = await query(
    `INSERT INTO dbo.cities (name, region_id)
     OUTPUT inserted.city_id
     VALUES (@name, @regionId)`,
    {
      name: { type: sql.NVarChar(100), value: city.name },
      regionId: { type: sql.Int, value: city.region_id ?? null },
    },
  );
  return result.recordset[0].city_id;
}

async function update(cityId, city) {
  await query(
    'UPDATE dbo.cities SET name = @name, region_id = @regionId WHERE city_id = @cityId',
    {
      cityId: { type: sql.Int, value: cityId },
      name: { type: sql.NVarChar(100), value: city.name },
      regionId: { type: sql.Int, value: city.region_id ?? null },
    },
  );
}

async function setActive(cityId, isActive) {
  await query(
    'UPDATE dbo.cities SET is_active = @isActive WHERE city_id = @cityId',
    { cityId: { type: sql.Int, value: cityId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
