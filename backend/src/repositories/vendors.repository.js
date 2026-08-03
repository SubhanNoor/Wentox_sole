// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['v.is_active = 1'];
  const params = {};

  if (filters.search) {
    conditions.push('v.name LIKE @search');
    params.search = { type: sql.NVarChar(100), value: `%${filters.search}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT v.*, r.name AS region_name, c.name AS city_name
     FROM dbo.vendors v
     LEFT JOIN dbo.regions r ON r.region_id = v.region_id
     LEFT JOIN dbo.cities c ON c.city_id = v.city_id
     ${where}
     ORDER BY v.name`,
    params,
  );
  return result.recordset;
}

async function findById(vendorId) {
  const result = await query(
    `SELECT v.*, r.name AS region_name, c.name AS city_name
     FROM dbo.vendors v
     LEFT JOIN dbo.regions r ON r.region_id = v.region_id
     LEFT JOIN dbo.cities c ON c.city_id = v.city_id
     WHERE v.vendor_id = @vendorId`,
    { vendorId: { type: sql.Int, value: vendorId } },
  );
  return result.recordset[0] || null;
}

async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.vendors WHERE name = @name',
    { name: { type: sql.NVarChar(100), value: name } },
  );
  return result.recordset[0] || null;
}

// Takes the caller's transaction — always called in the same withTransaction block as the
// business_accounts row it links to (vendors.service.js:create()), so the vendor and its ledger
// account commit or roll back together (never an orphaned business_accounts row with no vendor).
async function insert(transaction, vendor) {
  const request = requestWithParams(transaction, {
    name: { type: sql.NVarChar(100), value: vendor.name },
    phone: { type: sql.VarChar(30), value: vendor.phone ?? null },
    address: { type: sql.NVarChar(200), value: vendor.address ?? null },
    regionId: { type: sql.Int, value: vendor.region_id ?? null },
    cityId: { type: sql.Int, value: vendor.city_id ?? null },
    baId: { type: sql.Int, value: vendor.ba_id ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.vendors (name, phone, address, region_id, city_id, ba_id)
    OUTPUT inserted.vendor_id
    VALUES (@name, @phone, @address, @regionId, @cityId, @baId)
  `);
  return result.recordset[0].vendor_id;
}

async function update(vendorId, vendor) {
  await query(
    `UPDATE dbo.vendors SET
       name = @name, phone = @phone, address = @address, region_id = @regionId, city_id = @cityId
     WHERE vendor_id = @vendorId`,
    {
      vendorId: { type: sql.Int, value: vendorId },
      name: { type: sql.NVarChar(100), value: vendor.name },
      phone: { type: sql.VarChar(30), value: vendor.phone ?? null },
      address: { type: sql.NVarChar(200), value: vendor.address ?? null },
      regionId: { type: sql.Int, value: vendor.region_id ?? null },
      cityId: { type: sql.Int, value: vendor.city_id ?? null },
    },
  );
}

async function setActive(vendorId, isActive) {
  await query(
    'UPDATE dbo.vendors SET is_active = @isActive WHERE vendor_id = @vendorId',
    { vendorId: { type: sql.Int, value: vendorId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
