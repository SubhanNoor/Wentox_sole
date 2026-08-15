// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// AD-01/AD-02: route_city_ids/route_city_names ride along as comma-joined strings (same
// STRING_AGG pattern employees.repository.js#list uses for worker_stages) so the list view and
// the search-by-route case both work off one query, no per-row route fetch.
async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['a.is_active = 1'];
  const params = {};

  if (filters.city_id) {
    conditions.push('EXISTS (SELECT 1 FROM dbo.adda_routes ar WHERE ar.adda_id = a.adda_id AND ar.city_id = @cityId)');
    params.cityId = { type: sql.Int, value: filters.city_id };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT a.*,
            (SELECT STRING_AGG(CAST(ar.city_id AS VARCHAR(10)), ',')
             FROM dbo.adda_routes ar WHERE ar.adda_id = a.adda_id) AS route_city_ids,
            (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY c.name)
             FROM dbo.adda_routes ar JOIN dbo.cities c ON c.city_id = ar.city_id
             WHERE ar.adda_id = a.adda_id) AS route_city_names
     FROM dbo.addas a
     ${where}
     ORDER BY a.name`,
    params,
  );
  return result.recordset;
}

async function findById(addaId) {
  const result = await query(
    `SELECT a.*,
            (SELECT STRING_AGG(CAST(ar.city_id AS VARCHAR(10)), ',')
             FROM dbo.adda_routes ar WHERE ar.adda_id = a.adda_id) AS route_city_ids,
            (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY c.name)
             FROM dbo.adda_routes ar JOIN dbo.cities c ON c.city_id = ar.city_id
             WHERE ar.adda_id = a.adda_id) AS route_city_names
     FROM dbo.addas a
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

async function insert(transaction, adda) {
  const request = requestWithParams(transaction, {
    name: { type: sql.NVarChar(100), value: adda.name },
    details: { type: sql.NVarChar(200), value: adda.details ?? null },
  });
  const result = await request.query(
    `INSERT INTO dbo.addas (name, details)
     OUTPUT inserted.adda_id
     VALUES (@name, @details)`,
  );
  return result.recordset[0].adda_id;
}

async function update(transaction, addaId, adda) {
  const request = requestWithParams(transaction, {
    addaId: { type: sql.Int, value: addaId },
    name: { type: sql.NVarChar(100), value: adda.name },
    details: { type: sql.NVarChar(200), value: adda.details ?? null },
  });
  await request.query(
    `UPDATE dbo.addas SET name = @name, details = @details WHERE adda_id = @addaId`,
  );
}

// AD-01: replaces an adda's whole route wholesale (delete-all-then-reinsert — same pattern
// employees.repository.js#replaceTrades uses for a worker's trades). Caller owns the transaction.
async function replaceRoutes(transaction, addaId, cityIds) {
  const delRequest = requestWithParams(transaction, { addaId: { type: sql.Int, value: addaId } });
  await delRequest.query('DELETE FROM dbo.adda_routes WHERE adda_id = @addaId');

  for (const cityId of cityIds) {
    const request = requestWithParams(transaction, {
      addaId: { type: sql.Int, value: addaId },
      cityId: { type: sql.Int, value: cityId },
    });
    await request.query(
      `INSERT INTO dbo.adda_routes (adda_id, city_id) VALUES (@addaId, @cityId)`,
    );
  }
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

module.exports = { list, findById, findByName, insert, update, replaceRoutes, setActive, isReferenced };
