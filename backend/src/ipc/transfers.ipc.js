// IPC layer: registers ipcMain.handle channels for transfers — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/transfers.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('transfers:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('transfers:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('transfers:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update, no password guard.
  ipcMain.handle('transfers:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session);
  }));

  ipcMain.handle('transfers:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('transfers:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId, session);
  }));

  ipcMain.handle('transfers:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId, session);
  }));
};
