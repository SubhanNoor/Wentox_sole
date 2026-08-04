// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/salaryRuns.repository');
const employeesRepository = require('../repositories/employees.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');

// "Pick the month" — the screen only ever asks for a month, so any date given is truncated to
// its first-of-month, matching CK_salary_runs_month (DAY(period_month) = 1) without making the
// caller get the day right.
function normalizeMonth(dateStr) {
  if (!dateStr) throw ApiError.badRequest('period_month is required');
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('period_month is not a valid date');
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return first.toISOString().slice(0, 10);
}

function validateHeader(payload) {
  if (!payload.run_date) throw ApiError.badRequest('run_date is required');
}

// Builds one line per ACTIVE salaried employee, server-authoritative — the caller never has to
// (and can't) hand-pick the roster, only override specific lines. salary_amount is ALWAYS a fresh
// snapshot of employees.monthly_salary (payroll.md §11: "no" under Editable) — never trusted from
// the payload. amount defaults to salary_amount unless overrides supplies one for that employee_id
// (payroll.md §11: "yes, pre-filled from salary_amount").
async function buildLines(overrides = []) {
  const overrideByEmployee = new Map(overrides.map((o) => [o.employee_id, o]));
  const employees = await employeesRepository.list({ employee_type: 'SALARIED' });

  return employees.map((employee) => {
    const override = overrideByEmployee.get(employee.employee_id);
    const salaryAmount = employee.monthly_salary;
    const amount = override && override.amount !== undefined && override.amount !== null
      ? override.amount
      : salaryAmount;
    return {
      employee_id: employee.employee_id,
      ba_id: employee.ba_id,
      salary_amount: salaryAmount,
      amount,
      remarks: override ? override.remarks ?? null : null,
    };
  });
}

function buildTotal(lines) {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

function list(filters) {
  return repository.list(filters);
}

async function getById(salaryRunId) {
  const run = await repository.findById(salaryRunId);
  if (!run) throw ApiError.notFound('Salary run not found');
  return run;
}

// One CONFIRMED run per month — checked here for a clean conflict (with the existing run's id in
// `details` so the frontend can "offer to open it") ahead of UQ_salary_runs_month, which only
// fires at the DB level and only at post() time (DRAFTs are unconstrained by design — payroll.md
// §11: "a correction can be built alongside").
async function assertMonthNotConfirmed(periodMonth) {
  const existing = await repository.findConfirmedByMonth(periodMonth);
  if (existing) {
    throw ApiError.conflict(
      'This month already has a confirmed salary run',
      'MONTH_ALREADY_CONFIRMED',
      { salary_run_id: existing.salary_run_id },
    );
  }
}

// Always created DRAFT — post() is the only thing that moves money. Every active salaried
// employee gets a line automatically; a normal month needs no `overrides` at all.
async function create(payload, userId) {
  const periodMonth = normalizeMonth(payload.period_month);
  validateHeader(payload);
  await assertMonthNotConfirmed(periodMonth);

  const lines = await buildLines(payload.overrides);
  if (!lines.length) throw ApiError.badRequest('there are no active salaried employees to include in this run');
  const totalAmount = buildTotal(lines);

  const id = await withTransaction(async (transaction) => {
    const salaryRunId = await repository.insert(transaction, {
      period_month: periodMonth,
      run_date: payload.run_date,
      total_amount: totalAmount,
      created_by: userId,
    });
    await repository.insertItems(transaction, salaryRunId, lines);
    return salaryRunId;
  });

  return getById(id);
}

// DRAFT-only — a CONFIRMED run is never edited in place (payroll.md §8: unpost first). The roster
// is rebuilt fresh from the CURRENT active-salaried-employee list and CURRENT monthly_salary
// figures, same "fresh statement of what happened" reasoning as wage runs.
async function update(salaryRunId, payload, userId) {
  const existing = await getById(salaryRunId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the salary run before editing', 'POSTED_LOCK');
  }

  const periodMonth = normalizeMonth(payload.period_month);
  validateHeader(payload);
  if (periodMonth !== existing.period_month.toISOString().slice(0, 10)) {
    await assertMonthNotConfirmed(periodMonth);
  }

  const lines = await buildLines(payload.overrides);
  if (!lines.length) throw ApiError.badRequest('there are no active salaried employees to include in this run');
  const totalAmount = buildTotal(lines);

  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, salaryRunId, {
      period_month: periodMonth,
      run_date: payload.run_date,
      total_amount: totalAmount,
      updated_by: userId,
    });
    await repository.deleteItems(transaction, salaryRunId);
    await repository.insertItems(transaction, salaryRunId, lines);
  });

  return getById(salaryRunId);
}

// DRAFT-only — a CONFIRMED run contributes to every salaried employee's balance.
async function remove(salaryRunId) {
  const existing = await getById(salaryRunId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the salary run before deleting', 'POSTED_LOCK');
  }
  await repository.remove(salaryRunId);
  return { ok: true };
}

// Post: Dr SALARIES EXPENSE (410002) / Cr each employee's own ba_id, one credit per line
// (payroll.md §6/§11).
async function post(salaryRunId, userId) {
  const run = await getById(salaryRunId);
  if (run.status === 'CONFIRMED') {
    throw ApiError.conflict('Salary run is already posted', 'ALREADY_POSTED');
  }
  await assertMonthNotConfirmed(run.period_month.toISOString().slice(0, 10));

  for (const item of run.items) {
    if (!item.employee_ba_id) {
      throw ApiError.conflict(
        `Employee "${item.employee_name}" has no linked account yet — add one before posting`,
        'NO_EMPLOYEE_ACCOUNT',
      );
    }
  }

  const salariesExpenseAccount = await chartAccountsRepository.findByCode(CODES.SALARIES_EXPENSE);
  if (!salariesExpenseAccount) {
    throw new Error(`Reserved chart account SALARIES EXPENSE (code ${CODES.SALARIES_EXPENSE}) not found — run npm run seed`);
  }

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, {
      salaryRunId,
      runDate: run.run_date,
      salariesExpenseAcId: salariesExpenseAccount.ac_id,
      totalAmount: run.total_amount,
      lines: run.items.map((item) => ({ ba_id: item.employee_ba_id, amount: item.amount })),
    });
    await repository.markPosted(transaction, salaryRunId, userId);
  });

  return getById(salaryRunId);
}

async function unpost(salaryRunId, userId) {
  const run = await getById(salaryRunId);
  if (run.status !== 'CONFIRMED') {
    throw ApiError.conflict('Salary run is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, salaryRunId);
    await repository.markUnposted(transaction, salaryRunId, userId, run.total_amount);
  });

  return getById(salaryRunId);
}

module.exports = { list, getById, create, update, remove, post, unpost };
