# repositories/ — Data Access Layer

One repository per feature (`<feature>.repository.js`). The **only** place SQL lives.

Rules:
- Parameterized queries only via `mssql` named params (`request.input('name', sql.Type, value)`
  and `@name` in the query text) through `query()`/`requestWithParams()` from `../db/pool` — never
  string interpolation (SQL injection).
- Functions that are part of a multi-write operation accept a `transaction` argument so the service
  can run them inside `withTransaction()`.
- No IPC/session awareness, no business decisions — take plain values, return plain rows.

Files map 1:1 to features (see `../ipc/README.md`). Each typically exposes:
`findAll(filters)`, `findById(id)`, `insert(data)`, `update(id, data)`, `softDelete(id)`
plus feature-specific queries (e.g. `saleBills.repository.js`: `insertItems(transaction, billId, items)`,
`biltySearch(filters)`; `reports.repository.js`: aggregate queries over `stock_movements` /
`ledger_entries`).
