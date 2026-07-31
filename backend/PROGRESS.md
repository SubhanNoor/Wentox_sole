# Wentox Backend — Progress Log

**Current milestone:** Milestone 2 — Sale Bill & Sale Return
**Status:** Milestone 1 code-complete (Modules 1.1–1.3, verification pending SQL Server + `npm install`). Milestone 2: **Module 2.1 (Sale Bill) fully complete** — create, draftSaleBills, list/get/update/post/unpost, all debugged. Module 2.2 (Sale Return) not started.

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

---

## Milestone 2 — Sale Bill & Sale Return

### 2026-07-31 — Module 2.1 complete: sale-bills:list/get/update/post/unpost
- **What:** Finished every remaining `milestone2.md` Module 2.1 checkbox. `saleBills.repository.js`
  gained `deleteItems`, `updateHeader`, `setStatus`, `deleteLedgerAndStock`, `list(filters)`.
  `saleBills.service.js` gained `list` (with a `resolveDateRange` helper — `weekly`/`monthly`/
  `overall` convenience on top of explicit `date_from`/`date_to`, explicit always wins), `update`
  (blocked unless `status = 'DRAFT'`, i.e. unposted — reuses the exact same totals math as `create`
  via two new extracted helpers, `resolveLinesAndTotals`/`buildBillFields`, so the two don't drift),
  `post` (reuses the existing `postLedgerAndStock` built earlier for `draftSaleBills.confirm`, then
  sets `status = 'CONFIRMED'`; blocked if already posted), `unpost` (deletes the bill's
  `ledger_entries`/`stock_movements` rows and sets `status = 'DRAFT'`; blocked if not posted).
  `saleBills.ipc.js` wired `sale-bills:list/get/update/post/unpost`.
- **How:** Verified the full lifecycle with a stubbed-dependency `node -e` test: create → update
  while DRAFT (succeeds, totals recompute) → post (ledger + stock rows written, status flips) →
  update while CONFIRMED (blocked) → double-post (blocked) → unpost (ledger/stock rows removed,
  status flips back) → double-unpost (blocked) → list with a weekly range (correct date window). A
  separate subagent debug review (briefed from `.claude/agents/debugger.md`) checked the parts that
  test wouldn't catch — `deleteLedgerAndStock`'s WHERE clause can't touch a different bill's rows or
  a `SALE_RETURN`'s rows, `updateHeader` updates every column `insert` sets except `status`/
  `created_by` (correctly immutable outside `setStatus`), no invalid status string is ever written,
  and every multi-write path is inside one `withTransaction` call. No bugs found.
- **Files:** `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`
- **Module 2.1 is now fully complete.** Next: Module 2.2 (Sale Return) — same shape, mirrored
  direction. No live SQL Server yet — everything here is logic-verified, not DB-verified.

### 2026-07-30 — Module 2.1 (partial): sale-bills:create + debug pass
- **What:** Implemented the first `milestone2.md` checklist item: `saleBills.repository.js`
  (`getVariantPackings`, `insert`, `insertItems`, `findById`), `saleBills.service.js` (`create` —
  validation, server-computed pairs/discounts/totals, one `withTransaction`), `saleBills.ipc.js`
  (`sale-bills:create` behind `requireSession()`).
- **How:** A separate subagent review (briefed from `.claude/agents/debugger.md`, not done inline)
  found and I fixed 4 real bugs: (1) **critical** — the repository joined against `dbo.products`/
  `product_id`, which doesn't exist; `database/schema.sql` (the real, authoritative schema — more
  current than `System_architecture/database_schema_v4.3.md`, which still describes the old
  `products` shape) actually has `dbo.articles`/`article_id`, with a completely different cost
  breakdown (12 real manufacturing-stage columns + `sale_price`, not `cost_price`/`labour`/etc.) —
  every `sale-bills:create` call would have failed at the first query; (2) `discount_percent`
  defaulted to `0` one line too late in `buildLine`, so omitting it produced `NaN` through the whole
  totals chain; (3) missing validation for the schema's `CK_sale_bills_custdlv` (sub_customer_id
  required unless `delivery_type = 'SAME'`); (4) missing validation that `cartons > 0` per line
  (schema's `CK_sale_bill_items_pairs` requires `pairs > 0`, and `pairs = cartons × packing`).
  Verified all 4 fixes with stubbed-dependency `node -e` tests (module-cache injection to avoid
  needing `mssql`/a live DB) — confirmed correct totals math and that all three validation cases now
  throw before reaching the transaction.
- **Files:** `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`, `backend/electron/preload.js` (kebab-case channel name fix —
  `window.api.saleBills.list()` now correctly calls `sale-bills:list`, not `saleBills:list`)
- **Resolved:** `products` vs `articles` naming — decided to keep the feature/screen name
  `products` (matches the frontend sidebar and `use_cases.md`), with its SQL querying the real
  `dbo.articles` table underneath, same pattern as `saleBills.repository.js`. No renaming needed;
  noted in `milestone6.md`'s Module 6.1.
- **Pending:** `sale-bills:list`, `sale-bills:get`, update, post/unpost, and Module 2.2 (Sale
  Return) are not started. No live SQL Server yet — everything here is logic-verified, not
  DB-verified.

### 2026-07-30 — Module 2.1: draftSaleBills (create/list/get/remove/confirm) + shared posting logic
- **What:** Implemented the second `milestone2.md` checklist item (schema §5.6.1). New:
  `draftSaleBills.repository.js` (own `getVariantPackings`/`insertStockMovements` copies, plus
  `insertDraft`/`insertDraftItems`/`findById`/`list`/`deleteDraft`), `draftSaleBills.service.js`
  (`create` — deducts stock via a negative `ADJUSTMENT` movement on save; `remove` — restores via a
  positive one, never deleting the original per the schema's reverse-never-erase pattern; `confirm`
  — per the user's actual workflow (draft now, finish and confirm later that same session), this
  behaves as **create + post in one step**, not a separate later post), `draftSaleBills.ipc.js`
  (`draft-sale-bills:create/list/get/remove/confirm`). Extracted shared pairs/discount/totals math
  and item/header validation out of `saleBills.service.js` into a new `saleBillMath.js` (both
  features need the identical formula). Added minimal `chartAccounts.repository.js` (`findByCode`)
  and `customers.repository.js`/`service.js` (`findById`/`getById`) — just enough for posting to
  resolve the `SALES` account and a customer's `ba_id`, full CRUD for both is Milestone 7/8. Added
  `src/constants/reservedAccounts.js` (shared codes between `seeds/run.js` and posting logic).
  `saleBills.service.js` gained `postLedgerAndStock`/`insertConfirmed`/`getById` exports so
  `draftSaleBills.confirm()` reuses the exact same posting path a normal bill uses.
- **How:** Confirming a draft first inserts a *positive* reversing `ADJUSTMENT` stock movement
  (canceling the draft's original deduction), then inserts the real `sale_bills` row with
  `status = 'CONFIRMED'` directly, then runs the normal post (ledger entries + negative `SALE`
  stock movement), then deletes the draft — net stock effect over the full lifecycle is exactly one
  deduction, same as a bill that was never a draft. Verified this arithmetic directly with stubbed
  `node -e` tests tracing every stock-movement row's sign and source. A separate subagent debug
  review (briefed from `.claude/agents/debugger.md`) found one real bug: `confirm()` checked
  `bill_no`/`gp_no`/`bilty_no`/`adda_id` but not the schema's `CK_sale_bills_custdlv` rule
  (`sub_customer_id` required unless `delivery_type = 'SAME'`) — `draft_sale_bills` has no such
  constraint so a draft could reach `confirm()` in a state the real `sale_bills` table would reject,
  surfacing as an opaque `INTERNAL` error. Fixed by extracting `validateDeliveryCustomer()` into
  `saleBillMath.js` and calling it from both `saleBills.service.js` and `draftSaleBills.confirm()`.
  A second, lower-severity finding (inconsistent `Error` vs `ApiError` for the "SALES account
  missing" case) was deliberately left as-is: that case is a setup/seed problem, not a normal-user
  error, and `wrap.js` only `console.error`s non-`ApiError` throws — converting it would have
  silenced a real misconfiguration instead of surfacing it. Verified the fix with three cases
  (`SAME` delivery, `CUSTOM` with no sub-customer, `CUSTOM` with one) — all behave correctly.
- **Files:** `backend/src/repositories/draftSaleBills.repository.js`,
  `backend/src/services/draftSaleBills.service.js`, `backend/src/ipc/draftSaleBills.ipc.js`,
  `backend/src/services/saleBillMath.js` (new), `backend/src/services/saleBills.service.js`,
  `backend/src/repositories/saleBills.repository.js`, `backend/src/repositories/chartAccounts.repository.js` (new),
  `backend/src/repositories/customers.repository.js`, `backend/src/services/customers.service.js`,
  `backend/src/constants/reservedAccounts.js` (new), `backend/src/db/seeds/run.js`,
  `backend/src/ipc/index.js`, `backend/electron/preload.js`

### 2026-07-30 — Second debug pass on wrap.js: unexpected errors weren't actually sanitized
- **What:** A follow-up review (run as a genuinely separate subagent this time, briefed with
  `.claude/agents/debugger.md`, not done inline) found that the previous `wrap.js` fix only *logged*
  non-`ApiError` failures — it didn't actually replace their `message`/`code` before returning. A
  raw `mssql`/Tedious driver error (e.g. connection failure) would still leak its real `.code`
  (`ESOCKET`, `ETIMEOUT`, `ELOGIN`, ...) and message (which can contain host/port/driver internals)
  straight to the renderer, contradicting the documented "sanitized to `INTERNAL`" contract.
- **How:** Restructured the `catch` block to branch explicitly: `ApiError` → pass through its real
  `message`/`code`; anything else → `console.error` the full error, then always return the fixed
  `{ message: 'Internal error', code: 'INTERNAL' }` pair, no fallback to `err.message`/`err.code`.
  Verified with a `node -e` harness simulating a real driver error shape (`ESOCKET` + a message
  containing an IP and port): confirmed it now returns the sanitized shape while still logging the
  real error to console.
- **Files:** `backend/src/ipc/wrap.js`
- **Also this session:** updated `.claude/settings.json` to add a `PostToolUse` hook (fires the
  debugger review after every `Write`/`Edit`, not just once at `Stop`) matching the pattern from
  another project, and pointed both hooks at reading `.claude/agents/debugger.md` fresh each run
  instead of a hardcoded paraphrase of it.

### 2026-07-30 — Debug pass on Module 1.3: wrap.js error-serialization bug
- **What:** Debugger-persona review (`.claude/agents/debugger.md`, run inline since the Stop hook's
  `agent`-type mechanism means acting as that persona directly on the diff, not invoking a separate
  subagent) of the Module 1.3 auth code found two real bugs, both in `src/ipc/wrap.js`, not in the
  auth logic itself: (1) `wrap.js` was throwing a `new Error()` with `.code` attached back across
  `ipcMain.handle` — but Electron only preserves a thrown error's `.message` crossing into the
  renderer's rejected promise, silently dropping custom properties, so every `ApiError`'s `.code`
  (`UNAUTHORIZED`, `USERNAME_TAKEN`, etc.) was being lost in transit, contradicting the documented
  `{ message, code }` contract. (2) unexpected non-`ApiError` failures (real bugs, not business
  errors) were sanitized to `code: 'INTERNAL'` with no logging anywhere, making them undebuggable.
- **How:** Rewrote `wrap.js` to **resolve always** instead of throwing — `{ ok: true, data }` on
  success, `{ ok: false, error: { message, code } }` on failure — which sidesteps Electron's
  property-stripping entirely rather than working around it, and added `console.error(err)` for any
  caught error that isn't an `ApiError` instance. Verified both paths directly (a plain `node -e`
  harness calling `wrap()` with a success case, a thrown `ApiError.unauthorized`, and a thrown
  `TypeError`): the `ApiError` case now correctly surfaces `code: 'UNAUTHORIZED'`, and the
  `TypeError` case printed to console before resolving as `code: 'INTERNAL'`.
- **Files:** `backend/src/ipc/wrap.js`, `backend/CLAUDE.md`, `backend/plan.md`,
  `backend/src/ipc/README.md`, `backend/src/errors/README.md`
- **Note for Milestone 9:** `frontend/src/lib/api.ts` must check `.ok` on every `window.api.x.y()`
  call — it never rejects/throws anymore, it always resolves.

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

### 2026-07-30 — Module 1.3: Auth over IPC (login/logout/update-credentials)
- **What:** Implemented `auth.repository.js` (`findByUsername`, `findById`, `usernameTaken`,
  `updateCredentials`), `auth.service.js` (`login` — bcrypt compare, returns `{user_id, username,
  role}`; `updateCredentials` — verifies `currentPassword`, allows changing username and/or
  password together, checks the new username isn't taken via `UQ_users_name` before writing, hashes
  a new password with bcrypt if provided), and `auth.ipc.js` (`auth:login` calls the service then
  `session.login(user)`; `auth:logout` calls `session.logout()`; `auth:update-credentials` calls
  `session.requireSession()` first, then the service).
- **How:** Kept `auth.service.js` free of any IPC/session import — it just verifies credentials and
  returns data, so it stays testable without Electron; `session.login()`/`session.requireSession()`
  are only ever called from the `ipc` layer, matching the layering rule in `CLAUDE.md`.
- **Files:** `backend/src/repositories/auth.repository.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/milestones/milestone1.md`
- **Pending:** end-to-end verification blocked on `npm install` (package.json's `mssql` swap isn't
  installed yet) and a live SQL Server instance to seed against.

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
