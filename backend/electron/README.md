# electron/ — Desktop Shell

Wraps the backend + built frontend into one desktop app.

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process: starts the Express API on 127.0.0.1 (via `src/server.js` `start()`), then opens a `BrowserWindow`. Dev: loads `VITE_DEV_SERVER_URL`; prod: loads `frontend/dist/index.html`. Shuts the API down when all windows close. |
| `preload.js` | contextBridge — exposes only `window.wentox.apiBaseUrl` to the renderer. The app talks to the backend over plain HTTP; no Node APIs cross into the renderer. |

Dev workflow: `npm run electron:dev` (backend + Vite + Electron together).
Packaging (Milestone 5): electron-builder; the target PC needs local PostgreSQL installed.
