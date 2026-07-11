# Milestone 2 — Setup & Lookup CRUD

**Goal:** All setup screens (System Setup section of the frontend) backed by real API endpoints.
Each module follows the layered pattern: `routes → controller → service → repository`, parameterized
SQL only, input validation, soft-delete via `is_active`.

Standard endpoints per module: `GET /` (list, active by default), `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` (soft).

## Module 2.1 — Cities (UC-14)
- [ ] `cities` (routes/controller/service/repository) CRUD + unique-name validation

## Module 2.2 — Stores
- [ ] `stores` (routes/controller/service/repository) CRUD

## Module 2.3 — Addas (UC-21)
- [ ] `addas` (routes/controller/service/repository) CRUD
- [ ] Delete guard: block deletion when the adda is referenced by any sale bill (return 409)

## Module 2.4 — Vendors
- [ ] `vendors` (routes/controller/service/repository) CRUD (name, phone, city)

## Module 2.5 — Product Categories (UC-12)
- [ ] `categories` (routes/controller/service/repository) CRUD

## Module 2.6 — Products (UC-11)
- [ ] `products` (routes/controller/service/repository) CRUD with full cost-breakdown fields + optional color
- [ ] Validation: packing > 0, category required, money fields numeric
- [ ] List endpoint joins category + vendor names (for searchable dropdowns)

## Module 2.7 — Customers
- [ ] `customers` (routes/controller/service/repository) CRUD (links to chart account `ac_id` + city)
- [ ] List endpoint returns linked account + city names

## Module 2.8 — Sub-Customers (UC-13)
- [ ] `subCustomers` (routes/controller/service/repository) CRUD (must belong to a customer)
- [ ] `GET /api/customers/:id/sub-customers` for the Sale Bill inline "+ Add Sub-Customer" flow
