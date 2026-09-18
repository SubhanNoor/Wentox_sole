/* ============================================================================
   035 — Document System No. sequences: NO CACHE, and close the jumps already made

   WHY: every document-number sequence (031's four + 034's journal voucher) was created with
   SQL Server's default CACHE. The engine pre-allocates a block of values in memory and, on a
   service restart / unclean shutdown, throws away whatever of that block was not used yet — so
   the next number jumps by up to ~50. Reported by the user (2026-09-18): "journal voucher system
   numbers are not generated in order — after 5 comes 56". The same jump was already sitting
   unused in the other sequences (sale return would have gone 3 -> 54, purchase 9 -> 59, purchase
   return 1 -> 52).

   WHAT:
   1. Journal Voucher only: vouchers whose number jumped are renumbered back into order (by their
      current number, then jv_id). Numbers recorded in dbo.deleted_document_numbers are skipped, so
      a deleted number is never handed to a live voucher. voucher_no only became system-generated
      in 034 (the release before this one) and nothing stores it elsewhere — ledger narrations use
      jv_id — so this is safe. Other document types are NOT renumbered: none of them had consumed
      a jumped value yet.
   2. Every sequence: RESTART at (highest number in use, live OR logged deleted) + 1, and NO CACHE
      from now on. Allocation is one number per saved document, so the cost of NO CACHE is nil.
   ============================================================================ */

-- 1. Journal Voucher renumber ------------------------------------------------------------------
DECLARE @expected INT = 1, @jvId INT, @cur INT;
DECLARE jv_cur CURSOR LOCAL FAST_FORWARD FOR
  SELECT jv_id, TRY_CAST(voucher_no AS INT)
  FROM dbo.journal_vouchers
  WHERE TRY_CAST(voucher_no AS INT) IS NOT NULL
  ORDER BY TRY_CAST(voucher_no AS INT), jv_id;
OPEN jv_cur;
FETCH NEXT FROM jv_cur INTO @jvId, @cur;
WHILE @@FETCH_STATUS = 0
BEGIN
  WHILE @expected < @cur AND EXISTS (
    SELECT 1 FROM dbo.deleted_document_numbers WHERE doc_type = 'JOURNAL_VOUCHER' AND system_no = @expected
  )
    SET @expected += 1;
  IF @cur > @expected
    UPDATE dbo.journal_vouchers SET voucher_no = CAST(@expected AS NVARCHAR(30)) WHERE jv_id = @jvId;
  SET @expected = CASE WHEN @cur > @expected THEN @expected ELSE @cur END + 1;
  FETCH NEXT FROM jv_cur INTO @jvId, @cur;
END
CLOSE jv_cur;
DEALLOCATE jv_cur;
GO

-- 2. Restart every sequence right after the highest number in use, with NO CACHE -----------------
DECLARE @n INT, @sql NVARCHAR(300);

SELECT @n = ISNULL(MAX(n), 0) + 1 FROM (
  SELECT system_no AS n FROM dbo.sale_bills
  UNION ALL SELECT system_no FROM dbo.draft_sale_bills
  UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'SALE_BILL'
) x;
SET @sql = N'ALTER SEQUENCE dbo.seq_sale_bill_no RESTART WITH ' + CAST(@n AS NVARCHAR(20)) + N' NO CACHE;';
EXEC sp_executesql @sql;

SELECT @n = ISNULL(MAX(n), 0) + 1 FROM (
  SELECT system_no AS n FROM dbo.sale_returns
  UNION ALL SELECT system_no FROM dbo.draft_sale_returns
  UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'SALE_RETURN'
) x;
SET @sql = N'ALTER SEQUENCE dbo.seq_sale_return_no RESTART WITH ' + CAST(@n AS NVARCHAR(20)) + N' NO CACHE;';
EXEC sp_executesql @sql;

SELECT @n = ISNULL(MAX(n), 0) + 1 FROM (
  SELECT system_no AS n FROM dbo.purchases
  UNION ALL SELECT system_no FROM dbo.draft_purchases
  UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'PURCHASE'
) x;
SET @sql = N'ALTER SEQUENCE dbo.seq_purchase_no RESTART WITH ' + CAST(@n AS NVARCHAR(20)) + N' NO CACHE;';
EXEC sp_executesql @sql;

SELECT @n = ISNULL(MAX(n), 0) + 1 FROM (
  SELECT system_no AS n FROM dbo.purchase_returns
  UNION ALL SELECT system_no FROM dbo.draft_purchase_returns
  UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'PURCHASE_RETURN'
) x;
SET @sql = N'ALTER SEQUENCE dbo.seq_purchase_return_no RESTART WITH ' + CAST(@n AS NVARCHAR(20)) + N' NO CACHE;';
EXEC sp_executesql @sql;

SELECT @n = ISNULL(MAX(n), 0) + 1 FROM (
  SELECT TRY_CAST(voucher_no AS INT) AS n FROM dbo.journal_vouchers
  UNION ALL SELECT system_no FROM dbo.deleted_document_numbers WHERE doc_type = 'JOURNAL_VOUCHER'
) x;
SET @sql = N'ALTER SEQUENCE dbo.seq_journal_voucher_no RESTART WITH ' + CAST(@n AS NVARCHAR(20)) + N' NO CACHE;';
EXEC sp_executesql @sql;
GO
