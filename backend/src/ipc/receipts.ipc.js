// IPC layer: registers ipcMain.handle channels for receipts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/receipts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('receipts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('receipts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('receipts:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update, no password guard.
  ipcMain.handle('receipts:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId);
  }));

  ipcMain.handle('receipts:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('receipts:post', wrap((payload) => {
    requireSession();
    return service.post(payload.id);
  }));

  ipcMain.handle('receipts:unpost', wrap((payload) => {
    requireSession();
    return service.unpost(payload.id);
  }));
};
