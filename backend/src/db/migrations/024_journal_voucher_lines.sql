/* ============================================================================
   024 — Journal Voucher: multi-line double-entry rebuild

   WHAT: the legacy Journal Entry screen (client's reference screenshots
         "journal voucher.jpeg"/"jv2.0.jpeg") is a real multi-line double-entry
         journal — N lines, each against its own account, each a debit OR a
         credit, that must net to zero. The old model (one ba_id + direction +
         amount, other leg always forced onto a fixed JOURNAL VOUCHER account)
         cannot represent that, so it is replaced outright by dbo.journal_voucher_lines.

   dbo.journal_vouchers keeps only the header: jv_date, voucher_no, reason,
   remarks, status. ba_id/direction/amount move to the new lines table, one row
   per account touched.

   BACKFILL: existing rows get two lines each (the party leg + the old fixed
   JOURNAL VOUCHER account leg) so no historical data is silently dropped,
   before the now-unused columns are removed.
   ============================================================================ */

CREATE TABLE dbo.journal_voucher_lines (
  line_id     INT IDENTITY(1,1) NOT NULL,
  jv_id       INT           NOT NULL,
  line_no     INT           NOT NULL,
  ba_id       INT           NOT NULL,
  debit       DECIMAL(14,2) NOT NULL CONSTRAINT DF_jvl_debit  DEFAULT (0),
  credit      DECIMAL(14,2) NOT NULL CONSTRAINT DF_jvl_credit DEFAULT (0),
  -- Per-line note (e.g. "Eid compensation" on one leg, "damaged stock" on another) —
  -- distinct from the header's single reason, matching the legacy grid's per-row Narration.
  narration   NVARCHAR(500) NULL,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_jvl_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_jvl_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_journal_voucher_lines     PRIMARY KEY (line_id),
  CONSTRAINT FK_jvl_jv                    FOREIGN KEY (jv_id) REFERENCES dbo.journal_vouchers(jv_id) ON DELETE CASCADE,
  CONSTRAINT FK_jvl_ba                    FOREIGN KEY (ba_id) REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT CK_jvl_amounts_nonneg         CHECK (debit >= 0 AND credit >= 0),
  -- One side per line, same shape as dbo.ledger_entries.
  CONSTRAINT CK_jvl_one_side               CHECK (debit = 0 OR credit = 0),
  CONSTRAINT CK_jvl_nonzero                CHECK (debit > 0 OR credit > 0)
);
GO

CREATE INDEX IX_journal_voucher_lines_jv ON dbo.journal_voucher_lines(jv_id);
GO

/* ---- backfill existing single-line JVs into two lines each ---- */
INSERT INTO dbo.journal_voucher_lines (jv_id, line_no, ba_id, debit, credit, narration)
SELECT
  jv.jv_id,
  1,
  jv.ba_id,
  CASE WHEN jv.direction = 'DEBIT' THEN jv.amount ELSE 0 END,
  CASE WHEN jv.direction = 'DEBIT' THEN 0 ELSE jv.amount END,
  jv.reason
FROM dbo.journal_vouchers jv;
GO

-- Guard rather than silently backfilling an unbalanced single-leg JV if the reserved account is
-- somehow missing — a silent no-op here would be far worse to track down later than a loud failure.
--
-- Only when there is actually something to backfill, though. On a BRAND-NEW database (a fresh
-- install, or Settings > Reset Database, both of which migrate an empty database from scratch)
-- dbo.journal_vouchers is empty, so the INSERT below is a no-op and the reserved account is not
-- needed at all — but seed() has not run yet either, so an unconditional guard RAISERROR'd and
-- took the whole migrate() down with it. main.js/systemReset.service.js then never reached their
-- own seed() call on the following line, leaving the database with NO USERS AT ALL and the app
-- rejecting every login. Reported directly by the user after a reinstall-and-erase.
IF EXISTS (SELECT 1 FROM dbo.journal_vouchers)
AND NOT EXISTS (
  SELECT 1 FROM dbo.chart_of_accounts ca
  JOIN dbo.business_accounts ba ON ba.ac_id = ca.ac_id
  WHERE ca.code = '400007' -- CODES.JOURNAL_VOUCHER, see constants/reservedAccounts.js
)
BEGIN
  RAISERROR('024_journal_voucher_lines: reserved JOURNAL VOUCHER business account (chart code 400007) not found — run npm run seed before migrating', 16, 1);
END
GO

INSERT INTO dbo.journal_voucher_lines (jv_id, line_no, ba_id, debit, credit, narration)
SELECT
  jv.jv_id,
  2,
  ba.ba_id,
  CASE WHEN jv.direction = 'DEBIT' THEN 0 ELSE jv.amount END,
  CASE WHEN jv.direction = 'DEBIT' THEN jv.amount ELSE 0 END,
  jv.reason
FROM dbo.journal_vouchers jv
JOIN dbo.chart_of_accounts ca ON ca.code = '400007' -- CODES.JOURNAL_VOUCHER, see constants/reservedAccounts.js
JOIN dbo.business_accounts ba ON ba.ac_id = ca.ac_id;
GO

/* ---- drop the now-superseded header columns ---- */
ALTER TABLE dbo.journal_vouchers DROP CONSTRAINT CK_journal_vouchers_dir;
GO
ALTER TABLE dbo.journal_vouchers DROP CONSTRAINT CK_journal_vouchers_amount;
GO
ALTER TABLE dbo.journal_vouchers DROP CONSTRAINT FK_journal_vouchers_ba;
GO
-- 016_journal_vouchers.sql also indexed ba_id (paired with jv_date) — that index still
-- references the column and blocks the DROP COLUMN below until it's gone too.
DROP INDEX IX_journal_vouchers_ba ON dbo.journal_vouchers;
GO
ALTER TABLE dbo.journal_vouchers DROP COLUMN ba_id, direction, amount;
GO
