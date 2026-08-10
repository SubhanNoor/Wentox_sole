/* ============================================================================
   018 — Sale Return: bilty_no, gp_no and adda_id become optional

   WHY: dispatch details are not always known when the return is recorded — the
        goods may come back before any bilty exists, or without going through a
        transport adda at all. Sale BILLS were already relaxed this way
        (012_sale_bills_optional_bilty_gp.sql, 013_sale_bills_optional_adda.sql);
        returns were left NOT NULL, so the two screens disagreed about the same
        three fields.

   Both draft tables already allow NULL in all three, so a draft could hold a
   return that its own confirm step would then reject. This closes that too.

   Nothing is backfilled: existing rows keep whatever they carry. Dropping NOT
   NULL only widens what is accepted from here on.
   ============================================================================ */

-- The type and length MUST be restated exactly as they are (VARCHAR(30), verified against
-- sys.columns) — ALTER COLUMN rewrites the whole definition, so naming a different type here would
-- silently convert the column as a side effect of making it nullable.
ALTER TABLE dbo.sale_returns ALTER COLUMN bilty_no VARCHAR(30) NULL;
GO

ALTER TABLE dbo.sale_returns ALTER COLUMN gp_no VARCHAR(30) NULL;
GO

-- adda_id keeps FK_sale_returns_adda; only the NOT NULL goes. A return with no
-- adda simply has no transport destination recorded.
ALTER TABLE dbo.sale_returns ALTER COLUMN adda_id INT NULL;
GO
