// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
// UC-10: sub-customers are independent — no parent customer link, no linked business account.
// region_id (required)/city_id (optional) added post-v4.3 so Sale Bill/Sale Return can narrow
// the "deliver to" dropdown to the selected customer's region.
const { sql, query } = require('../db/pool');

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['sc.is_active = 1'];
  const params = {};

  if (filters.region_id) {
    conditions.push('sc.region_id = @regionId');
    params.regionId = { type: sql.Int, value: filters.region_id };
  }
  if (filters.search) {
    conditions.push('sc.name LIKE @search');
    params.search = { type: sql.NVarChar(150), value: `%${filters.search}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT sc.*, r.name AS region_name, ci.name AS city_name
     FROM dbo.sub_customers sc
     JOIN dbo.regions r ON r.region_id = sc.region_id
     LEFT JOIN dbo.cities ci ON ci.city_id = sc.city_id
     ${where}
     ORDER BY sc.name`,
    params,
  );
  return result.recordset;
}

async function findById(subCustomerId) {
  const result = await query(
    `SELECT sc.*, r.name AS region_name, ci.name AS city_name
     FROM dbo.sub_customers sc
     JOIN dbo.regions r ON r.region_id = sc.region_id
     LEFT JOIN dbo.cities ci ON ci.city_id = sc.city_id
     WHERE sc.sub_customer_id = @subCustomerId`,
    { subCustomerId: { type: sql.Int, value: subCustomerId } },
  );
  return result.recordset[0] || null;
}

async function findByName(name) {
  const result = await query(
    'SELECT * FROM dbo.sub_customers WHERE name = @name',
    { name: { type: sql.NVarChar(150), value: name } },
  );
  return result.recordset[0] || null;
}

async function insert(subCustomer) {
  const result = await query(
    `INSERT INTO dbo.sub_customers (name, region_id, city_id, address)
     OUTPUT inserted.sub_customer_id
     VALUES (@name, @regionId, @cityId, @address)`,
    {
      name: { type: sql.NVarChar(150), value: subCustomer.name },
      regionId: { type: sql.Int, value: subCustomer.region_id },
      cityId: { type: sql.Int, value: subCustomer.city_id ?? null },
      address: { type: sql.NVarChar(200), value: subCustomer.address ?? null },
    },
  );
  return result.recordset[0].sub_customer_id;
}

async function update(subCustomerId, subCustomer) {
  await query(
    `UPDATE dbo.sub_customers SET
       name = @name, region_id = @regionId, city_id = @cityId, address = @address
     WHERE sub_customer_id = @subCustomerId`,
    {
      subCustomerId: { type: sql.Int, value: subCustomerId },
      name: { type: sql.NVarChar(150), value: subCustomer.name },
      regionId: { type: sql.Int, value: subCustomer.region_id },
      cityId: { type: sql.Int, value: subCustomer.city_id ?? null },
      address: { type: sql.NVarChar(200), value: subCustomer.address ?? null },
    },
  );
}

async function setActive(subCustomerId, isActive) {
  await query(
    'UPDATE dbo.sub_customers SET is_active = @isActive WHERE sub_customer_id = @subCustomerId',
    {
      subCustomerId: { type: sql.Int, value: subCustomerId },
      isActive: { type: sql.Bit, value: isActive },
    },
  );
}

module.exports = { list, findById, findByName, insert, update, setActive };
