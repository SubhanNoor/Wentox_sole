// IPC layer: registers ipcMain.handle channels for groupAccounts — no business logic, no SQL.
// Channel prefix is kebab-case ('group-accounts') to match preload.js's camelToKebab(feature).
const { ipcMain } = require('electron');
const service = require('../services/groupAccounts.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('group-accounts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('group-accounts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('group-accounts:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('group-accounts:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  // Password-gated per the user (2026-09-17), same as every other account type's delete.
  ipcMain.handle('group-accounts:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('group-accounts:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));

  // True hard delete — added on top of (never instead of) the soft-close above, per the user
  // (2026-09-17). Password-gated the same way remove() is; the service enforces the stricter
  // "already closed, and referenced nowhere at all" guard.
  ipcMain.handle('group-accounts:permanentDelete', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.permanentDelete(payload.id);
  }));
};
