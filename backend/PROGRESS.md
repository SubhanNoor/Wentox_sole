# Wentox Backend — Progress Log

**Current milestone:** Milestone 1 — Foundation & Auth
**Status:** Not started (scaffolding created 2026-07-11)

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

---

## Milestone 1 — Foundation & Auth

### 2026-07-11 — Backend scaffolding & planning docs
- **What:** Rewrote `System_architecture/database_schema.md` (v3: 21 relations, enums, ledger +
  stock-movement design, full DDL). Created milestones 1–5, CLAUDE.md, this file, layered-modular
  folder structure with minimal boilerplate (Express skeleton, pg pool, config, migration runner
  placeholders), and `.claude/settings.json` wiring the pre-edit-approval and debugger hooks.
- **How:** Schema gaps (users, expenses, stock, ledger) closed per use cases UC-01…UC-20; posting
  semantics documented in the schema doc's Design Decisions.
- **Files:** `System_architecture/database_schema.md`, `backend/*`

### 2026-07-11 — Layer stubs in every module + errors folder
- **What:** Added `routes.js / controller.js / service.js / repository.js` stubs to all 16 modules;
  split `accounts` into `groups / controls / chart / business` submodules with an aggregating
  `accounts/routes.js`; added `src/errors/ApiError.js` (used by services + errorHandler).
- **How:** Each stub encodes its layer's rule (controllers: no SQL/logic; repositories: parameterized
  SQL only; services: ApiError + withTransaction). All files pass `node --check`.
- **Files:** `backend/src/{routes,controllers,services,repositories}/**`, `backend/src/errors/ApiError.js`

## Milestone 2 — Setup & Lookup CRUD
_Not started._

## Milestone 3 — Accounts Hierarchy
_Not started._

## Milestone 4 — Transactions & Posting
_Not started._

## Milestone 5 — Reports, Integration & Packaging
_Not started._
