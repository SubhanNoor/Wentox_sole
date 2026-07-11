# Milestone 5 — Reports, Frontend Integration & Electron Packaging

**Goal:** The three reports served from the ledger/stock tables, the React frontend switched from
AppContext demo data to the real API, and the whole thing packaged as an Electron desktop app.

## Module 5.1 — Reports
- [ ] `GET /api/reports/stock` — current stock per product (`SUM(qty_pairs)` from stock_movements) (UC-08)
- [ ] `GET /api/reports/khaata` — business accounts ledger: date range, Summary / Detail / Customer views, opening balance + running balance (UC-09)
- [ ] `GET /api/reports/cash-book` — per-date cash summary from CASH-account ledger entries: receipts in, expenses out, opening/closing balance (UC-10)

## Module 5.2 — Frontend Integration
- [ ] `frontend/src/lib/api.ts` — fetch client (base URL, JWT header, error handling)
- [ ] Replace AppContext demo data with API calls, screen by screen (setup → accounts → transactions → reports)
- [ ] Real login flow: store JWT, redirect on 401 (UC-20)
- [ ] Keep localStorage draft persistence for unconfirmed bills (frontend-only feature)

## Module 5.3 — Electron
- [ ] `electron/main.js` — start Express on localhost port, then open BrowserWindow loading the Vite build
- [ ] `electron/preload.js` — contextBridge (minimal; app talks HTTP)
- [ ] Dev script: concurrently run backend (nodemon) + Vite dev server + Electron
- [ ] electron-builder config — package app for Windows (shop PC); document local PostgreSQL prerequisite

## Module 5.4 — End-to-End Verification
- [ ] Full flow test: login → setup data → create & post sale bill → receipt → expense → verify stock report, khaata, cash book balance
- [ ] Verify unpost reverses ledger + stock correctly
- [ ] A4 print flows still work against real data
