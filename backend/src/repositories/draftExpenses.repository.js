// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// All four payment modes are representable here (unlike draftReceipts, which can't draft a CHEQUE
// receipt) — see migration 004_draft_expenses_parity.sql's note: a CHEQUE_ENDORSED draft references
// an ALREADY-EXISTING received cheque, no chicken-egg problem.
async function insert(transaction, draft) {
  const request = requestWithParams(transaction, {
    expenseDate: { type: sql.Date, value: draft.expense_date },
    baId: { type: sql.Int, value: draft.ba_id },
    amount: { type: sql.Decimal(14, 2), value: draft.amount },
    paymentMode: { type: sql.VarChar(20), value: draft.payment_mode },
    details: { type: sql.NVarChar(200), value: draft.details ?? null },
    chequeId: { type: sql.Int, value: draft.cheque_id ?? null },
    bankId: { type: sql.Int, value: draft.bank_id ?? null },
    issuedChequeNo: { type: sql.VarChar(50), value: draft.issued_cheque_no ?? null },
    issuedChequeDate: { type: sql.Date, value: draft.issued_cheque_date ?? null },
    remarks: { type: sql.NVarChar(500), value: draft.remarks ?? null },
    createdBy: { type: sql.Int, value: draft.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.draft_expenses (
      expense_date, ba_id, amount, payment_mode, details, cheque_id, bank_id,
      issued_cheque_no, issued_cheque_date, remarks, created_by
    )
    OUTPUT inserted.draft_id
    VALUES (
      @expenseDate, @baId, @amount, @paymentMode, @details, @chequeId, @bankId,
      @issuedChequeNo, @issuedChequeDate, @remarks, @createdBy
    )
  `);
  return result.recordset[0].draft_id;
}

async function findById(draftId) {
  const result = await query(
    `SELECT dexp.*, ba.name AS ba_name
     FROM dbo.draft_expenses dexp
     JOIN dbo.business_accounts ba ON ba.ba_id = dexp.ba_id
     WHERE dexp.draft_id = @draftId`,
    { draftId: { type: sql.Int, value: draftId } },
  );
  return result.recordset[0] || null;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.ba_id) {
    conditions.push('ba_id = @baId');
    params.baId = { type: sql.Int, value: filters.ba_id };
  }
  if (filters.date_from) {
    conditions.push('expense_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('expense_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.draft_expenses ${where} ORDER BY expense_date DESC, draft_id DESC`,
    params,
  );
  return result.recordset;
}

async function deleteDraft(transaction, draftId) {
  const request = requestWithParams(transaction, { draftId: { type: sql.Int, value: draftId } });
  await request.query('DELETE FROM dbo.draft_expenses WHERE draft_id = @draftId');
}

// Set right after confirm() creates the real expense, BEFORE attempting to post it — see the
// column's own comment in schema.sql. Lets a later confirm() retry resume against the same
// expense_id instead of minting a second one.
async function setPendingExpenseId(transaction, draftId, expenseId) {
  const request = requestWithParams(transaction, {
    draftId: { type: sql.Int, value: draftId },
    expenseId: { type: sql.Int, value: expenseId },
  });
  await request.query('UPDATE dbo.draft_expenses SET pending_expense_id = @expenseId WHERE draft_id = @draftId');
}

// Used by expenses.service.js#remove() to give a clear error instead of an opaque FK-violation
// when someone tries to delete a stuck expense directly (from the Expenses screen) rather than
// resolving it via the Drafts UI — FK_draft_expenses_pending_expense has no ON DELETE clause, so
// the raw DELETE would otherwise fail with a generic SQL Server error wrap.js can't make sense of.
async function findByPendingExpenseId(expenseId) {
  const result = await query(
    'SELECT * FROM dbo.draft_expenses WHERE pending_expense_id = @expenseId',
    { expenseId: { type: sql.Int, value: expenseId } },
  );
  return result.recordset[0] || null;
}

module.exports = { insert, findById, list, deleteDraft, setPendingExpenseId, findByPendingExpenseId };
