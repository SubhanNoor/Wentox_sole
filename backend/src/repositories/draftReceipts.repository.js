// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// CASH/ONLINE only (see draftReceipts.service.js — dbo.draft_receipts has a cheque_id FK but no
// cheque_no/cheque_date columns of its own, so a genuinely useful CHEQUE draft isn't possible).
async function insert(transaction, draft) {
  const request = requestWithParams(transaction, {
    receiptDate: { type: sql.Date, value: draft.receipt_date },
    customerId: { type: sql.Int, value: draft.customer_id },
    amount: { type: sql.Decimal(14, 2), value: draft.amount },
    commission: { type: sql.Decimal(14, 2), value: draft.commission ?? 0 },
    paymentMode: { type: sql.VarChar(10), value: draft.payment_mode },
    details: { type: sql.NVarChar(200), value: draft.details ?? null },
    bankId: { type: sql.Int, value: draft.bank_id ?? null },
    remarks: { type: sql.NVarChar(500), value: draft.remarks ?? null },
    createdBy: { type: sql.Int, value: draft.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.draft_receipts (
      receipt_date, customer_id, amount, commission, payment_mode, details, bank_id, remarks, created_by
    )
    OUTPUT inserted.draft_id
    VALUES (
      @receiptDate, @customerId, @amount, @commission, @paymentMode, @details, @bankId, @remarks, @createdBy
    )
  `);
  return result.recordset[0].draft_id;
}

async function findById(draftId) {
  const result = await query(
    `SELECT dr.*, c.name AS customer_name
     FROM dbo.draft_receipts dr
     JOIN dbo.customers c ON c.customer_id = dr.customer_id
     WHERE dr.draft_id = @draftId`,
    { draftId: { type: sql.Int, value: draftId } },
  );
  return result.recordset[0] || null;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.customer_id) {
    conditions.push('customer_id = @customerId');
    params.customerId = { type: sql.Int, value: filters.customer_id };
  }
  if (filters.date_from) {
    conditions.push('receipt_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('receipt_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.draft_receipts ${where} ORDER BY receipt_date DESC, draft_id DESC`,
    params,
  );
  return result.recordset;
}

async function deleteDraft(transaction, draftId) {
  const request = requestWithParams(transaction, { draftId: { type: sql.Int, value: draftId } });
  await request.query('DELETE FROM dbo.draft_receipts WHERE draft_id = @draftId');
}

module.exports = { insert, findById, list, deleteDraft };
