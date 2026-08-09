-- adda_id on dbo.sale_bills was NOT NULL — same reasoning as migration 012's gp_no/bilty_no:
-- the transport adda is often not known yet when the bill is written up, so it can now be left
-- blank at save time and filled in later via the bilty/adda update flow (UC-07 "Search & Bilty
-- Adda Updation", saleBills.service.js#updateBiltyInfo). Guarded on IS_NULLABLE so this is a
-- no-op on a fresh database created from the current schema.sql, which already has it nullable.
-- The existing FK_sale_bills_adda constraint is untouched — a FOREIGN KEY already permits NULL.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.sale_bills') AND name = 'adda_id' AND is_nullable = 0
)
  ALTER TABLE dbo.sale_bills ALTER COLUMN adda_id INT NULL;
