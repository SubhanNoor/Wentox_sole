# Milestone 1 — Foundation & Auth

**Goal:** A bootable Express backend with config, PostgreSQL connection, the full database schema
applied via migrations, and working JWT authentication for the single admin user (UC-19, UC-20).
Everything after this milestone builds on this skeleton.

## Module 1.1 — Project Bootstrap
- [ ] Initialize `package.json` (express, pg, jsonwebtoken, bcrypt, cors, dotenv; dev: nodemon, electron, electron-builder, concurrently)
- [ ] Create layered-modular folder tree (`src/config`, `src/db`, `src/middleware`, `src/routes`, `src/controllers`, `src/services`, `src/repositories`, `src/errors`, `src/utils`, `electron/`)
- [ ] `src/config/index.js` — env loading (PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRY)
- [ ] `src/app.js` — Express app: JSON body parsing, CORS (localhost renderer), route mounting
- [ ] `src/server.js` — bootstrap + `/health` endpoint
- [ ] Central error-handling middleware (`src/middleware/errorHandler.js`) with consistent JSON error shape
- [ ] `.env.example` and `.gitignore`

## Module 1.2 — Database
- [ ] `src/db/pool.js` — pg Pool singleton + `query()` helper + `withTransaction()` helper
- [ ] `src/db/migrate.js` — simple migration runner (applies `src/db/migrations/*.sql` in order, tracks in `schema_migrations` table)
- [ ] `src/db/migrations/001_init.sql` — full DDL from `System_architecture/database_schema.md` (enums, 21 tables, indexes, updated_at triggers)
- [ ] Seed script (`src/db/seeds/`) — admin user (bcrypt hash), CASH & SALES chart accounts, default store
- [ ] Verify: migration applies cleanly to a fresh local database

## Module 1.3 — Auth (UC-19, UC-20)
- [ ] `auth` files — login + credentials logic across routes/controller/service/repository
- [ ] `POST /api/auth/login` — verify bcrypt hash, return JWT
- [ ] `src/middleware/auth.js` — JWT verification, applied to all `/api/*` routes except login
- [ ] `PUT /api/auth/credentials` — update username/password (UC-19), re-hash with bcrypt
- [ ] Verify: login with seeded admin, hit a protected route with/without token
