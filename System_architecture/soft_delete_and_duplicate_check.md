# Soft delete & duplicate-name check

Every entity referenced by a foreign key elsewhere in the schema (vendors, customers,
sub-customers, regions, cities, stores, products, employees, addas, ...) is never hard-deleted.
"Delete" flips `is_active = 0` instead. A real `DELETE FROM` would either be blocked by the FK
constraint (if any bill/ledger row still points at it) or, if we cascaded the delete, silently
erase history that a posted purchase/sale/receipt still needs to render correctly months later.
Soft delete is the only option that keeps referential integrity intact while still letting the
"deleted" row disappear from active dropdowns and lists (`list()` filters `is_active = 1` by
default, `includeInactive` opts back in).

The flip side of never truly deleting anything is that `create()` needs to check whether the same
entry already exists before inserting a new row — otherwise soft-deleted rows would just accumulate
duplicates every time someone re-adds the same vendor by mistake. Important correction from the
first pass of this: **name alone is not a safe duplicate key** for any of these entities — two real
vendors, two real customers, two real employees can legitimately share a name ("Ali Traders" is a
common business name; "Ali" is a common person's name). Where a second identifying field exists
(vendors have `phone`), the match key is **name + that field together**, case-insensitive on name,
NULL-safe on the other field so two no-phone entries with the same name still collide. Customers and
sub-customers don't carry `phone` at all (removed earlier — see git history), so their match key is
name alone; that's acceptable because, unlike vendors, an active name match never blocks them
anyway (see below) — the key only has to be precise enough to drive the *inactive* branch's
per-row reactivate list.

The check always branches the same way once a match (or matches) is found — the difference between
entity types is what happens on an **active** match, not on an inactive one:

- **Unique-by-nature entities** (vendors, regions, cities, stores, products, employees) — a match
  against an **active** row blocks creation outright (`DUPLICATE_NAME`, 409). A match against an
  **inactive** row throws `INACTIVE_DUPLICATE` instead, carrying the existing row's id/name (and
  phone, where relevant) back to the frontend via `ApiError`'s new `details` field (threaded
  through `wrap.js` into `{ ok:false, error:{ message, code, details } }`), so the UI can pop "this
  already exists — reactivate it?" and call the new `<feature>:reactivate` channel instead of
  creating a second row.
- **Customers / sub-customers** — a name match against an **active** row never blocks `create()`
  at all (real people share names; `create()` just creates). Only a match against an **inactive**
  row needs a decision, and it's a different decision than the unique-entity case: "activate one of
  these previous (inactive) matches" or "create a new one anyway." Because names aren't unique here,
  there's no single conflict error to throw — instead there's a `checkName(name)` service fn and
  `<feature>:checkName` IPC channel the frontend calls *before* `create()`, returning
  `{ status: 'none'|'active'|'inactive', matches: [...] }` (`'inactive'` wins over `'active'` when
  both exist, since it's the only one needing a choice). The frontend decides what to show; `create()`
  itself no longer does any duplicate check.

**Status: rolled out to every entity that has CRUD code today.**

- Unique-entity branch: `vendors` (name+phone key), `regions`/`cities`/`stores`/`categories`/
  `addas` (name-only key — their existing DB-level `UNIQUE(name)` was left in place, since it's
  correct there: those really must be globally unique, unlike vendors), and `products` (name+
  vendor_id key — `products` had *no* duplicate-name check at all before this, since the same
  product name legitimately recurs across different vendors/suppliers). Each gets
  `<feature>.repository.js#findByName[AndX]`, `<feature>.service.js#create/update/reactivate`, and
  a `<feature>:reactivate` IPC channel.
- Non-blocking branch: `customers`/`sub_customers` (name-only key, since neither carries a second
  field like phone — acceptable because an active match never blocks them anyway, so the key only
  needs to be precise enough to drive the inactive branch's reactivate list). Each gets
  `<feature>.repository.js#findAllByName`, `<feature>.service.js#create/checkName/reactivate`, and
  `<feature>:checkName` + `<feature>:reactivate` IPC channels.
- **Not done:** `bank_accounts` and `employees` have no CRUD implemented yet (both are still empty
  stub repository/service files — Milestone 4, not built), so there's nothing to attach this
  pattern to there. Do this when those modules are actually built.
- Two stray DB-level `UNIQUE(name)` constraints that would have silently overridden the app-level
  check were dropped: `vendors.name`, `sub_customers.name` (`customers.name` never had one).
  `regions`/`cities`/`stores`/`categories`/`addas`' `UNIQUE(name)` constraints were kept — they're
  correct for those tables, since names there truly must be globally unique.

A reusable frontend prompt for both branches exists at
`frontend/src/components/DuplicateNamePromptModal.tsx` (the `allowCreateOnActive` prop switches
between them), but it is **not wired into any page**. Every relevant setup page —
`VendorSetupPage.tsx`, `RegionSetupPage.tsx`, `CitySetupPage.tsx`, `StoreSetupPage.tsx`,
`CategorySetupPage.tsx`, `AddaSetupPage.tsx`, `ProductSetupPage.tsx`, `CustomerSetupPage.tsx`,
`SubCustomerSetupPage.tsx` — still runs on the old in-memory demo state (`AppContext.tsx`'s
`useReducer`), not real `window.api` IPC calls to the backend at all. Wiring this modal in for real
means switching each page off demo data first; that hasn't been done for any of them.
