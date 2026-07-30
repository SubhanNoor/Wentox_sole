# Milestone 1 — Foundation & Auth

**Goal:** A bootable Express backend with config, MS SQL Server connection, the full database schema
applied via migrations, and working JWT authentication for the single admin user (UC-01, UC-02).
Everything after this milestone builds on this skeleton.

## Module 1.1 — Project Bootstrap
- [ ] Initialize `package.json` (express, mssql, jsonwebtoken, bcrypt, cors, dotenv; dev: nodemon, electron, electron-builder, concurrently)
- [ ] Create layered-modular folder tree (`src/config`, `src/db`, `src/middleware`, `src/routes`, `src/controllers`, `src/services`, `src/repositories`, `src/errors`, `src/utils`, `electron/`)
- [ ] `src/config/index.js` — env loading (PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRY)
- [ ] `src/app.js` — Express app: JSON body parsing, CORS (localhost renderer), route mounting
- [ ] `src/server.js` — bootstrap + `/health` endpoint
- [ ] Central error-handling middleware (`src/middleware/errorHandler.js`) with consistent JSON error shape
- [ ] `.env.example` and `.gitignore`

## Module 1.2 — Database
- [ ] `src/db/pool.js` — `mssql` `ConnectionPool` singleton + `query()` helper + `withTransaction()` helper (wraps an `mssql` `Transaction`/`Request` pair)
- [ ] `src/db/migrate.js` — simple migration runner (applies `src/db/migrations/*.sql` in order, tracks in a `schema_migrations` table)
- [ ] `src/db/migrations/001_init.sql` — full T-SQL DDL from `System_architecture/database_schema_v4.3.md` (30 tables, `IDENTITY(1,1)`, `DATETIME2`, `CHECK` constraints, indexes) — used verbatim per that document; the old `001_init.sql` (Postgres, 21 tables) is archived, not edited. Applying all 30 tables up front means every later milestone's CRUD/transaction work has its tables available from day one, regardless of which screen milestone builds it in.
- [ ] Seed script (`src/db/seeds/`) — admin user (bcrypt hash, with `role`), CASH & SALES chart accounts, default store
- [ ] Verify: migration applies cleanly to a fresh local SQL Server database

## Module 1.3 — Auth (UC-02: Log in / log out, UC-03: Role-based access control)
- [ ] `auth` files — login + credentials logic across routes/controller/service/repository
- [ ] `POST /api/auth/login` — verify bcrypt hash, return JWT (include `role` claim per UC-03)
- [ ] `src/middleware/auth.js` — JWT verification, applied to all `/api/*` routes except login
- [ ] `PUT /api/auth/credentials` — update username/password (UC-04: Update system settings/credentials), re-hash with bcrypt
- [ ] Verify: login with seeded admin, hit a protected route with/without token
