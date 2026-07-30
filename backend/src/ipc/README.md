# ipc/ — IPC Layer

Replaces `routes/`+`controllers/` from an HTTP-shaped backend — there's no URL routing or req/res
object here, so the two collapse into one file per feature. A file (`<feature>.ipc.js`):

- registers `ipcMain.handle('<feature>:<action>', wrap((payload) => ...))` channels
- calls `requireSession()` (or `requireRole('ADMIN')`) from `session.js` first, for anything that
  needs a logged-in user — `auth:login` is the only channel that doesn't
- calls the matching **service** function and returns its result — `wrap()` turns that into
  `{ ok: true, data }`, or `{ ok: false, error }` if the service threw, which is what the renderer's
  `await window.api.<feature>.<action>(payload)` resolves with (it never rejects; check `.ok`)
- never contains business logic or SQL

| File | Purpose |
| --- | --- |
| `index.js` | Central registrar — calls every feature's `register()` once, from `electron/main.js`, before the `BrowserWindow` loads |
| `session.js` | In-memory `{ userId, username, role }` session (no JWT/bearer token — renderer and main process share a process tree). `login()`/`logout()`/`current()`/`requireSession()`/`requireRole()` |
| `wrap.js` | Resolve-always wrapper: success → `{ ok: true, data }`, failure → `{ ok: false, error: { message, code } }` — never throws across IPC, since Electron drops custom properties (like `ApiError`'s `.code`) off anything thrown through `ipcMain.handle`. Logs non-`ApiError` failures via `console.error` before sanitizing them. |
| `auth.ipc.js` | Login (no session required) + update credentials (UC-02/03/04) |
| `cities.ipc.js` | City setup CRUD (UC-11) |
| `regions.ipc.js` (Milestone 8) | Region setup CRUD (UC-12) |
| `stores.ipc.js` | Store setup CRUD (UC-13) |
| `addas.ipc.js` | Transport adda setup CRUD (UC-14) |
| `vendors.ipc.js` | Vendor setup CRUD (UC-08) |
| `categories.ipc.js` | Product category CRUD (UC-06) |
| `products.ipc.js` | Product CRUD incl. cost breakdown, article colors (UC-07) |
| `customers.ipc.js` | Customer CRUD (UC-09) |
| `subCustomers.ipc.js` | Sub-customer CRUD (UC-10) |
| `groupAccounts.ipc.js` | Group accounts (UC-15) |
| `chartAccounts.ipc.js` | Chart of accounts (UC-16) |
| `businessAccounts.ipc.js` | Business accounts (UC-17) |
| `saleBills.ipc.js` | Sale bills + post/unpost + bilty search/update (UC-18/19/20) |
| `saleReturns.ipc.js` | Sale returns (UC-21/22) |
| `receipts.ipc.js` | Receipts / Jamma + cheque disposal (UC-25/27) |
| `expenses.ipc.js` | Expenses / Kharch (UC-26) |
| `stock.ipc.js` | Production entries (UC-28), opening/adjustment movements, movement history |
| `reports.ipc.js` | Current stock + production logs, khaata, cash book, and the rest of the report set (UC-29–38) |

Adding a feature: create `<feature>.ipc.js` (+ service + repository), add one line to `index.js`'s
registrar, and add the feature name to the `FEATURES` array in `../../electron/preload.js`.
