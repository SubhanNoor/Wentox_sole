# milestones/ — Backend Work Plan

One file per delivery phase. Each milestone has a goal, `##` Modules, and `- [ ]` task checkboxes —
tick tasks as they're completed and log details in `../PROGRESS.md`.

Milestones 2–8 follow the frontend sidebar's own top-to-bottom order (see the app screenshot this
plan was built from), 2–3 screens/functionalities per milestone, so each phase ships a coherent
slice of the UI rather than a cross-cutting layer.

**Transport is Electron IPC, not HTTP.** The renderer and backend logic run in one desktop app, not
a browser talking to a server — there's no Express, no port, no JWT/bearer token. Every endpoint
bullet below (`GET /api/x`, `POST /api/x/:id/post`, etc.) is written in the old HTTP-shorthand for
brevity but means an IPC channel: `ipcMain.handle('x:action', ...)` on the main-process side, called
as `window.api.x.action(payload)` from the renderer (via a `contextBridge` preload script). The
mechanical conversion is:

| HTTP shorthand | IPC channel |
| --- | --- |
| `GET /api/x` (list) | `x:list` |
| `GET /api/x/:id` | `x:get` |
| `POST /api/x` | `x:create` |
| `PUT /api/x/:id` | `x:update` |
| `PATCH /api/x/:id/<field>` | `x:update-<field>` |
| `DELETE /api/x/:id` | `x:remove` (soft delete) |
| `POST /api/x/:id/post` / `.../unpost` | `x:post` / `x:unpost` |

`routes/controller/service/repository` becomes `ipc handler/service/repository` — `src/ipc/<feature>.ipc.js`
does what `routes.js` + `controller.js` used to (register channels, read the payload, call the
service), since there's no URL routing or req/res object to separate them.

| File | Phase | Covers |
| --- | --- | --- |
| `milestone1.md` | Foundation & Auth | Electron bootstrap (main/preload/ipc registrar), config, MS SQL pool, migrations (39 tables) + seeds, session-based login, update credentials (UC-01–04) |
| `milestone2.md` | Sale Bill & Sale Return | Create/list/edit/post/unpost + drafts for both (UC-18, 19, 21, 22) |
| `milestone3.md` | Purchase & Purchase Return | Create/list/edit/post/unpost for both, vendor stock movements (UC-23, 24) |
| `milestone4.md` | Receipts (Jamma) & Expenses (Kharch) | Ledger-only postings, cheque lifecycle/bounce reversal (UC-25–27) |
| `milestone5.md` | Current Stock, Reports & Search/Bilty-Adda | Stock/production entry, full report set, bilty/adda search+update (UC-20, 28–38) |
| `milestone6.md` | System Setup: Products, Categories, Vendors | (UC-06–08) |
| `milestone7.md` | System Setup: Workers, Customers, Sub-Customers | Workers blocked on definition; customers/sub-customers (UC-09, 10) |
| `milestone8.md` | System Setup: Cities & Accounts Hierarchy | Cities/regions/stores/addas, Class→Group→Chart/Business accounts (UC-11–17) |
| `milestone9.md` | Alerts, Frontend Integration & Electron | Alerts (UC-05), API wiring, packaging, end-to-end verification |
