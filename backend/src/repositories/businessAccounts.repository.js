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

// Resolves a reserved chart account's single linked business account (e.g. Cash, seeded once
// under CASH_IN_HAND — see db/seeds/run.js#ensureCashBusinessAccount) by its parent ac_id, rather
// than a hardcoded ba_id.
async function findByAcId(acId) {
  const result = await query(
    'SELECT * FROM dbo.business_accounts WHERE ac_id = @acId',
    { acId: { type: sql.Int, value: acId } },
  );
  return result.recordset[0] || null;
}

// UC-17 setup screen. excludeRestrictedParent hides rows whose parent chart account is
// is_restricted (Cash at Banks / Directors Drawings, TASK-14) for a non-ADMIN session;
// excludeClosed hides CLOSED rows for an expense-head selection-list caller (milestone8.md).
async function list(filters = {}) {
  const conditions = [];
  const params = {};
  if (filters.ac_id) {
    conditions.push('ba.ac_id = @acId');
    params.acId = { type: sql.Int, value: filters.ac_id };
  }
  if (filters.excludeRestrictedParent) conditions.push('ca.is_restricted = 0');
  if (filters.excludeClosed) conditions.push("ba.status = 'ACTIVE'");
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT ba.*, ca.code AS ac_code, ca.name AS ac_name, ca.is_restricted, r.name AS region_name,
            ci.name AS city_name
     FROM dbo.business_accounts ba
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     LEFT JOIN dbo.regions r       ON r.region_id = ba.region_id
     LEFT JOIN dbo.cities ci       ON ci.city_id = ba.city_id
     ${where}
     ORDER BY ba.code`,
    params,
  );
  return result.recordset;
}

// findById() joined with is_restricted so getById() can enforce the same TASK-14 hiding as list().
async function findByIdWithRestriction(baId) {
  const result = await query(
    `SELECT ba.*, ca.is_restricted
     FROM dbo.business_accounts ba
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     WHERE ba.ba_id = @baId`,
    { baId: { type: sql.Int, value: baId } },
  );
  return result.recordset[0] || null;
}

async function update(baId, ba) {
  await query(
    `UPDATE dbo.business_accounts SET name = @name, region_id = @regionId, city_id = @cityId
     WHERE ba_id = @baId`,
    {
      baId: { type: sql.Int, value: baId },
      name: { type: sql.NVarChar(100), value: ba.name },
      regionId: { type: sql.Int, value: ba.region_id ?? null },
      cityId: { type: sql.Int, value: ba.city_id ?? null },
    },
  );
}

async function setStatus(baId, status) {
  await query(
    'UPDATE dbo.business_accounts SET status = @status WHERE ba_id = @baId',
    { baId: { type: sql.Int, value: baId }, status: { type: sql.VarChar(10), value: status } },
  );
}

// UC-17's own screen never owns a party-linked business account (vendor/customer/employee/bank
// each auto-create their own via createUnderChartCode — see UC-08/09) — closing one of those out
// from under its owning party here would silently break that party's own accounting, so it's
// blocked in favor of the owning entity's own setup screen.
async function isPartyLinked(baId) {
  const result = await query(
    `SELECT
       (SELECT 1 FROM dbo.vendors WHERE ba_id = @baId) AS v,
       (SELECT 1 FROM dbo.customers WHERE ba_id = @baId) AS c,
       (SELECT 1 FROM dbo.employees WHERE ba_id = @baId) AS e,
       (SELECT 1 FROM dbo.bank_accounts WHERE ba_id = @baId) AS b`,
    { baId: { type: sql.Int, value: baId } },
  );
  const row = result.recordset[0];
  return Boolean(row.v || row.c || row.e || row.b);
}

module.exports = {
  nextSerial, insert, updateName, findById, findByAcId, list, findByIdWithRestriction, update,
  setStatus, isPartyLinked,
};
