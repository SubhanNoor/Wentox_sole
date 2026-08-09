# Wentox Backend — Working Instructions

Backend for the Wentox ERP desktop app (Electron): the renderer and this backend logic run in one
process tree and talk over **Electron IPC**, not HTTP — no Express, no port, no bearer token. Raw
SQL via `mssql` (Tedious), locally installed Microsoft SQL Server. Auth is a single in-memory
session (single admin), not JWT. Schema: `../System_architecture/database_schema_v4.3.md` (source
of truth — supersedes `database_schema.md`, which is the old, stale Postgres-era doc); the actual
applied DDL lives at `../database/schema.sql`. Use cases: `../System_architecture/use_cases.md`.
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

## Architecture: Layered, over IPC

Layer-first folders; each feature has one file per layer, named `<feature>.<layer>.js`:

```
src/ipc/           → ipcMain.handle('<feature>:<action>', ...) registration; index.js registers all
src/services/      → business logic, validation, transactions (throw ApiError)
src/repositories/  → SQL only (parameterized queries via db/pool)
src/middleware/    → small shared helpers (payload validation) — not an Express chain
src/errors/        → ApiError and error types
src/utils/         → tiny pure helpers with no layer of their own (dates.js: the single
                     definition of "today", local not UTC — see its header)
src/db/            → pool, migrations, seeds
electron/          → main.js (registers IPC, opens BrowserWindow), preload.js (contextBridge)
```

- Call flow: renderer `window.api.<feature>.<action>(payload)` → `ipc` handler → `service` →
  `repository` → `db`.
- `src/ipc/<feature>.ipc.js` replaces `routes/`+`controllers/` from an HTTP-shaped backend — there's
  no URL routing or req/res object to separate, so one file registers the channels, checks the
  session, and calls the service.
- `ipc` handlers never run SQL; repositories never touch IPC/session state.
- Cross-feature reads go through the other feature's service, not its tables directly.
- Adding a feature = 3 files (ipc/service/repository) + one line in `src/ipc/index.js`'s registrar +
  the feature name added to `electron/preload.js`'s `FEATURES` array.

## Conventions

- **SQL:** parameterized queries only, via `mssql` named params (`request.input('name', sql.Type,
  value)` and `@name` in the query text) — never string interpolation. snake_case naming. Money is
  `DECIMAL`, never floats. `IDENTITY(1,1)` for surrogate keys, `DATETIME2` for timestamps (matches
  `database_schema_v4.3.md`). Any operation with multiple writes (e.g. bill + items, post/unpost
  writing ledger + stock) MUST use `withTransaction()` from `src/db/pool.js`, which wraps an
  `mssql` `Transaction`/`Request` pair.
- **Posting:** post = write `ledger_entries` + `stock_movements` in one transaction; unpost =
  delete them in one transaction. Financial edits only on UNPOSTED documents; bilty/adda updates
  allowed on POSTED bills (UC-07).
- **Auth:** no JWT/bearer token — `src/ipc/session.js` holds an in-memory `{ userId, username, role }`
  set by `auth:login`. Every ipc handler that needs a logged-in user calls `requireSession()` (or
  `requireRole('ADMIN')`) first; `auth:login` is the only channel that doesn't.
- **Errors:** throw `ApiError` from services; `src/ipc/wrap.js` catches it and **resolves** (never
  throws back across IPC) `{ ok: false, error: { message, code } }` — Electron strips custom
  properties like `.code` off anything thrown through `ipcMain.handle`, so `wrap.js` sidesteps that
  by never throwing across the boundary. Success resolves `{ ok: true, data }`. Non-`ApiError`
  failures are logged via `console.error` before being sanitized to `code: 'INTERNAL'`. Never format
  errors inside an `ipc` handler itself.
- **Migrations:** the schema source of truth is `../database/schema.sql` (T-SQL, generated from
  `database_schema_v4.3.md`, applied first by `migrate.js`) — never edit it once applied; any
  schema change after that goes in a new numbered file under `src/db/migrations/` (never edit an
  applied one).
- **Skills:** use `architecture-designer` for design decisions; `postgres-pro` /
  `database-optimizer` still apply for general query-tuning/indexing principles, but treat their
  Postgres-specific syntax examples as illustrative only — this project runs on SQL Server.

## Commands

- `npm run dev` / `npm start` — launch the Electron app (main process registers IPC, opens the window)
- `npm run electron:dev` — Vite dev server + Electron together, for frontend hot-reload
- `npm run migrate` — apply `database/schema.sql` then any pending files under `src/db/migrations/`
- `npm run seed` — seed admin user + account classes/groups/reserved chart accounts + default store
