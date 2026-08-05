-- Module 4.2: dbo.draft_expenses is documented as "field-for-field mirror of expenses" but was
-- never updated when expenses' payment_mode split 'CHEQUE' into CHEQUE_ENDORSED/CHEQUE_ISSUED
-- (cash_and_bank.md §6) — it still only allows the stale 'CHEQUE' value and has no
-- issued_cheque_no/issued_cheque_date columns at all. Brought into parity so a draft expense can
-- represent all four modes, same as a real one. Unlike draft_receipts (where a CHEQUE receipt
-- can't be usefully drafted because the cheque doesn't exist yet), a CHEQUE_ENDORSED draft expense
-- references an ALREADY-EXISTING received cheque (cheque_id), so there's no chicken-egg problem
-- here — all four payment modes are representable on a draft.
--
-- Guarded: schema.sql already includes all of this directly, so this is a no-op on a fresh DB.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_expenses') AND name = 'issued_cheque_no')
  ALTER TABLE dbo.draft_expenses ADD issued_cheque_no VARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.draft_expenses') AND name = 'issued_cheque_date')
  ALTER TABLE dbo.draft_expenses ADD issued_cheque_date DATE NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE object_id = OBJECT_ID('dbo.CK_draft_expenses_mode') AND definition NOT LIKE '%CHEQUE_ENDORSED%'
)
BEGIN
  ALTER TABLE dbo.draft_expenses DROP CONSTRAINT CK_draft_expenses_mode;
  ALTER TABLE dbo.draft_expenses ADD CONSTRAINT CK_draft_expenses_mode CHECK (payment_mode IN
        ('CASH','CHEQUE_ENDORSED','CHEQUE_ISSUED','ONLINE'));
END
GO

-- Same per-mode shape rule as CK_expenses_payment.
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CK_draft_expenses_payment'))
  ALTER TABLE dbo.draft_expenses ADD CONSTRAINT CK_draft_expenses_payment CHECK (
        (payment_mode = 'CASH'
             AND bank_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'ONLINE'
             AND bank_id IS NOT NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ENDORSED'
             AND cheque_id IS NOT NULL AND bank_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ISSUED'
             AND bank_id IS NOT NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NOT NULL AND issued_cheque_date IS NOT NULL));
