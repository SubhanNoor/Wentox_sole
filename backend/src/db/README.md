# db/ — PostgreSQL Access & Schema

| Item | Purpose |
| --- | --- |
| `pool.js` | pg `Pool` singleton. Exports `query(text, params)` for single statements and `withTransaction(fn)` which runs `fn(client)` inside BEGIN/COMMIT with automatic ROLLBACK — **required** for any multi-write operation (bill + items, post/unpost). |
| `migrate.js` | Migration runner (`npm run migrate`): applies `migrations/*.sql` in filename order, each in its own transaction, tracked in a `schema_migrations` table so files are applied once. |
| `migrations/` | Numbered `.sql` schema files. Never edit an applied migration — add a new one. |
| `seeds/` | Seed scripts (`npm run seed`): admin user (bcrypt), CASH & SALES chart accounts, default store. |

Schema reference: `System_architecture/database_schema.md`.
