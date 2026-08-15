/* ============================================================================
   020 — Wage run amount: rate x cartons (drop the packing multiplier)

   WHY: dbo.wage_run_items.amount was `rate * cartons * packing`, matching a
        rate defined per PAIR (see the design note on the table below, and on
        dbo.articles). The client wants stage rates read as per-CARTON going
        forward, so the packing multiplier is dropped: amount = rate * cartons.

        packing stays as a column (still snapshotted from the article per
        line, same as before) -- only the computed formula and the UI's use
        of it change. Removing the column itself is out of scope; it just
        stops feeding the calculation.

   Guarded on the column's current formula_definition so this is a no-op if
   already applied (idempotent, matching the rest of this migrations folder).
   ============================================================================ */

IF EXISTS (
  SELECT 1 FROM sys.computed_columns
  WHERE object_id = OBJECT_ID('dbo.wage_run_items') AND name = 'amount'
    AND definition LIKE '%packing%'
)
BEGIN
  ALTER TABLE dbo.wage_run_items DROP COLUMN amount;
  ALTER TABLE dbo.wage_run_items ADD amount AS (rate * cartons) PERSISTED NOT NULL;
END
