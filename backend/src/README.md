# src/ — Application Source

Layer-first layout. A request flows: `routes → controllers → services → repositories → db`.

| Item | Purpose |
| --- | --- |
| `app.js` | Builds the Express app: CORS, JSON parsing, `/health`, mounts `routes/index.js` at `/api`, attaches the error handler last |
| `server.js` | Starts the HTTP server (exported `start()` is also called by `electron/main.js`) |
| `routes/` | URL definitions only — no logic |
| `controllers/` | HTTP handling (req/res), calls services — no business logic, no SQL |
| `services/` | Business logic, validation, transactions — throws `ApiError` |
| `repositories/` | SQL only (parameterized queries) — no req/res |
| `middleware/` | Cross-cutting Express middleware (JWT auth, error handler, validation) |
| `errors/` | Error types (`ApiError`) |
| `config/` | Environment/configuration loading |
| `db/` | PostgreSQL pool, migration runner, migrations, seeds |
| `utils/` | Small shared helpers (date ranges, formatting) — keep tiny |

Naming convention: one file per feature per layer — `<feature>.<layer>.js`
(e.g. `saleBills.routes.js`, `saleBills.controller.js`, `saleBills.service.js`, `saleBills.repository.js`).
