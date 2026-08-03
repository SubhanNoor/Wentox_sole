# Milestone 6 — System Setup: Product Details, Categories, Vendors

**Goal:** The first three sidebar SYSTEM SETUP entries. Each module follows the layered pattern:
`ipc handler → service → repository`, parameterized SQL only, input validation, soft-delete
via `is_active`. Standard IPC channels per module unless noted: `<feature>:list` (active by default),
`<feature>:get`, `<feature>:create`, `<feature>:update`, `<feature>:remove` (soft).

## Module 6.1 — Product Details (UC-07)

**Naming note:** the screen is "Product Details" and the backend feature stays named `products`
(files, IPC channels — `products:*`), but the real table in `database/schema.sql` is `dbo.articles`
(PK `article_id`), not `dbo.products`. `database_schema_v4.3.md` still describes an older
`products`/`product_id` shape with different cost columns (`cost_price`/`labour`/etc.) — that doc is
stale here; `database/schema.sql`'s `articles` table (12 real manufacturing-stage cost columns +
`sale_price`) is the one actually applied. All SQL in `products.repository.js` must query
`dbo.articles`/`article_id`, same pattern already used in `saleBills.repository.js`.

- [x] `products` (ipc handler/service/repository) CRUD with full cost-breakdown fields — queries `dbo.articles`; code (e.g. `P-101`) system-generated on create (`nextCode()` — `MAX(TRY_CAST(SUBSTRING(code,3,30) AS INT))` over `code LIKE 'P-%'`, +1)
- [x] `productColors` (ipc handler/service/repository) — colors as a real child table (`dbo.article_colors`), not a loose column; per UC-07, not created from this form — `resolveOrCreate(article_id, color, packing)` is what the Current Stock "Add" dialog (UC-28, Milestone 5) will call, case-insensitive dedup on `(article_id, color)`
- [x] Validation: packing > 0, category required, money fields numeric
- [x] List endpoint joins category + vendor names (for searchable dropdowns)
- [x] Verify: create category → create product referencing it (auto-generates `P-101`, rejects an unknown `category_id`) → create a second product (`P-102`) → update → create two color variants (including a different-case duplicate resolving to the same variant) → soft-delete a variant → soft-delete the product (excluded from default list) — all run live against `wentox_db`

## Module 6.2 — Categories (UC-06)
- [x] `categories` (ipc handler/service/repository) CRUD — duplicate-name rejected, soft-delete via `is_active`; verified live alongside Module 6.1 above

## Module 6.3 — Vendors (UC-08)
- [x] `vendors` (ipc handler/service/repository) CRUD (name, phone, address, region, city); `create()` auto-creates a linked `business_accounts` row under the reserved VENDORS ACCOUNTS chart account (§3.2 code composition: parent 6-digit chart code + 4-digit zero-padded serial, `serial = MAX(existing under that parent) + 1`) and links it via `vendors.ba_id` — both writes share one `withTransaction` (a debugger review caught the first version doing this as two separate non-transactional writes, which could have orphaned a `business_accounts` row if the vendor insert failed after the account insert succeeded; fixed by threading the transaction through `businessAccounts.repository.js`/`vendors.repository.js`)
- [x] Renaming a vendor keeps the linked account's name in sync (`businessAccountsService.renameLinked`)
- [x] Soft delete — `is_active = 0` on the vendor; the linked `business_accounts` row stays `ACTIVE` (ledger/history integrity, not tied to the vendor's own active state)
- [x] Verify: create (linked account auto-created, code `200001` + serial) → duplicate name rejected → update renames both → list/soft-delete → confirmed the transaction fix leaves no orphaned `business_accounts` row — all run live against `wentox_db`

Reusable pattern added along the way: `businessAccountsService.createUnderChartCode(transaction, chartCode, name, extra)` — the §3.2 code-generation logic, callable from any future party-creation flow (Customers/Sub-Customers in Milestone 7 will need the identical pattern under CUSTOMERS ACCOUNTS).
