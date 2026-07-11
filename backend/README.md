# Wentox Backend

Local Express API for the Wentox ERP desktop app (Electron + React frontend + PostgreSQL).
Layered architecture: **route → controller → service → repository → db**.

## Folders
| Folder | Purpose |
| --- | --- |
| `src/` | All application source code (see `src/README.md`) |
| `electron/` | Electron desktop shell (starts the API + opens the app window) |
| `milestones/` | Work plan: milestone files with modules and task checklists |
| `.claude/` | AI tooling: debugger agent, DB/architecture skills, workflow hooks |

## Key files
| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Working instructions: workflow rules, architecture, conventions |
| `PROGRESS.md` | Log of every completed task (what/how/files) |
| `package.json` | Dependencies and scripts (`dev`, `migrate`, `seed`, `electron:dev`) |
| `.env.example` | Template for `.env` (PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRY) |

## Quick start
```bash
cp .env.example .env    # fill in DB credentials + JWT secret
npm install
npm run migrate         # apply schema to local PostgreSQL
npm run seed            # admin user + CASH/SALES accounts + default store
npm run dev             # API on http://127.0.0.1:4000 (/health to check)
```
