// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
//
// PN-01: the header side of a payment (Naam) voucher — the Payments counterpart of
// receiptVouchers.repository.js. The entry lines live in dbo.expenses and are read through this
// file only for display (listLines); anything that WRITES a line still goes through
// expenses.repository, so there is one definition of how an expense row is written.
const { sql, query, requestWithParams } = require('../db/pool');

// PN-01: "C.Book No" — MAX + 1, allocated inside the caller's transaction so the read and the
// insert that consumes it cannot be split. Numbered independently of receipt vouchers: a payment
// voucher and a receipt voucher are different documents and the client's screens number them
// separately.
async function nextVoucherNo(transaction) {
  const request = requestWithParams(transaction, {});
  const result = await request.query(
    'SELECT ISNULL(MAX(voucher_no), 0) + 1 AS nextNo FROM dbo.expense_vouchers',
  );
  return result.recordset[0].nextNo;
}

async function insert(transaction, voucher) {
  const request = requestWithParams(transaction, {
    voucherNo: { type: sql.Int, value: voucher.voucher_no },
    voucherDate: { type: sql.Date, value: voucher.voucher_date },
    remarks: { type: sql.NVarChar(500), value: voucher.remarks ?? null },
    createdBy: { type: sql.Int, value: voucher.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.expense_vouchers (voucher_no, voucher_date, remarks, created_by)
    OUTPUT inserted.voucher_id
    VALUES (@voucherNo, @voucherDate, @remarks, @createdBy)
  `);
  return result.recordset[0].voucher_id;
}

async function findById(voucherId) {
  const result = await query(
    'SELECT * FROM dbo.expense_vouchers WHERE voucher_id = @voucherId',
    { voucherId: { type: sql.Int, value: voucherId } },
  );
  return result.recordset[0] || null;
}

// The voucher's entry lines, in the order they were added — entry order is what the user sees in
// the grid and what Post walks, so it must not be re-sorted here.
// Carries the issued-cheque columns as well as the endorsed-cheque join: an expense can be paid by
// a cheque WE wrote (issued_cheque_no on the row) or by handing on a cheque we received
// (cheque_id -> dbo.cheques), and the grid has to show either.
async function listLines(voucherId) {
  const result = await query(
    `SELECT e.*, ba.name AS account_name, ba.code AS account_code,
            b.name AS bank_name,
            ch.cheque_no AS endorsed_cheque_no, ch.cheque_date AS endorsed_cheque_date,
            ch.cheque_status AS endorsed_cheque_status
     FROM dbo.expenses e
     JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = e.bank_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = e.cheque_id
     WHERE e.voucher_id = @voucherId
     ORDER BY e.expense_id ASC`,
    { voucherId: { type: sql.Int, value: voucherId } },
  );
  return result.recordset;
}

// One row per voucher with the aggregates the listing needs. `confirmed_lines` vs `line_count` is
// what the service turns into UNPOSTED/PARTIAL/POSTED — there is no stored status column to read
// (see migration 022 for why).
//
// The two cheque modes are totalled together as `total_cheque`: CHEQUE_ISSUED (a cheque we wrote)
// and CHEQUE_ENDORSED (one we received and handed on) are different mechanics but both are "paid
// by cheque" on the voucher footer.
async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.date_from) {
    conditions.push('v.voucher_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('v.voucher_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }
  if (filters.voucher_no) {
    conditions.push('v.voucher_no = @voucherNo');
    params.voucherNo = { type: sql.Int, value: filters.voucher_no };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT v.*,
            COUNT(e.expense_id) AS line_count,
            SUM(CASE WHEN e.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_lines,
            ISNULL(SUM(e.amount), 0) AS total_amount,
            ISNULL(SUM(CASE WHEN e.payment_mode = 'CASH'   THEN e.amount ELSE 0 END), 0) AS total_cash,
            ISNULL(SUM(CASE WHEN e.payment_mode IN ('CHEQUE_ISSUED','CHEQUE_ENDORSED') THEN e.amount ELSE 0 END), 0) AS total_cheque,
            ISNULL(SUM(CASE WHEN e.payment_mode = 'ONLINE' THEN e.amount ELSE 0 END), 0) AS total_online
     FROM dbo.expense_vouchers v
     LEFT JOIN dbo.expenses e ON e.voucher_id = v.voucher_id
     ${where}
     GROUP BY v.voucher_id, v.voucher_no, v.voucher_date, v.remarks,
              v.created_by, v.updated_by, v.created_at, v.updated_at
     ORDER BY v.voucher_date DESC, v.voucher_no DESC`,
    params,
  );
  return result.recordset;
}

async function updateHeader(transaction, voucherId, voucher) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
    voucherDate: { type: sql.Date, value: voucher.voucher_date },
    remarks: { type: sql.NVarChar(500), value: voucher.remarks ?? null },
    updatedBy: { type: sql.Int, value: voucher.updated_by ?? null },
  });
  await request.query(`
    UPDATE dbo.expense_vouchers
       SET voucher_date = @voucherDate,
           remarks      = @remarks,
           updated_by   = @updatedBy,
           updated_at   = SYSUTCDATETIME()
     WHERE voucher_id = @voucherId
  `);
}

// Keeps every line's own expense_date equal to the header's date — migration 022 kept the per-line
// date (the ledger, cash book and every report read it), so the header moving has to carry its
// lines with it or the two silently disagree.
async function syncLineDates(transaction, voucherId, voucherDate) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
    voucherDate: { type: sql.Date, value: voucherDate },
  });
  await request.query(`
    UPDATE dbo.expenses
       SET expense_date = @voucherDate, updated_at = SYSUTCDATETIME()
     WHERE voucher_id = @voucherId
  `);
}

async function remove(transaction, voucherId) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
  });
  await request.query('DELETE FROM dbo.expense_vouchers WHERE voucher_id = @voucherId');
}

module.exports = {
  nextVoucherNo, insert, findById, listLines, list, updateHeader, syncLineDates, remove,
};
