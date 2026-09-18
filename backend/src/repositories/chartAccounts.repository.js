// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// Reserved-account lookup (see src/constants/reservedAccounts.js) — used by posting logic to
// resolve e.g. the SALES account without hardcoding its ac_id anywhere.
async function findByCode(code) {
  const result = await query(
    'SELECT ac_id, code, name, status FROM dbo.chart_of_accounts WHERE code = @code',
    { code: { type: sql.VarChar, value: code } },
  );
  return result.recordset[0] || null;
}

// UC-16 setup screen + every "pick a chart account" dropdown. excludeRestricted hides
// is_restricted rows for a non-ADMIN session (TASK-14); excludeClosed hides CLOSED rows for a
// selection-list caller (milestone8.md: "CLOSED accounts excluded from selection lists") while the
// setup screen itself passes neither, showing everything.
async function list(filters = {}) {
  const conditions = [];
  const params = {};
  if (filters.group_id) {
    conditions.push('ca.group_id = @groupId');
    params.groupId = { type: sql.Int, value: filters.group_id };
  }
  if (filters.excludeRestricted) conditions.push('ca.is_restricted = 0');
  if (filters.excludeClosed) conditions.push("ca.status = 'ACTIVE'");
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT ca.*, ga.code AS group_code, ga.name AS group_name, ga.class_id,
            acl.code AS class_code, acl.name AS class_name,
            CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_accounts ba WHERE ba.ac_id = ca.ac_id)
                 THEN 1 ELSE 0 END AS BIT) AS has_children
     FROM dbo.chart_of_accounts ca
     JOIN dbo.group_accounts ga    ON ga.group_id = ca.group_id
     JOIN dbo.account_classes acl  ON acl.class_id = ga.class_id
     ${where}
     ORDER BY ca.code`,
    params,
  );
  return result.recordset;
}

async function findById(acId) {
  const result = await query(
    `SELECT ca.*, ga.code AS group_code, ga.name AS group_name, ga.class_id,
            acl.code AS class_code, acl.name AS class_name
     FROM dbo.chart_of_accounts ca
     JOIN dbo.group_accounts ga    ON ga.group_id = ca.group_id
     JOIN dbo.account_classes acl  ON acl.class_id = ga.class_id
     WHERE ca.ac_id = @acId`,
    { acId: { type: sql.Int, value: acId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive, scoped to the group — matches CK_chart_of_accounts_code's own
// UNIQUE(group_id, name) (two different groups may legitimately reuse a name, e.g. a generic
// "Miscellaneous" head under both ASSETS and EXPENSES).
async function findByGroupAndName(groupId, name) {
  const result = await query(
    'SELECT * FROM dbo.chart_of_accounts WHERE group_id = @groupId AND LOWER(name) = LOWER(@name)',
    { groupId: { type: sql.Int, value: groupId }, name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

// §3.2: chart code = <parent group's code> + 2-digit serial (6 digits total) — matches the
// majority of already-seeded reserved codes (e.g. group '1000' + '01' = '100001' CUSTOMERS
// ACCOUNTS); see groupAccounts's own nextSerial for the level above.
async function nextSerial(transaction, groupCode) {
  const request = requestWithParams(transaction, {
    groupCode: { type: sql.VarChar(20), value: groupCode },
  });
  const result = await request.query(
    `SELECT MAX(TRY_CAST(RIGHT(code, 2) AS INT)) AS maxSerial
     FROM dbo.chart_of_accounts
     WHERE LEN(code) = 6 AND LEFT(code, LEN(@groupCode)) = @groupCode`,
  );
  return (result.recordset[0].maxSerial || 0) + 1;
}

async function insert(transaction, chart) {
  const request = requestWithParams(transaction, {
    code: { type: sql.VarChar(20), value: chart.code },
    name: { type: sql.NVarChar(100), value: chart.name },
    groupId: { type: sql.Int, value: chart.group_id },
    linkCode: { type: sql.VarChar(20), value: chart.link_code ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.chart_of_accounts (code, name, group_id, link_code)
    OUTPUT inserted.ac_id
    VALUES (@code, @name, @groupId, @linkCode)
  `);
  return result.recordset[0].ac_id;
}

async function update(acId, chart) {
  await query(
    'UPDATE dbo.chart_of_accounts SET name = @name, link_code = @linkCode WHERE ac_id = @acId',
    {
      acId: { type: sql.Int, value: acId },
      name: { type: sql.NVarChar(100), value: chart.name },
      linkCode: { type: sql.VarChar(20), value: chart.link_code ?? null },
    },
  );
}

async function setStatus(acId, status) {
  await query(
    'UPDATE dbo.chart_of_accounts SET status = @status WHERE ac_id = @acId',
    { acId: { type: sql.Int, value: acId }, status: { type: sql.VarChar(10), value: status } },
  );
}

// ACC-02 (changes-14-09-26.md, 2026-09-15): "carries transactions" — any posted ledger row
// against this chart account directly (ac_id), regardless of source type.
async function hasLedgerActivity(acId) {
  const result = await query(
    'SELECT TOP 1 1 AS found FROM dbo.ledger_entries WHERE ac_id = @acId',
    { acId: { type: sql.Int, value: acId } },
  );
  return result.recordset.length > 0;
}

// ACC-02's "child accounts" check for this level of the hierarchy: any business account filed
// under this chart account (ba.ac_id is its parent — see schema.sql's own comment on the column),
// active or closed — unconditional, same as groupAccounts.repository.js#isReferenced.
async function hasChildren(acId) {
  const result = await query(
    'SELECT TOP 1 1 AS found FROM dbo.business_accounts WHERE ac_id = @acId',
    { acId: { type: sql.Int, value: acId } },
  );
  return result.recordset.length > 0;
}

// Permanent delete (per the user, 2026-09-17 — added on top of the existing soft-close, not
// instead of it). `hasChildren`/`hasLedgerActivity` above only ever needed to cover what blocks a
// reversible close; a real `DELETE FROM` has to survive every foreign key in the schema, so this
// also covers `main_ac_id` on sale_bills/draft_sale_bills/stock_vouchers, which neither existing
// guard touches.
async function hasAnyReference(acId) {
  const result = await query(
    `SELECT
       (SELECT TOP 1 1 FROM dbo.business_accounts WHERE ac_id = @acId) AS businessAccount,
       (SELECT TOP 1 1 FROM dbo.ledger_entries WHERE ac_id = @acId) AS ledger,
       (SELECT TOP 1 1 FROM dbo.draft_sale_bills WHERE main_ac_id = @acId) AS draftSaleBill,
       (SELECT TOP 1 1 FROM dbo.sale_bills WHERE main_ac_id = @acId) AS saleBill,
       (SELECT TOP 1 1 FROM dbo.stock_vouchers WHERE main_ac_id = @acId) AS stockVoucher`,
    { acId: { type: sql.Int, value: acId } },
  );
  const row = result.recordset[0];
  return Object.values(row).some((v) => v != null);
}

async function hardDelete(transaction, acId) {
  const request = requestWithParams(transaction, { acId: { type: sql.Int, value: acId } });
  await request.query('DELETE FROM dbo.chart_of_accounts WHERE ac_id = @acId');
}

module.exports = {
  findByCode, list, findById, findByGroupAndName, nextSerial, insert, update, setStatus,
  hasLedgerActivity, hasChildren, hasAnyReference, hardDelete,
};
