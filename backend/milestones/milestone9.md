# Milestone 9 — Alerts, Frontend Integration & Electron Packaging

**Goal:** Close out with the alerts banner, wire the React frontend from AppContext demo data onto
the real API, and package the whole thing as an Electron desktop app.

## Module 9.1 — Alerts (UC-05)
- [ ] `GET /api/alerts` — cheque-due alerts only (payment-overdue alert dropped in v4.3); dismiss endpoint

## Module 9.2 — Frontend Integration
- [ ] `frontend/src/lib/api.ts` — fetch client (base URL, JWT header, error handling)
- [ ] Replace AppContext demo data with API calls, screen by screen, following the sidebar order Milestones 2–8 were built in
- [ ] Real login flow: store JWT, redirect on 401 (UC-02)
- [ ] Draft bills/returns/receipts/expenses now come from the backend `draft_*` tables (Milestones 2 & 4), not just localStorage — reconcile any existing frontend-only draft persistence with the real API

## Module 9.3 — Electron & End-to-End Verification
- [ ] `electron/main.js` — start Express on localhost port, then open BrowserWindow loading the Vite build
- [ ] `electron/preload.js` — contextBridge (minimal; app talks HTTP)
- [ ] Dev script: concurrently run backend (nodemon) + Vite dev server + Electron
- [ ] electron-builder config — package app for Windows (shop PC); document local MS SQL Server prerequisite
- [ ] Full flow test: login → setup data → create & post sale bill → receipt → expense → verify stock report, account ledger, cash book balance
- [ ] Verify unpost reverses ledger + stock correctly; verify a bounced cheque produces a reversing entry, not a deleted row
- [ ] A4 print flows still work against real data
