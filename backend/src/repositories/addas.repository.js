// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['a.is_active = 1'];
  const params = {};

  if (filters.region_id) {
    conditions.push('a.region_id = @regionId');
    params.regionId = { type: sql.Int, value: filters.region_id };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT a.*, r.name AS region_name, c.name AS city_name
     FROM dbo.addas a
     JOIN dbo.regions r ON r.region_id = a.region_id
     LEFT JOIN dbo.cities c ON c.city_id = a.city_id
     ${where}
     ORDER BY a.name`,
    params,
  );
  return result.recordset;
}

async function findById(addaId) {
  const result = await query(
    `SELECT a.*, r.name AS region_name, c.name AS city_name
     FROM dbo.addas a
     JOIN dbo.regions r ON r.region_id = a.region_id
     LEFT JOIN dbo.cities c ON c.city_id = a.city_id
     WHERE a.adda_id = @addaId`,
    { addaId: { type: sql.Int, value: addaId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive on purpose (explicit LOWER(), not relying on DB collation).
async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.addas WHERE LOWER(name) = LOWER(@name)',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

async function insert(adda) {
  const result = await query(
    `INSERT INTO dbo.addas (name, region_id, city_id, details)
     OUTPUT inserted.adda_id
     VALUES (@name, @regionId, @cityId, @details)`,
    {
      name: { type: sql.NVarChar(100), value: adda.name },
      regionId: { type: sql.Int, value: adda.region_id },
      cityId: { type: sql.Int, value: adda.city_id ?? null },
      details: { type: sql.NVarChar(200), value: adda.details ?? null },
    },
  );
  return result.recordset[0].adda_id;
}

async function update(addaId, adda) {
  await query(
    `UPDATE dbo.addas SET name = @name, region_id = @regionId, city_id = @cityId, details = @details
     WHERE adda_id = @addaId`,
    {
      addaId: { type: sql.Int, value: addaId },
      name: { type: sql.NVarChar(100), value: adda.name },
      regionId: { type: sql.Int, value: adda.region_id },
      cityId: { type: sql.Int, value: adda.city_id ?? null },
      details: { type: sql.NVarChar(200), value: adda.details ?? null },
    },
  );
}

async function setActive(addaId, isActive) {
  await query(
    'UPDATE dbo.addas SET is_active = @isActive WHERE adda_id = @addaId',
    { addaId: { type: sql.Int, value: addaId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

// UC-14: delete is blocked when the adda is referenced by any sale bill — checks both sale_bills
// and sale_returns (adda_id is NOT NULL on both) plus their draft mirrors (adda_id nullable there,
// but a filled-in draft still counts as "referenced").
async function isReferenced(addaId) {
  const result = await query(
    `SELECT
       (SELECT COUNT(*) FROM dbo.sale_bills WHERE adda_id = @addaId) +
       (SELECT COUNT(*) FROM dbo.sale_returns WHERE adda_id = @addaId) +
       (SELECT COUNT(*) FROM dbo.draft_sale_bills WHERE adda_id = @addaId) +
       (SELECT COUNT(*) FROM dbo.draft_sale_returns WHERE adda_id = @addaId) AS refCount`,
    { addaId: { type: sql.Int, value: addaId } },
  );
  return result.recordset[0].refCount > 0;
}

module.exports = { list, findById, findByName, insert, update, setActive, isReferenced };
