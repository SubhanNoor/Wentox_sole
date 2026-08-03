// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['c.is_active = 1'];
  const params = {};

  if (filters.region_id) {
    conditions.push('c.region_id = @regionId');
    params.regionId = { type: sql.Int, value: filters.region_id };
  }
  if (filters.city_id) {
    conditions.push('c.city_id = @cityId');
    params.cityId = { type: sql.Int, value: filters.city_id };
  }
  if (filters.search) {
    conditions.push('c.name LIKE @search');
    params.search = { type: sql.NVarChar(150), value: `%${filters.search}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Region first, City second (§11 primary/secondary search key — UC-09).
  const result = await query(
    `SELECT c.*, r.name AS region_name, ci.name AS city_name
     FROM dbo.customers c
     JOIN dbo.regions r ON r.region_id = c.region_id
     LEFT JOIN dbo.cities ci ON ci.city_id = c.city_id
     ${where}
     ORDER BY r.name, ci.name, c.name`,
    params,
  );
  return result.recordset;
}

async function findById(customerId) {
  const result = await query(
    `SELECT c.*, r.name AS region_name, ci.name AS city_name
     FROM dbo.customers c
     JOIN dbo.regions r ON r.region_id = c.region_id
     LEFT JOIN dbo.cities ci ON ci.city_id = c.city_id
     WHERE c.customer_id = @customerId`,
    { customerId: { type: sql.Int, value: customerId } },
  );
  return result.recordset[0] || null;
}

async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.customers WHERE name = @name',
    { name: { type: sql.NVarChar(150), value: name } },
  );
  return result.recordset[0] || null;
}

// Takes the caller's transaction — always called in the same withTransaction block as the
// business_accounts row it links to (customers.service.js:create()), so the customer and its
// ledger account commit or roll back together (never an orphaned business_accounts row).
async function insert(transaction, customer) {
  const request = requestWithParams(transaction, {
    name: { type: sql.NVarChar(150), value: customer.name },
    baId: { type: sql.Int, value: customer.ba_id ?? null },
    regionId: { type: sql.Int, value: customer.region_id },
    cityId: { type: sql.Int, value: customer.city_id ?? null },
    phone: { type: sql.VarChar(30), value: customer.phone ?? null },
    address: { type: sql.NVarChar(200), value: customer.address ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.customers (name, ba_id, region_id, city_id, phone, address)
    OUTPUT inserted.customer_id
    VALUES (@name, @baId, @regionId, @cityId, @phone, @address)
  `);
  return result.recordset[0].customer_id;
}

async function update(customerId, customer) {
  await query(
    `UPDATE dbo.customers SET
       name = @name, region_id = @regionId, city_id = @cityId, phone = @phone, address = @address
     WHERE customer_id = @customerId`,
    {
      customerId: { type: sql.Int, value: customerId },
      name: { type: sql.NVarChar(150), value: customer.name },
      regionId: { type: sql.Int, value: customer.region_id },
      cityId: { type: sql.Int, value: customer.city_id ?? null },
      phone: { type: sql.VarChar(30), value: customer.phone ?? null },
      address: { type: sql.NVarChar(200), value: customer.address ?? null },
    },
  );
}

async function setActive(customerId, isActive) {
  await query(
    'UPDATE dbo.customers SET is_active = @isActive WHERE customer_id = @customerId',
    { customerId: { type: sql.Int, value: customerId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
