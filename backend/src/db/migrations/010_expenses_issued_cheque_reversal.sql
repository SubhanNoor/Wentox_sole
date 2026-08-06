-- "Cheque Return" page follow-up: a cheque WE wrote (CHEQUE_ISSUED) had no bounce/return path at
-- all — the schema deliberately gave it no pending state (deduct-on-write, see the expenses
-- table's own comment). This adds the same reverse-never-delete lifecycle CHEQUE_ENDORSED already
-- gets via dbo.cheques' bounced_date/returned_date/return_reason, just kept on this row instead —
-- a cheque we write still isn't a dbo.cheques row (that table is for cheques RECEIVED).

ALTER TABLE dbo.expenses ADD
  issued_cheque_status        VARCHAR(20)   NOT NULL CONSTRAINT DF_expenses_issued_cheque_status DEFAULT ('PENDING'),
  issued_cheque_bounced_date  DATE          NULL,
  issued_cheque_returned_date DATE          NULL,
  issued_cheque_return_reason NVARCHAR(500) NULL;
GO

ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_issued_cheque_status CHECK (
      issued_cheque_status IN ('PENDING','BOUNCED','RETURNED'));
GO
ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_issued_cheque_bounced CHECK (
      (issued_cheque_bounced_date IS NULL     AND issued_cheque_status <> 'BOUNCED')
   OR (issued_cheque_bounced_date IS NOT NULL AND issued_cheque_status =  'BOUNCED'));
GO
ALTER TABLE dbo.expenses ADD CONSTRAINT CK_expenses_issued_cheque_returned CHECK (
      (issued_cheque_returned_date IS NULL     AND issued_cheque_status <> 'RETURNED')
   OR (issued_cheque_returned_date IS NOT NULL AND issued_cheque_status =  'RETURNED'));
GO

-- "Cheque Return" page's issued-cheque list (mirrors IX_cheques_endorsable).
CREATE INDEX IX_expenses_issued_cheque_returnable ON dbo.expenses(payment_mode, issued_cheque_status)
       WHERE payment_mode = 'CHEQUE_ISSUED' AND issued_cheque_status = 'PENDING';
GO
