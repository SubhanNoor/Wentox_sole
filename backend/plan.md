# Wentox Backend — Build Plan

This sequences the work **ahead of** `milestones/milestone1.md … milestone5.md`: the engine switch
to MS SQL Server and the doc reconciliation it depends on. Read this before picking up any
milestone task.

## Where the project actually stands

Per `System_architecture/architecture-v2.md` §0:

- **Schema:** 0 tables exist anywhere. The old `backend/src/db/migrations/001_init.sql` (Postgres)
  was never applied against real data. `database_schema_v4.3.md` is the current source of truth
  and targets **MS SQL Server**, not Postgres.
- **Backend code:** 100% scaffolding. Every route file has zero registered routes; every
  controller/service/repository exports `{}`. Nothing is callable yet, not even login.
- **Frontend:** fully built (19 pages) but runs entirely on hardcoded in-memory demo data
  (`AppContext.tsx`). No API call exists anywhere yet — frontend and backend are disconnected.

Because nothing has shipped against the old Postgres shape, switching engines now costs a rewrite
of scaffolding only, not a data migration.

## Step 1 — Reconcile `use_cases.md` (deferred, blocked on you)

`use_cases.md` is v3.0, sourced from `architecture-v2.md`, so it isn't deeply stale — but it
predates several v4.3-only additions:

- `draft_sale_bills`/`draft_sale_bill_items` and the mirrored `draft_sale_returns`/
  `draft_sale_return_items` (dummy/unconfirmed documents, §5.6.1–5.6.2 of the schema doc)
- `draft_receipts`/`draft_expenses` (same dummy-record pattern)
- `bank_accounts`/`cheques` (cheque lifecycle pulled out of `receipts`/`expenses`)
- `account_classes` (promoted from a fixed `CHECK` list to a real lookup)
- **Removed:** the "Without Bilty"/"Without Adda" dispatch-later workflow (now that `store_id` is
  nullable but `bilty_no`/`adda_id` are `NOT NULL`), and the payment-overdue alert (only cheque-due
  alerts remain)

Action: once you supply the use case you said was missing, do one pass adding/annotating the UCs
above (and the two removed workflows) directly in `use_cases.md`. This is a delta note, not a
rewrite — 25 of 38 use cases are already ✅ and unaffected.

## Step 2 — Engine switch (Postgres → MS SQL Server)

1. `package.json`: remove `pg`, add `mssql` (Tedious driver).
2. `src/config`: replace Postgres connection env vars with SQL Server ones (server, database,
   user/password or Windows auth, port, encrypt/trustServerCertificate options).
3. `src/db/pool.js`: rewrite `withTransaction()` around an `mssql` `ConnectionPool` +
   `Transaction`/`Request`, matching the shape services already expect (open transaction, hand
   back a request-like object, commit/rollback on error).
4. Archive `src/db/migrations/001_init.sql` (old Postgres schema — do not edit or apply it).
5. Generate the new migration T-SQL directly from `database_schema_v4.3.md`'s DDL (30 tables,
   meant to be used verbatim per that document) as the new `001_init.sql` (or `002_...` if the old
   one is kept for reference instead of deleted — confirm with user which).

## Step 3 — Re-check milestones against v4.3

Re-diff `milestones/milestone1.md … milestone9.md` against the v4.3 table list above; correct any
task written against the old shape (e.g. anything assuming `control_accounts`, the old
`due_date`-based alert, or dispatch-later sale bills without a store). Milestones 2–8 are now
sequenced by frontend sidebar screen order (Sale Bill → Sale Return → Purchase → Purchase Return →
Receipts → Expenses → Current Stock/Reports/Search → System Setup → Accounts Hierarchy), not by
backend layer — see `milestones/README.md`.

## Step 4 — Resume at Milestone 1 (Foundation & Auth)

The actual next coding task: `users` table (with a `role` column — currently missing per
architecture-v2 §0), JWT login/logout, seed script. Gated as always by the pre-edit-approval hook
(`.claude/hooks/pre-edit-approval.sh`) — plan the task, get approval, then implement; the Stop hook
runs the `debugger` subagent afterward.

## Verification per step

- Step 2: `npm run migrate` applies cleanly against a local SQL Server instance; `npm run seed`
  inserts the admin user + CASH/SALES accounts + default store without error.
- Step 4: `POST /api/auth/login` returns a JWT for the seeded admin; a protected route rejects
  requests without a valid token.
