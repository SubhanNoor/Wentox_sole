/* ============================================================================
   034 — Journal Voucher: system-generated sequential number (JV-01, changes-14-09-26.md)

   WHAT: `voucher_no` (added manual/free-text by migration 023) becomes system-generated,
   sequential and read-only — same treatment as Sale Bill/Purchase/etc.'s own System No.
   (dbo.seq_sale_bill_no and friends), allocated via nextSequenceValue() at creation time so a
   voucher shows its number before it is ever posted. The column itself is unchanged (still
   NVARCHAR(30) — kept as-is per the client's own instruction, "the voucher_no column stays, only
   how it is filled changes"); only journalVouchers.repository.js#insert() now fills it from the
   sequence instead of accepting client input.

   Backfill: every existing JV (all 5 currently have voucher_no = NULL — the manual field was
   never actually used) gets numbered 1, 2, 3… in creation order (created_at, jv_id), same
   ordering rule as migration 031's system_no backfill.

   Deleted numbers are logged via the existing shared dbo.deleted_document_numbers table (031/032)
   under doc_type 'JOURNAL_VOUCHER' — no schema change needed there, it already accepts any
   doc_type literal.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_journal_voucher_no')
BEGIN
  UPDATE jv
  SET jv.voucher_no = CAST(t.rn AS NVARCHAR(30))
  FROM dbo.journal_vouchers jv
  JOIN (
    SELECT jv_id, ROW_NUMBER() OVER (ORDER BY created_at, jv_id) AS rn
    FROM dbo.journal_vouchers
  ) t ON t.jv_id = jv.jv_id;

  DECLARE @nextNo INT = (SELECT ISNULL(MAX(TRY_CAST(voucher_no AS INT)), 0) FROM dbo.journal_vouchers) + 1;
  DECLARE @sql NVARCHAR(200) = N'CREATE SEQUENCE dbo.seq_journal_voucher_no AS INT START WITH ' + CAST(@nextNo AS NVARCHAR(10)) + N' INCREMENT BY 1;';
  EXEC sp_executesql @sql;
END
GO
