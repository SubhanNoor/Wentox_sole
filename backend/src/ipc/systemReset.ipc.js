// IPC layer for the "Reset Database" danger-zone action. Admin-only, and the service layer itself
// re-verifies the caller's password on top of that — see systemReset.service.js's own comment.
const { ipcMain } = require('electron');
const service = require('../services/systemReset.service');
const { wrap } = require('./wrap');
const { requireRole, logout } = require('./session');

module.exports = function register() {
  ipcMain.handle('system-reset:run', wrap(async (payload) => {
    const current = requireRole('ADMIN');
    await service.resetDatabase(current.userId, payload?.password);
    // The session's own user row no longer exists after the wipe (the fresh seed inserts new
    // IDENTITY rows) — force back to the login screen rather than leaving a stale session alive.
    logout();
    return { ok: true };
  }));
};
