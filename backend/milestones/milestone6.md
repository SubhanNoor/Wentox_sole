# Milestone 6 — System Setup: Product Details, Categories, Vendors

**Goal:** The first three sidebar SYSTEM SETUP entries. Each module follows the layered pattern:
`ipc handler → service → repository`, parameterized SQL only, input validation, soft-delete
via `is_active`. Standard IPC channels per module unless noted: `<feature>:list` (active by default),
`<feature>:get`, `<feature>:create`, `<feature>:update`, `<feature>:remove` (soft).

## Module 6.1 — Product Details (UC-07)
- [ ] `products` (ipc handler/service/repository) CRUD with full cost-breakdown fields
- [ ] `productColors` (ipc handler/service/repository) — colors as a real child table (`article_colors` in v4.3), not a loose column
- [ ] Validation: packing > 0, category required, money fields numeric
- [ ] List endpoint joins category + vendor names (for searchable dropdowns)

## Module 6.2 — Categories (UC-06)
- [ ] `categories` (ipc handler/service/repository) CRUD

## Module 6.3 — Vendors (UC-08)
- [ ] `vendors` (ipc handler/service/repository) CRUD (name, phone, city); creates a linked chart account per UC-08
