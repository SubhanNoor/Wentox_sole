# db/ — MS SQL Server Access & Schema

| Item | Purpose |
| --- | --- |
| `pool.js` | `mssql` `ConnectionPool` singleton (lazy-connected). Exports `query(text, params)` for single statements (named params via `request.input`), `withTransaction(fn)` which runs `fn(transaction)` inside an `mssql` `Transaction` (commit/rollback automatic) — **required** for any multi-write operation (bill + items, post/unpost) — and `requestWithParams(poolOrTransaction, params)` for building ad-hoc parameterized requests inside repositories. Also re-exports the `sql` module for type tags (`sql.Int`, `sql.NVarChar`, …). |
| `migrate.js` | Migration runner (`npm run migrate`): applies `migrations/*.sql` in filename order, each in its own transaction, tracked in a `schema_migrations` table so files are applied once. |
| `migrations/` | Numbered `.sql` schema files. Never edit an applied migration — add a new one. |
| `seeds/` | Seed scripts (`npm run seed`): admin user (bcrypt), account classes/groups/chart accounts, default store. |

Schema reference: `System_architecture/database_schema_v4.3.md` (source of truth — supersedes the
old Postgres-era `database_schema.md`).
