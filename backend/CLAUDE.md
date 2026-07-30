# Wentox Backend — Working Instructions

Backend for the Wentox ERP desktop app (Electron): Node.js + Express local API, raw SQL via `mssql`
(Tedious), locally installed Microsoft SQL Server, JWT auth (single admin). Schema:
`../System_architecture/database_schema_v4.3.md` (source of truth — supersedes `database_schema.md`,
which is the old, stale Postgres-era doc). Use cases: `../System_architecture/use_cases.md`.
Build sequencing (engine switch + reconciliation, ahead of the milestones): `plan.md`. Work plan:
`milestones/milestone1.md … milestone9.md`, ordered to follow the frontend sidebar's own screen
order (see `milestones/README.md`).

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

- **SQL:** parameterized queries only, via `mssql` named params (`request.input('name', sql.Type,
  value)` and `@name` in the query text) — never string interpolation. snake_case naming. Money is
  `DECIMAL`, never floats. `IDENTITY(1,1)` for surrogate keys, `DATETIME2` for timestamps (matches
  `database_schema_v4.3.md`). Any operation with multiple writes (e.g. bill + items, post/unpost
  writing ledger + stock) MUST use `withTransaction()` from `src/db/pool.js`, which wraps an
  `mssql` `Transaction`/`Request` pair — not a `pg` client.
- **Posting:** post = write `ledger_entries` + `stock_movements` in one transaction; unpost =
  delete them in one transaction. Financial edits only on UNPOSTED documents; bilty/adda updates
  allowed on POSTED bills (UC-07).
- **Auth:** JWT middleware on all `/api/*` routes except `POST /api/auth/login`.
- **Errors:** throw from services; the central `errorHandler` middleware formats
  `{ error: { message, code } }`. Never `res.status(500)` inline.
- **Migrations:** T-SQL only, in `src/db/migrations/` (never edit applied ones). `001_init.sql` is
  the old Postgres-era schema and is superseded — the current migration is generated from
  `database_schema_v4.3.md`'s DDL, which is meant to be used verbatim once approved.
- **Skills:** use `architecture-designer` for design decisions; `postgres-pro` /
  `database-optimizer` still apply for general query-tuning/indexing principles, but treat their
  Postgres-specific syntax examples as illustrative only — this project runs on SQL Server.

## Commands

- `npm run dev` — nodemon on `src/server.js`
- `npm run migrate` — apply pending migrations
- `npm run seed` — seed admin user + CASH/SALES accounts + default store
