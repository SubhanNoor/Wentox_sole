/* ============================================================================
   023 — Journal Voucher: manual Voucher Number

   WHAT: a free-text "Number" field next to Date on the JV entry screen, matching
         the field set of the legacy Journal Entry screen (see the client's
         reference screenshot) — a manual voucher number the office can write on
         paper/cross-reference, distinct from jv_id (the internal identity every
         other page already exposes as "JV #<jv_id>"). Optional and unvalidated,
         same treatment as sale_bills.gp_no/bilty_no — nothing downstream depends
         on it being present or unique.
   ============================================================================ */

ALTER TABLE dbo.journal_vouchers ADD voucher_no NVARCHAR(30) NULL;
GO
