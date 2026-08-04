-- Module 4.2 debugger fix, round 2: making expenses.service.js#post() idempotent for
-- CHEQUE_ENDORSED (migration 006) closed the retry gap at the post() level, but
-- draftExpenses.service.js#confirm() still minted a BRAND-NEW expense on every call — so a user
-- retrying via the Drafts UI after a stuck confirm() (the realistic recovery path, not a direct
-- expenses:post retry) would create a second expense and, via post()'s CHEQUE_ENDORSED delegation,
-- a second real cheque_allocations row for the same disposition. Adding a nullable
-- pending_expense_id lets confirm() record which real expense it already created for this draft
-- BEFORE attempting to post it, so any later confirm() call on the same draft resumes against that
-- SAME expense_id (whose post() is already idempotent) instead of creating another one.
ALTER TABLE dbo.draft_expenses ADD pending_expense_id INT NULL;
GO
ALTER TABLE dbo.draft_expenses ADD CONSTRAINT FK_draft_expenses_pending_expense
      FOREIGN KEY (pending_expense_id) REFERENCES dbo.expenses(expense_id);
