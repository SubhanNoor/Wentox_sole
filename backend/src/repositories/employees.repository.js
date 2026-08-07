// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = filters.includeInactive ? [] : ['e.is_active = 1'];
  const params = {};

  if (filters.employee_type) {
    conditions.push('e.employee_type = @employeeType');
    params.employeeType = { type: sql.VarChar(10), value: filters.employee_type };
  }
  if (filters.search) {
    conditions.push('e.name LIKE @search');
    params.search = { type: sql.NVarChar(100), value: `%${filters.search}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT e.*, c.name AS city_name,
       (SELECT STRING_AGG(ws.stage_key, ',') WITHIN GROUP (ORDER BY s.sort_order)
        FROM dbo.worker_stages ws JOIN dbo.stages s ON s.stage_key = ws.stage_key
        WHERE ws.employee_id = e.employee_id) AS stage_keys
     FROM dbo.employees e
     LEFT JOIN dbo.cities c ON c.city_id = e.city_id
     ${where}
     ORDER BY e.name`,
    params,
  );
  return result.recordset;
}

async function findById(employeeId) {
  const result = await query(
    `SELECT e.*, c.name AS city_name
     FROM dbo.employees e
     LEFT JOIN dbo.cities c ON c.city_id = e.city_id
     WHERE e.employee_id = @employeeId`,
    { employeeId: { type: sql.Int, value: employeeId } },
  );
  const employee = result.recordset[0];
  if (!employee) return null;

  if (employee.employee_type === 'WORKER') {
    const trades = await query(
      `SELECT ws.stage_key, s.form_label, s.worker_label
       FROM dbo.worker_stages ws
       JOIN dbo.stages s ON s.stage_key = ws.stage_key
       WHERE ws.employee_id = @employeeId
       ORDER BY s.sort_order`,
      { employeeId: { type: sql.Int, value: employeeId } },
    );
    return { ...employee, stages: trades.recordset };
  }
  return employee;
}

// Two employees CAN share a name (two different people named "Ali") — match key is name+phone,
// case-insensitive on name (explicit LOWER()), NULL-safe on phone, same shape as vendors.
async function findByNameAndPhone(name, phone) {
  const result = await query(
    `SELECT * FROM dbo.employees
     WHERE LOWER(name) = LOWER(@name)
       AND ((phone IS NULL AND @phone IS NULL) OR phone = @phone)`,
    {
      name: { type: sql.NVarChar(100), value: name },
      phone: { type: sql.VarChar(30), value: phone ?? null },
    },
  );
  return result.recordset[0] || null;
}

// Takes the caller's transaction — always called in the same withTransaction block as the
// business_accounts row it links to (employees.service.js:create()), same pattern as vendors.
async function insert(transaction, employee) {
  const request = requestWithParams(transaction, {
    name: { type: sql.NVarChar(100), value: employee.name },
    phone: { type: sql.VarChar(30), value: employee.phone ?? null },
    cityId: { type: sql.Int, value: employee.city_id ?? null },
    employeeType: { type: sql.VarChar(10), value: employee.employee_type },
    monthlySalary: { type: sql.Decimal(12, 2), value: employee.monthly_salary ?? null },
    baId: { type: sql.Int, value: employee.ba_id ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.employees (name, phone, city_id, employee_type, monthly_salary, ba_id)
    OUTPUT inserted.employee_id
    VALUES (@name, @phone, @cityId, @employeeType, @monthlySalary, @baId)
  `);
  return result.recordset[0].employee_id;
}

// Takes the caller's transaction — always called alongside replaceTrades() in the same
// withTransaction block (employees.service.js:update()), so a WORKER's rename and trade-set
// change commit or roll back together. employee_type is never in this SET clause — immutable
// after creation (payroll.md §7), enforced in employees.service.js:update() before this ever runs.
async function update(transaction, employeeId, employee) {
  const request = requestWithParams(transaction, {
    employeeId: { type: sql.Int, value: employeeId },
    name: { type: sql.NVarChar(100), value: employee.name },
    phone: { type: sql.VarChar(30), value: employee.phone ?? null },
    cityId: { type: sql.Int, value: employee.city_id ?? null },
    monthlySalary: { type: sql.Decimal(12, 2), value: employee.monthly_salary ?? null },
  });
  await request.query(`
    UPDATE dbo.employees SET
      name = @name, phone = @phone, city_id = @cityId, monthly_salary = @monthlySalary
    WHERE employee_id = @employeeId
  `);
}

async function setActive(employeeId, isActive) {
  await query(
    'UPDATE dbo.employees SET is_active = @isActive WHERE employee_id = @employeeId',
    { employeeId: { type: sql.Int, value: employeeId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

// Replaces a WORKER's trade set wholesale (delete-all-then-reinsert — simplest correct way to
// reconcile an arbitrary add/remove set, and cheap: at most 12 rows). Removing a trade does NOT
// touch history — wage_runs.stage_key is its own FK straight to dbo.stages, not through this
// table, so a dropped trade never invalidates a run already posted under it (payroll.md §5 note).
async function replaceTrades(transaction, employeeId, stageKeys) {
  const delRequest = requestWithParams(transaction, { employeeId: { type: sql.Int, value: employeeId } });
  await delRequest.query('DELETE FROM dbo.worker_stages WHERE employee_id = @employeeId');

  for (const stageKey of stageKeys) {
    const request = requestWithParams(transaction, {
      employeeId: { type: sql.Int, value: employeeId },
      stageKey: { type: sql.VarChar(20), value: stageKey },
    });
    await request.query(
      `INSERT INTO dbo.worker_stages (employee_id, stage_key) VALUES (@employeeId, @stageKey)`,
    );
  }
}

module.exports = {
  list, findById, findByNameAndPhone, insert, update, setActive, replaceTrades,
};
