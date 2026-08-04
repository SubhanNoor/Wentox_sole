// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function findById(materialId) {
  const result = await query(
    'SELECT material_id, name, default_unit, is_active FROM dbo.materials WHERE material_id = @materialId',
    { materialId: { type: sql.Int, value: materialId } },
  );
  return result.recordset[0] || null;
}

// Self-building material lookup (schema §4.3) — resolves an existing material by name (default
// collation is case-insensitive, so 'pu sheet roll' matches 'PU Sheet Roll') or auto-registers a
// new one. Runs inside the caller's transaction so registration is atomic with the purchase/
// purchase-return line it belongs to.
async function resolveOrCreate(transaction, name, defaultUnit) {
  const findRequest = requestWithParams(transaction, {
    name: { type: sql.NVarChar(150), value: name },
  });
  const existing = await findRequest.query(
    'SELECT material_id FROM dbo.materials WHERE name = @name',
  );
  if (existing.recordset.length > 0) return existing.recordset[0].material_id;

  const insertRequest = requestWithParams(transaction, {
    name: { type: sql.NVarChar(150), value: name },
    defaultUnit: { type: sql.NVarChar(30), value: defaultUnit ?? null },
  });
  const inserted = await insertRequest.query(`
    INSERT INTO dbo.materials (name, default_unit)
    OUTPUT inserted.material_id
    VALUES (@name, @defaultUnit)
  `);
  return inserted.recordset[0].material_id;
}

module.exports = { resolveOrCreate, findById };
