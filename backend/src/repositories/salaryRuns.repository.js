// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.status) {
    conditions.push('status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('period_month >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('period_month <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.salary_runs ${where} ORDER BY period_month DESC, salary_run_id DESC`,
    params,
  );
  return result.recordset;
}

// "If that month already has a confirmed run, the screen says so and offers to open it" (payroll.md
// §11) — UQ_salary_runs_month backstops this at the DB level (filtered WHERE status='CONFIRMED'),
// this is what lets the service give a clean conflict instead of a raw unique-violation error.
async function findConfirmedByMonth(periodMonth) {
  const result = await query(
    `SELECT * FROM dbo.salary_runs WHERE period_month = @periodMonth AND status = 'CONFIRMED'`,
    { periodMonth: { type: sql.Date, value: periodMonth } },
  );
  return result.recordset[0] || null;
}

async function findById(salaryRunId) {
  const runResult = await query(
    'SELECT * FROM dbo.salary_runs WHERE salary_run_id = @salaryRunId',
    { salaryRunId: { type: sql.Int, value: salaryRunId } },
  );
  const run = runResult.recordset[0];
  if (!run) return null;

  const itemsResult = await query(
    `SELECT sri.*, e.name AS employee_name, e.ba_id AS employee_ba_id
     FROM dbo.salary_run_items sri
     JOIN dbo.employees e ON e.employee_id = sri.employee_id
     WHERE sri.salary_run_id = @salaryRunId
     ORDER BY sri.line_no`,
    { salaryRunId: { type: sql.Int, value: salaryRunId } },
  );

  return { ...run, items: itemsResult.recordset };
}

// Always inserted DRAFT explicitly (matches wage_runs/transfers' discipline — never relies on the
// column's own DEFAULT('DRAFT') coinciding).
async function insert(transaction, salaryRun) {
  const request = requestWithParams(transaction, {
    periodMonth: { type: sql.Date, value: salaryRun.period_month },
    runDate: { type: sql.Date, value: salaryRun.run_date },
    totalAmount: { type: sql.Decimal(14, 2), value: salaryRun.total_amount },
    createdBy: { type: sql.Int, value: salaryRun.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.salary_runs (period_month, run_date, total_amount, status, created_by)
    OUTPUT inserted.salary_run_id
    VALUES (@periodMonth, @runDate, @totalAmount, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].salary_run_id;
}

async function updateHeader(transaction, salaryRunId, salaryRun) {
  const request = requestWithParams(transaction, {
    salaryRunId: { type: sql.Int, value: salaryRunId },
    periodMonth: { type: sql.Date, value: salaryRun.period_month },
    runDate: { type: sql.Date, value: salaryRun.run_date },
    totalAmount: { type: sql.Decimal(14, 2), value: salaryRun.total_amount },
    updatedBy: { type: sql.Int, value: salaryRun.updated_by ?? null },
  });
  await request.query(`
    UPDATE dbo.salary_runs SET
      period_month = @periodMonth, run_date = @runDate, total_amount = @totalAmount,
      updated_by = @updatedBy
    WHERE salary_run_id = @salaryRunId
  `);
}

// amount is NOT a computed column here (unlike wage_run_items.amount) — it's an operator input
// defaulting to salary_amount, so both are written explicitly (schema note: "nothing to compute
// and nothing that can drift").
async function insertItems(transaction, salaryRunId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      salaryRunId: { type: sql.Int, value: salaryRunId },
      employeeId: { type: sql.Int, value: item.employee_id },
      salaryAmount: { type: sql.Decimal(12, 2), value: item.salary_amount },
      amount: { type: sql.Decimal(12, 2), value: item.amount },
      remarks: { type: sql.NVarChar(200), value: item.remarks ?? null },
      lineNo: { type: sql.Int, value: index + 1 },
    });
    await request.query(`
      INSERT INTO dbo.salary_run_items (salary_run_id, employee_id, salary_amount, amount, remarks, line_no)
      VALUES (@salaryRunId, @employeeId, @salaryAmount, @amount, @remarks, @lineNo)
    `);
  }
}

