# Milestone 8 — System Setup: City Creation & Accounts Hierarchy

**Goal:** The remaining sidebar SYSTEM SETUP entry (City Creation) plus its supporting location
setup, and the 3-level accounting hierarchy (Class → Group → Chart/Business) every earlier
transaction milestone posts against. **v4.3 dropped `control_accounts` entirely** — the hierarchy
is Group → Chart or Group → Business directly, one level shallower than previously planned.

## Module 8.1 — City Creation, Regions, Stores & Addas (UC-11, UC-12, UC-13, UC-14)
- [ ] `cities` (routes/controller/service/repository) CRUD + unique-name validation
- [ ] `regions` (routes/controller/service/repository) CRUD
- [ ] `stores` (routes/controller/service/repository) CRUD
- [ ] `addas` (routes/controller/service/repository) CRUD; delete guard: block deletion when the adda is referenced by any sale bill (409) — `adda_id` is `NOT NULL` on sale bills in v4.3, so every bill has one

## Module 8.2 — Account Classes & Group Accounts (UC-15)
- [ ] `accountClasses` files — read-only lookup CRUD (`account_classes`, promoted from a fixed `CHECK` list in v4.3)
- [ ] `groupAccounts` files CRUD (name + `account_class_id` FK)
- [ ] Prevent delete when chart/business accounts reference the group

## Module 8.3 — Chart & Business Accounts, Hierarchy Queries (UC-16, UC-17)
- [ ] `chartAccounts` files CRUD (group parent, link_code, status ACTIVE/CLOSED, account-code composition rule per schema §3.2); CLOSED accounts excluded from selection lists
- [ ] `businessAccounts` files CRUD (group parent, link_code, region, `city_id`, status; 4-digit serial per schema v4.2); CLOSED accounts excluded from expense-head selection
- [ ] `GET /api/accounts/tree` — full Class→Group→Chart/Business tree for setup screens
- [ ] Auto-fill lookups: given chart account → its group/class (Sale Bill & Receipt auto-fill)
