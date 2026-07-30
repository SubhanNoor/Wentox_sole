# electron/ — Desktop Shell

Wraps the backend logic + built frontend into one desktop app. No HTTP server, no port — the
renderer and the backend logic run in the same OS process tree and talk over Electron IPC.

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process: calls `registerIpcHandlers()` (`src/ipc/index.js`) so every `ipcMain.handle` channel exists, then opens a `BrowserWindow`. Dev: loads `VITE_DEV_SERVER_URL`; prod: loads `frontend/dist/index.html`. |
| `preload.js` | `contextBridge` — exposes `window.api.<feature>.<action>(payload)` to the renderer, each call forwarding to `ipcRenderer.invoke('<feature>:<action>', payload)`. No other Node APIs cross into the renderer (`contextIsolation: true`, `nodeIntegration: false`). |

Dev workflow: `npm run electron:dev` (Vite dev server + Electron together).
Packaging (Milestone 9): electron-builder; the target PC needs local MS SQL Server installed.
