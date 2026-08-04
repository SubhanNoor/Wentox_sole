// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/wageRuns.repository');
const employeesService = require('./employees.service');
const productsService = require('./products.service');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const CODES = require('../constants/reservedAccounts');
const STAGES = require('../constants/stages');

function validateHeader(payload) {
  if (!payload.employee_id) throw ApiError.badRequest('employee_id is required');
  if (!payload.stage_key) throw ApiError.badRequest('stage_key is required');
  if (!payload.run_date) throw ApiError.badRequest('run_date is required');
}

function validateItemsShape(items) {
  if (!Array.isArray(items) || !items.length) throw ApiError.badRequest('at least one line item is required');
  for (const item of items) {
    if (!item.article_id) throw ApiError.badRequest('article_id is required on every line');
    if (!item.cartons || item.cartons <= 0) throw ApiError.badRequest('cartons must be > 0 on every line');
  }
}

// employee must be a WORKER with this exact trade — the composite FK (employee_id, employee_type)
// backstops this at the DB level, but this gives a clean 400 instead of a raw FK error, and it's
// also what implements "the stage list on create must filter to the chosen worker's trades only"
// (payroll.md §7) — the frontend filters visually, this is the actual enforcement.
async function validateEmployeeStage(employeeId, stageKey) {
  const employee = await employeesService.getById(employeeId);
  if (employee.employee_type !== 'WORKER') {
    throw ApiError.badRequest('wage runs can only be created for a WORKER employee');
  }
  const hasTrade = (employee.stages || []).some((s) => s.stage_key === stageKey);
  if (!hasTrade) {
    throw ApiError.badRequest(`this worker has no trade for stage_key: ${stageKey}`);
  }
  return employee;
}

// Snapshots rate + packing from the article's CURRENT figures at the moment the line is (re-)added
// (payroll.md §8: "Snapshots re-take from the source at the moment the line is (re-)added — an
// edit is a fresh statement of what happened") — never from whatever was on the item before. RATE
// can be overridden by the operator (payroll.md §7: "the operator can type a rate over it"); a
// caller-supplied item.rate wins, otherwise it's the article's own cost for this stage. PACKING is
// never overridable — always the article's own packing, snapshotted, matching the schema comment.
async function resolveLines(stageKey, items) {
  const costColumn = STAGES.find((s) => s.stage_key === stageKey)?.cost_column;
  if (!costColumn) throw ApiError.badRequest(`unknown stage_key: ${stageKey}`);

  const lines = [];
  for (const item of items) {
    const article = await productsService.getById(item.article_id); // 404s if it doesn't exist
    const rate = item.rate !== undefined && item.rate !== null ? item.rate : (article[costColumn] || 0);
    lines.push({
      article_id: item.article_id,
      rate,
      cartons: item.cartons,
      packing: article.packing,
    });
  }
  return lines;
}

function buildTotal(lines) {
  return lines.reduce((sum, line) => sum + line.rate * line.cartons * line.packing, 0);
}

function list(filters) {
  return repository.list(filters);
}

// "That worker's last three runs for the selected stage" (payroll.md §7) — the recent-runs list
// that replaces a duplicate-settlement guard the design deliberately doesn't build.
function recent(employeeId, stageKey) {
  return repository.recentRuns(employeeId, stageKey);
}

async function getById(wageRunId) {
  const run = await repository.findById(wageRunId);
  if (!run) throw ApiError.notFound('Wage run not found');
  return run;
}

// Always created DRAFT — post() is the only thing that moves money, same shape as
// transfers/purchases. A rate of 0 is allowed but not blocked (payroll.md §7: "it does not block
// posting" — the frontend flags it, this layer doesn't reject it).
async function create(payload, userId) {
  validateHeader(payload);
  validateItemsShape(payload.items);
  await validateEmployeeStage(payload.employee_id, payload.stage_key);

  const lines = await resolveLines(payload.stage_key, payload.items);
  const totalAmount = buildTotal(lines);

  const id = await withTransaction(async (transaction) => {
    const wageRunId = await repository.insert(transaction, {
      employee_id: payload.employee_id,
      stage_key: payload.stage_key,
      run_date: payload.run_date,
      total_amount: totalAmount,
      created_by: userId,
    });
    await repository.insertItems(transaction, wageRunId, lines);
    return wageRunId;
  });

  return getById(id);
}

