// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
//
// RJ-03: the header side of a receipt voucher. The entry lines live in dbo.receipts and are read
// through this file only for display (listLines) — anything that WRITES a line still goes through
// receipts.repository, so there is one definition of how a receipt row is written.
const { sql, query, requestWithParams } = require('../db/pool');

// RJ-03: "C.Book No" — MAX + 1, the same allocation business_accounts codes use. Takes the
// caller's transaction so the read and the insert that consumes it cannot be split by another
// write. (Single-session desktop app, so there is no concurrent allocator; the transaction is
// belt-and-braces, and makes the intent explicit.)
async function nextVoucherNo(transaction) {
  const request = requestWithParams(transaction, {});
  const result = await request.query(
    'SELECT ISNULL(MAX(voucher_no), 0) + 1 AS nextNo FROM dbo.receipt_vouchers',
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
    INSERT INTO dbo.receipt_vouchers (voucher_no, voucher_date, remarks, created_by)
    OUTPUT inserted.voucher_id
    VALUES (@voucherNo, @voucherDate, @remarks, @createdBy)
  `);
  return result.recordset[0].voucher_id;
}

async function findById(voucherId) {
  const result = await query(
    'SELECT * FROM dbo.receipt_vouchers WHERE voucher_id = @voucherId',
    { voucherId: { type: sql.Int, value: voucherId } },
  );
  return result.recordset[0] || null;
}

// The voucher's entry lines, in the order they were added — entry order is what the user sees in
// the grid and what Post walks, so it must not be re-sorted here.
// Mirrors receipts.repository#findById's join set so a line rendered inside a voucher carries the
// same fields (account name, cheque number, bank) it carries anywhere else.
//
// A voucher's lines now live in TWO tables: the posted ones in dbo.receipts and the unposted ones
// in dbo.draft_receipts (the draft/real split — an unposted receipt is never left in the real
// table). This unions both halves into the single list the screen has always rendered, so nothing
// upstream has to know there are two tables:
//   - `status` is derived, not read: a real row is 'CONFIRMED' by the invariant, a draft is 'DRAFT'.
//     receiptVouchers.service#deriveStatus() counts these exactly as before.
//   - `receipt_id` / `draft_id`: exactly one is set per line, naming which table it came from and
//     which id the per-line actions must address.
//   - cheque columns come from dbo.cheques for a posted line and from the draft's own columns
//     (migration 024) for an unposted one; a draft has no cheques row yet, hence NULL cheque_status.
// Ordered by created_at so the two halves interleave in genuine entry order — confirm()/unconfirm()
// carry created_at across, so a line keeps its position when it is posted or unposted.
async function listLines(voucherId) {
  const result = await query(
    `SELECT r.receipt_id, CAST(NULL AS INT) AS draft_id,
            r.receipt_date, r.ba_id, r.amount, r.commission, r.payment_mode, r.details,
            r.bank_id, r.remarks, r.voucher_id, r.created_at,
            CAST(r.status AS VARCHAR(10)) AS status,
            ba.name AS account_name, ba.code AS account_code,
            c.customer_id, c.name AS customer_name,
            b.name AS bank_name,
            ch.cheque_no, ch.cheque_date, ch.cheque_received_date,
            CAST(ch.cheque_status AS VARCHAR(20)) AS cheque_status
     FROM dbo.receipts r
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = r.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = r.bank_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = r.cheque_id
     WHERE r.voucher_id = @voucherId

     UNION ALL

     SELECT CAST(NULL AS INT) AS receipt_id, dr.draft_id,
            dr.receipt_date, dr.ba_id, dr.amount, dr.commission, dr.payment_mode, dr.details,
            dr.bank_id, dr.remarks, dr.voucher_id, dr.created_at,
            CAST('DRAFT' AS VARCHAR(10)) AS status,
            ba.name AS account_name, ba.code AS account_code,
            c.customer_id, c.name AS customer_name,
            b.name AS bank_name,
            dr.cheque_no, dr.cheque_date, dr.cheque_received_date,
            CAST(NULL AS VARCHAR(20)) AS cheque_status
     FROM dbo.draft_receipts dr
     JOIN dbo.business_accounts ba ON ba.ba_id = dr.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = dr.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = dr.bank_id
     WHERE dr.voucher_id = @voucherId

     ORDER BY created_at ASC, receipt_id ASC, draft_id ASC`,
    { voucherId: { type: sql.Int, value: voucherId } },
  );
  return result.recordset;
}

// One row per voucher with the aggregates the listing needs. `confirmed_lines` vs `line_count` is
// what the service turns into UNPOSTED/PARTIAL/POSTED — there is no stored status column to read
// (see migration 022 for why), so this is where that judgement gets its numbers.
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

  // Lines come from both dbo.receipts (posted) and dbo.draft_receipts (unposted) — see listLines()
  // for why. The union is folded into a single derived table first so every aggregate below counts
  // the whole voucher, not just its posted half (which would report a fully-unposted voucher as
  // having no lines at all, and so read POSTED-of-zero rather than UNPOSTED).
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `WITH all_lines AS (
       SELECT r.voucher_id, r.amount, r.payment_mode, 1 AS is_line,
              CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END AS is_confirmed
         FROM dbo.receipts r
       UNION ALL
       SELECT dr.voucher_id, dr.amount, dr.payment_mode, 1 AS is_line, 0 AS is_confirmed
         FROM dbo.draft_receipts dr
     )
     SELECT v.*,
            ISNULL(SUM(l.is_line), 0) AS line_count,
            ISNULL(SUM(l.is_confirmed), 0) AS confirmed_lines,
            ISNULL(SUM(l.amount), 0) AS total_amount,
            ISNULL(SUM(CASE WHEN l.payment_mode = 'CASH'   THEN l.amount ELSE 0 END), 0) AS total_cash,
            ISNULL(SUM(CASE WHEN l.payment_mode = 'CHEQUE' THEN l.amount ELSE 0 END), 0) AS total_cheque,
            ISNULL(SUM(CASE WHEN l.payment_mode = 'ONLINE' THEN l.amount ELSE 0 END), 0) AS total_online
     FROM dbo.receipt_vouchers v
     LEFT JOIN all_lines l ON l.voucher_id = v.voucher_id
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
    UPDATE dbo.receipt_vouchers
       SET voucher_date = @voucherDate,
           remarks      = @remarks,
           updated_by   = @updatedBy,
           updated_at   = SYSUTCDATETIME()
     WHERE voucher_id = @voucherId
  `);
}

// Keeps every line's own receipt_date equal to the header's date. Migration 022 kept the per-line
// date rather than dropping it (the ledger, cash book and every report read it), so the header
// moving has to carry its lines with it or the two silently disagree.
async function syncLineDates(transaction, voucherId, voucherDate) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
    voucherDate: { type: sql.Date, value: voucherDate },
  });
  await request.query(`
    UPDATE dbo.receipts
       SET receipt_date = @voucherDate, updated_at = SYSUTCDATETIME()
     WHERE voucher_id = @voucherId
  `);
}

async function remove(transaction, voucherId) {
  const request = requestWithParams(transaction, {
    voucherId: { type: sql.Int, value: voucherId },
  });
  await request.query('DELETE FROM dbo.receipt_vouchers WHERE voucher_id = @voucherId');
}

module.exports = {
  nextVoucherNo, insert, findById, listLines, list, updateHeader, syncLineDates, remove,
};
