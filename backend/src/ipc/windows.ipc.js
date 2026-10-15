// IPC layer: opens additional app windows — no business logic, no SQL, no service/repository
// (there's nothing to query; this only calls into Electron's own BrowserWindow via windowManager).
const { ipcMain } = require('electron');
const { BrowserWindow } = require('electron');
const { createAppWindow, closeChildAndFocusMain, listChildWindows, focusChildWindow } = require('../../electron/windowManager');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // Only an already-logged-in operator can open more windows — session is one shared in-memory
  // value for the whole Electron process (src/ipc/session.js), so the new window inherits it
  // automatically (see auth:currentSession) rather than needing its own login.
  ipcMain.handle('windows:open', wrap((payload, event) => {
    requireSession();
    const page = payload?.page;
    if (!page) throw new Error('page is required');
    createAppWindow(page, payload?.tab, {
      child: true, params: payload?.params, opener: BrowserWindow.fromWebContents(event.sender),
    });
    return { ok: true };
  }));

  // Closes the CALLING window (only ever a child — the main window is left alone) and focuses the
  // main window. `closed: false` tells the renderer it was the main window, so it navigates instead.
  ipcMain.handle('windows:closeSelf', wrap((_payload, event) => {
    const closed = closeChildAndFocusMain(BrowserWindow.fromWebContents(event.sender));
    return { closed };
  }));

  // The main window's "Open Windows" list: every open child window, and bringing one forward.
  ipcMain.handle('windows:list', wrap(() => {
    requireSession();
    return listChildWindows();
  }));

  ipcMain.handle('windows:focus', wrap((payload) => {
    requireSession();
    const id = Number(payload?.id);
    if (!Number.isInteger(id)) throw new Error('id is required');
    return { focused: focusChildWindow(id) };
  }));
};