async function deleteItems(transaction, salaryRunId) {
  const request = requestWithParams(transaction, { salaryRunId: { type: sql.Int, value: salaryRunId } });
  await request.query('DELETE FROM dbo.salary_run_items WHERE salary_run_id = @salaryRunId');
}

// Clears the unpost-audit trio back to NULL on every post — same discipline as wage_runs.
async function markPosted(transaction, salaryRunId, userId) {
  const request = requestWithParams(transaction, {
    salaryRunId: { type: sql.Int, value: salaryRunId },
    updatedBy: { type: sql.Int, value: userId ?? null },
  });
  await request.query(`
    UPDATE dbo.salary_runs SET
      status = 'CONFIRMED', unposted_at = NULL, unposted_by = NULL, amount_before = NULL,
      updated_by = @updatedBy
    WHERE salary_run_id = @salaryRunId
  `);
}

async function markUnposted(transaction, salaryRunId, userId, amountBefore) {
  const request = requestWithParams(transaction, {
    salaryRunId: { type: sql.Int, value: salaryRunId },
    unpostedBy: { type: sql.Int, value: userId ?? null },
    amountBefore: { type: sql.Decimal(14, 2), value: amountBefore },
    updatedBy: { type: sql.Int, value: userId ?? null },
  });
  await request.query(`
    UPDATE dbo.salary_runs SET
      status = 'DRAFT', unposted_at = SYSUTCDATETIME(), unposted_by = @unpostedBy,
      amount_before = @amountBefore, updated_by = @updatedBy
    WHERE salary_run_id = @salaryRunId
  `);
}

// DRAFT-only, enforced by the service — salary_run_items cascades via ON DELETE CASCADE.
async function remove(salaryRunId) {
  await query(
    'DELETE FROM dbo.salary_runs WHERE salary_run_id = @salaryRunId',
    { salaryRunId: { type: sql.Int, value: salaryRunId } },
  );
}

// Dr SALARIES EXPENSE (total) / Cr each employee's own ba_id, one credit per line (payroll.md
// §6/§11) — unlike wage_runs' single Dr/Cr pair, this is 1 + N rows.
async function insertLedgerEntries(transaction, { salaryRunId, runDate, salariesExpenseAcId, totalAmount, lines }) {
  const debitRequest = requestWithParams(transaction, {
    entryDate: { type: sql.Date, value: runDate },
    acId: { type: sql.Int, value: salariesExpenseAcId },
    debit: { type: sql.Decimal(14, 2), value: totalAmount },
    sourceId: { type: sql.Int, value: salaryRunId },
    narration: { type: sql.NVarChar(500), value: `Salary Run #${salaryRunId}` },
  });
  await debitRequest.query(`
    INSERT INTO dbo.ledger_entries (entry_date, ac_id, debit, credit, source_type, source_id, narration)
    VALUES (@entryDate, @acId, @debit, 0, 'SALARY_RUN', @sourceId, @narration)
  `);

  for (const line of lines) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: runDate },
      baId: { type: sql.Int, value: line.ba_id },
      credit: { type: sql.Decimal(14, 2), value: line.amount },
      sourceId: { type: sql.Int, value: salaryRunId },
      narration: { type: sql.NVarChar(500), value: `Salary Run #${salaryRunId}` },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @baId, 0, @credit, 'SALARY_RUN', @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, salaryRunId) {
  const request = requestWithParams(transaction, { salaryRunId: { type: sql.Int, value: salaryRunId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'SALARY_RUN' AND source_id = @salaryRunId`,
  );
}

module.exports = {
  list, findConfirmedByMonth, findById, insert, updateHeader, insertItems, deleteItems,
  markPosted, markUnposted, remove, insertLedgerEntries, deleteLedgerEntries,
};
