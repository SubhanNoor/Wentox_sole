# Milestone 7 — System Setup: Workers, Customers, Sub-Customers

**Goal:** The next three sidebar SYSTEM SETUP entries.

## Module 7.1 — Workers
- [ ] **Blocked on definition:** `Workers` appears in the frontend sidebar but has no entry in
      `use_cases.md` or `database_schema_v4.3.md` — confirm with the user what a worker record needs
      (fields, whether it drives payroll/expense heads, relation to `business_accounts`) before
      writing schema or CRUD for it. Do not invent fields.

## Module 7.2 — Customers (UC-09)
- [ ] `customers` (routes/controller/service/repository) CRUD (links to chart account `ac_id` + city, per UC-09 auto-creates a chart account exactly as UC-08 does for vendors)
- [ ] List endpoint returns linked account + city names

## Module 7.3 — Sub-Customers (UC-10)
- [ ] `subCustomers` (routes/controller/service/repository) CRUD (must belong to a customer)
- [ ] `GET /api/customers/:id/sub-customers` for the Sale Bill inline "+ Add Sub-Customer" flow
