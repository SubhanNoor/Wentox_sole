# Wentox Backend — Progress Log

**Current milestone:** Milestone 1 — Foundation & Auth
**Status:** Modules 1.1 & 1.2 done; Module 1.3 (Auth) in progress

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

---

### 2026-07-30 — Transport switch: Express/HTTP → Electron IPC
- **What:** Client wants a real desktop app, not something reachable like a local website, so the
  renderer↔backend transport changed from Express REST-over-localhost to Electron IPC — no HTTP
  server, no port, no JWT/bearer token. Removed `src/app.js`, `src/server.js`, `src/routes/`,
  `src/controllers/`, `src/middleware/{auth,errorHandler}.js`, and the dead `controlAccounts`
  feature (already gone from schema v4.3). Added `src/ipc/` (one `<feature>.ipc.js` per feature,
  replacing `routes.js`+`controller.js`; `index.js` central registrar; `session.js` — in-memory
  `{ userId, username, role }`, `requireSession()`/`requireRole()`; `wrap.js` — normalizes thrown
  `ApiError`s into a plain `{ message, code }`). `electron/main.js` now registers IPC handlers
  before opening the window; `electron/preload.js` exposes `window.api.<feature>.<action>(payload)`
  via a generic `Proxy`-based `contextBridge`, not just an API base URL. `package.json` dropped
  `express`/`cors`/`jsonwebtoken`; `config/index.js` dropped `port`/`jwtSecret`/`jwtExpiry` (DB
  connection only); `.env`/`.env.example` trimmed to just the `DB_*` vars.
- **How:** Renderer and backend logic share one OS process tree in this architecture, so there's no
  network boundary to protect with a token — "logged in" is just state held in `session.js`, same
  idea as the old JWT middleware but without a token to verify. `ipc/<feature>.ipc.js` collapses
  `routes`+`controllers` into one file since there's no URL routing or req/res object to separate.
  Milestone docs (`milestone1.md`, `milestone5–9.md`, `README.md`) converted from HTTP-shorthand
  endpoints (`GET /api/x`) to IPC channel names (`x:list`) via a documented mechanical mapping, so
  existing task detail didn't need a line-by-line rewrite.
- **Files:** `backend/package.json`, `backend/electron/{main.js,preload.js,README.md}`,
  `backend/src/ipc/**`, `backend/src/config/{index.js,README.md}`, `backend/src/middleware/{validate.js,README.md}`,
  `backend/src/{README.md,errors/README.md,services/README.md,repositories/README.md}`,
  `backend/.env`, `backend/.env.example`, `backend/CLAUDE.md`, `backend/plan.md`,
  `backend/milestones/{milestone1,milestone5,milestone7,milestone8,milestone9,README}.md`
- **Pending:** Module 1.3 (Auth) itself is still TODO stubs — `auth:login`/`logout`/`update-credentials`
  not yet implemented.

## Milestone 1 — Foundation & Auth

### 2026-07-11 — Backend scaffolding & planning docs
- **What:** Rewrote `System_architecture/database_schema.md` (v3: 21 relations, enums, ledger +
  stock-movement design, full DDL). Created milestones 1–5, CLAUDE.md, this file, layered-modular
  folder structure with minimal boilerplate (Express skeleton, pg pool, config, migration runner
  placeholders), and `.claude/settings.json` wiring the pre-edit-approval and debugger hooks.
- **How:** Schema gaps (users, expenses, stock, ledger) closed per use cases UC-01…UC-20; posting
  semantics documented in the schema doc's Design Decisions.
- **Files:** `System_architecture/database_schema.md`, `backend/*`

### 2026-07-11 — Layer stubs in every module + errors folder
- **What:** Added `routes.js / controller.js / service.js / repository.js` stubs to all 16 modules;
  split `accounts` into `groups / controls / chart / business` submodules with an aggregating
  `accounts/routes.js`; added `src/errors/ApiError.js` (used by services + errorHandler).
- **How:** Each stub encodes its layer's rule (controllers: no SQL/logic; repositories: parameterized
  SQL only; services: ApiError + withTransaction). All files pass `node --check`.
- **Files:** `backend/src/{routes,controllers,services,repositories}/**`, `backend/src/errors/ApiError.js`

### 2026-07-11 — Schema v3.1 for updated use cases (UC-08 production, UC-21 addas)
- **What:** Use cases v2.1 changed UC-08 to "Manage Stock & Production Logs" and added UC-21
  (Transport Addas with delete protection). Schema updated: `PRODUCTION` added to
  `stock_movement_type`; `stock_movements` gained `input_qty`, `input_unit` (CARTONS/PAIRS) and
  `packing` snapshot so PRODUCTION rows double as the production log; `vendors` gained
  `phone`/`city`; `products` gained `color` (matching new frontend types).
