/* ============================================================================
   024 — draft_receipts / draft_expenses: full parity with their real tables

   WHAT: columns the draft tables were missing to be able to hold ANY unposted
         receipt/expense, not just some of them:
           - draft_receipts.voucher_id           (RJ-03 voucher membership)
           - draft_receipts.cheque_no/_date/
             _received_date                      (CHEQUE-mode drafts)
           - draft_expenses.voucher_id           (PN-01 voucher membership)

   WHY:  the draft/real split now governs Receipts and Expenses the same way it
         governs Sale Bill / Sale Return / Purchase / Purchase Return: an
         unposted document lives in the DRAFT table, posting moves it into the
         real table (writing the ledger), unposting moves it back. That makes
         the real table strictly "posted only", so the ledger and every report
         reading it are correct by construction rather than by remembering to
         filter on status.

         Before this migration the draft tables could not represent two ordinary
         cases, which is why receipts/expenses were previously created straight
         into the real table under a status column:
           1. a CHEQUE receipt — draft_receipts carries a cheque_id FK but had
              no cheque_no/cheque_date of its own, and the cheques row cannot be
              written until the receipt exists (circular FK). Held as plain
              columns on the draft instead; the real cheques row is created at
              confirm time by the SAME receipts.service#insertReceipt() code as
              always, so cheque/deposit/endorse/bounce logic is untouched.
           2. a voucher line — receipts/expenses gained voucher_id in migration
              022 but the draft tables did not, so a draft could not belong to
              the voucher it was entered on.

   NOTE: no data migration is needed. Existing DRAFT rows in dbo.receipts /
         dbo.expenses are left exactly where they are — see the "pre-existing
         rows" note in PROGRESS.md. Nothing here drops or rewrites anything;
         every added column is nullable.
   ============================================================================ */

/* ---- dbo.draft_receipts -------------------------------------------------- */

IF COL_LENGTH('dbo.draft_receipts', 'voucher_id') IS NULL
BEGIN
  ALTER TABLE dbo.draft_receipts ADD voucher_id INT NULL
    CONSTRAINT FK_draft_receipts_voucher FOREIGN KEY (voucher_id)
      REFERENCES dbo.receipt_vouchers(voucher_id);
END
GO

/* Cheque details held directly on the draft. Same types/nullability as the
   dbo.cheques columns they are copied into at confirm time, so nothing can be
   silently truncated on the way across. */
IF COL_LENGTH('dbo.draft_receipts', 'cheque_no') IS NULL
  ALTER TABLE dbo.draft_receipts ADD cheque_no VARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.draft_receipts', 'cheque_date') IS NULL
  ALTER TABLE dbo.draft_receipts ADD cheque_date DATE NULL;
GO

IF COL_LENGTH('dbo.draft_receipts', 'cheque_received_date') IS NULL
  ALTER TABLE dbo.draft_receipts ADD cheque_received_date DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_draft_receipts_voucher')
  CREATE INDEX IX_draft_receipts_voucher ON dbo.draft_receipts(voucher_id);
GO

/* ---- dbo.draft_expenses -------------------------------------------------- */

IF COL_LENGTH('dbo.draft_expenses', 'voucher_id') IS NULL
BEGIN
  ALTER TABLE dbo.draft_expenses ADD voucher_id INT NULL
    CONSTRAINT FK_draft_expenses_voucher FOREIGN KEY (voucher_id)
      REFERENCES dbo.expense_vouchers(voucher_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_draft_expenses_voucher')
  CREATE INDEX IX_draft_expenses_voucher ON dbo.draft_expenses(voucher_id);
GO
