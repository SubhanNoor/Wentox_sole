/* ============================================================================
   030 — cartons become DECIMAL(12,1)

   WHAT: every carton quantity is INT today, so a half carton cannot be
   recorded. The client enters part-cartons and wants one decimal place
   (per the user, 2026-09-02).

   PAIRS STAY INT, DELIBERATELY. Stock is held in pairs
   (stock_movements.qty_pairs) and a pair of soles is indivisible, so
   `pairs = cartons * packing` must still come to a whole number. The
   services reject an entry that doesn't — chosen explicitly by the user
   over rounding, so nothing silently drifts between the carton figure on
   a document and the pairs that actually moved.

   DECIMAL(12,1) matches the money columns' own shape (12,2) on these
   tables, so the widths stay consistent.

   Three things block a plain ALTER and are handled below:
     - CHECK constraints on the column     -> dropped and recreated
     - wage_run_items.amount is a COMPUTED column (rate * cartons), and
       SQL Server refuses to alter a column a computed column depends on
       -> dropped first, recreated after
     - DEFAULT constraints also block the ALTER (verified against a
       throwaway database, which is how this was caught) -> dropped by
       lookup rather than by name, since an unnamed default gets an
       auto-generated one, then re-added as ((0)) exactly as before

   IF NOT EXISTS-guarded throughout, matching 021/022/025/028: schema.sql
   and the migrations run in the SAME migrate() pass on a fresh database,
   so anything unconditional here fails once schema.sql already made it.
   The guard is on the column TYPE, so a re-run is a no-op.
   ============================================================================ */

/* Drops whatever DEFAULT constraint sits on <table>.<column>, by lookup rather than by name —
   an unnamed default gets an auto-generated name, so hardcoding one is not safe across databases.
   The default is re-added after the ALTER; ((0)) is valid for decimal as it was for int. */

/* ---- sale_bill_items ------------------------------------------------------ */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.sale_bill_items') AND c.name = 'cartons' AND t.name = 'int')
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_sale_bill_items_ctn')
    ALTER TABLE dbo.sale_bill_items DROP CONSTRAINT CK_sale_bill_items_ctn;
  ALTER TABLE dbo.sale_bill_items ALTER COLUMN cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.sale_bill_items ADD CONSTRAINT CK_sale_bill_items_ctn CHECK (cartons >= 0);
END
GO

/* ---- draft_sale_bill_items ------------------------------------------------ */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.draft_sale_bill_items') AND c.name = 'cartons' AND t.name = 'int')
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_draft_sale_bill_items_ctn')
    ALTER TABLE dbo.draft_sale_bill_items DROP CONSTRAINT CK_draft_sale_bill_items_ctn;
  ALTER TABLE dbo.draft_sale_bill_items ALTER COLUMN cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.draft_sale_bill_items ADD CONSTRAINT CK_draft_sale_bill_items_ctn CHECK (cartons >= 0);
END
GO

/* ---- sale_return_items / draft_sale_return_items -------------------------- */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.sale_return_items') AND c.name = 'cartons' AND t.name = 'int')
  ALTER TABLE dbo.sale_return_items ALTER COLUMN cartons DECIMAL(12, 1) NOT NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.draft_sale_return_items') AND c.name = 'cartons' AND t.name = 'int')
  ALTER TABLE dbo.draft_sale_return_items ALTER COLUMN cartons DECIMAL(12, 1) NOT NULL;
GO