- **How:** No new table needed — production logs are PRODUCTION stock movements filtered by date.
  Adda delete protection comes from the existing FK (RESTRICT) + a 409 guard in the service
  (Milestone 2.3). Milestones 2/4/5 and routes README updated accordingly.
- **Files:** `System_architecture/database_schema.md`, `backend/src/db/migrations/001_init.sql`,
  `backend/milestones/milestone{2,4,5}.md`, `backend/src/routes/README.md`

### 2026-07-30 — Milestones restructured to follow frontend sidebar order
- **What:** Replaced milestones 1–5 (layer-first: Foundation, Setup CRUD, Accounts, Transactions,
  Reports) with milestones 1–9, where 2–8 follow the frontend sidebar's own screen order (Sale
  Bill → Sale Return → Purchase → Purchase Return → Receipts → Expenses → Current
  Stock/Reports/Search → System Setup → Accounts Hierarchy), 2–3 screens per milestone.
- **How:** All original task detail (posting rules, v4.3 notes, UC references) carried over
  unchanged — only the grouping/order changed. `Workers` (sidebar item with no schema/use-case
  entry) flagged as blocked in Milestone 7 rather than inventing fields for it.
- **Files:** `backend/milestones/milestone{1..9}.md`, `backend/milestones/README.md`,
  `backend/CLAUDE.md`, `backend/plan.md`

### 2026-07-30 — src/ scaffolding pass (later superseded — see next entry)
- **What:** Scaffolded controller/service/repository/routes stubs for every feature missing from
  the layered folder tree (regions, accountClasses, productColors, purchases, purchaseReturns,
  drafts, bankAccounts, cheques, alerts); removed stale `controlAccounts.*` (dropped in v4.3);
  fixed a stale Postgres-style (`$1, $2`) comment in repository file templates to describe `mssql`
  named params instead.
- **How:** Matched the existing TODO-stub style; `routes/index.js` remounted everything grouped by
  milestone. User reverted this specific pass afterward (kept the milestone doc updates) — the
  repo's real base state for Milestone 1 work is the original pre-scaffold stubs.
- **Files:** `backend/src/{controllers,services,repositories,routes}/**`

### 2026-07-30 — Module 1.1 & 1.2: engine switch to MS SQL Server
- **What:** Swapped the backend off Postgres (`pg`) onto MS SQL Server (`mssql`/Tedious), per
  `plan.md` Step 2. `package.json` dependency swap; `.env.example` + `config/index.js` rewritten
  around a `db` connection object (server/port/database/user/password/options) instead of
  `DATABASE_URL`; `pool.js` rewritten around `mssql.ConnectionPool` (`query()` + `withTransaction()`
  wrapping an `mssql` `Transaction`); `migrate.js` rewritten to apply T-SQL batches split on `GO`,
  tracked in `dbo.schema_migrations`; seed script (`src/db/seeds/run.js`) added — admin user,
  account classes/groups, reserved chart accounts (CUSTOMERS/VENDORS ACCOUNTS, CASH IN HAND, SALES,
  PURCHASES, COMMISSION ALLOWED, CHEQUES IN HAND, Payment Trail heads), default store, idempotent.
- **How:** Schema source of truth is `database/schema.sql` (repo root, T-SQL generated from
  `database_schema_v4.3.md`, 39 tables) — the user maintains this file directly, not a
  `src/db/migrations/001_init.sql` copy. `migrate.js` applies `database/schema.sql` first, then any
  later numbered files under `src/db/migrations/`, tracked by basename so both share one
  `schema_migrations` ledger. The old Postgres migration and its planned `001_init.sql` replacement
  were both removed, not archived, once `database/schema.sql` became the actual source of truth.
- **Files:** `backend/package.json`, `backend/.env.example`, `backend/.env`,
  `backend/src/config/{index.js,README.md}`, `backend/src/db/{pool.js,migrate.js,README.md}`,
  `backend/src/db/seeds/run.js`, `backend/src/db/migrations/README.md` (removed),
  `backend/CLAUDE.md`, `backend/milestones/milestone1.md`
- **Pending:** no SQL Server instance set up yet — migration/seed scripts are unverified end-to-end.

## Milestone 2 — Sale Bill & Sale Return
_Not started._

## Milestone 3 — Purchase & Purchase Return
_Not started._

## Milestone 4 — Receipts (Jamma) & Expenses (Kharch)
_Not started._

## Milestone 5 — Current Stock, Reports & Search/Bilty-Adda Updation
_Not started._

## Milestone 6 — System Setup: Products, Categories, Vendors
_Not started._

## Milestone 7 — System Setup: Workers, Customers, Sub-Customers
_Not started._

## Milestone 8 — System Setup: Cities & Accounts Hierarchy
_Not started._

## Milestone 9 — Alerts, Frontend Integration & Electron
_Not started._
