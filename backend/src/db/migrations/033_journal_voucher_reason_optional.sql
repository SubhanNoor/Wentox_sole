/* ============================================================================
   033 — Journal Voucher: reason becomes optional

   changes-14-09-26.md JV-03: the client no longer wants a reason required up front on every
   Journal Voucher. Column was NOT NULL since migration 016_journal_vouchers.sql; this drops that
   constraint. No data migration needed — existing rows already have a value.

   IF NOT EXISTS-guarded on the column's current nullability so a re-run (or a fresh DB where
   schema.sql/016 already created it nullable) is a no-op.
   ============================================================================ */

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.journal_vouchers') AND name = 'reason' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.journal_vouchers ALTER COLUMN reason NVARCHAR(200) NULL;
END
GO
