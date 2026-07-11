# migrations/ — Schema Migrations

Numbered `.sql` files applied in order by `../migrate.js` (`npm run migrate`).
Applied files are recorded in `schema_migrations` and never re-run. **Never edit an applied
migration** — schema changes go in a new file (`002_...sql`, `003_...sql`, …).

| File | Purpose |
| --- | --- |
| `001_init.sql` | Full initial schema: 6 enum types, 21 tables (auth, lookups, products, 4-level accounts hierarchy, customers, sale bills/returns + items, receipts, expenses, `stock_movements`, `ledger_entries`), indexes (incl. partial indexes for the UC-07 without-bilty/adda filters), and `updated_at` triggers on every table. Mirrors `System_architecture/database_schema.md`. |
