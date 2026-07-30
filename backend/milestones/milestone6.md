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

- [ ] `products` (ipc handler/service/repository) CRUD with full cost-breakdown fields — queries `dbo.articles`
- [ ] `productColors` (ipc handler/service/repository) — colors as a real child table (`dbo.article_colors`), not a loose column
- [ ] Validation: packing > 0, category required, money fields numeric
- [ ] List endpoint joins category + vendor names (for searchable dropdowns)

## Module 6.2 — Categories (UC-06)
- [ ] `categories` (ipc handler/service/repository) CRUD

## Module 6.3 — Vendors (UC-08)
- [ ] `vendors` (ipc handler/service/repository) CRUD (name, phone, city); creates a linked chart account per UC-08
