// IPC layer: opens additional app windows — no business logic, no SQL, no service/repository
// (there's nothing to query; this only calls into Electron's own BrowserWindow via windowManager).
const { ipcMain } = require('electron');
const { createAppWindow } = require('../../electron/windowManager');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // Only an already-logged-in operator can open more windows — session is one shared in-memory
  // value for the whole Electron process (src/ipc/session.js), so the new window inherits it
  // automatically (see auth:currentSession) rather than needing its own login.
  ipcMain.handle('windows:open', wrap((payload) => {
    requireSession();
    const page = payload?.page;
    if (!page) throw new Error('page is required');
    createAppWindow(page, payload?.tab, { child: true, params: payload?.params });
    return { ok: true };
  }));
};
