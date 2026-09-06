/* ============================================================================
   031 — One stable System No. per document, from draft through posted

   WHAT: Sale Bill, Sale Return, Purchase, and Purchase Return each live in two tables: a draft
   table while unposted, a real table once posted. Each of those eight tables has its OWN
   independent IDENTITY(1,1). Posting deletes the draft row and INSERTs a brand-new row into the
   real table, picking up a fresh id from that table's own counter — unrelated to the id the
   document had as a draft. The frontend showed this id as the document's "System No.", so that
   number visibly changed the moment a document was posted (per the user, 2026-09-05).

   NOT included here: Receipts (Payments) and Expenses. Both already have a stable,
   posting-independent number — receipt_vouchers.voucher_no / expense_vouchers.voucher_no —
   assigned once when the voucher is created and never touched again by posting/unposting an
   individual line (migration 022). The user's ask is already satisfied there; adding a second,
   unused system_no to draft_receipts/receipts or draft_expenses/expenses would just be dead
   weight with no user-visible effect.

   This adds a `system_no INT NOT NULL` column to both tables of each pair, sourced from one
   SEQUENCE per document type (four total, each independent — Sale Bill's numbers don't share a
   counter with Purchase's, etc.):
     - A new draft gets `NEXT VALUE FOR` its type's sequence at insert time.
     - Confirming a draft CARRIES OVER its existing system_no into the new real-table row —
       never regenerates it. See draftXService.js#confirm() / repository insert changes
       (application code, not this migration).

   BACKFILL: existing rows have no system_no. Every draft + real row (per type) is numbered
   1, 2, 3… in order of whatever created_at it has. This is a best-effort ordering — a posted
   document's original draft-creation moment is gone once it was posted, so its own (later)
   created_at is used instead — so some existing documents' displayed number may shift once here;
   from then on it never changes again (per the user, explicitly accepted, 2026-09-05).

   No cross-table UNIQUE constraint is possible (draft and real are separate tables) — correctness
   depends entirely on every NEW number coming from the SEQUENCE, never a client-side or MAX()+1
   guess computed at insert time.

   NOT touched: ledger_entries/stock_movements' own source_id/source_type, which reference a
   document's real table id (bill_id, etc.) for lookups — those keep pointing at the actual DB
   identity exactly as today. system_no is a pure display/search number layered on top.

   IF NOT EXISTS-guarded throughout, matching 021/022/025/028/030: schema.sql and the migrations
   run in the SAME migrate() pass on a fresh database, so anything unconditional here fails once
   schema.sql already made it. The guard is per-step, so a re-run (or a fresh DB where schema.sql
   never had these columns) is a no-op / safe to resume.
   ============================================================================ */

