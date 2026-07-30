# Milestone 1 — Foundation & Auth

**Goal:** A bootable Electron app — main process, MS SQL Server connection, the full database
schema applied via migrations, and a working login/session for the single admin user (UC-01,
UC-02) — talking to the renderer over IPC, not HTTP. Everything after this milestone builds on
this skeleton.

## Module 1.1 — Project Bootstrap
- [x] Initialize `package.json` (mssql, bcrypt, dotenv; dev: nodemon, electron, electron-builder, concurrently) — no `express`/`cors`/`jsonwebtoken`, there's no HTTP server or bearer token in this architecture
- [x] Create layered-modular folder tree (`src/config`, `src/db`, `src/ipc`, `src/services`, `src/repositories`, `src/errors`, `src/utils`, `electron/`) — `src/ipc` replaces `routes`+`controllers`: one file per feature registering `ipcMain.handle` channels and calling into the service layer
- [x] `src/config/index.js` — env loading (`db` connection object for `mssql`; no `JWT_SECRET`/`JWT_EXPIRY`)
- [x] `electron/main.js` — creates the `BrowserWindow`, calls `registerIpcHandlers()` (from `src/ipc`) before loading the renderer
- [x] `electron/preload.js` — `contextBridge` exposing `window.api.<feature>.<action>(payload)`, each a thin wrapper over `ipcRenderer.invoke('<feature>:<action>', payload)`
- [x] `src/ipc/index.js` — central registrar (mirrors the old `routes/index.js`): imports every `<feature>.ipc.js` and registers its channels
- [x] Central error handling: each ipc handler's errors are caught in `src/ipc/wrap.js` and re-thrown as a plain `{ message, code }` shape so `ipcRenderer.invoke`'s rejection is predictable in the renderer (an `ApiError` serializes cleanly; anything else becomes `INTERNAL`)
- [x] `.env` and `.gitignore`

## Module 1.2 — Database
- [x] `src/db/pool.js` — `mssql` `ConnectionPool` singleton + `query()` helper + `withTransaction()` helper (wraps an `mssql` `Transaction`/`Request` pair)
- [x] `src/db/migrate.js` — migration runner: applies `database/schema.sql` first (repo-root source of truth, full T-SQL DDL generated from `System_architecture/database_schema_v4.3.md`, 39 tables), then any numbered files under `src/db/migrations/*.sql` in order, tracked in a `dbo.schema_migrations` table. Applying all tables up front means every later milestone's CRUD/transaction work has its tables available from day one, regardless of which screen milestone builds it in.
- [x] Seed script (`src/db/seeds/run.js`) — admin user (bcrypt hash, with `role`), account classes/groups + reserved chart accounts (CUSTOMERS/VENDORS ACCOUNTS, CASH IN HAND, SALES, PURCHASES, COMMISSION ALLOWED, CHEQUES IN HAND, Payment Trail heads), default store — idempotent, safe to re-run
- [ ] Verify: migration applies cleanly to a fresh local SQL Server database — **pending**: no SQL Server instance set up yet

## Module 1.3 — Auth (UC-02: Log in / log out, UC-03: Role-based access control)

No JWT, no bearer token, no `Authorization` header — there's no network boundary between renderer
and main process to protect (they're one OS process tree), so "session" is just in-memory state in
the main process, set on login and cleared on logout/app quit. `requireSession()` is the IPC
equivalent of the old JWT middleware: any handler that needs a logged-in user calls it first.

- [x] `src/ipc/session.js` — module-level `{ userId, username, role } | null`, `login()`, `logout()`, `requireSession()` (throws `ApiError.unauthorized` if null), `requireRole(role)` (UC-03)
- [x] `auth` files — login + credentials logic across `ipc handler/service/repository`
- [x] `auth:login` — verify bcrypt hash, call `session.login(user)` (include `role` per UC-03)
- [x] `auth:logout` — call `session.logout()`
- [x] `auth:update-credentials` — requires session; supports changing **username and/or password** — verify `currentPassword`, check new username isn't taken (`UQ_users_name`) before updating, re-hash new password with bcrypt if provided (UC-04)
- [ ] Verify: `auth:login` with seeded admin returns a session; a protected channel called with no prior login rejects via `requireSession()` — **pending**: no SQL Server instance / `npm install` (mssql) yet to run end-to-end
