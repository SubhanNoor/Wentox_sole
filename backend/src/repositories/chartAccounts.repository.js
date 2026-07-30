// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// Reserved-account lookup (see src/constants/reservedAccounts.js) — used by posting logic to
// resolve e.g. the SALES account without hardcoding its ac_id anywhere.
async function findByCode(code) {
  const result = await query(
    'SELECT ac_id, code, name, status FROM dbo.chart_of_accounts WHERE code = @code',
    { code: { type: sql.VarChar, value: code } },
  );
  return result.recordset[0] || null;
}

module.exports = { findByCode };
