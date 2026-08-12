// IPC layer: window zoom. No service and no repository behind it — there is no business logic and
// nothing to query, only a call into Electron's own webContents. Single-word feature ('zoom'), so
// ipcBridge.ts's camelToKebab() leaves the channel prefix unchanged.
//
// Why it goes through IPC at all: the renderer runs with contextIsolation and no node integration,
// so it cannot reach `webFrame` itself, and preload.js deliberately exposes one primitive
// (__ipcInvoke) rather than a widening surface of electron APIs.
//
// NOTE — no requireSession() here, unlike every other channel. Zoom is a display preference, not
// data: the LOGIN screen itself has to be zoomable, and it is by definition reached before any
// session exists. Adding a session check would make the app un-zoomable exactly when someone who
// cannot read it needs it most. This is deliberate, not an oversight.
const { ipcMain, BrowserWindow } = require('electron');
const { wrap } = require('./wrap');

// Matches the ladder in frontend/src/components/ZoomControl.tsx. Enforced here too because the
// clamp belongs with the thing that applies it — a bad factor from any caller would otherwise be
// handed straight to Chromium.
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 1.5;

// wrap() calls handlers as (payload, event), so the sender's own window is reachable — better than
// BrowserWindow.getAllWindows()[0], which would zoom the wrong window the moment a second one
// exists (a print preview window, say).
function windowFor(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('No window for this request');
  return win;
}

module.exports = function register() {
  ipcMain.handle('zoom:set', wrap((payload, event) => {
    const requested = Number(payload?.factor);
    if (!Number.isFinite(requested)) throw new Error('factor must be a number');
    const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, requested));
    windowFor(event).webContents.setZoomFactor(factor);
    // Return what was actually applied, not what was asked for — the caller stores this, so after a
    // clamp the stored value and the window agree instead of drifting apart.
    return { factor };
  }));

  ipcMain.handle('zoom:get', wrap((_payload, event) => (
    { factor: windowFor(event).webContents.getZoomFactor() }
  )));
};
