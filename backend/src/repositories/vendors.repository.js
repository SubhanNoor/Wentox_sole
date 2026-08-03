// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// Minimal read used internally by posting logic (needs ba_id for the ledger's VENDOR BA side).
// Full CRUD for the Vendors screen lands in Milestone 7.
async function findById(vendorId) {
  const result = await query(
    'SELECT vendor_id, name, ba_id, region_id, city_id FROM dbo.vendors WHERE vendor_id = @vendorId',
    { vendorId: { type: sql.Int, value: vendorId } },
  );
  return result.recordset[0] || null;
}

module.exports = { findById };
