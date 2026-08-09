/* ============================================================================
   014 — Receipts (Jamma) against ANY business account, not just customers

   WHY: receipts.customer_id was NOT NULL with an FK to dbo.customers, so the
        Jamma screen could only ever offer customers — money coming back from a
        director, an employee, a vendor refund or a bank had nowhere to go.
        Expenses (Naam) has always worked the other way: a single ba_id that
        points at any business account, with vendors merely detected through
        their parent chart account. This makes the two sides symmetrical.

   WHAT: replace customer_id with ba_id on dbo.receipts and dbo.draft_receipts.

   NO INFORMATION IS LOST. dbo.customers.ba_id has a UNIQUE filtered index, so
   the mapping is 1:1 and reversible — "which customer paid this" is still
   answerable with
       JOIN dbo.customers c ON c.ba_id = r.ba_id
   and that join has a useful side effect: it excludes non-customer receipts
   automatically, keeping money from a director out of a customer's "Payment
   Received" total on Sale Analysis / Sale Report.

   customers.ba_id is NULLABLE (a customer created before its account exists —
   TASK-05's "Please add customer account first"), so the backfill can leave a
   row behind. That is a data problem, not something to paper over with a
   nullable column, so it aborts the migration with an actionable message.
   ============================================================================ */

/* ---- dbo.receipts ------------------------------------------------------- */
ALTER TABLE dbo.receipts ADD ba_id INT NULL;
GO

UPDATE r
   SET r.ba_id = c.ba_id
  FROM dbo.receipts r
  JOIN dbo.customers c ON c.customer_id = r.customer_id;
GO

IF EXISTS (SELECT 1 FROM dbo.receipts WHERE ba_id IS NULL)
  THROW 50014, 'Migration 014: one or more receipts belong to a customer with no linked business account. Open Setup > Customers, save those customers so their account is created, then restart.', 1;
GO

ALTER TABLE dbo.receipts ALTER COLUMN ba_id INT NOT NULL;
GO

ALTER TABLE dbo.receipts
  ADD CONSTRAINT FK_receipts_ba FOREIGN KEY (ba_id) REFERENCES dbo.business_accounts(ba_id);
GO

DROP INDEX IX_receipts_customer ON dbo.receipts;
GO

ALTER TABLE dbo.receipts DROP CONSTRAINT FK_receipts_cust;
GO

ALTER TABLE dbo.receipts DROP COLUMN customer_id;
GO

CREATE INDEX IX_receipts_account ON dbo.receipts(ba_id, receipt_date);
GO

/* ---- dbo.draft_receipts ------------------------------------------------- */
ALTER TABLE dbo.draft_receipts ADD ba_id INT NULL;
GO

UPDATE dr
   SET dr.ba_id = c.ba_id
  FROM dbo.draft_receipts dr
  JOIN dbo.customers c ON c.customer_id = dr.customer_id;
GO

IF EXISTS (SELECT 1 FROM dbo.draft_receipts WHERE ba_id IS NULL)
  THROW 50014, 'Migration 014: one or more draft receipts belong to a customer with no linked business account. Open Setup > Customers, save those customers so their account is created, then restart.', 1;
GO

ALTER TABLE dbo.draft_receipts ALTER COLUMN ba_id INT NOT NULL;
GO

ALTER TABLE dbo.draft_receipts
  ADD CONSTRAINT FK_draft_receipts_ba FOREIGN KEY (ba_id) REFERENCES dbo.business_accounts(ba_id);
GO

DROP INDEX IX_draft_receipts_customer ON dbo.draft_receipts;
GO

ALTER TABLE dbo.draft_receipts DROP CONSTRAINT FK_draft_receipts_cust;
GO

ALTER TABLE dbo.draft_receipts DROP COLUMN customer_id;
GO

CREATE INDEX IX_draft_receipts_account ON dbo.draft_receipts(ba_id, receipt_date);
GO
