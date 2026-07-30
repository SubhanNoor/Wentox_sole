# services/ — Business Logic Layer

One service per feature (`<feature>.service.js`). This is the only place for business rules:

- validation (throw `ApiError.badRequest(...)` on bad input)
- calculations (pairs = cartons × packing, discounts, totals)
- posting rules: post/unpost writes `ledger_entries` + `stock_movements` **inside
  `withTransaction()`** from `../db/pool` — every multi-write operation must be transactional
- guards (e.g. financial edits only on UNPOSTED documents, CLOSED accounts unusable)

Services call their own **repository** for data access; cross-feature data goes through the other
feature's *service*, never directly to its tables. Services know nothing about IPC — session
checks (`requireSession`/`requireRole`) happen in the `ipc/` layer before a service is called.

Files map 1:1 to features (see `../ipc/README.md`). Notable ones once implemented:
- `saleBills.service.js` / `saleReturns.service.js` — totals + the posting engine
- `receipts.service.js` / `expenses.service.js` — ledger-only posting
- `reports.service.js` — stock summary, khaata (ledger by account), cash book (CASH account by date)
- `auth.service.js` — bcrypt verify/hash, starts/ends the in-memory session (`ipc/session.js`)