// DRAFT-only — a CONFIRMED run is never edited in place (payroll.md §8: unpost first). Lines are
// always fully re-resolved (delete-all-then-reinsert), never patched — same "fresh statement of
// what happened" reasoning as the rate/packing snapshot rule.
async function update(wageRunId, payload, userId) {
  const existing = await getById(wageRunId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the wage run before editing', 'POSTED_LOCK');
  }

  validateHeader(payload);
  validateItemsShape(payload.items);
  await validateEmployeeStage(payload.employee_id, payload.stage_key);

  const lines = await resolveLines(payload.stage_key, payload.items);
  const totalAmount = buildTotal(lines);

  await withTransaction(async (transaction) => {
    await repository.updateHeader(transaction, wageRunId, {
      employee_id: payload.employee_id,
      stage_key: payload.stage_key,
      run_date: payload.run_date,
      total_amount: totalAmount,
      updated_by: userId,
    });
    await repository.deleteItems(transaction, wageRunId);
    await repository.insertItems(transaction, wageRunId, lines);
  });

  return getById(wageRunId);
}

// DRAFT-only — a CONFIRMED run contributes to the worker's balance, so deleting it would silently
// move that balance (payroll.md §8).
async function remove(wageRunId) {
  const existing = await getById(wageRunId);
  if (existing.status === 'CONFIRMED') {
    throw ApiError.conflict('Unpost the wage run before deleting', 'POSTED_LOCK');
  }
  await repository.remove(wageRunId);
  return { ok: true };
}

// Post: Dr WAGES EXPENSE (410001) / Cr worker's ba_id, source_type='WAGE_RUN' (payroll.md §6).
async function post(wageRunId, userId) {
  const run = await getById(wageRunId);
  if (run.status === 'CONFIRMED') {
    throw ApiError.conflict('Wage run is already posted', 'ALREADY_POSTED');
  }

  const employee = await employeesService.getById(run.employee_id);
  if (!employee.ba_id) {
    throw ApiError.conflict('Worker has no linked account yet — add one before posting', 'NO_WORKER_ACCOUNT');
  }

  const wagesExpenseAccount = await chartAccountsRepository.findByCode(CODES.WAGES_EXPENSE);
  if (!wagesExpenseAccount) {
    throw new Error(`Reserved chart account WAGES EXPENSE (code ${CODES.WAGES_EXPENSE}) not found — run npm run seed`);
  }

  await withTransaction(async (transaction) => {
    await repository.insertLedgerEntries(transaction, {
      wageRunId,
      runDate: run.run_date,
      wagesExpenseAcId: wagesExpenseAccount.ac_id,
      workerBaId: employee.ba_id,
      amount: run.total_amount,
    });
    await repository.markPosted(transaction, wageRunId, userId);
  });

  return getById(wageRunId);
}

// Unpost is audited, not silent (payroll.md §8) — unposted_at/unposted_by/amount_before record
// that this run WAS confirmed and for how much, since a labourer holds no paperwork of his own to
// check a silent edit against.
async function unpost(wageRunId, userId) {
  const run = await getById(wageRunId);
  if (run.status !== 'CONFIRMED') {
    throw ApiError.conflict('Wage run is not posted', 'NOT_POSTED');
  }

  await withTransaction(async (transaction) => {
    await repository.deleteLedgerEntries(transaction, wageRunId);
    await repository.markUnposted(transaction, wageRunId, userId, run.total_amount);
  });

  return getById(wageRunId);
}

module.exports = { list, recent, getById, create, update, remove, post, unpost };
