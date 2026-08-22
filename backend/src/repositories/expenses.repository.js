// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// Always inserted DRAFT explicitly, regardless of the column's DEFAULT ('CONFIRMED') — same
// discipline as receipts/transfers/wage_runs/salary_runs.
async function insert(transaction, expense) {
  const request = requestWithParams(transaction, {
    expenseDate: { type: sql.Date, value: expense.expense_date },
    baId: { type: sql.Int, value: expense.ba_id },
    amount: { type: sql.Decimal(14, 2), value: expense.amount },
    paymentMode: { type: sql.VarChar(20), value: expense.payment_mode },
    details: { type: sql.NVarChar(200), value: expense.details ?? null },
    chequeId: { type: sql.Int, value: expense.cheque_id ?? null },
    bankId: { type: sql.Int, value: expense.bank_id ?? null },
    issuedChequeNo: { type: sql.VarChar(50), value: expense.issued_cheque_no ?? null },
    issuedChequeDate: { type: sql.Date, value: expense.issued_cheque_date ?? null },
    remarks: { type: sql.NVarChar(500), value: expense.remarks ?? null },
    createdBy: { type: sql.Int, value: expense.created_by ?? null },
    // PN-01: the voucher this entry belongs to. Nullable in the column so migration 022's backfill
    // could populate it, but every line written through here carries one.
    voucherId: { type: sql.Int, value: expense.voucher_id ?? null },
    // Carried across from the draft by draftExpenses.service#confirm() so a line that gets posted
    // keeps its original position in its voucher's entry order (listLines orders the posted and
    // unposted halves together by created_at). Defaults to now for every other caller.
    createdAt: { type: sql.DateTime2, value: expense.created_at ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.expenses (
      expense_date, ba_id, amount, payment_mode, details, cheque_id, bank_id,
      issued_cheque_no, issued_cheque_date, remarks, status, created_by, voucher_id, created_at
    )
    OUTPUT inserted.expense_id
    VALUES (
      @expenseDate, @baId, @amount, @paymentMode, @details, @chequeId, @bankId,
      @issuedChequeNo, @issuedChequeDate, @remarks, 'DRAFT', @createdBy, @voucherId,
      ISNULL(@createdAt, SYSUTCDATETIME())
    )
  `);
  return result.recordset[0].expense_id;
}

async function findById(expenseId) {
  const result = await query(
    `SELECT e.*, ba.name AS ba_name, b.name AS bank_name, ch.cheque_no, ch.cheque_status
     FROM dbo.expenses e
     JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = e.bank_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = e.cheque_id
     WHERE e.expense_id = @expenseId`,
    { expenseId: { type: sql.Int, value: expenseId } },
  );
  return result.recordset[0] || null;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.ba_id) {
    conditions.push('e.ba_id = @baId');
    params.baId = { type: sql.Int, value: filters.ba_id };
  }
  if (filters.payment_mode) {
    conditions.push('e.payment_mode = @paymentMode');
    params.paymentMode = { type: sql.VarChar(20), value: filters.payment_mode };
  }
  if (filters.status) {
    conditions.push('e.status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('e.expense_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('e.expense_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT e.*, ba.name AS ba_name
     FROM dbo.expenses e
     JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
     ${where}
     ORDER BY e.expense_date DESC, e.expense_id DESC`,
    params,
  );
  return result.recordset;
}

async function updateHeader(transaction, expenseId, expense) {
  const request = requestWithParams(transaction, {
    expenseId: { type: sql.Int, value: expenseId },
    expenseDate: { type: sql.Date, value: expense.expense_date },
    baId: { type: sql.Int, value: expense.ba_id },
    amount: { type: sql.Decimal(14, 2), value: expense.amount },
    paymentMode: { type: sql.VarChar(20), value: expense.payment_mode },
    details: { type: sql.NVarChar(200), value: expense.details ?? null },
    chequeId: { type: sql.Int, value: expense.cheque_id ?? null },
    bankId: { type: sql.Int, value: expense.bank_id ?? null },
    issuedChequeNo: { type: sql.VarChar(50), value: expense.issued_cheque_no ?? null },
    issuedChequeDate: { type: sql.Date, value: expense.issued_cheque_date ?? null },
    remarks: { type: sql.NVarChar(500), value: expense.remarks ?? null },
  });
  await request.query(`
    UPDATE dbo.expenses SET
      expense_date = @expenseDate, ba_id = @baId, amount = @amount, payment_mode = @paymentMode,
      details = @details, cheque_id = @chequeId, bank_id = @bankId,
      issued_cheque_no = @issuedChequeNo, issued_cheque_date = @issuedChequeDate, remarks = @remarks
    WHERE expense_id = @expenseId
  `);
}

async function setStatus(transaction, expenseId, status, userId) {
  const request = requestWithParams(transaction, {
    expenseId: { type: sql.Int, value: expenseId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: userId ?? null },
  });
  await request.query(
    'UPDATE dbo.expenses SET status = @status, updated_by = @updatedBy WHERE expense_id = @expenseId',
  );
}

// DRAFT-only, enforced by the service — expenses is a transaction table, never soft-deleted.
async function remove(transaction, expenseId) {
  const request = requestWithParams(transaction, { expenseId: { type: sql.Int, value: expenseId } });
  await request.query('DELETE FROM dbo.expenses WHERE expense_id = @expenseId');
}

// Used by CASH/ONLINE/CHEQUE_ISSUED posting only — CHEQUE_ENDORSED's real ledger effect is owned
// by cheques.service.js#endorseToExpense() instead (see expenses.service.js#post()).
async function insertLedgerEntries(transaction, rows) {
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: row.entry_date },
      acId: { type: sql.Int, value: row.ac_id ?? null },
      baId: { type: sql.Int, value: row.ba_id ?? null },
      debit: { type: sql.Decimal(14, 2), value: row.debit },
      credit: { type: sql.Decimal(14, 2), value: row.credit },
      sourceType: { type: sql.VarChar(20), value: row.source_type },
      sourceId: { type: sql.Int, value: row.source_id },
      narration: { type: sql.NVarChar(500), value: row.narration ?? null },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @acId, @baId, @debit, @credit, @sourceType, @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, expenseId) {
  const request = requestWithParams(transaction, { expenseId: { type: sql.Int, value: expenseId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'EXPENSE' AND source_id = @expenseId`,
  );
}

async function markIssuedChequeBounced(transaction, expenseId, bouncedDate) {
  const request = requestWithParams(transaction, {
    expenseId: { type: sql.Int, value: expenseId },
    bouncedDate: { type: sql.Date, value: bouncedDate },
  });
  await request.query(
    `UPDATE dbo.expenses SET issued_cheque_status = 'BOUNCED', issued_cheque_bounced_date = @bouncedDate
     WHERE expense_id = @expenseId`,
  );
}

// RETURNED — distinct from BOUNCED (a due-date issue or any other non-bounce reason), same
// reverse-never-delete mechanics, own date/reason columns (see cheques.repository.js#markReturned).
async function markIssuedChequeReturned(transaction, expenseId, returnedDate, reason) {
  const request = requestWithParams(transaction, {
    expenseId: { type: sql.Int, value: expenseId },
    returnedDate: { type: sql.Date, value: returnedDate },
    reason: { type: sql.NVarChar(500), value: reason ?? null },
  });
  await request.query(
    `UPDATE dbo.expenses SET issued_cheque_status = 'RETURNED', issued_cheque_returned_date = @returnedDate,
       issued_cheque_return_reason = @reason
     WHERE expense_id = @expenseId`,
  );
}

// "Cheque Return" page's issued-cheque list — CONFIRMED CHEQUE_ISSUED rows still PENDING (mirrors
// cheques.repository.js#listEndorsedAllocations, but for a cheque WE wrote instead of one we
// endorsed on).
async function listReturnableIssuedCheques(filters = {}) {
  const conditions = ["e.status = 'CONFIRMED'", "e.payment_mode = 'CHEQUE_ISSUED'", "e.issued_cheque_status = 'PENDING'"];
  const params = {};

  if (filters.date_from) {
    conditions.push('e.expense_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('e.expense_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await query(
    `SELECT e.*, ba.name AS ba_name, b.name AS bank_name
     FROM dbo.expenses e
     JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = e.bank_id
     ${where}
     ORDER BY e.expense_date DESC, e.expense_id DESC`,
    params,
  );
  return result.recordset;
}

// Cheque Ledger tab — every CONFIRMED CHEQUE_ISSUED expense regardless of issued_cheque_status
// (mirrors cheques.repository.js#list(), but for cheques WE wrote instead of ones we received).
// Unlike listReturnableIssuedCheques() above, this is NOT restricted to PENDING — the ledger needs
// the full history (still pending, bounced, or returned) for one comprehensive register.
async function listIssuedCheques(filters = {}) {
  const conditions = ["e.status = 'CONFIRMED'", "e.payment_mode = 'CHEQUE_ISSUED'"];
  const params = {};

  if (filters.date_from) {
    conditions.push('e.expense_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('e.expense_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await query(
    `SELECT e.*, ba.name AS ba_name, b.name AS bank_name
     FROM dbo.expenses e
     JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = e.bank_id
     ${where}
     ORDER BY e.expense_date DESC, e.expense_id DESC`,
    params,
  );
  return result.recordset;
}

module.exports = {
  insert, findById, list, updateHeader, setStatus, remove, insertLedgerEntries, deleteLedgerEntries,
  markIssuedChequeBounced, markIssuedChequeReturned, listReturnableIssuedCheques, listIssuedCheques,
};
