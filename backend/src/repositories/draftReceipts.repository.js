// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
//
// Every UNPOSTED receipt now lives here — the real dbo.receipts table strictly only ever holds
// posted documents (same architecture as draft_sale_bills/draft_purchases/...). All three payment
// modes are representable since migration 024 added cheque_no/cheque_date/cheque_received_date:
// a CHEQUE draft holds the cheque's details as plain columns, and the real dbo.cheques row is only
// written at confirm time by receipts.service#insertReceipt() — the same code path that always
// wrote it — so the cheque/deposit/endorse/bounce logic is untouched by this change.
const { sql, query, requestWithParams } = require('../db/pool');

const SELECT_COLUMNS = `dr.*, ba.name AS account_name, ba.code AS account_code,
            c.customer_id, c.name AS customer_name,
            b.name AS bank_name`;

const FROM_JOINS = `FROM dbo.draft_receipts dr
     JOIN dbo.business_accounts ba ON ba.ba_id = dr.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = dr.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = dr.bank_id`;

function headerParams(draft) {
  return {
    receiptDate: { type: sql.Date, value: draft.receipt_date },
    baId: { type: sql.Int, value: draft.ba_id },
    amount: { type: sql.Decimal(14, 2), value: draft.amount },
    commission: { type: sql.Decimal(14, 2), value: draft.commission ?? 0 },
    paymentMode: { type: sql.VarChar(10), value: draft.payment_mode },
    details: { type: sql.NVarChar(200), value: draft.details ?? null },
    bankId: { type: sql.Int, value: draft.bank_id ?? null },
    onlineBaId: { type: sql.Int, value: draft.online_ba_id ?? null },
    remarks: { type: sql.NVarChar(500), value: draft.remarks ?? null },
    // Cheque details live directly on the draft (migration 024) — no dbo.cheques row exists for an
    // unposted receipt, because cheques.receipt_id is NOT NULL and there is no receipt yet.
    chequeNo: { type: sql.VarChar(50), value: draft.cheque_no ?? null },
    chequeDate: { type: sql.Date, value: draft.cheque_date ?? null },
    chequeReceivedDate: { type: sql.Date, value: draft.cheque_received_date ?? null },
  };
}

async function insert(transaction, draft) {
  const request = requestWithParams(transaction, {
    ...headerParams(draft),
    createdBy: { type: sql.Int, value: draft.created_by ?? null },
    // RJ-03: which voucher this draft line belongs to (migration 024).
    voucherId: { type: sql.Int, value: draft.voucher_id ?? null },
    // Carried across from the real row by receipts.service#unconfirm() so a line that is unposted
    // keeps its original position in its voucher's entry order rather than jumping to the end.
    createdAt: { type: sql.DateTime2, value: draft.created_at ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.draft_receipts (
      receipt_date, ba_id, amount, commission, payment_mode, details, bank_id, online_ba_id, remarks,
      cheque_no, cheque_date, cheque_received_date, created_by, voucher_id, created_at
    )
    OUTPUT inserted.draft_id
    VALUES (
      @receiptDate, @baId, @amount, @commission, @paymentMode, @details, @bankId, @onlineBaId, @remarks,
      @chequeNo, @chequeDate, @chequeReceivedDate, @createdBy, @voucherId,
      ISNULL(@createdAt, SYSUTCDATETIME())
    )
  `);
  return result.recordset[0].draft_id;
}

// Editing an unposted receipt — the normal edit path now, since an unposted receipt is always a
// draft. Deliberately does NOT touch voucher_id, mirroring receipts.repository#updateHeader:
// editing a line can never move it to another voucher.
async function updateHeader(transaction, draftId, draft) {
  const request = requestWithParams(transaction, {
    draftId: { type: sql.Int, value: draftId },
    ...headerParams(draft),
  });
  await request.query(`
    UPDATE dbo.draft_receipts SET
      receipt_date = @receiptDate, ba_id = @baId, amount = @amount,
      commission = @commission, payment_mode = @paymentMode, details = @details,
      bank_id = @bankId, online_ba_id = @onlineBaId, remarks = @remarks,
      cheque_no = @chequeNo, cheque_date = @chequeDate,
      cheque_received_date = @chequeReceivedDate,
      updated_at = SYSUTCDATETIME()
    WHERE draft_id = @draftId
  `);
}

// Same 1:1 LEFT JOIN as receipts.repository#findById — see the note there.
async function findById(draftId) {
  const result = await query(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} WHERE dr.draft_id = @draftId`,
    { draftId: { type: sql.Int, value: draftId } },
  );
  return result.recordset[0] || null;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.ba_id) {
    conditions.push('dr.ba_id = @baId');
    params.baId = { type: sql.Int, value: filters.ba_id };
  }
  if (filters.customer_id) {
    conditions.push('c.customer_id = @customerId');
    params.customerId = { type: sql.Int, value: filters.customer_id };
  }
  if (filters.payment_mode) {
    conditions.push('dr.payment_mode = @paymentMode');
    params.paymentMode = { type: sql.VarChar(10), value: filters.payment_mode };
  }
  if (filters.date_from) {
    conditions.push('dr.receipt_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('dr.receipt_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ${where}
     ORDER BY dr.receipt_date DESC, dr.draft_id DESC`,
    params,
  );
  return result.recordset;
}

// RJ-03: the unposted half of a voucher's lines. receiptVouchers.repository#listLines() unions
// this with the posted (real) half — see the note there.
async function listByVoucher(voucherId) {
  const result = await query(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINS}
     WHERE dr.voucher_id = @voucherId
     ORDER BY dr.created_at ASC, dr.draft_id ASC`,
    { voucherId: { type: sql.Int, value: voucherId } },
  );
  return result.recordset;
}

// Mirrors receiptVouchers.repository#syncLineDates for the draft half — a voucher whose header
// date moves has to carry ALL its lines with it, posted or not.
async function syncVoucherLineDates(transaction, voucherId, voucherDate) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
    voucherDate: { type: sql.Date, value: voucherDate },
  });
  await request.query(`
    UPDATE dbo.draft_receipts
       SET receipt_date = @voucherDate, updated_at = SYSUTCDATETIME()
     WHERE voucher_id = @voucherId
  `);
}

async function deleteDraft(transaction, draftId) {
  const request = requestWithParams(transaction, { draftId: { type: sql.Int, value: draftId } });
  await request.query('DELETE FROM dbo.draft_receipts WHERE draft_id = @draftId');
}

module.exports = {
  insert, updateHeader, findById, list, listByVoucher, syncVoucherLineDates, deleteDraft,
};
