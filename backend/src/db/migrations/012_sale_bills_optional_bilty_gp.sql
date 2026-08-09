-- gp_no/bilty_no on dbo.sale_bills were NOT NULL — dispatch paperwork (gate pass, bilty) is often
-- not known yet when the bill is written up, so the requirement was dropped: both can now be left
-- blank at save time and filled in later via the bilty/adda update flow (UC-07 "Search & Bilty
-- Adda Updation", saleBills.service.js#updateBiltyInfo). Guarded on IS_NULLABLE so this is a
-- no-op on a fresh database created from the current schema.sql, which already has both nullable.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.sale_bills') AND name = 'gp_no' AND is_nullable = 0
)
  ALTER TABLE dbo.sale_bills ALTER COLUMN gp_no VARCHAR(30) NULL;

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.sale_bills') AND name = 'bilty_no' AND is_nullable = 0
)
  ALTER TABLE dbo.sale_bills ALTER COLUMN bilty_no VARCHAR(30) NULL;
