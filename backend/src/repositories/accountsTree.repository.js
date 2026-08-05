// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { query } = require('../db/pool');

// milestone8.md "accounts:tree" — Class → Group → Chart → Business in one pass (LEFT JOINs all
// the way down, since a chart account like SALES/PURCHASES has no business accounts under it at
// all, and a fresh group can have zero chart accounts yet). The service assembles the nesting;
// this just returns the flat, already-joined rows.
async function treeRows() {
  const result = await query(`
    SELECT
      acl.class_id, acl.code AS class_code, acl.name AS class_name,
      ga.group_id, ga.code AS group_code, ga.name AS group_name,
      ca.ac_id, ca.code AS ac_code, ca.name AS ac_name, ca.status AS ac_status, ca.is_restricted,
      ba.ba_id, ba.code AS ba_code, ba.name AS ba_name, ba.status AS ba_status
    FROM dbo.account_classes acl
    JOIN dbo.group_accounts ga     ON ga.class_id = acl.class_id AND ga.is_active = 1
    LEFT JOIN dbo.chart_of_accounts ca ON ca.group_id = ga.group_id
    LEFT JOIN dbo.business_accounts ba ON ba.ac_id = ca.ac_id
    WHERE acl.is_active = 1
    ORDER BY acl.class_id, ga.code, ca.code, ba.code
  `);
  return result.recordset;
}

module.exports = { treeRows };
