/* ============================================================================
   022 — Receipt & Expense vouchers (RJ-03, PN-01)

   WHY: a day's takings are entered at the END of the day, all at once, and they
        are not one customer's — they are whatever came in from whoever. The old
        screen made each receipt its own document with its own posting step, so
        twenty receipts meant twenty postings. The client's previous software
        (and the screen they showed us) works the other way: ONE voucher, a
        date/C.Book No/Remarks on its head, many entry lines beneath it, and a
        single Post at the end.

   Each line still names its OWN account — confirmed explicitly with the client:
   "records maybe for different customer". So this is a header table with any
   party per row, not a per-customer grouping.

   dbo.receipt_vouchers / dbo.expense_vouchers are pure headers. The entry lines
   stay in dbo.receipts / dbo.expenses exactly as they are, gaining only a
   voucher_id. Nothing about how a line posts changes — posting a voucher posts
   its lines, one at a time.

   STATUS IS DERIVED, NOT STORED. There is deliberately no status column here.
   Posting is per-line (each line gets its own transaction, so one line that
   cannot post never rolls back the lines that already did — decided explicitly
   with the client), which means a voucher can legitimately sit half-posted. A
   stored header status would be a second source of truth that is wrong the
   moment that happens. The header's state is read off its lines instead:
       no line CONFIRMED  -> UNPOSTED
       every line CONFIRMED -> POSTED
       otherwise          -> PARTIAL
   See receiptVouchers.service.js#deriveStatus.

   voucher_no is the "C.Book No" from the client's screen — a plain sequential
   integer, allocated MAX+1 by the service inside the creating transaction (the
   same approach business_accounts codes already use; this is a single-session
   desktop app, so there is no concurrent allocator to race).

   voucher_date is the head date. Lines keep their own receipt_date/expense_date
   — NOT removed, because the ledger, the cash book and every report read the
   line's date, and rewriting all of those is not in scope. The service writes
   the voucher's date onto each of its lines, so the two never disagree.

   BACKFILL: every existing receipt and expense becomes a one-line voucher of
   its own. No row is edited beyond gaining a voucher_id, no amount or date
   changes, and nothing is deleted — so an existing receipt reads and posts
   exactly as before, it simply now has a header. This keeps the model uniform
   (no permanent "voucher_id IS NULL means legacy" branch in every query) at the
   cost of one voucher row per pre-existing line, which is correct: each of
   those WAS its own document.

   Idempotent throughout, matching the rest of this folder.
   ============================================================================ */

/* ── dbo.receipt_vouchers ─────────────────────────────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'receipt_vouchers' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.receipt_vouchers (
    voucher_id   INT IDENTITY(1,1) NOT NULL,
    voucher_no   INT           NOT NULL,               -- "C.Book No" on the client's screen
    voucher_date DATE          NOT NULL,
    remarks      NVARCHAR(500) NULL,                   -- head-level; lines keep their own narration
    created_by   INT           NULL,
    updated_by   INT           NULL,
    created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_rv_created DEFAULT (SYSUTCDATETIME()),
    updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_rv_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_receipt_vouchers      PRIMARY KEY (voucher_id),
    CONSTRAINT UQ_receipt_vouchers_no   UNIQUE (voucher_no),
    CONSTRAINT FK_receipt_vouchers_user FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
    CONSTRAINT FK_receipt_vouchers_upd  FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
  );
  CREATE INDEX IX_receipt_vouchers_date ON dbo.receipt_vouchers(voucher_date);
END
GO

/* ── dbo.expense_vouchers ─────────────────────────────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'expense_vouchers' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.expense_vouchers (
    voucher_id   INT IDENTITY(1,1) NOT NULL,
    voucher_no   INT           NOT NULL,
    voucher_date DATE          NOT NULL,
    remarks      NVARCHAR(500) NULL,
    created_by   INT           NULL,
    updated_by   INT           NULL,
    created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_ev_created DEFAULT (SYSUTCDATETIME()),
    updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_ev_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_expense_vouchers      PRIMARY KEY (voucher_id),
    CONSTRAINT UQ_expense_vouchers_no   UNIQUE (voucher_no),
    CONSTRAINT FK_expense_vouchers_user FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
    CONSTRAINT FK_expense_vouchers_upd  FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
  );
  CREATE INDEX IX_expense_vouchers_date ON dbo.expense_vouchers(voucher_date);
END
GO

/* ── link columns ─────────────────────────────────────────────────────────── */
/* NULLable: the column has to exist before the backfill below can populate it,
   and a line being inserted by the service exists momentarily before its
   voucher_id is known. Every line ends up with one — enforced at the service
   layer, the same way receipts.cheque_id's "eventually not null" is. */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.receipts') AND name = 'voucher_id')
