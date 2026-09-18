// IPC layer: registers ipcMain.handle channels for chartAccounts — no business logic, no SQL.
// Channel prefix is kebab-case ('chart-accounts') to match preload.js's camelToKebab(feature).
const { ipcMain } = require('electron');
const service = require('../services/chartAccounts.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('chart-accounts:list', wrap((payload) => {
    const session = requireSession();
    return service.list(payload, session);
  }));

  ipcMain.handle('chart-accounts:get', wrap((payload) => {
    const session = requireSession();
    return service.getById(payload.id, session);
  }));

  ipcMain.handle('chart-accounts:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('chart-accounts:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  // "Remove" = close (status CLOSED) — see chartAccounts.service.js#remove(). A true hard delete
  // exists too now — see permanentDelete below. Password-gated per the user (2026-09-17), same as
  // every account type.
  ipcMain.handle('chart-accounts:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('chart-accounts:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));

  // True hard delete — added on top of (never instead of) the soft-close above, per the user
  // (2026-09-17). Password-gated the same way remove() is; the service enforces the stricter
  // "already closed, and referenced nowhere at all" guard.
  ipcMain.handle('chart-accounts:permanentDelete', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.permanentDelete(payload.id, session);
  }));
};
