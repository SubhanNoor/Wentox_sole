/* ============================================================================
   050 — Books Check clearances

   WHY: a Books Check problem the client has already settled by hand (per the user, 2026-11-28:
   "they have balanced the entry and made the account balance equal manually but it still appears
   as red notice") stayed red for good, because the check reads the records, not the balance.
   An admin can now mark one flagged item as cleared.

   WHAT: one row per cleared item. item_key names the item's exact records (e.g. the cheque
   number, the party and every receipt it is on), so if anything about that item changes it no
   longer matches and is flagged again. item_text is what the check showed when it was cleared.
   Safe to re-run.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'books_check_clearances' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.books_check_clearances (
    clearance_id INT IDENTITY(1,1) NOT NULL,
    check_key    VARCHAR(40)   NOT NULL,
    item_key     NVARCHAR(400) NOT NULL,
    item_text    NVARCHAR(1000) NULL,
    cleared_by   INT           NULL,
    cleared_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_bcc_cleared DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_books_check_clearances PRIMARY KEY (clearance_id),
    CONSTRAINT UQ_books_check_clearances UNIQUE (check_key, item_key),
    CONSTRAINT FK_bcc_user FOREIGN KEY (cleared_by) REFERENCES dbo.users(user_id)
  );
END
GO