BEGIN
  ALTER TABLE dbo.receipts ADD voucher_id INT NULL
    CONSTRAINT FK_receipts_voucher FOREIGN KEY (voucher_id) REFERENCES dbo.receipt_vouchers(voucher_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_receipts_voucher' AND object_id = OBJECT_ID('dbo.receipts'))
  CREATE INDEX IX_receipts_voucher ON dbo.receipts(voucher_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'voucher_id')
BEGIN
  ALTER TABLE dbo.expenses ADD voucher_id INT NULL
    CONSTRAINT FK_expenses_voucher FOREIGN KEY (voucher_id) REFERENCES dbo.expense_vouchers(voucher_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_expenses_voucher' AND object_id = OBJECT_ID('dbo.expenses'))
  CREATE INDEX IX_expenses_voucher ON dbo.expenses(voucher_id);
GO

/* ── backfill: one voucher per existing line ──────────────────────────────── */
/* Guarded on "is there any line still without a voucher", so re-running is a
   no-op. OUTPUT ... INTO maps each new voucher back to the line that produced
   it: the voucher rows are inserted first, carrying the line's own id in
   voucher_no's place is NOT safe (voucher_no is UNIQUE and must stay a clean
   sequence), so a mapping table is used instead of guessing the id pairing from
   IDENTITY order — which is not guaranteed to match insertion order. */
IF EXISTS (SELECT 1 FROM dbo.receipts WHERE voucher_id IS NULL)
BEGIN
  DECLARE @rmap TABLE (voucher_id INT, receipt_id INT);
  DECLARE @rbase INT = ISNULL((SELECT MAX(voucher_no) FROM dbo.receipt_vouchers), 0);

  MERGE dbo.receipt_vouchers AS target
  USING (
    SELECT receipt_id,
           receipt_date,
           created_by,
           @rbase + ROW_NUMBER() OVER (ORDER BY receipt_date, receipt_id) AS voucher_no
    FROM dbo.receipts
    WHERE voucher_id IS NULL
  ) AS src
  ON 1 = 0                                    -- never matches: INSERT-only MERGE, used purely
  WHEN NOT MATCHED BY TARGET THEN              -- because it can OUTPUT both sides' columns
    INSERT (voucher_no, voucher_date, remarks, created_by)
    VALUES (src.voucher_no, src.receipt_date, NULL, src.created_by)
  OUTPUT inserted.voucher_id, src.receipt_id INTO @rmap (voucher_id, receipt_id);

  UPDATE r
     SET r.voucher_id = m.voucher_id
    FROM dbo.receipts r
    JOIN @rmap m ON m.receipt_id = r.receipt_id;
END
GO

IF EXISTS (SELECT 1 FROM dbo.expenses WHERE voucher_id IS NULL)
BEGIN
  DECLARE @emap TABLE (voucher_id INT, expense_id INT);
  DECLARE @ebase INT = ISNULL((SELECT MAX(voucher_no) FROM dbo.expense_vouchers), 0);

  MERGE dbo.expense_vouchers AS target
  USING (
    SELECT expense_id,
           expense_date,
           created_by,
           @ebase + ROW_NUMBER() OVER (ORDER BY expense_date, expense_id) AS voucher_no
    FROM dbo.expenses
    WHERE voucher_id IS NULL
  ) AS src
  ON 1 = 0
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (voucher_no, voucher_date, remarks, created_by)
    VALUES (src.voucher_no, src.expense_date, NULL, src.created_by)
  OUTPUT inserted.voucher_id, src.expense_id INTO @emap (voucher_id, expense_id);

  UPDATE e
     SET e.voucher_id = m.voucher_id
    FROM dbo.expenses e
    JOIN @emap m ON m.expense_id = e.expense_id;
END
GO
