/* ============================================================================
   048 — Salary runs post on the first of their month

   WHY: the client wants every salary run dated the 1st of the month it is for (2026-11-09), not
   the last day. salaryRuns.service.js now does that for new runs; this moves the existing ones so
   every month reads the same.

   WHAT: each run's ledger rows and its run_date (drafts included) move to period_month, which is
   already the 1st (CK_salary_runs_month). Dates only, within the same month: no amount changes.
   Safe to re-run; a run already on the 1st matches nothing.
   ============================================================================ */

UPDATE le
   SET entry_date = sr.period_month, updated_at = SYSUTCDATETIME()
  FROM dbo.ledger_entries le
  JOIN dbo.salary_runs sr ON sr.salary_run_id = le.source_id
 WHERE le.source_type = 'SALARY_RUN' AND le.entry_date <> sr.period_month;

UPDATE dbo.salary_runs
   SET run_date = period_month, updated_at = SYSUTCDATETIME()
 WHERE run_date <> period_month;
GO
