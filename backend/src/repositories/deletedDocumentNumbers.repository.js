// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
//
// One small shared table backing all four document types (see migration 032) — `doc_type` is
// always one of the hardcoded literals below, never user input, and each type's own draftX
// service.js#remove() is the only caller of `record()` (the app has exactly one delete path per
// type: the draft table's remove — a posted document is always unposted back to a draft first).
const { sql, query, requestWithParams } = require('../db/pool');

async function record(transaction, docType, systemNo, deletedBy) {
  const request = requestWithParams(transaction, {
    docType: { type: sql.VarChar(20), value: docType },
    systemNo: { type: sql.Int, value: systemNo },
    deletedBy: { type: sql.Int, value: deletedBy ?? null },
  });
  // IF NOT EXISTS guard: remove() is called once per draft_id, but the same system_no should never
  // be recorded twice regardless (defensive, not expected to actually trigger).
  await request.query(`
    IF NOT EXISTS (
      SELECT 1 FROM dbo.deleted_document_numbers WHERE doc_type = @docType AND system_no = @systemNo
    )
    INSERT INTO dbo.deleted_document_numbers (doc_type, system_no, deleted_by)
    VALUES (@docType, @systemNo, @deletedBy)
  `);
}

async function listByType(docType) {
  const result = await query(
    `SELECT system_no, deleted_at FROM dbo.deleted_document_numbers WHERE doc_type = @docType ORDER BY system_no`,
    { docType: { type: sql.VarChar(20), value: docType } },
  );
  return result.recordset;
}

// Receipt/Payment voucher numbers are NOT sequence-based like the other four doc types — voucher_no
// is a plain MAX(voucher_no)+1 (per the user, 2026-09-07: keep that reuse behavior as-is, just log
// deletions) — so a number logged as deleted can later be handed to a genuinely new voucher. Called
// from receiptVouchers.service.js#create()/expenseVouchers.service.js#create() right after a fresh
// voucher_no is resolved, so the stale "deleted" row never sits alongside the live voucher that just
// reclaimed its number (which would otherwise make it show as BOTH a real document and a deleted
// placeholder when browsing).
async function unrecord(transaction, docType, systemNo) {
  const request = requestWithParams(transaction, {
    docType: { type: sql.VarChar(20), value: docType },
    systemNo: { type: sql.Int, value: systemNo },
  });
  await request.query(`
    DELETE FROM dbo.deleted_document_numbers WHERE doc_type = @docType AND system_no = @systemNo
  `);
}

module.exports = { record, listByType, unrecord };
