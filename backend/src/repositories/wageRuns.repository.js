// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.employee_id) {
    conditions.push('wr.employee_id = @employeeId');
    params.employeeId = { type: sql.Int, value: filters.employee_id };
  }
  if (filters.stage_key) {
    conditions.push('wr.stage_key = @stageKey');
    params.stageKey = { type: sql.VarChar(20), value: filters.stage_key };
  }
  if (filters.status) {
    conditions.push('wr.status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('wr.run_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('wr.run_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT wr.*, e.name AS employee_name, s.worker_label AS stage_label,
       (SELECT COUNT(*) FROM dbo.wage_run_items wri WHERE wri.wage_run_id = wr.wage_run_id) AS item_count
     FROM dbo.wage_runs wr
     JOIN dbo.employees e ON e.employee_id = wr.employee_id
     JOIN dbo.stages s ON s.stage_key = wr.stage_key
     ${where}
     ORDER BY wr.run_date DESC, wr.wage_run_id DESC`,
    params,
  );
  return result.recordset;
}

// "That worker's last three runs for the selected stage" (payroll.md §7) — replaces a duplicate-
// settlement guard the design doc deliberately doesn't build (§5: "NOTHING HERE CAN DETECT THE
// SAME WEEK BEING PAID TWICE"). Any status, not just CONFIRMED — a recent DRAFT is still
// information worth showing the operator.
async function recentRuns(employeeId, stageKey, limit = 3) {
  const result = await query(
    `SELECT TOP (@limit) wage_run_id, run_date, total_amount, status
     FROM dbo.wage_runs
     WHERE employee_id = @employeeId AND stage_key = @stageKey
     ORDER BY run_date DESC, wage_run_id DESC`,
    {
      employeeId: { type: sql.Int, value: employeeId },
      stageKey: { type: sql.VarChar(20), value: stageKey },
      limit: { type: sql.Int, value: limit },
    },
  );
  return result.recordset;
}

async function findById(wageRunId) {
  const headerResult = await query(
    `SELECT wr.*, e.name AS employee_name, s.worker_label AS stage_label
     FROM dbo.wage_runs wr
     JOIN dbo.employees e ON e.employee_id = wr.employee_id
     JOIN dbo.stages s ON s.stage_key = wr.stage_key
     WHERE wr.wage_run_id = @wageRunId`,
    { wageRunId: { type: sql.Int, value: wageRunId } },
  );
  const run = headerResult.recordset[0];
  if (!run) return null;

  const itemsResult = await query(
    `SELECT wri.*, a.code AS article_code, a.name AS article_name
     FROM dbo.wage_run_items wri
     JOIN dbo.articles a ON a.article_id = wri.article_id
     WHERE wri.wage_run_id = @wageRunId
     ORDER BY wri.line_no`,
    { wageRunId: { type: sql.Int, value: wageRunId } },
  );

  return { ...run, items: itemsResult.recordset };
}

// Always inserted DRAFT regardless of the column's DEFAULT ('DRAFT') coincidentally matching —
// explicit here anyway so this doesn't silently rely on the default, same discipline as transfers.
async function insert(transaction, wageRun) {
  const request = requestWithParams(transaction, {
    employeeId: { type: sql.Int, value: wageRun.employee_id },
    stageKey: { type: sql.VarChar(20), value: wageRun.stage_key },
    runDate: { type: sql.Date, value: wageRun.run_date },
    totalAmount: { type: sql.Decimal(14, 2), value: wageRun.total_amount },
    createdBy: { type: sql.Int, value: wageRun.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.wage_runs (employee_id, stage_key, run_date, total_amount, status, created_by)
    OUTPUT inserted.wage_run_id
    VALUES (@employeeId, @stageKey, @runDate, @totalAmount, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].wage_run_id;
}

async function updateHeader(transaction, wageRunId, wageRun) {
  const request = requestWithParams(transaction, {
    wageRunId: { type: sql.Int, value: wageRunId },
    employeeId: { type: sql.Int, value: wageRun.employee_id },
    stageKey: { type: sql.VarChar(20), value: wageRun.stage_key },
    runDate: { type: sql.Date, value: wageRun.run_date },
    totalAmount: { type: sql.Decimal(14, 2), value: wageRun.total_amount },
    updatedBy: { type: sql.Int, value: wageRun.updated_by ?? null },
  });
  await request.query(`
    UPDATE dbo.wage_runs SET
      employee_id = @employeeId, stage_key = @stageKey, run_date = @runDate,
      total_amount = @totalAmount, updated_by = @updatedBy
    WHERE wage_run_id = @wageRunId
  `);
}

// amount is a computed column (rate * cartons PERSISTED) — never in this INSERT list.
async function insertItems(transaction, wageRunId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      wageRunId: { type: sql.Int, value: wageRunId },
      articleId: { type: sql.Int, value: item.article_id },
      rate: { type: sql.Decimal(12, 2), value: item.rate },
      cartons: { type: sql.Decimal(12, 1), value: item.cartons },
      packing: { type: sql.Int, value: item.packing },
      lineNo: { type: sql.Int, value: index + 1 },
    });
    await request.query(`
      INSERT INTO dbo.wage_run_items (wage_run_id, article_id, rate, cartons, packing, line_no)
      VALUES (@wageRunId, @articleId, @rate, @cartons, @packing, @lineNo)
    `);
  }
}

async function deleteItems(transaction, wageRunId) {
  const request = requestWithParams(transaction, { wageRunId: { type: sql.Int, value: wageRunId } });
  await request.query('DELETE FROM dbo.wage_run_items WHERE wage_run_id = @wageRunId');
}

// Clears the unpost-audit trio back to NULL on every post — a run being posted now is not "in an
// unposted state" regardless of what a prior unpost cycle left there.
async function markPosted(transaction, wageRunId, userId) {
  const request = requestWithParams(transaction, {
    wageRunId: { type: sql.Int, value: wageRunId },
    updatedBy: { type: sql.Int, value: userId ?? null },
  });
  await request.query(`
    UPDATE dbo.wage_runs SET
      status = 'CONFIRMED', unposted_at = NULL, unposted_by = NULL, amount_before = NULL,
      updated_by = @updatedBy
    WHERE wage_run_id = @wageRunId
  `);
}

// Unpost audit (payroll.md §8) — a labourer holds no paperwork of his own, so unlike a sale bill
// there's nothing on the other side to check a silent edit against; these three columns are the
// symmetric partner of created_by/updated_by, not a full edit history.
async function markUnposted(transaction, wageRunId, userId, amountBefore) {
  const request = requestWithParams(transaction, {
    wageRunId: { type: sql.Int, value: wageRunId },
    unpostedBy: { type: sql.Int, value: userId ?? null },
    amountBefore: { type: sql.Decimal(14, 2), value: amountBefore },
    updatedBy: { type: sql.Int, value: userId ?? null },
  });
  await request.query(`
    UPDATE dbo.wage_runs SET
      status = 'DRAFT', unposted_at = SYSUTCDATETIME(), unposted_by = @unpostedBy,
      amount_before = @amountBefore, updated_by = @updatedBy
    WHERE wage_run_id = @wageRunId
  `);
}

// DRAFT-only, enforced by the service — wage_run_items cascades via ON DELETE CASCADE.
async function remove(wageRunId) {
  await query(
    'DELETE FROM dbo.wage_runs WHERE wage_run_id = @wageRunId',
    { wageRunId: { type: sql.Int, value: wageRunId } },
  );
}

// Dr WAGES EXPENSE / Cr worker BA (payroll.md §6) — one pair, not one row per line, since
// wage_run_items' amounts already roll up into total_amount.
async function insertLedgerEntries(transaction, { wageRunId, runDate, wagesExpenseAcId, workerBaId, amount }) {
  const rows = [
    {
      entry_date: runDate, ac_id: wagesExpenseAcId, debit: amount, credit: 0,
      source_type: 'WAGE_RUN', source_id: wageRunId, narration: 'HISAB',
    },
    {
      entry_date: runDate, ba_id: workerBaId, debit: 0, credit: amount,
      source_type: 'WAGE_RUN', source_id: wageRunId, narration: 'HISAB',
    },
  ];
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: row.entry_date },
      acId: { type: sql.Int, value: row.ac_id ?? null },
      baId: { type: sql.Int, value: row.ba_id ?? null },
      debit: { type: sql.Decimal(14, 2), value: row.debit },
      credit: { type: sql.Decimal(14, 2), value: row.credit },
      sourceType: { type: sql.VarChar(20), value: row.source_type },
      sourceId: { type: sql.Int, value: row.source_id },
      narration: { type: sql.NVarChar(500), value: row.narration },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @acId, @baId, @debit, @credit, @sourceType, @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, wageRunId) {
  const request = requestWithParams(transaction, { wageRunId: { type: sql.Int, value: wageRunId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'WAGE_RUN' AND source_id = @wageRunId`,
  );
}

module.exports = {
  list, recentRuns, findById, insert, updateHeader, insertItems, deleteItems,
  markPosted, markUnposted, remove, insertLedgerEntries, deleteLedgerEntries,
};
