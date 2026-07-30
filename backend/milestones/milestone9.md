# Milestone 9 — Alerts, Frontend Integration & Electron Packaging

**Goal:** Close out with the alerts banner, wire the React frontend from AppContext demo data onto
the real API, and package the whole thing as an Electron desktop app.

## Module 9.1 — Alerts (UC-05)
- [ ] `alerts:list` — cheque-due alerts only (payment-overdue alert dropped in v4.3); `alerts:dismiss` channel

## Module 9.2 — Frontend Integration
- [ ] `frontend/src/lib/api.ts` — thin wrapper over `window.api.<feature>.<action>(payload)` (exposed by `electron/preload.js`), error handling for a rejected IPC call
- [ ] Replace AppContext demo data with `window.api` calls, screen by screen, following the sidebar order Milestones 2–8 were built in
- [ ] Real login flow: call `window.api.auth.login(...)`, hold the returned `{ role }` in React state for UI purposes (e.g. hiding admin-only nav per UC-03) — no token to store, session lives in the main process
- [ ] Draft bills/returns/receipts/expenses now come from the backend `draft_*` tables (Milestones 2 & 4), not just localStorage — reconcile any existing frontend-only draft persistence with the real IPC calls

## Module 9.3 — Electron & End-to-End Verification
- [x] `electron/main.js` — registers every IPC channel (`src/ipc/index.js`), then opens the `BrowserWindow` loading the Vite build
- [x] `electron/preload.js` — `contextBridge` exposing `window.api.<feature>.<action>(payload)` over `ipcRenderer.invoke`
- [ ] Dev script: concurrently run Vite dev server + Electron (`npm run electron:dev`)
- [ ] electron-builder config — package app for Windows (shop PC); document local MS SQL Server prerequisite
- [ ] Update-check page — `electron-updater` in the main process polling the project's GitHub Releases; internet only for this one check, no Express/backend involvement
- [ ] Full flow test: login → setup data → create & post sale bill → receipt → expense → verify stock report, account ledger, cash book balance
- [ ] Verify unpost reverses ledger + stock correctly; verify a bounced cheque produces a reversing entry, not a deleted row
- [ ] A4 print flows still work against real data
