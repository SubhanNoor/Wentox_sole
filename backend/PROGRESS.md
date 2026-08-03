# Wentox Backend — Progress Log

**Current milestone:** Milestone 7 — System Setup: Workers, Customers, Sub-Customers (pulled forward ahead of Milestone 4, same as Milestone 6 — see rationale below)
**Status:** SQL Server is up and `wentox_db` migrated + seeded. Milestone 1 code-complete and its migrate/seed scripts verified working end-to-end (including live `auth:login`/`requireSession` checks). Milestone 2: **Modules 2.1 and 2.2 both complete and verified end-to-end** (create/post/unpost, ledger + stock direction, drafts, password re-verification guard, and the `status`-column removal / `due_date` addition). Milestone 3: **Modules 3.1 and 3.2 both complete and verified end-to-end** (create with material auto-registration, post/unpost, drafts with zero vendor-stock effect until confirmed, no password guard). Milestone 6: **Modules 6.1, 6.2, and 6.3 all complete and verified end-to-end** (Product Details/`articles`, Categories, Vendors with auto-linked business account). Milestone 7: **Modules 7.2 and 7.3 complete and verified end-to-end** (Customers mirroring Vendors' auto-linked-account pattern, Sub-Customers as a flat independent CRUD per UC-10 — see below); **Module 7.1 (Workers) is blocked** — no definition exists in `use_cases.md`/`database_schema_v4.3.md`, needs the user's input before any schema/CRUD work. Milestone 4 (Receipts/Expenses) and the Milestone 2/3 frontend wiring are still pending — Milestones 6/7/8 (system setup) were deliberately pulled forward because Sale Bill/Return/Purchase/Return all depend on real customer/vendor/adda/city/region data to be testable end-to-end through the actual UI, not hardcoded fixtures.

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

---

## Milestone 7 — System Setup: Workers, Customers, Sub-Customers

### 2026-08-16 — Added region_id/city_id to sub_customers (schema change, per client instruction)
- **What:** Sale Bill/Sale Return's "deliver to" sub-customer dropdown needs to narrow to the
  selected customer's region — sub_customers previously had no region/city at all. Confirmed the
  exact requirements with the user first (region_id required, city_id optional/informational;
  filter matches region only, not city) before touching schema or code.
- **How:** `region_id INT NOT NULL` + `city_id INT NULL` (both FK'd to `regions`/`cities`) added to
  `dbo.sub_customers`, folded directly into `database/schema.sql` (table was empty in `wentox_db`,
  so the `NOT NULL` add needed no backfill — applied via a temporary migration first, verified
  live, then folded in and the migration deleted, same pattern as every other schema change this
  project). `subCustomers.repository.js`'s `list()` gained a `region_id` filter (unfiltered still
  returns everyone — this is opt-in narrowing, not a hard restriction), `findById()`/`list()` now
  join `regions` (INNER, required) and `cities` (LEFT, optional) for display names, `insert()`/
  `update()` carry the new columns through. `subCustomers.service.js`'s `validate()` now requires
  `region_id`. Also corrected two docs that were now stale: `use_cases.md`'s UC-10, which
  explicitly said the dropdown lists "every sub-customer... not a filtered subset" (struck
  through, replaced with the new region-match behavior), and `database_schema_v4.3.md`'s
  `sub_customers` CREATE TABLE block + a new "Post-v4.3 amendment" note.
- **Verified:** live against `wentox_db` — missing `region_id` rejected; created two sub-customers
  in different regions; `list({ region_id: lahoreId })` correctly included the matching one and
  excluded the other; unfiltered `list()` still returned both. Also re-verified the from-scratch
  `schema.sql`-only import path against a disposable scratch database (`sub_customers.region_id`
  `NOT NULL`, `city_id` nullable, matching the live database exactly).
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`,
  `System_architecture/use_cases.md`, `backend/src/repositories/subCustomers.repository.js`,
  `backend/src/services/subCustomers.service.js`, `backend/milestones/milestone7.md`

### 2026-08-15 — Modules 7.2 & 7.3 complete: customers, subCustomers
- **What:** Built module-by-module with a functionality check-in before each, per explicit
  direction this session (confirm scope/approach first, then implement — not the whole milestone
  in one pass).
  - **Customers** (`customers.*`, Module 7.2, UC-09): confirmed as an exact mirror of Module 6.3's
    Vendors before building — same CRUD shape, same auto-linked-`business_accounts`-on-create
    pattern (reusing `businessAccountsService.createUnderChartCode` under CUSTOMERS ACCOUNTS this
    time), same rename-syncs-the-account behavior, same transaction-safe `create()` from the
    start (no repeat of the Vendors orphan-row bug — a debugger review confirmed this). One real
    schema difference correctly handled: `region_id` is required (`NOT NULL` on `dbo.customers`,
    unlike vendors' nullable `region_id`), validated accordingly. Debugger review flagged one
    low-risk informational note: `customers.name` has no DB-level `UNIQUE` constraint (unlike
    `vendors.name`'s `UQ_vendors_name`) — duplicate protection is service-layer-only, accepted as
    low risk in this single-admin-session desktop app, not schema-patched.
  - **Sub-Customers** (`subCustomers.*`, Module 7.3, UC-10): milestone7.md's checklist said
    sub-customers "must belong to a customer" — checked this against the actual schema (no
    `customer_id` column on `dbo.sub_customers`) and UC-10's explicit text ("Sub-customers are
    independent. They have no parent customer... the parent-customer link still exists and must
    be *removed*") and confirmed with the user that the milestone doc's line was stale before
    building. Built as a flat CRUD instead: `name`/`phone`/`address`/`is_active` only, no
    region/city, no linked business account. The Sale Bill inline "+ Add Sub-Customer" flow uses
    the same `sub-customers:create` channel as the standalone screen (no parent to scope under, so
    no separate customer-scoped channel needed, correcting milestone7.md's other stale line).
- **How:** Both modules follow the same list/get/create/update/remove IPC shape as every other
  Milestone 6/7 module. `milestone7.md` updated in place to strike the two stale lines with a
  note explaining what was actually built and why.
- **Verified:** debugger-subagent review on each module separately (Customers: confirmed
  transaction safety, correct `region_id` requirement, correct `CODES.CUSTOMERS_ACCOUNTS` usage,
  correct JOIN directions; Sub-Customers: confirmed no parent-link anywhere, correct IPC channel
  casing) — both clean. Then live against `wentox_db` for each before moving to the next: Customers
  (missing region rejected → create with linked account `100001XXXX` → duplicate rejected → update
  renames both → soft-delete, account stays `ACTIVE`); Sub-Customers (create → duplicate rejected →
  update → list/soft-delete).
- **Files:** `backend/src/{repositories,services,ipc}/customers.*`,
  `backend/src/{repositories,services,ipc}/subCustomers.*`, `backend/milestones/milestone7.md`

## Milestone 6 — System Setup: Product Details, Categories, Vendors

### 2026-08-14 — Modules 6.1, 6.2, 6.3 complete: products, categories, vendors
- **What:** Pulled forward ahead of Milestone 4 (see status line above) so Sale Bill/Return/
  Purchase/Return have real dropdown data to test against instead of hardcoded fixture IDs. Built
  module-by-module, checking in and live-verifying after each before moving to the next, per
  explicit direction partway through this session.
  - **Categories** (`categories.*`): plain CRUD, duplicate-name rejected, soft delete via `is_active`.
  - **Products** (`products.*`, queries `dbo.articles` — see milestone6.md's naming note):
    CRUD with the full 12-column manufacturing cost breakdown; `code` (e.g. `P-101`) is
    system-generated on create, never typed — `nextCode()` takes
    `MAX(TRY_CAST(SUBSTRING(code,3,30) AS INT))` over `code LIKE 'P-%'` and adds 1, starting at 101.
    `create()`/`update()` validate `category_id` exists via `categoriesService.getById` first, for a
    clean 404 instead of a raw FK-violation.
  - **Product Colors** (`productColors.*`, queries `dbo.article_colors`): per UC-07, colors are
    *not* created from the Product Details form — `resolveOrCreate(article_id, color, packing)` is
    what the Current Stock "Add" dialog (UC-28, Milestone 5) will call later; case-insensitive
    dedup on `(article_id, color)`, backed by `UQ_article_colors_acolor`.
  - **Vendors** (`vendors.*`): full CRUD; `create()` auto-creates a linked `business_accounts` row
    under the reserved VENDORS ACCOUNTS chart account (§3.2 composition: parent 6-digit chart code
    + 4-digit zero-padded serial, `serial = MAX(existing under that parent) + 1`) and links it via
    `vendors.ba_id` — the user never sees a separate account-setup step (UC-08). Renaming a vendor
    renames the linked account too.
  - New reusable helper: `businessAccountsService.createUnderChartCode(transaction, chartCode,
    name, extra)` — the §3.2 code-generation logic pulled out so Customers/Sub-Customers
    (Milestone 7) can call the identical pattern under CUSTOMERS ACCOUNTS instead of
    reimplementing it.
- **How:** A debugger-subagent review of the Vendors module caught a real bug before it shipped:
  the first version created the `business_accounts` row and the `vendors` row as two separate,
  non-transactional `query()` calls — if the vendor insert failed after the account insert
  succeeded, the account row would be permanently orphaned (a ledger account with no vendor
  pointing at it, visible in Chart of Accounts listings with no way to clean it up from the UI).
  Fixed by threading a `transaction` parameter through `businessAccounts.repository.js`
  (`nextSerial`, `insert`) and `vendors.repository.js` (`insert`), and wrapping both calls in one
  `withTransaction` block in `vendors.service.js:create()` — same pattern every other multi-write
  service in this codebase already follows.
  Also fixed, while auditing for the same bug class: `auth.ipc.js`'s `auth:update-credentials`/
  `auth:verify-password` channels were kebab-case on the action segment, but
  `electron/preload.js`'s `window.api` Proxy only kebab-cases the *feature* prefix, not the action
  — it passes the JS property access straight through unmodified. A future
  `window.api.auth.verifyPassword(...)` call would have silently mismatched. Renamed to
  `auth:updateCredentials`/`auth:verifyPassword`. New `productColors.ipc.js` channels
  (`listByArticle`, `resolveOrCreate`) were written camelCase from the start to avoid the same trap.
- **Verified:** debugger-subagent review on both the Products/Categories/ProductColors batch and
  the Vendors batch (separately) came back clean after the transaction fix; then live against
  `wentox_db` for each module before moving to the next: category → product (auto-code, rejects
  unknown category) → second product (incremented code) → update → two color variants (including
  a different-case duplicate resolving to the same variant) → soft-delete variant → soft-delete
  product; vendor create (linked business account `200001XXXX`) → duplicate name rejected → update
  (renames both) → list/soft-delete (linked account stays `ACTIVE`) → structural check confirming
  no orphaned `business_accounts` row.
- **Files:** `backend/src/{repositories,services,ipc}/categories.*`,
  `backend/src/{repositories,services,ipc}/products.*`,
  `backend/src/{repositories,services,ipc}/productColors.*` (new `ipc` file),
  `backend/src/{repositories,services,ipc}/vendors.*`,
  `backend/src/{repositories,services}/businessAccounts.*`, `backend/src/ipc/index.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/electron/preload.js`,
  `backend/milestones/milestone6.md`

## Milestone 3 — Purchase & Purchase Return

### 2026-08-13 — Modules 3.1 & 3.2 complete: purchases, purchaseReturns, both draft mirrors
- **What:** Full Purchase (UC-23) and Purchase Return (UC-24) backend, same shape as Sale
  Bill/Return but with real differences settled via a short round of clarifying questions before
  building: (1) no password guard anywhere — there's no edit-a-posted-purchase UI flow, so
  `update()` just blocks entirely once posted (`POSTED_LOCK`), never reverses+reapplies ledger;
  (2) `draft_purchases`/`draft_purchase_returns` are their own tables (not a status value), per
  client instruction; (3) unlike `draft_sale_bills`, saving/deleting a draft purchase has **zero**
  effect on `vendor_stock_movements` — nothing physically arrives before a purchase is recorded.
  New: `materials.repository.js` (`resolveOrCreate` — case-insensitive material lookup-or-register,
  transactional), `purchaseMath.js` (shared line/total math, no packing/discount concept — just
  `quantity × price_per_unit`), `purchases`/`purchaseReturns`/`draftPurchases`/
  `draftPurchaseReturns` (ipc/service/repository each), `vendors.service.js`/
  `vendors.repository.js` gained the same minimal `getById`/`findById` pattern
  `customers.service.js` already has (full CRUD still deferred to Milestone 7).
- **How:** Posting (schema §7): Purchase → debit PURCHASES chart account / credit vendor BA,
  positive `PURCHASE` vendor_stock_movements row per line. Purchase Return → reverse — debit
  vendor BA / credit PURCHASES, negative `PURCHASE_RETURN` row (return items are stored positive
  per `CK_purchase_return_items_qty`, negated only when building the vendor-stock movement).
  Purchases never touch `stock_movements` (finished-goods/pairs) — only `vendor_stock_movements`
  (material units), per UC-23's explicit note. Schema changes (drop `status` from both tables, add
  the four draft tables) went through the usual path: a temporary numbered migration, applied and
  verified live, then folded directly into `database/schema.sql` and the migration file deleted —
  a fresh `schema.sql`-only import needs nothing else (verified against a disposable scratch
  database, `wentox_db` unaffected/no-op on re-migrate).
- **Verified:** `debugger`-pattern subagent review (posting signs, transaction scoping — material
  resolution happens inside the same transaction as the line it belongs to, not a separate
  connection — export/usage consistency, draft-confirm asymmetry vs. Sale Bill) came back clean.
  Then live against `wentox_db`: create with a brand-new material name → auto-registered in
  `dbo.materials`; a second purchase using a different-case spelling of the same name resolved to
  the identical `material_id` (case-insensitive collation); post → correct ledger direction +
  positive vendor-stock row; double-post rejected; update-while-posted rejected
  (`POSTED_LOCK`, not a reverse+reapply); unpost removes the rows; Purchase Return posted the exact
  reverse (debit vendor BA / credit PURCHASES, negative vendor-stock row); draft create/delete
  confirmed zero net vendor-stock movement; draft confirm (both Purchase and Purchase Return)
  posted exactly once and deleted the draft row.
- **Files:** `backend/src/repositories/materials.repository.js`,
  `backend/src/services/purchaseMath.js`,
  `backend/src/repositories/vendors.repository.js`, `backend/src/services/vendors.service.js`,
  `backend/src/{ipc,services,repositories}/{purchases,draftPurchases,purchaseReturns,draftPurchaseReturns}.*`,
  `backend/src/ipc/index.js`, `backend/electron/preload.js`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `backend/milestones/milestone3.md`

## Milestone 2 — Sale Bill & Sale Return

### 2026-08-07 — Folded the status-drop/due_date migrations directly into database/schema.sql
- **What:** Per explicit client instruction ("only run schema.sql on import"), consolidated the two
  migrations from the entry below (`001_sale_bills_due_date.sql`, `002_drop_sale_status.sql`)
  directly into `database/schema.sql`'s `sale_bills`/`sale_returns` `CREATE TABLE` blocks, then
  deleted both migration files and the now-empty `src/db/migrations/` directory. This is a
  deliberate one-time exception to the project's usual "never edit an applied schema file" rule
  (see `backend/CLAUDE.md`) — done only because consolidating is exactly what was asked for.
- **How:** `sale_bills` now declares `due_date DATE NULL` directly (no `status` column);
  `sale_returns` declares neither. Also updated the `alert_dismissals` block comment, which used to
  say `due_date` "was removed from sale_bills/purchases" — now notes it's back on `sale_bills` (not
  `purchases`) for the pending notification feature, though the alert itself isn't wired up yet.
  `database_schema_v4.3.md`'s CREATE TABLE blocks for both tables were updated to match (the doc's
  blocks are meant to mirror the actual applied schema), and its top-of-file amendments note was
  reworded from "applied via migrations" to "folded directly into schema.sql."
  For the already-migrated `wentox_db`, this is a no-op — `migrate.js` tracks applied files by
  basename in `schema_migrations`, so it never re-runs `schema.sql`, and the two migration files it
  already ran are simply gone from disk now (their effect is already permanently in that database).
- **Verified:** created a disposable scratch database (`wentox_schema_scratch_test`) on the same SQL
  Server instance, applied `schema.sql` alone (no migrations directory, none exist anymore),
  confirmed `sale_bills` has `due_date` and no `status`, confirmed `sale_returns` has no `status`,
  then dropped the scratch database — `wentox_db` was never touched by this verification.
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`; removed
  `backend/src/db/migrations/001_sale_bills_due_date.sql`,
  `backend/src/db/migrations/002_drop_sale_status.sql`, and the (now-empty) `migrations/` dir.

### 2026-08-07 — Dropped `status` from sale_bills/sale_returns; re-added `sale_bills.due_date`
- **What:** Two schema amendments beyond the applied `database/schema.sql` (both via new files
  under `src/db/migrations/`, per the project's "never edit an applied schema file" rule):
  1. `001_sale_bills_due_date.sql` — `ALTER TABLE sale_bills ADD due_date DATE NULL`. Reverses
     v4.3's deliberate removal of this column, per explicit client instruction, ahead of a planned
     payment-overdue notification feature (details pending). Wired through
     `saleBills.repository.js` (`insert`, `updateHeader`) and `saleBills.service.js`
     (`buildBillFields`). Not added to `sale_returns` (schema note: "a return is not a payable").
  2. `002_drop_sale_status.sql` — drops `status` (+ its `DF_*`/`CK_*` constraints) from both
     `sale_bills` and `sale_returns`, per client confirmation that the column never actually
     changed value given the frontend's real button set: Confirm creates+posts atomically, and
     editing an already-posted document reverses+reapplies its ledger inside `update()` itself
     (from an earlier session), so a real row is never left visibly "unposted" in between.
- **How:** Both repositories gained `isPosted(id)` — `SELECT CASE WHEN EXISTS (... ledger_entries
  WHERE source_type=... AND source_id=@id) THEN 1 ELSE 0 END` — and `findById` now attaches the
  result as `is_posted` on every returned row. `create()` no longer sets any status field.
  `update()`/`post()`/`unpost()` in both services branch on `existing.is_posted` /`bill.is_posted`
  instead of a stored string; `setStatus` removed from both repositories entirely.
  `draftSaleBills.service.js`/`draftSaleReturns.service.js`'s `confirm()` no longer builds a
  `status: 'CONFIRMED'` field when assembling the row to insert (posting happens right after via
  `postLedgerAndStock`, which is what makes it "posted" now). The two ipc handlers
  (`sale-bills:update`, `sale-returns:update`) that gate the password check on "is this document
  currently posted" now read `existing.is_posted` instead of `existing.status === 'CONFIRMED'`.
  `database_schema_v4.3.md` got a "Post-v4.3 live amendments" note up top rather than rewritten
  CREATE TABLE blocks, since the doc's blocks are meant to match the *original* applied
  `schema.sql`, not the migrations layered on top.
- **Verified:** live against `wentox_db` — confirmed zero `status` columns remain on either table;
  full bill lifecycle (create → `is_posted=false` → post → `is_posted=true` → double-post rejected
  → edit-while-posted, ledger/stock correctly reversed+reapplied at new totals → unpost →
  `is_posted=false` → double-unpost rejected); same lifecycle on sale return; draft-return
  `confirm()` still produces a correctly-posted return with no `status` field involved anywhere.
- **Files:** `backend/src/db/migrations/001_sale_bills_due_date.sql`,
  `backend/src/db/migrations/002_drop_sale_status.sql`,
  `backend/src/repositories/{saleBills,saleReturns}.repository.js`,
  `backend/src/services/{saleBills,saleReturns,draftSaleBills,draftSaleReturns}.service.js`,
  `backend/src/ipc/{saleBills,saleReturns}.ipc.js`,
  `System_architecture/database_schema_v4.3.md`

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

### Module 2.1 — Sale Bill (UC-18, UC-19)
- **What:** `saleBills`/`draftSaleBills` (ipc/service/repository) — create with items, server-side
  totals, list with weekly/monthly/overall/date-range + customer filters, get, update
  (UNPOSTED-only), post/unpost (ledger + stock, one transaction), and the confirm-as-create+post
  draft flow.
- **Files:** `backend/src/{ipc,services,repositories}/{saleBills,draftSaleBills}.*`,
  `backend/src/services/saleBillMath.js`
- **Verified:** stubbed-dependency review only — no live SQL Server yet.

### Module 2.2 — Sale Return (UC-21, UC-22)
- **What:** `saleReturns`/`draftSaleReturns` (ipc/service/repository) — mirror of Module 2.1, with
  the schema's reversed semantics: no `main_ac_id`/`delivery_type`/`delivery_address` (not columns
  on `sale_returns`); post debits SALES / credits customer BA with positive `SALE_RETURN` stock
  movements (reverse of sale bill posting); draft-save restores stock (positive `ADJUSTMENT`),
  draft-delete deducts it back out (negative `ADJUSTMENT`) — reverse of draft sale bills.
- **New cross-cutting requirement (password re-verification), final design:** the frontend's edit
  icon never unposts anything on open — it just opens the form on a still-`CONFIRMED` row. Only
  pressing Confirm/Save actually writes anything, so `update(id, payload)` itself now branches on
  the row's *existing* status: `DRAFT` → plain header/item replace, no ledger involved, no
  password. `CONFIRMED` → the same call also deletes the old `ledger_entries`/`stock_movements`
  rows and reposts fresh ones against the new totals, all inside one `withTransaction` — the
  unpost→edit→repost cycle collapsed into a single atomic step so `status` never visibly leaves
  `CONFIRMED`. The password is required only for that `CONFIRMED` branch: the ipc handler fetches
  the existing row via `service.getById` first, and calls `authService.verifyPassword` only if
  `status === 'CONFIRMED'`, before calling `service.update`. `post()` (the initial Confirm/Save on
  a still-DRAFT row) always requires the password. `unpost()` was reverted to a plain standalone
  action with no password guard — it's no longer part of the edit flow.
  Added `auth.service.js:verifyPassword(userId, password)` + `auth:verify-password` IPC channel
  (re-checks the session user's password without touching session state, distinct from login/
  updateCredentials) to back this. Scoped to Sale Bill/Sale Return for now; same pattern extends
  to Purchase/Receipts/Expenses when those milestones come up.
- **Files:** `backend/src/{ipc,services,repositories}/{saleReturns,draftSaleReturns}.*`,
  `backend/src/services/saleReturnMath.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`, `backend/src/ipc/index.js`, `backend/electron/preload.js`
- **Verified:** static review + `debugger` subagent pass, then live end-to-end against a real SQL
  Server (`wentox_db`, migrated + seeded): sale bill post → debit customer BA / credit SALES,
  negative `SALE` stock movement; sale return post → debit SALES / credit customer BA, positive
  `SALE_RETURN` stock movement (confirmed reverse of the bill); unpost removes ledger + stock rows
  on both; draft-return create restores stock (+12 pairs), delete deducts it back out (net 0);
  draft-return confirm reverses the restoration and posts exactly one `SALE_RETURN` movement,
  deletes the draft row; `authService.verifyPassword` rejects a wrong password and accepts the
  right one. Re-verified again after the update()-redesign: editing a CONFIRMED bill (cartons 2→5)
  produced exactly 2 ledger rows and 1 stock row reflecting the new total, `status` stayed
  `CONFIRMED` throughout; editing a DRAFT bill produced 0 ledger rows, `status` stayed `DRAFT`.
- **Pending:** frontend wiring for the password prompt on save/confirm when editing a posted
  document.

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
