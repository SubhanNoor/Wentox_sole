// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

async function list() {
  const result = await query('SELECT * FROM dbo.account_classes WHERE is_active = 1 ORDER BY class_id');
  return result.recordset;
}

async function findById(classId) {
  const result = await query(
    'SELECT * FROM dbo.account_classes WHERE class_id = @classId',
    { classId: { type: sql.Int, value: classId } },
  );
  return result.recordset[0] || null;
}

module.exports = { list, findById };
