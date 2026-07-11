# repositories/ — Data Access Layer

One repository per feature (`<feature>.repository.js`). The **only** place SQL lives.

Rules:
- Parameterized queries only (`$1, $2, …`) via `query()` from `../db/pool` — never string
  interpolation (SQL injection).
- Functions that are part of a multi-write operation accept a `client` argument so the service
  can run them inside `withTransaction()`.
- No req/res, no business decisions — take plain values, return plain rows.

Files map 1:1 to features (see `../routes/README.md`). Each typically exposes:
`findAll(filters)`, `findById(id)`, `insert(data)`, `update(id, data)`, `softDelete(id)`
plus feature-specific queries (e.g. `saleBills.repository.js`: `insertItems(client, billId, items)`,
`biltySearch(filters)`; `reports.repository.js`: aggregate queries over `stock_movements` /
`ledger_entries`).
