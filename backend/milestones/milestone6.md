# Milestone 6 — System Setup: Product Details, Categories, Vendors

**Goal:** The first three sidebar SYSTEM SETUP entries. Each module follows the layered pattern:
`routes → controller → service → repository`, parameterized SQL only, input validation, soft-delete
via `is_active`. Standard endpoints per module unless noted: `GET /` (list, active by default),
`GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` (soft).

## Module 6.1 — Product Details (UC-07)
- [ ] `products` (routes/controller/service/repository) CRUD with full cost-breakdown fields
- [ ] `productColors` (routes/controller/service/repository) — colors as a real child table (`article_colors` in v4.3), not a loose column
- [ ] Validation: packing > 0, category required, money fields numeric
- [ ] List endpoint joins category + vendor names (for searchable dropdowns)

## Module 6.2 — Categories (UC-06)
- [ ] `categories` (routes/controller/service/repository) CRUD

## Module 6.3 — Vendors (UC-08)
- [ ] `vendors` (routes/controller/service/repository) CRUD (name, phone, city); creates a linked chart account per UC-08
