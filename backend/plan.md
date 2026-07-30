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

## Step 2 — Engine switch (Postgres → MS SQL Server) — done

1. `package.json`: `pg` removed, `mssql` (Tedious driver) added.
2. `src/config`: Postgres connection env vars replaced with SQL Server ones (server, database,
   user/password, port, encrypt/trustServerCertificate options).
3. `src/db/pool.js`: `withTransaction()` rewritten around an `mssql` `ConnectionPool` +
   `Transaction`/`Request`, matching the shape services already expect (open transaction, hand
   back a request-like object, commit/rollback on error).
4. The old Postgres `001_init.sql` and the once-planned `src/db/migrations/001_init.sql` T-SQL copy
   are both gone — the schema source of truth is `database/schema.sql` at the repo root (T-SQL
   generated from `database_schema_v4.3.md`, 39 tables), which the user maintains directly.
   `src/db/migrate.js` applies it first, then any later numbered files under `src/db/migrations/`.

## Step 5 — Transport switch (Express/HTTP → Electron IPC) — done

The client wants a real desktop app, not something that looks like a local website — decided after
Step 4 was already underway, so this step landed alongside early Milestone 1 work rather than
before it.

1. `package.json`: `express`, `cors`, `jsonwebtoken` removed — no HTTP server, no bearer token.
2. `src/routes/` + `src/controllers/` deleted, replaced by `src/ipc/<feature>.ipc.js` (one file per
   feature, registers `ipcMain.handle('<feature>:<action>', ...)` channels, calls the service layer
   — same job `routes.js`+`controller.js` did, collapsed into one file since there's no URL routing
   or req/res object to separate).
3. `src/middleware/auth.js` (JWT verification) replaced by `src/ipc/session.js` — an in-memory
   `{ userId, username, role }` set by `auth:login`, checked via `requireSession()`/`requireRole()`
   in any handler that needs a logged-in user. `src/middleware/errorHandler.js` replaced by
   `src/ipc/wrap.js`, which **resolves** `{ ok: true, data }` or `{ ok: false, error: { message,
   code } }` — never throws across IPC, since Electron drops custom error properties (like
   `ApiError`'s `.code`) off anything thrown through `ipcMain.handle`; found and fixed during the
   Module 1.3 debug pass (see `PROGRESS.md`).
4. `electron/main.js` now calls `src/ipc/index.js`'s registrar before opening the `BrowserWindow`
   (previously it started the Express server); `electron/preload.js` exposes
   `window.api.<feature>.<action>(payload)` via `contextBridge` instead of just an API base URL.
5. JWT storage question (localStorage vs. `safeStorage`) is moot now — there's no token to store.
   The renderer just calls `window.api.auth.login(...)` and holds the returned `{ role }` in memory/
   React state for UI purposes (e.g. hiding admin-only nav items per UC-03).

## Step 3 — Re-check milestones against v4.3

Re-diff `milestones/milestone1.md … milestone9.md` against the v4.3 table list above; correct any
task written against the old shape (e.g. anything assuming `control_accounts`, the old
`due_date`-based alert, or dispatch-later sale bills without a store). Milestones 2–8 are now
sequenced by frontend sidebar screen order (Sale Bill → Sale Return → Purchase → Purchase Return →
Receipts → Expenses → Current Stock/Reports/Search → System Setup → Accounts Hierarchy), not by
backend layer — see `milestones/README.md`.

## Step 4 — Resume at Milestone 1 (Foundation & Auth)

Modules 1.1 (bootstrap) and 1.2 (database: pool, migrate, seed) are done. Remaining: Module 1.3 —
`auth:login`/`auth:logout`/`auth:update-credentials` over IPC, backed by `src/ipc/session.js`
(no JWT — see Step 5). Gated as always by the pre-edit-approval hook
(`.claude/hooks/pre-edit-approval.sh`) — plan the task, get approval, then implement; the Stop hook
runs the `debugger` subagent afterward.

## Verification per step

- Step 2: `npm run migrate` applies `database/schema.sql` cleanly against a local SQL Server
  instance; `npm run seed` inserts the admin user + account classes/chart accounts + default store
  without error.
- Step 4: `auth:login` resolves with a session for the seeded admin; a channel guarded by
  `requireSession()` rejects when called with no prior login.
- Step 5: the app launches via `npm run dev`/`npm start` with no Express server involved; a call
  from the renderer console (`window.api.cities.list()` once implemented) resolves via IPC.
