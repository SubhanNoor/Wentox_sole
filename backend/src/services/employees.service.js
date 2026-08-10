// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/employees.repository');
const stagesRepository = require('../repositories/stages.repository');
const businessAccountsService = require('./businessAccounts.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

// employeeType is passed in explicitly (not read off payload) so update() can validate against
// the EXISTING type, never the payload's — employee_type itself is checked for immutability
// separately, before this ever runs.
async function validate(payload, employeeType) {
  if (!payload.name || !payload.name.trim()) throw ApiError.badRequest('name is required');
  if (employeeType !== 'WORKER' && employeeType !== 'SALARIED') {
    throw ApiError.badRequest("employee_type must be 'WORKER' or 'SALARIED'");
  }

  if (employeeType === 'SALARIED') {
    if (payload.monthly_salary === undefined || payload.monthly_salary === null || payload.monthly_salary < 0) {
      throw ApiError.badRequest('monthly_salary is required for a salaried employee');
    }
  } else {
    const stages = payload.stages || [];
    if (!stages.length) throw ApiError.badRequest('a worker requires at least one trade');
    if (new Set(stages).size !== stages.length) {
      // Would otherwise hit PK_worker_stages(employee_id, stage_key) in replaceTrades() and
      // surface as a raw SQL error instead of a clean 400.
      throw ApiError.badRequest('duplicate stage_key in stages');
    }
    const validKeys = new Set((await stagesRepository.list()).map((s) => s.stage_key));
    for (const key of stages) {
      if (!validKeys.has(key)) throw ApiError.badRequest(`unknown stage_key: ${key}`);
    }
  }
}

function list(filters) {
  return repository.list(filters);
}

async function getById(employeeId) {
  const employee = await repository.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

// payroll.md §2/§6: WORKER links under WORKER WAGES (220001), SALARIED under SALARIES PAYABLE
// (220002) — both LIABILITY heads, since baqaya/net-balance is a debt, not an expense. Same
// transaction-safety pattern as vendors/customers/bankAccounts: BA + employee row commit or roll
// back together.
async function create(payload) {
  const employeeType = payload.employee_type;
  await validate(payload, employeeType);
  const name = payload.name.trim();

  // Case-insensitive name+phone collision (not name alone — two different people can share a
  // name). ACTIVE match blocks; INACTIVE match offers reactivate — same pattern as vendors.
  const phone = payload.phone ?? null;
  const existing = await repository.findByNameAndPhone(name, phone);
  if (existing) {
    if (existing.is_active) {
      throw ApiError.conflict('An employee with this name and phone already exists', 'DUPLICATE_NAME');
    }
    throw ApiError.conflict(
      'An inactive employee with this name and phone already exists',
      'INACTIVE_DUPLICATE',
      { employee_id: existing.employee_id, name: existing.name, phone: existing.phone },
    );
  }

  const chartCode = employeeType === 'WORKER' ? CODES.WORKER_WAGES : CODES.SALARIES_PAYABLE;

  // Opening balance belongs to the auto-created business account (same as bankAccounts.service.js).
  // Validated before the transaction opens so a mismatched pair fails as a clean 400.
  const opening = businessAccountsService.validateOpeningPair(payload);

  const id = await withTransaction(async (transaction) => {
    const baId = await businessAccountsService.createUnderChartCode(transaction, chartCode, name, {
      city_id: payload.city_id ?? null,
      ...opening,
    });
    const employeeId = await repository.insert(transaction, {
      name,
      phone,
      city_id: payload.city_id ?? null,
      employee_type: employeeType,
      monthly_salary: employeeType === 'SALARIED' ? payload.monthly_salary : null,
      ba_id: baId,
    });
    if (employeeType === 'WORKER') {
      await repository.replaceTrades(transaction, employeeId, payload.stages);
    }
    return employeeId;
  });

  const created = await getById(id);
  // The business account was created inside the transaction above with its opening balance stored;
  // its derived OPENING ledger pair is written after the commit (see syncOpeningEntries' own note).
  if (created.ba_id) await businessAccountsService.syncOpeningEntries(created.ba_id);
  return created;
}

// employee_type is immutable (payroll.md §7) — changing it would strand ba_id under the wrong
// head and orphan trades/salary history, so a type change is rejected outright rather than
// silently applied or ignored.
async function update(employeeId, payload) {
  const existing = await getById(employeeId);
  if (payload.employee_type && payload.employee_type !== existing.employee_type) {
    throw ApiError.badRequest('employee_type cannot be changed after creation', 'TYPE_IMMUTABLE');
  }

  await validate(payload, existing.employee_type);
  const name = payload.name.trim();

  const phone = payload.phone ?? null;
  const duplicate = await repository.findByNameAndPhone(name, phone);
  if (duplicate && duplicate.employee_id !== employeeId) {
    throw ApiError.conflict('An employee with this name and phone already exists', 'DUPLICATE_NAME');
  }

  await withTransaction(async (transaction) => {
    await repository.update(transaction, employeeId, {
      name,
      phone,
      city_id: payload.city_id ?? null,
      monthly_salary: existing.employee_type === 'SALARIED' ? payload.monthly_salary : null,
    });
    if (existing.employee_type === 'WORKER') {
      await repository.replaceTrades(transaction, employeeId, payload.stages);
    }
  });

  if (existing.ba_id && name !== existing.name) {
    await businessAccountsService.renameLinked(existing.ba_id, name);
  }
  // The opening balance lives on the linked business account, not on this row.
  if (existing.ba_id) await businessAccountsService.setOpening(existing.ba_id, payload);

  return getById(employeeId);
}

// Soft delete — is_active = 0, never a hard DELETE (wage_run/salary_run items reference this row
// historically). The linked business_accounts row stays ACTIVE for ledger/history integrity.
async function remove(employeeId) {
  await getById(employeeId);
  await repository.setActive(employeeId, false);
  return { ok: true };
}

async function reactivate(employeeId) {
  const employee = await repository.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  await repository.setActive(employeeId, true);
  return getById(employeeId);
}

module.exports = { list, getById, create, update, remove, reactivate };
