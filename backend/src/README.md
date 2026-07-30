# src/ — Application Source

Layer-first layout. There's no HTTP server — the Electron renderer and this backend logic run in
one process tree and talk over IPC. A call flows: `renderer (window.api.x.y()) → ipc → services →
repositories → db`.

| Item | Purpose |
| --- | --- |
| `ipc/` | One file per feature (`<feature>.ipc.js`), each registering its `ipcMain.handle('<feature>:<action>', ...)` channels and calling into the service layer — replaces `routes/`+`controllers/` (no URL routing or req/res object to separate). `index.js` registers every feature; `session.js` holds the in-memory logged-in session and `requireSession()`/`requireRole()` guards; `wrap.js` normalizes handler errors. |
| `services/` | Business logic, validation, transactions — throws `ApiError` |
| `repositories/` | SQL only (parameterized queries) — no session/no IPC awareness |
| `middleware/` | Small shared helpers (payload validation) — not an Express middleware chain |
| `errors/` | Error types (`ApiError`) |
| `config/` | Environment/configuration loading (MS SQL connection only) |
| `db/` | `mssql` pool, migration runner, migrations, seeds |
| `utils/` | Small shared helpers (date ranges, formatting) — keep tiny |

Naming convention: one file per feature per layer — `<feature>.<layer>.js`
(e.g. `saleBills.ipc.js`, `saleBills.service.js`, `saleBills.repository.js`).

The Electron shell (`../electron/main.js`, `../electron/preload.js`) is what actually starts this:
`main.js` calls `ipc/index.js`'s registrar before opening the `BrowserWindow`, and `preload.js`
exposes `window.api.<feature>.<action>(payload)` to the renderer via `contextBridge`.
