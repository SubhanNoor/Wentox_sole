/* ============================================================================
   029 — ONLINE expenses can name ANY business account (finishes 028)

   WHAT: migration 028 added the online_ba_id column + FK to dbo.expenses and
   dbo.draft_expenses (alongside receipts/draft_receipts) but only relaxed the
   CHECK constraint that ties ONLINE to bank_id on dbo.receipts
   (CK_receipts_bank) — CK_expenses_payment and CK_draft_expenses_payment on
   the expenses side were never touched, so they still hard-require
   bank_id IS NOT NULL for payment_mode = 'ONLINE'. An ONLINE expense recorded
   with only online_ba_id set (no bank_id) violates that CHECK at the SQL
   level and fails to save — reported by the user, 2026-08-30, as "bank_id
   required" while adding a payment against a freshly-added bank account.

   Both constraints are dropped and recreated (SQL Server has no ALTER
   CONSTRAINT) with the ONLINE branch relaxed the same way 028 relaxed
   CK_receipts_bank: bank_id OR online_ba_id, never both — matching the rule
   already enforced by expenses.service.js/draftExpenses.service.js
   #validateHeader. Every other branch (CASH/CHEQUE_ENDORSED/CHEQUE_ISSUED) is
   reproduced unchanged, plus now also requiring online_ba_id IS NULL there,
   since only ONLINE is ever allowed to carry it.

   EXISTING DATA IS NOT TOUCHED — bank_id-only ONLINE rows already satisfy the
   relaxed constraint exactly as they did the original one.
   ============================================================================ */

/* ---- dbo.expenses --------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_expenses_payment')
BEGIN
  ALTER TABLE dbo.expenses DROP CONSTRAINT CK_expenses_payment;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_expenses_payment')
BEGIN
  ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_payment CHECK (
        (payment_mode = 'CASH'
             AND bank_id IS NULL AND online_ba_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'ONLINE'
             AND (bank_id IS NOT NULL OR online_ba_id IS NOT NULL)
             AND NOT (bank_id IS NOT NULL AND online_ba_id IS NOT NULL)
             AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ENDORSED'
             AND cheque_id IS NOT NULL AND bank_id IS NULL AND online_ba_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ISSUED'
             AND bank_id IS NOT NULL AND online_ba_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NOT NULL AND issued_cheque_date IS NOT NULL));
END
GO

/* ---- dbo.draft_expenses ---------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_draft_expenses_payment')
BEGIN
  ALTER TABLE dbo.draft_expenses DROP CONSTRAINT CK_draft_expenses_payment;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_draft_expenses_payment')
BEGIN
  ALTER TABLE dbo.draft_expenses ADD CONSTRAINT CK_draft_expenses_payment CHECK (
        (payment_mode = 'CASH'
             AND bank_id IS NULL AND online_ba_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'ONLINE'
             AND (bank_id IS NOT NULL OR online_ba_id IS NOT NULL)
             AND NOT (bank_id IS NOT NULL AND online_ba_id IS NOT NULL)
             AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ENDORSED'
             AND cheque_id IS NOT NULL AND bank_id IS NULL AND online_ba_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ISSUED'
             AND bank_id IS NOT NULL AND online_ba_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NOT NULL AND issued_cheque_date IS NOT NULL));
END
GO
