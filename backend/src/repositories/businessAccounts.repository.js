// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// §3.2 allocation rule: serial = MAX(existing serial under that parent) + 1, zero-padded to 4
// digits. A business account's code is its parent chart account's 6-digit code + this serial.
// Takes the caller's transaction — always called immediately before insert() within the same
// withTransaction block (see businessAccounts.service.js), so the serial and the row it names
// are computed and written atomically with whatever party (vendor/customer) it's created for.
async function nextSerial(transaction, chartCode) {
  const request = requestWithParams(transaction, {
    chartCode: { type: sql.VarChar(20), value: chartCode },
  });
  const result = await request.query(
    `SELECT MAX(TRY_CAST(RIGHT(code, 4) AS INT)) AS maxSerial
     FROM dbo.business_accounts
     WHERE LEN(code) = 10 AND LEFT(code, 6) = @chartCode`,
  );
  return (result.recordset[0].maxSerial || 0) + 1;
}

async function insert(transaction, ba) {
  const request = requestWithParams(transaction, {
    code: { type: sql.VarChar(20), value: ba.code },
    name: { type: sql.NVarChar(100), value: ba.name },
    acId: { type: sql.Int, value: ba.ac_id },
    regionId: { type: sql.Int, value: ba.region_id ?? null },
    cityId: { type: sql.Int, value: ba.city_id ?? null },
    openingBalance: { type: sql.Decimal(14, 2), value: ba.opening_balance ?? null },
    openingDate: { type: sql.Date, value: ba.opening_date ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.business_accounts (code, name, ac_id, region_id, city_id, opening_balance, opening_date)
    OUTPUT inserted.ba_id
    VALUES (@code, @name, @acId, @regionId, @cityId, @openingBalance, @openingDate)
  `);
  return result.recordset[0].ba_id;
}

async function updateName(baId, name) {
  await query(
    'UPDATE dbo.business_accounts SET name = @name WHERE ba_id = @baId',
    { baId: { type: sql.Int, value: baId }, name: { type: sql.NVarChar(100), value: name } },
  );
}

async function findById(baId) {
  const result = await query(
    'SELECT * FROM dbo.business_accounts WHERE ba_id = @baId',
    { baId: { type: sql.Int, value: baId } },
  );
  return result.recordset[0] || null;
}

// Read-only listing for pickers that need "any business account" (e.g. Expenses' non-vendor
// payment target, Cheques' EXPENSE_PAYMENT disposition) — dedicated party lists (vendors,
// bankAccounts) already cover their own kind; this is the generic fallback for everything else.
async function list(filters = {}) {
  const conditions = [`ba.status = @status`];
  const params = { status: { type: sql.VarChar(10), value: filters.status || 'ACTIVE' } };

  if (filters.ac_id) {
    conditions.push('ba.ac_id = @acId');
    params.acId = { type: sql.Int, value: filters.ac_id };
  }
  if (filters.search) {
    conditions.push('ba.name LIKE @search');
    params.search = { type: sql.NVarChar(100), value: `%${filters.search}%` };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await query(
    `SELECT ba.*, ca.code AS chart_code, ca.name AS chart_name
     FROM dbo.business_accounts ba
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     ${where}
     ORDER BY ba.name`,
    params,
  );
  return result.recordset;
}

module.exports = { nextSerial, insert, updateName, findById, list };
