// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// Every UNPOSTED expense lives here now — the real dbo.expenses table strictly only ever holds
// posted documents (same architecture as draft_sale_bills/draft_purchases/draft_receipts).
// All four payment modes were already representable here (unlike draft_receipts, which needed
// migration 024's cheque columns) — see migration 004_draft_expenses_parity.sql's note: a
// CHEQUE_ENDORSED draft references an ALREADY-EXISTING received cheque, no chicken-egg problem.
function headerParams(draft) {
  return {
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
  };
}

async function insert(transaction, draft) {
  const request = requestWithParams(transaction, {
    ...headerParams(draft),
    createdBy: { type: sql.Int, value: draft.created_by ?? null },
    // PN-01: which voucher this draft line belongs to (migration 024).
    voucherId: { type: sql.Int, value: draft.voucher_id ?? null },
    // Carried across from the real row by expenses.service#unconfirm() so a line that is unposted
    // keeps its original position in its voucher's entry order.
    createdAt: { type: sql.DateTime2, value: draft.created_at ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.draft_expenses (
      expense_date, ba_id, amount, payment_mode, details, cheque_id, bank_id,
      issued_cheque_no, issued_cheque_date, remarks, created_by, voucher_id, created_at
    )
    OUTPUT inserted.draft_id
    VALUES (
      @expenseDate, @baId, @amount, @paymentMode, @details, @chequeId, @bankId,
      @issuedChequeNo, @issuedChequeDate, @remarks, @createdBy, @voucherId,
      ISNULL(@createdAt, SYSUTCDATETIME())
    )
  `);
  return result.recordset[0].draft_id;
}

// Editing an unposted expense — the normal edit path now. Deliberately does NOT touch voucher_id,
// mirroring expenses.repository#updateHeader: editing a line can never move it to another voucher.
async function updateHeader(transaction, draftId, draft) {
  const request = requestWithParams(transaction, {
    draftId: { type: sql.Int, value: draftId },
    ...headerParams(draft),
  });
  await request.query(`
    UPDATE dbo.draft_expenses SET
      expense_date = @expenseDate, ba_id = @baId, amount = @amount,
      payment_mode = @paymentMode, details = @details, cheque_id = @chequeId,
      bank_id = @bankId, issued_cheque_no = @issuedChequeNo,
      issued_cheque_date = @issuedChequeDate, remarks = @remarks,
      updated_at = SYSUTCDATETIME()
    WHERE draft_id = @draftId
  `);
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

// PN-01: the unposted half of a voucher's lines. expenseVouchers.repository#listLines() unions
// this with the posted (real) half — see the note there. Mirrors that query's join set so a draft
// line carries the same fields (account name, bank, endorsed-cheque details) a posted one does.
async function listByVoucher(voucherId) {
  const result = await query(
    `SELECT dexp.*, ba.name AS ba_name, ba.name AS account_name, ba.code AS account_code,
            b.name AS bank_name,
            ch.cheque_no AS endorsed_cheque_no, ch.cheque_date AS endorsed_cheque_date,
            ch.cheque_status AS endorsed_cheque_status
     FROM dbo.draft_expenses dexp
     JOIN dbo.business_accounts ba ON ba.ba_id = dexp.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = dexp.bank_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = dexp.cheque_id
     WHERE dexp.voucher_id = @voucherId
     ORDER BY dexp.created_at ASC, dexp.draft_id ASC`,
    { voucherId: { type: sql.Int, value: voucherId } },
  );
  return result.recordset;
}

// Mirrors expenseVouchers.repository#syncLineDates for the draft half — a voucher whose header
// date moves has to carry ALL its lines with it, posted or not.
async function syncVoucherLineDates(transaction, voucherId, voucherDate) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
    voucherDate: { type: sql.Date, value: voucherDate },
  });
  await request.query(`
    UPDATE dbo.draft_expenses
       SET expense_date = @voucherDate, updated_at = SYSUTCDATETIME()
     WHERE voucher_id = @voucherId
  `);
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

module.exports = {
  insert, updateHeader, findById, list, listByVoucher, syncVoucherLineDates, deleteDraft,
  setPendingExpenseId, findByPendingExpenseId,
};