/* ============================================================================
   Sale Bill — draft_sale_bills(draft_id) / sale_bills(bill_id)
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_sale_bills') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.draft_sale_bills ADD system_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.sale_bills') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.sale_bills ADD system_no INT NULL;
END
GO

IF EXISTS (SELECT 1 FROM dbo.draft_sale_bills WHERE system_no IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.sale_bills WHERE system_no IS NULL)
BEGIN
  -- A CTE is only in scope for the ONE statement right after it — a #temp table survives the
  -- whole batch, which is what letting two separate UPDATEs share one numbering pass requires.
  SELECT src, id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  INTO #numbered_sb
  FROM (
    SELECT 'd' AS src, draft_id AS id, created_at FROM dbo.draft_sale_bills
    UNION ALL
    SELECT 'r', bill_id, created_at FROM dbo.sale_bills
  ) ordered;

  UPDATE d SET system_no = n.rn
  FROM dbo.draft_sale_bills d JOIN #numbered_sb n ON n.src = 'd' AND n.id = d.draft_id;

  UPDATE r SET system_no = n.rn
  FROM dbo.sale_bills r JOIN #numbered_sb n ON n.src = 'r' AND n.id = r.bill_id;

  DROP TABLE #numbered_sb;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_sale_bills') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.draft_sale_bills ALTER COLUMN system_no INT NOT NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.sale_bills') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.sale_bills ALTER COLUMN system_no INT NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_sale_bill_no')
BEGIN
  DECLARE @next_sb INT = (SELECT ISNULL(MAX(system_no), 0) + 1 FROM (
    SELECT system_no FROM dbo.draft_sale_bills
    UNION ALL
    SELECT system_no FROM dbo.sale_bills
  ) t);
  DECLARE @sql_sb NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_sale_bill_no AS INT START WITH ' + CAST(@next_sb AS NVARCHAR(20)) + N' INCREMENT BY 1;';
  EXEC sp_executesql @sql_sb;
END
GO

/* ============================================================================
   Sale Return — draft_sale_returns(draft_id) / sale_returns(return_id)
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_sale_returns') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.draft_sale_returns ADD system_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.sale_returns') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.sale_returns ADD system_no INT NULL;
END
GO

IF EXISTS (SELECT 1 FROM dbo.draft_sale_returns WHERE system_no IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.sale_returns WHERE system_no IS NULL)
BEGIN
  SELECT src, id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  INTO #numbered_sr
  FROM (
    SELECT 'd' AS src, draft_id AS id, created_at FROM dbo.draft_sale_returns
    UNION ALL
    SELECT 'r', return_id, created_at FROM dbo.sale_returns
  ) ordered;

  UPDATE d SET system_no = n.rn
  FROM dbo.draft_sale_returns d JOIN #numbered_sr n ON n.src = 'd' AND n.id = d.draft_id;

  UPDATE r SET system_no = n.rn
  FROM dbo.sale_returns r JOIN #numbered_sr n ON n.src = 'r' AND n.id = r.return_id;

  DROP TABLE #numbered_sr;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_sale_returns') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.draft_sale_returns ALTER COLUMN system_no INT NOT NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.sale_returns') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.sale_returns ALTER COLUMN system_no INT NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_sale_return_no')
BEGIN
  DECLARE @next_sr INT = (SELECT ISNULL(MAX(system_no), 0) + 1 FROM (
    SELECT system_no FROM dbo.draft_sale_returns
    UNION ALL
    SELECT system_no FROM dbo.sale_returns
  ) t);
  DECLARE @sql_sr NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_sale_return_no AS INT START WITH ' + CAST(@next_sr AS NVARCHAR(20)) + N' INCREMENT BY 1;';
  EXEC sp_executesql @sql_sr;
END
GO

/* ============================================================================
   Purchase — draft_purchases(draft_id) / purchases(purchase_id)
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_purchases') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.draft_purchases ADD system_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.purchases') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.purchases ADD system_no INT NULL;
END
GO

IF EXISTS (SELECT 1 FROM dbo.draft_purchases WHERE system_no IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.purchases WHERE system_no IS NULL)
BEGIN
  SELECT src, id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  INTO #numbered_pur
  FROM (
    SELECT 'd' AS src, draft_id AS id, created_at FROM dbo.draft_purchases
    UNION ALL
    SELECT 'r', purchase_id, created_at FROM dbo.purchases
  ) ordered;

  UPDATE d SET system_no = n.rn
  FROM dbo.draft_purchases d JOIN #numbered_pur n ON n.src = 'd' AND n.id = d.draft_id;

  UPDATE r SET system_no = n.rn
  FROM dbo.purchases r JOIN #numbered_pur n ON n.src = 'r' AND n.id = r.purchase_id;

  DROP TABLE #numbered_pur;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_purchases') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.draft_purchases ALTER COLUMN system_no INT NOT NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.purchases') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.purchases ALTER COLUMN system_no INT NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_purchase_no')
BEGIN
  DECLARE @next_pur INT = (SELECT ISNULL(MAX(system_no), 0) + 1 FROM (
    SELECT system_no FROM dbo.draft_purchases
    UNION ALL
    SELECT system_no FROM dbo.purchases
  ) t);
  DECLARE @sql_pur NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_purchase_no AS INT START WITH ' + CAST(@next_pur AS NVARCHAR(20)) + N' INCREMENT BY 1;';
  EXEC sp_executesql @sql_pur;
END
GO

/* ============================================================================
   Purchase Return — draft_purchase_returns(draft_id) / purchase_returns(return_id)
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_purchase_returns') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.draft_purchase_returns ADD system_no INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.purchase_returns') AND name = 'system_no')
BEGIN
  ALTER TABLE dbo.purchase_returns ADD system_no INT NULL;
END
GO

IF EXISTS (SELECT 1 FROM dbo.draft_purchase_returns WHERE system_no IS NULL)
   OR EXISTS (SELECT 1 FROM dbo.purchase_returns WHERE system_no IS NULL)
BEGIN
  SELECT src, id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  INTO #numbered_pret
  FROM (
    SELECT 'd' AS src, draft_id AS id, created_at FROM dbo.draft_purchase_returns
    UNION ALL
    SELECT 'r', return_id, created_at FROM dbo.purchase_returns
  ) ordered;

  UPDATE d SET system_no = n.rn
  FROM dbo.draft_purchase_returns d JOIN #numbered_pret n ON n.src = 'd' AND n.id = d.draft_id;

  UPDATE r SET system_no = n.rn
  FROM dbo.purchase_returns r JOIN #numbered_pret n ON n.src = 'r' AND n.id = r.return_id;

  DROP TABLE #numbered_pret;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_purchase_returns') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.draft_purchase_returns ALTER COLUMN system_no INT NOT NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.purchase_returns') AND name = 'system_no' AND is_nullable = 1)
BEGIN
  ALTER TABLE dbo.purchase_returns ALTER COLUMN system_no INT NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_purchase_return_no')
BEGIN
  DECLARE @next_pret INT = (SELECT ISNULL(MAX(system_no), 0) + 1 FROM (
    SELECT system_no FROM dbo.draft_purchase_returns
    UNION ALL
    SELECT system_no FROM dbo.purchase_returns
  ) t);
  DECLARE @sql_pret NVARCHAR(300) = N'CREATE SEQUENCE dbo.seq_purchase_return_no AS INT START WITH ' + CAST(@next_pret AS NVARCHAR(20)) + N' INCREMENT BY 1;';
  EXEC sp_executesql @sql_pret;
END
GO
