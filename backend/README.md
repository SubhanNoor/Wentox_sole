# Wentox Backend

Backend logic for the Wentox ERP desktop app (Electron + React frontend + MS SQL Server). No HTTP
server — the renderer and this backend logic run in one process tree and talk over Electron IPC.
Layered architecture: **ipc handler → service → repository → db**.

## Folders
| Folder | Purpose |
| --- | --- |
| `src/` | All application source code (see `src/README.md`) |
| `electron/` | Electron desktop shell — `main.js` registers every IPC channel then opens the window; `preload.js` exposes `window.api.<feature>.<action>(payload)` |
| `milestones/` | Work plan: milestone files with modules and task checklists |
| `.claude/` | AI tooling: debugger agent, DB/architecture skills, workflow hooks |

## Key files
| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Working instructions: workflow rules, architecture, conventions |
| `PROGRESS.md` | Log of every completed task (what/how/files) |
| `package.json` | Dependencies and scripts (`dev`, `migrate`, `seed`, `electron:dev`) |
| `.env.example` | Template for `.env` (MS SQL Server connection: `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERT`) |
| `../database/schema.sql` | Schema source of truth — full T-SQL DDL, applied first by `migrate.js` |

## Quick start
```bash
cp .env.example .env    # fill in your MS SQL Server credentials
npm install
npm run migrate         # apply database/schema.sql to local SQL Server
npm run seed            # admin user + account classes/chart accounts + default store
npm run dev             # launches the Electron app (no port, no browser — it's the desktop app)
```
