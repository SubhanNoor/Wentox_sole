/* ============================================================================
   032 — Remembering a deleted document's System No., so browsing shows the gap

   WHAT: migration 031 gave Sale Bill/Sale Return/Purchase/Purchase Return a stable, never-reused
   System No. per document (SEQUENCE-based). Deleting a document (always a draft-table row — the
   app never allows deleting a still-posted document; unposting always comes first) permanently
   retires its number, which is correct (per the user, 2026-09-07: a reused number could later be
   handed to an unrelated document, which is worse than a gap) — but until now nothing recorded
   THAT it happened, so First/Prev/Next/Last just silently skipped straight over the gap.

   This adds one small table recording every deleted number, so the browse UI can show
   "Bill #25 — Deleted" as an actual stop instead of jumping straight from #24 to #26.

   (doc_type, system_no) is the natural key — each document type's numbers are independent (Sale
   Bill's own count, Purchase's own count, etc., same as everywhere else in this feature), so the
   same number can be deleted once in each of the four types without collision.
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'deleted_document_numbers')
BEGIN
  CREATE TABLE dbo.deleted_document_numbers (
    doc_type    VARCHAR(20)  NOT NULL,   -- 'SALE_BILL' | 'SALE_RETURN' | 'PURCHASE' | 'PURCHASE_RETURN'
    system_no   INT          NOT NULL,
    deleted_by  INT          NULL,
    deleted_at  DATETIME2(0) NOT NULL CONSTRAINT DF_ddn_deleted_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_deleted_document_numbers PRIMARY KEY (doc_type, system_no),
    CONSTRAINT FK_deleted_document_numbers_user FOREIGN KEY (deleted_by) REFERENCES dbo.users(user_id)
  );
END
GO
