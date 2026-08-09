// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// Always inserted DRAFT explicitly, regardless of the column's DEFAULT ('CONFIRMED') — same
// discipline as transfers/wage_runs/salary_runs. cheque_id is NULL here on purpose: cheques.receipt_id
// and receipts.cheque_id reference each other, so a CHEQUE-mode receipt is written in two steps
// inside one transaction — this insert, then a cheques insert, then linkCheque() below.
async function insert(transaction, receipt) {
  const request = requestWithParams(transaction, {
    receiptDate: { type: sql.Date, value: receipt.receipt_date },
    baId: { type: sql.Int, value: receipt.ba_id },
    amount: { type: sql.Decimal(14, 2), value: receipt.amount },
    commission: { type: sql.Decimal(14, 2), value: receipt.commission ?? 0 },
    paymentMode: { type: sql.VarChar(10), value: receipt.payment_mode },
    details: { type: sql.NVarChar(200), value: receipt.details ?? null },
    bankId: { type: sql.Int, value: receipt.bank_id ?? null },
    remarks: { type: sql.NVarChar(500), value: receipt.remarks ?? null },
    createdBy: { type: sql.Int, value: receipt.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.receipts (
      receipt_date, ba_id, amount, commission, payment_mode, details, bank_id, remarks,
      status, created_by
    )
    OUTPUT inserted.receipt_id
    VALUES (
      @receiptDate, @baId, @amount, @commission, @paymentMode, @details, @bankId, @remarks,
      'DRAFT', @createdBy
    )
  `);
  return result.recordset[0].receipt_id;
}

async function linkCheque(transaction, receiptId, chequeId) {
  const request = requestWithParams(transaction, {
    receiptId: { type: sql.Int, value: receiptId },
    chequeId: { type: sql.Int, value: chequeId },
  });
  await request.query('UPDATE dbo.receipts SET cheque_id = @chequeId WHERE receipt_id = @receiptId');
}

// Before deleting a DRAFT cheque-mode receipt, the circular FK pair (receipts.cheque_id <->
// cheques.receipt_id) must be broken in this order: null out receipts.cheque_id first (the caller
// then deletes the cheques row, then this receipts row).
async function unlinkCheque(transaction, receiptId) {
  const request = requestWithParams(transaction, { receiptId: { type: sql.Int, value: receiptId } });
  await request.query('UPDATE dbo.receipts SET cheque_id = NULL WHERE receipt_id = @receiptId');
}

// A receipt names a business account, which may or may not belong to a customer (migration 014).
// customers.ba_id has a UNIQUE filtered index, so this LEFT JOIN is 1:1 and yields customer_id /
// customer_name for the customer case and NULLs for a director, employee, vendor or bank — which
// is exactly what callers need to decide whether customer-only behaviour (commission) applies.
async function findById(receiptId) {
  const result = await query(
    `SELECT r.*, ba.name AS account_name, c.customer_id, c.name AS customer_name,
            b.name AS bank_name,
            ch.cheque_no, ch.cheque_date, ch.cheque_received_date, ch.cheque_status,
            ch.bank_id AS cheque_bank_id
     FROM dbo.receipts r
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = r.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = r.bank_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = r.cheque_id
     WHERE r.receipt_id = @receiptId`,
    { receiptId: { type: sql.Int, value: receiptId } },
  );
  return result.recordset[0] || null;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.ba_id) {
    conditions.push('r.ba_id = @baId');
    params.baId = { type: sql.Int, value: filters.ba_id };
  }
  // Kept for callers that still think in customers (customer ledger drill-downs). Resolved through
  // the account rather than a receipts column, since receipts no longer carries customer_id.
  if (filters.customer_id) {
    conditions.push('c.customer_id = @customerId');
    params.customerId = { type: sql.Int, value: filters.customer_id };
  }
  if (filters.payment_mode) {
    conditions.push('r.payment_mode = @paymentMode');
    params.paymentMode = { type: sql.VarChar(10), value: filters.payment_mode };
  }
  if (filters.status) {
    conditions.push('r.status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('r.receipt_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('r.receipt_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT r.*, ba.name AS account_name, c.customer_id, c.name AS customer_name
     FROM dbo.receipts r
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = r.ba_id
     ${where}
     ORDER BY r.receipt_date DESC, r.receipt_id DESC`,
    params,
  );
  return result.recordset;
}

async function updateHeader(transaction, receiptId, receipt) {
  const request = requestWithParams(transaction, {
    receiptId: { type: sql.Int, value: receiptId },
    receiptDate: { type: sql.Date, value: receipt.receipt_date },
    baId: { type: sql.Int, value: receipt.ba_id },
    amount: { type: sql.Decimal(14, 2), value: receipt.amount },
    commission: { type: sql.Decimal(14, 2), value: receipt.commission ?? 0 },
    paymentMode: { type: sql.VarChar(10), value: receipt.payment_mode },
    details: { type: sql.NVarChar(200), value: receipt.details ?? null },
    bankId: { type: sql.Int, value: receipt.bank_id ?? null },
    remarks: { type: sql.NVarChar(500), value: receipt.remarks ?? null },
  });
  await request.query(`
    UPDATE dbo.receipts SET
      receipt_date = @receiptDate, ba_id = @baId, amount = @amount,
      commission = @commission, payment_mode = @paymentMode, details = @details,
      bank_id = @bankId, remarks = @remarks
    WHERE receipt_id = @receiptId
  `);
}

async function setStatus(transaction, receiptId, status, userId) {
  const request = requestWithParams(transaction, {
    receiptId: { type: sql.Int, value: receiptId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: userId ?? null },
  });
  await request.query(
    'UPDATE dbo.receipts SET status = @status, updated_by = @updatedBy WHERE receipt_id = @receiptId',
  );
}

// DRAFT-only, enforced by the service — receipts is a transaction table, never soft-deleted.
async function remove(transaction, receiptId) {
  const request = requestWithParams(transaction, { receiptId: { type: sql.Int, value: receiptId } });
  await request.query('DELETE FROM dbo.receipts WHERE receipt_id = @receiptId');
}

// One pair per plain receipt (Dr <cash/bank/cheques-in-hand> / Cr customer BA); a second pair when
// commission > 0 (Dr COMMISSION ALLOWED / Cr customer BA), both source_type/source_id distinct
// (RECEIPT vs COMMISSION) so they can be told apart and reversed independently if ever needed.
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

async function deleteLedgerEntries(transaction, receiptId) {
  const request = requestWithParams(transaction, { receiptId: { type: sql.Int, value: receiptId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type IN ('RECEIPT','COMMISSION') AND source_id = @receiptId`,
  );
}

module.exports = {
  insert, linkCheque, unlinkCheque, findById, list, updateHeader, setStatus, remove,
  insertLedgerEntries, deleteLedgerEntries,
};
