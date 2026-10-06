/* ============================================================================
   042 — Never-reused System No. sequences for Receipt, Payment and Stock vouchers

   WHY: the document page standard (System_architecture/document_page_standard.md §9) says a
   document's number comes from a NO CACHE sequence and is never reused. Per the user
   (2026-10-06, "sequences everywhere"), that now covers the three document types left out:
     - Receipt / Payment vouchers allocated voucher_no as MAX(voucher_no)+1 (migration 022), so
       deleting the newest voucher handed its number to the next one. This reverses the user's
       2026-09-07 "keep the reuse" decision.
     - Stock Voucher had no number at all — the screen showed the IDENTITY stock_voucher_id — and
       deleted ones were never logged.

   WHAT:
   1. dbo.seq_receipt_voucher_no / dbo.seq_expense_voucher_no, NO CACHE, starting right after the
      highest number ever used (live, or logged in dbo.deleted_document_numbers).
   2. dbo.stock_vouchers.voucher_no INT: backfilled with stock_voucher_id, so every voucher keeps
      the number it has always shown. dbo.seq_stock_voucher_no starts after the IDENTITY's current
      value as well, so a number the IDENTITY already handed out (to a since-deleted voucher) is
      never shown again. Deletes are logged as doc_type 'STOCK_VOUCHER' from now on.
   ============================================================================ */

-- 1. Receipt / Payment vouchers ----------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_receipt_voucher_no')
BEGIN
  DECLARE @r INT = (SELECT ISNULL(MAX(n), 0) + 1 FROM (
    SELECT voucher_no AS n FROM dbo.receipt_vouchers
    UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'RECEIPT_VOUCHER'
  ) x);
  DECLARE @rsql NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_receipt_voucher_no AS INT START WITH '
    + CAST(@r AS NVARCHAR(20)) + N' INCREMENT BY 1 NO CACHE;';
  EXEC sp_executesql @rsql;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_expense_voucher_no')
BEGIN
  DECLARE @e INT = (SELECT ISNULL(MAX(n), 0) + 1 FROM (
    SELECT voucher_no AS n FROM dbo.expense_vouchers
    UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'EXPENSE_VOUCHER'
  ) x);
  DECLARE @esql NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_expense_voucher_no AS INT START WITH '
    + CAST(@e AS NVARCHAR(20)) + N' INCREMENT BY 1 NO CACHE;';
  EXEC sp_executesql @esql;
END
GO

-- 2. Stock Voucher -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'voucher_no')
  ALTER TABLE dbo.stock_vouchers ADD voucher_no INT NULL;
GO

UPDATE dbo.stock_vouchers SET voucher_no = stock_voucher_id WHERE voucher_no IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers') AND name = 'voucher_no' AND is_nullable = 1)
  ALTER TABLE dbo.stock_vouchers ALTER COLUMN voucher_no INT NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_stock_vouchers_no' AND object_id = OBJECT_ID('dbo.stock_vouchers'))
  CREATE UNIQUE INDEX UQ_stock_vouchers_no ON dbo.stock_vouchers(voucher_no);
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_stock_voucher_no')
BEGIN
  DECLARE @s INT = (SELECT ISNULL(MAX(n), 0) + 1 FROM (
    SELECT voucher_no AS n FROM dbo.stock_vouchers
    -- last_value is NULL until the IDENTITY has handed out a value (IDENT_CURRENT would say 1).
    UNION ALL SELECT CAST(last_value AS INT) FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.stock_vouchers')
    UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'STOCK_VOUCHER'
  ) x);
  DECLARE @ssql NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_stock_voucher_no AS INT START WITH '
    + CAST(@s AS NVARCHAR(20)) + N' INCREMENT BY 1 NO CACHE;';
  EXEC sp_executesql @ssql;
END
GO