/* ---- the four header totals ----------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.sale_bills') AND c.name = 'total_cartons' AND t.name = 'int')
BEGIN
  DECLARE @df_total_cartons_sale_bills SYSNAME = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.sale_bills') AND c.name = 'total_cartons');
  IF @df_total_cartons_sale_bills IS NOT NULL
    EXEC('ALTER TABLE dbo.sale_bills DROP CONSTRAINT ' + @df_total_cartons_sale_bills);
  ALTER TABLE dbo.sale_bills ALTER COLUMN total_cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.sale_bills ADD CONSTRAINT DF_sb_ctn DEFAULT ((0)) FOR total_cartons;
END
GO
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.draft_sale_bills') AND c.name = 'total_cartons' AND t.name = 'int')
BEGIN
  DECLARE @df_total_cartons_draft_sale_bills SYSNAME = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.draft_sale_bills') AND c.name = 'total_cartons');
  IF @df_total_cartons_draft_sale_bills IS NOT NULL
    EXEC('ALTER TABLE dbo.draft_sale_bills DROP CONSTRAINT ' + @df_total_cartons_draft_sale_bills);
  ALTER TABLE dbo.draft_sale_bills ALTER COLUMN total_cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.draft_sale_bills ADD CONSTRAINT DF_dsb_ctn DEFAULT ((0)) FOR total_cartons;
END
GO
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.sale_returns') AND c.name = 'total_cartons' AND t.name = 'int')
BEGIN
  DECLARE @df_total_cartons_sale_returns SYSNAME = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.sale_returns') AND c.name = 'total_cartons');
  IF @df_total_cartons_sale_returns IS NOT NULL
    EXEC('ALTER TABLE dbo.sale_returns DROP CONSTRAINT ' + @df_total_cartons_sale_returns);
  ALTER TABLE dbo.sale_returns ALTER COLUMN total_cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.sale_returns ADD CONSTRAINT DF_sr_ctn DEFAULT ((0)) FOR total_cartons;
END
GO
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.draft_sale_returns') AND c.name = 'total_cartons' AND t.name = 'int')
BEGIN
  DECLARE @df_total_cartons_draft_sale_returns SYSNAME = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.draft_sale_returns') AND c.name = 'total_cartons');
  IF @df_total_cartons_draft_sale_returns IS NOT NULL
    EXEC('ALTER TABLE dbo.draft_sale_returns DROP CONSTRAINT ' + @df_total_cartons_draft_sale_returns);
  ALTER TABLE dbo.draft_sale_returns ALTER COLUMN total_cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.draft_sale_returns ADD CONSTRAINT DF_dsr_ctn DEFAULT ((0)) FOR total_cartons;
END
GO

/* ---- stock_voucher_lines --------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.stock_voucher_lines') AND c.name = 'cartons' AND t.name = 'int')
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_svl_cartons_nonneg')
    ALTER TABLE dbo.stock_voucher_lines DROP CONSTRAINT CK_svl_cartons_nonneg;
  DECLARE @df_cartons_stock_voucher_lines SYSNAME = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.stock_voucher_lines') AND c.name = 'cartons');
  IF @df_cartons_stock_voucher_lines IS NOT NULL
    EXEC('ALTER TABLE dbo.stock_voucher_lines DROP CONSTRAINT ' + @df_cartons_stock_voucher_lines);
  ALTER TABLE dbo.stock_voucher_lines ALTER COLUMN cartons DECIMAL(12, 1) NOT NULL;
  ALTER TABLE dbo.stock_voucher_lines ADD CONSTRAINT DF_svl_cartons DEFAULT ((0)) FOR cartons;
  ALTER TABLE dbo.stock_voucher_lines ADD CONSTRAINT CK_svl_cartons_nonneg CHECK (cartons >= 0);
END
GO

/* ---- wage_run_items: the computed column has to come off first ------------- */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.wage_run_items') AND c.name = 'cartons' AND t.name = 'int')
BEGIN
  IF EXISTS (SELECT 1 FROM sys.computed_columns WHERE object_id = OBJECT_ID('dbo.wage_run_items') AND name = 'amount')
    ALTER TABLE dbo.wage_run_items DROP COLUMN amount;
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_wage_run_items_ctn')
    ALTER TABLE dbo.wage_run_items DROP CONSTRAINT CK_wage_run_items_ctn;

  ALTER TABLE dbo.wage_run_items ALTER COLUMN cartons DECIMAL(12, 1) NOT NULL;

  ALTER TABLE dbo.wage_run_items ADD CONSTRAINT CK_wage_run_items_ctn CHECK (cartons > 0);
  -- Recreated exactly as it was: rate * cartons. A wage line is paid per carton, so a part
  -- carton now pays a part rate, which is the point of the change.
  ALTER TABLE dbo.wage_run_items ADD amount AS ([rate] * [cartons]);
END
GO

/* ---- stock_movements.input_qty --------------------------------------------
   Holds what was TYPED, alongside input_unit ('PAIRS' or 'CARTONS'). When the
   unit is CARTONS this is a carton count and needs the same decimal place;
   qty_pairs beside it stays INT, which is the whole point of the rule above. */
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.stock_movements') AND c.name = 'input_qty' AND t.name = 'int')
  ALTER TABLE dbo.stock_movements ALTER COLUMN input_qty DECIMAL(12, 1) NULL;
GO
