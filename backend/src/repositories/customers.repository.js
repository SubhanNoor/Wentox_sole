// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// Minimal read used internally by posting logic (needs ba_id for the ledger's CUSTOMER BA side).
// Full CRUD for the Customers screen lands in Milestone 7.
async function findById(customerId) {
  const result = await query(
    'SELECT customer_id, name, ba_id, region_id, city_id FROM dbo.customers WHERE customer_id = @customerId',
    { customerId: { type: sql.Int, value: customerId } },
  );
  return result.recordset[0] || null;
}

module.exports = { findById };
