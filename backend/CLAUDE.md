# Wentox Backend — Working Instructions

Backend for the Wentox ERP desktop app (Electron): Node.js + Express local API, raw SQL via `pg`,
locally installed PostgreSQL, JWT auth (single admin). Schema: `../System_architecture/database_schema.md`.
Use cases: `../System_architecture/use_cases.md`. Work plan: `milestones/milestone1.md … milestone5.md`.

## Workflow Rules (mandatory)

1. **Plan first, then ask.** Before writing or editing any code: design the logic/approach for the
   task, present it to the user, and get explicit approval. If the user requests changes, revise
   the plan before touching code. (Enforced by the PreToolUse hook in `.claude/settings.json`.)
2. **Debug after coding.** After writing code, invoke the `debugger` subagent
   (`.claude/agents/debugger.md`) on the session's changes before declaring the task done.
3. **Log progress.** After every completed task, update `PROGRESS.md`: what was done, how, and
   which files were touched. Tick the matching `- [ ]` checkbox in the milestone file.

## Architecture: Layered

Layer-first folders; each feature has one file per layer, named `<feature>.<layer>.js`:

```
src/routes/        → URL mapping only (cities.routes.js …); index.js mounts all under /api
src/controllers/   → req/res handling, calls service, no business logic
src/services/      → business logic, validation, transactions (throw ApiError)
src/repositories/  → SQL only (parameterized queries via db/pool)
src/middleware/    → auth (JWT), errorHandler, validate
src/errors/        → ApiError and error types
src/db/            → pool, migrations, seeds
```

- Request flow: route → controller → service → repository → db.
- Controllers never run SQL; repositories never touch req/res.
- Cross-feature reads go through the other feature's service, not its tables directly.
- Adding a feature = 4 files (routes/controller/service/repository) + one mount line in `routes/index.js`.

## Conventions

- **SQL:** parameterized queries only (`$1, $2…`) — never string interpolation. snake_case naming.
  Money is `NUMERIC`, never floats. Any operation with multiple writes (e.g. bill + items,
  post/unpost writing ledger + stock) MUST use `withTransaction()` from `src/db/pool.js`.
- **Posting:** post = write `ledger_entries` + `stock_movements` in one transaction; unpost =
  delete them in one transaction. Financial edits only on UNPOSTED documents; bilty/adda updates
  allowed on POSTED bills (UC-07).
- **Auth:** JWT middleware on all `/api/*` routes except `POST /api/auth/login`.
- **Errors:** throw from services; the central `errorHandler` middleware formats
  `{ error: { message, code } }`. Never `res.status(500)` inline.
- **Migrations:** schema changes only via new files in `src/db/migrations/` (never edit applied ones).
- **Skills:** use `architecture-designer` for design decisions, `postgres-pro` /
  `database-optimizer` when writing or tuning SQL.

## Commands

- `npm run dev` — nodemon on `src/server.js`
- `npm run migrate` — apply pending migrations
- `npm run seed` — seed admin user + CASH/SALES accounts + default store
