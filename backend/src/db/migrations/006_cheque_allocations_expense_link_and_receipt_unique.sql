-- Module 4.2 debugger fix (HIGH): expenses.service.js#post() for CHEQUE_ENDORSED calls
-- cheques.service.js#endorseToExpense() (its own committing transaction) then separately flips the
-- expense's own status (a second transaction) — if the second step fails after the first already
-- committed, a naive retry of post() would call endorseToExpense() a second time, double-disposing
-- the cheque. Adding a nullable back-reference from cheque_allocations to the expense that caused
-- it lets post() detect "did THIS expense already create an allocation?" before retrying, making it
-- safely idempotent.
--
-- Guarded: schema.sql already includes all of this directly, so this is a no-op on a fresh DB.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cheque_allocations') AND name = 'expense_id')
  ALTER TABLE dbo.cheque_allocations ADD expense_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.FK_cheque_allocations_expense'))
  ALTER TABLE dbo.cheque_allocations ADD CONSTRAINT FK_cheque_allocations_expense
        FOREIGN KEY (expense_id) REFERENCES dbo.expenses(expense_id);
GO

-- Module 4.2 debugger fix (LOW, defense in depth): cheques.repository.js's JOINs assume a
-- receipt has at most one cheque (the app-level invariant cheques.repository.js#insert() relies
-- on), but nothing in the schema actually enforced it. Filtered unique index — NULL-safe, though
-- receipt_id is NOT NULL on this table anyway.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.cheques') AND name = 'UQ_cheques_receipt')
  CREATE UNIQUE INDEX UQ_cheques_receipt ON dbo.cheques(receipt_id);
