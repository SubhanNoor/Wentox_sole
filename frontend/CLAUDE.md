# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server (port 3000)
- `npm run build` — type-check (`tsc -b`) then build production bundle
- `npm run lint` — run ESLint
- `npm run preview` — preview the production build

There is no test suite configured in this project.

## Architecture

This is a single-page inventory/sales management app for a shoe-sole manufacturing business ("Starmans"), built with React 19 + TypeScript + Vite, styled with Tailwind CSS and shadcn/ui (new-york style, "@/components/ui").

**State & routing are both driven by one reducer.** There is no React Router in use despite `react-router`/`react-router-dom` being installed. Instead:
- `src/context/AppContext.tsx` holds a single `useReducer`-based global store (`AppProvider`/`useApp`) containing all domain data: articles (stock), clients/slips (sales), productions, expenses, bills, chemical purchases/usage, payments, and settings/login state.
- Navigation is just another piece of state: `state.currentPage` is a string (typed as `NavPage` in `src/types/index.ts`), changed via `dispatch({ type: 'NAVIGATE', page })`. There are no routes/URLs — `src/App.tsx` renders a page component by checking `page.startsWith(...)` against fixed prefixes (`slips`, `production`, `bills`, `chemical`, `expenses`, `profit`, `payment`, `settings`), each page component then handles its own sub-view switching internally.
- All data is currently in-memory demo data seeded in `AppContext.tsx` (`demoArticles`, `demoClients`, `demoProductions`, etc.) — there is no backend/API integration yet.

**Domain model** (`src/types/index.ts`): `Article` (stock item) → sold via `Slip`/`SlipItem` under a `Client`; `Production` adds stock via `ProductionEntry`; `Expense`, `Bill`, `ChemPurchase`/`ChemUsage`, `Payment` are separate ledgers. Stock (`Article.stock`) is mutated as a side effect of reducer actions: `ADD_SLIP`/`UPDATE_SLIP`/`DELETE_SLIP` deduct/restore stock by matching `SlipItem.name` to `Article.name`, and `ADD_PRODUCTION`/`DELETE_ARTICLE` similarly adjust stock/production entries. When adding new stock-affecting actions, follow this same pattern of keeping `articles` in sync inside the reducer.

**Pages** live in `src/pages/` (one per top-level section, matching the `NavPage` prefixes above). `src/components/AppLayout.tsx` is the shared shell (nav/sidebar) that pages are presumably wrapped in. `src/lib/utils.ts` holds the shadcn `cn()` helper; other cross-cutting helpers (currency formatting, week/month date range checks) live directly in `AppContext.tsx` (`formatCurrency`, `getCurrentWeekStart/End`, `isDateInCurrentWeek`, `isDateInCurrentMonth`, `isDateInMonth`, `getMonthName`, `getPairsSold`, `getWeekRange`).

**Path alias**: `@/*` maps to `src/*` (configured in both `tsconfig.json` and `vite.config.ts`).

**Auth** is a trivial username/password check against `state.settings` (default `admin`/`admin`), no real backend/session — see `LOGIN` case in the reducer.
