# Milestone 8 — System Setup: City Creation & Accounts Hierarchy

**Goal:** The remaining sidebar SYSTEM SETUP entry (City Creation) plus its supporting location
setup, and the 3-level accounting hierarchy (Class → Group → Chart/Business) every earlier
transaction milestone posts against. **v4.3 dropped `control_accounts` entirely** — the hierarchy
is Group → Chart or Group → Business directly, one level shallower than previously planned.

## Module 8.1 — City Creation, Regions, Stores & Addas (UC-11, UC-12, UC-13, UC-14)
- [x] `cities` (ipc handler/service/repository) CRUD + unique-name validation — `region_id` optional (UC-11: "optionally attach it to a region"); no `code` column (UC-11's "auto code" wording is stale — schema has none)
- [x] `regions` (ipc handler/service/repository) CRUD — `regions.ipc.js` was a missing file, `regions` was also missing from `src/ipc/index.js` and `electron/preload.js`'s `FEATURES` array entirely; all three fixed. No `code` column (same stale-doc note as Cities).
- [x] `stores` (ipc handler/service/repository) CRUD
- [x] `addas` (ipc handler/service/repository) CRUD; delete guard: block deletion (409, `ADDA_IN_USE`) when the adda is referenced by any `sale_bills`/`sale_returns` row or their `draft_sale_bills`/`draft_sale_returns` mirrors — checked before the soft-delete runs, not after
- [x] **Post-v4.3 schema addition, per client instruction:** `addas.region_id` added (`NOT NULL`, folded directly into `database/schema.sql`) so Sale Bill/Sale Return can eventually scope the adda dropdown/filter by region, same pattern as `sub_customers.region_id` (Milestone 7). One pre-existing "Test Adda" fixture row was backfilled to a real region before the `NOT NULL` constraint was applied. `use_cases.md` UC-14 and `database_schema_v4.3.md` updated to match.
- [x] Verify: Regions/Cities/Stores CRUD (duplicate-name rejection, soft-delete); Addas — missing `region_id` rejected, create/update, unreferenced adda deletes (soft) successfully, a genuinely-referenced adda in `wentox_db` correctly blocked with `ADDA_IN_USE` — all run live, plus a from-scratch `schema.sql`-only import verified against a disposable scratch database
- **Parked for later discussion (flagged, not built):** "if a create() hits an inactive row with the same name, offer to reactivate instead of rejecting" — was raised mid-session and explicitly deferred. Every entity in this milestone (and every one before it) still does flat duplicate-name rejection regardless of active status.

## Module 8.2 — Account Classes & Group Accounts (UC-15)
- [ ] `accountClasses` files — read-only lookup CRUD (`account_classes`, promoted from a fixed `CHECK` list in v4.3)
- [ ] `groupAccounts` files CRUD (name + `account_class_id` FK)
- [ ] Prevent delete when chart/business accounts reference the group

## Module 8.3 — Chart & Business Accounts, Hierarchy Queries (UC-16, UC-17)
- [ ] `chartAccounts` files CRUD (group parent, link_code, status ACTIVE/CLOSED, account-code composition rule per schema §3.2); CLOSED accounts excluded from selection lists
- [ ] `businessAccounts` files CRUD (group parent, link_code, region, `city_id`, status; 4-digit serial per schema v4.2); CLOSED accounts excluded from expense-head selection
- [ ] `accounts:tree` — full Class→Group→Chart/Business tree for setup screens
- [ ] Auto-fill lookups: given chart account → its group/class (Sale Bill & Receipt auto-fill)
