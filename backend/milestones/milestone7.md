# Milestone 7 — System Setup: Employees, Customers, Sub-Customers

**Goal:** The next three sidebar SYSTEM SETUP entries.

## Module 7.1 — Employees (Workers + Salaried) — MOVED to Milestone 4 Module 4.5
**Unblocked 2026-08-19.** This was previously marked "blocked, no definition exists" — that was
wrong. `System_architecture/payroll.md` is a complete, reasoned design doc for Employees (the
sidebar label changes from "Workers" to "Employees"), `stages`, and `worker_stages`, and all three
tables are already fully specced and applied in `database/schema.sql`. Since Employees is tightly
coupled to the Wage Run / Salary Run transaction screens it feeds (same posting-account pattern,
same "type-first" design), the whole Employees/Payroll scope was consolidated into
**Milestone 4 Module 4.5** (`backend/milestones/milestone4.md`) alongside Wage Run (4.6) and
Salary Run (4.7) rather than split across two milestone files. See that file for the actual task
list — do not build Employees here.

## Module 7.2 — Customers (UC-09)
- [x] `customers` (ipc handler/service/repository) CRUD — `name`, `region_id` (required per schema), `city_id`, `address`; `create()` auto-creates a linked `business_accounts` row under the reserved CUSTOMERS ACCOUNTS chart account (same §3.2 pattern/helper as Vendors — `businessAccountsService.createUnderChartCode`) and links it via `customers.ba_id`, both writes in one transaction
- [x] List endpoint returns linked account + city names — joins `regions` (INNER, `region_id` is `NOT NULL`) and `cities` (LEFT, `city_id` nullable); ordered Region-first/City-second per §11 search rule
- [x] Renaming a customer keeps the linked account's name in sync
- [x] Verify: missing `region_id` rejected → create (linked account `100001XXXX`) → duplicate name rejected → update renames both → list/soft-delete (linked account stays `ACTIVE`) — all run live against `wentox_db`
- **Note:** unlike `vendors.name` (`UQ_vendors_name`), `customers.name` has no DB-level unique constraint (only a non-unique search index) — duplicate protection is service-layer only (`findByName` check). Low risk in this single-admin-session desktop app; flagged by debugger review, not fixed at the schema level.

## Module 7.3 — Sub-Customers (UC-10)
- [x] `subCustomers` (ipc handler/service/repository) CRUD — **independent record, no parent customer** (confirmed against schema — `sub_customers` has no `customer_id` column — and UC-10's explicit wording; the line below was corrected from the original stale draft)
- ~~`customers:sub-customers` channel for the Sale Bill inline "+ Add Sub-Customer" flow~~ — corrected: there's no parent to scope under, so the inline "+ Add Sub-Customer" flow just calls the normal `sub-customers:create` channel, same as the standalone Sub Customers screen
- [x] **Post-v4.3 schema addition, per client instruction:** `region_id` (required)/`city_id` (optional) added to `sub_customers` (`database/schema.sql`, folded in directly + `database_schema_v4.3.md`/`use_cases.md` UC-10 updated) so Sale Bill/Sale Return can narrow the "deliver to" dropdown to sub-customers whose region matches the selected customer's region — `subCustomers:list({ region_id })` filters accordingly; unfiltered `list()` still returns everyone. This reverses UC-10's original "not a filtered subset" wording.
- [x] Verify: create → duplicate name rejected → update → list/soft-delete → missing `region_id` rejected → region filter correctly includes/excludes by region, unfiltered list still returns both — all run live against `wentox_db`, plus a from-scratch `schema.sql`-only import confirmed against a disposable scratch database
