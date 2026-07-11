# Milestone 3 — Accounts Hierarchy

**Goal:** The 4-level accounting setup (Class → Group → Control → Chart/Business) fully served by
the API, with hierarchy queries powering the frontend's cascading dropdowns and guards preventing
misuse of CLOSED accounts.

## Module 3.1 — Group Accounts (UC-15)
- [ ] `groupAccounts` files CRUD (name + class enum)
- [ ] Prevent delete when control accounts reference the group

## Module 3.2 — Control Accounts (UC-16)
- [ ] `controlAccounts` files CRUD (parent group, sorting)
- [ ] `GET` list joined with group name + class; ordered by sorting

## Module 3.3 — Chart of Accounts (UC-17)
- [ ] `chartAccounts` files CRUD (control parent, link_code, status ACTIVE/CLOSED)
- [ ] Guard: CLOSED accounts excluded from selection lists (customers, posting)

## Module 3.4 — Business Accounts (UC-18)
- [ ] `businessAccounts` files CRUD (control parent, link_code, region, status)
- [ ] Guard: CLOSED accounts excluded from expense-head selection

## Module 3.5 — Hierarchy Queries
- [ ] `GET /api/accounts/tree` — full Class→Group→Control→Chart/Business tree for setup screens
- [ ] Auto-fill lookups: given chart account → its control/group/class (Sale Bill & Receipt auto-fill)
