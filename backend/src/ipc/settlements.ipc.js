// IPC layer: registers ipcMain.handle channels for settlements — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/settlements.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');
const authService = require('../services/auth.service');

module.exports = function register() {
  ipcMain.handle('settlements:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('settlements:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('settlements:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Blocked once posted (must unpost first) — same as transfers:update, no password guard.
  ipcMain.handle('settlements:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session);
  }));

  // Password required, matching 'draft-receipts:remove' — an endorsement is deleted from the same
  // voucher grid as a receipt line, behind the same password prompt, so it gets the same check.
  ipcMain.handle('settlements:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('settlements:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId, session);
  }));

  ipcMain.handle('settlements:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId, session);
  }));
};
