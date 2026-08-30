/* ============================================================================
   028 — ONLINE receipts/expenses can name ANY business account

   WHAT: an ONLINE receipt or payment could previously only name a BANK — the
         column is bank_id, a hard FK to dbo.bank_accounts, and posting resolved
         the ledger side through that bank's own linked business account
         (receipts.service.js#resolveDebitSide). The client genuinely settles
         online money against accounts that are not banks (per the user,
         2026-08-30), so these tables gain an alternative: online_ba_id, a
         direct FK to dbo.business_accounts.

   EXISTING DATA IS NOT TOUCHED. bank_id stays exactly as it is, still works,
   and is still what every already-recorded ONLINE row uses — explicitly
   required by the user ("must not disturb existing records"). The two columns
   are alternatives, never both: the services prefer online_ba_id when set and
   fall back to the bank lookup otherwise, so old rows keep posting through the
   exact path they always did.

   Only dbo.receipts carried a CHECK tying ONLINE to bank_id; it is relaxed to
   accept either column. draft_receipts/expenses/draft_expenses have no such
   CHECK, so they only need the column.

   IF NOT EXISTS-guarded throughout, matching 021/022/025: schema.sql and the
   migrations run in the SAME migrate() pass on a fresh database, so anything
   unconditional here fails the moment schema.sql already created it.
   ============================================================================ */

/* ---- dbo.receipts -------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.receipts') AND name = 'online_ba_id')
BEGIN
  ALTER TABLE dbo.receipts ADD online_ba_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_receipts_online_ba')
BEGIN
  ALTER TABLE dbo.receipts ADD CONSTRAINT FK_receipts_online_ba
    FOREIGN KEY (online_ba_id) REFERENCES dbo.business_accounts(ba_id);
END
GO

-- Relax the ONLINE rule: either column satisfies it now, and a non-ONLINE row must still carry
-- neither. Dropped and recreated rather than altered — SQL Server has no ALTER CONSTRAINT.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_receipts_bank')
BEGIN
  ALTER TABLE dbo.receipts DROP CONSTRAINT CK_receipts_bank;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_receipts_bank')
BEGIN
  ALTER TABLE dbo.receipts ADD CONSTRAINT CK_receipts_bank CHECK (
        (payment_mode =  'ONLINE' AND (bank_id IS NOT NULL OR online_ba_id IS NOT NULL))
     OR (payment_mode <> 'ONLINE' AND bank_id IS NULL AND online_ba_id IS NULL));
END
GO

/* ---- dbo.draft_receipts -------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_receipts') AND name = 'online_ba_id')
BEGIN
  ALTER TABLE dbo.draft_receipts ADD online_ba_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_draft_receipts_online_ba')
BEGIN
  ALTER TABLE dbo.draft_receipts ADD CONSTRAINT FK_draft_receipts_online_ba
    FOREIGN KEY (online_ba_id) REFERENCES dbo.business_accounts(ba_id);
END
GO

/* ---- dbo.expenses -------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.expenses') AND name = 'online_ba_id')
BEGIN
  ALTER TABLE dbo.expenses ADD online_ba_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_expenses_online_ba')
BEGIN
  ALTER TABLE dbo.expenses ADD CONSTRAINT FK_expenses_online_ba
    FOREIGN KEY (online_ba_id) REFERENCES dbo.business_accounts(ba_id);
END
GO

/* ---- dbo.draft_expenses -------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_expenses') AND name = 'online_ba_id')
BEGIN
  ALTER TABLE dbo.draft_expenses ADD online_ba_id INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_draft_expenses_online_ba')
BEGIN
  ALTER TABLE dbo.draft_expenses ADD CONSTRAINT FK_draft_expenses_online_ba
    FOREIGN KEY (online_ba_id) REFERENCES dbo.business_accounts(ba_id);
END
GO
