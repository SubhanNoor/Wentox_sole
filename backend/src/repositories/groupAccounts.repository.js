// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};
  if (!filters.includeInactive) conditions.push('ga.is_active = 1');
  if (filters.class_id) {
    conditions.push('ga.class_id = @classId');
    params.classId = { type: sql.Int, value: filters.class_id };
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT ga.*, ac.code AS class_code, ac.name AS class_name
     FROM dbo.group_accounts ga
     JOIN dbo.account_classes ac ON ac.class_id = ga.class_id
     ${where}
     ORDER BY ga.code`,
    params,
  );
  return result.recordset;
}

async function findById(groupId) {
  const result = await query(
    'SELECT * FROM dbo.group_accounts WHERE group_id = @groupId',
    { groupId: { type: sql.Int, value: groupId } },
  );
  return result.recordset[0] || null;
}

// Case-insensitive on purpose (explicit LOWER(), not relying on DB collation) — matches every
// other setup entity's duplicate-name lookup (regions/cities/stores/...).
async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.group_accounts WHERE LOWER(name) = LOWER(@name)',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

// §3.2 allocation rule, one level up from businessAccounts.repository.js#nextSerial — serial =
// MAX(existing serial under that class digit) + 1, 3 digits wide (class digit + 3-digit serial =
// the 4-digit group code, e.g. '1' + '001' = '1001').
async function nextSerial(transaction, classDigit) {
  const request = requestWithParams(transaction, {
    classDigit: { type: sql.VarChar(1), value: classDigit },
  });
  const result = await request.query(
    `SELECT MAX(TRY_CAST(RIGHT(code, 3) AS INT)) AS maxSerial
     FROM dbo.group_accounts
     WHERE LEN(code) = 4 AND LEFT(code, 1) = @classDigit`,
  );
  return (result.recordset[0].maxSerial || 0) + 1;
}

async function insert(transaction, group) {
  const request = requestWithParams(transaction, {
    code: { type: sql.VarChar(20), value: group.code },
    name: { type: sql.NVarChar(100), value: group.name },
    classId: { type: sql.Int, value: group.class_id },
    sorting: { type: sql.Int, value: group.sorting ?? 0 },
  });
  const result = await request.query(`
    INSERT INTO dbo.group_accounts (code, name, class_id, sorting)
    OUTPUT inserted.group_id
    VALUES (@code, @name, @classId, @sorting)
  `);
  return result.recordset[0].group_id;
}

async function update(groupId, group) {
  await query(
    'UPDATE dbo.group_accounts SET name = @name, sorting = @sorting WHERE group_id = @groupId',
    {
      groupId: { type: sql.Int, value: groupId },
      name: { type: sql.NVarChar(100), value: group.name },
      sorting: { type: sql.Int, value: group.sorting ?? 0 },
    },
  );
}

async function setActive(groupId, isActive) {
  await query(
    'UPDATE dbo.group_accounts SET is_active = @isActive WHERE group_id = @groupId',
    { groupId: { type: sql.Int, value: groupId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

// UC-15/milestone8.md delete guard: a group with chart accounts still filed under it can't be
// deactivated (would silently orphan their own hierarchy display).
async function isReferenced(groupId) {
  const result = await query(
    'SELECT TOP 1 1 AS found FROM dbo.chart_of_accounts WHERE group_id = @groupId',
    { groupId: { type: sql.Int, value: groupId } },
  );
  return result.recordset.length > 0;
}

module.exports = { list, findById, findByName, nextSerial, insert, update, setActive, isReferenced };
