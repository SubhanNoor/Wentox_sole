// IPC layer: registers ipcMain.handle channels for settlements — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/settlements.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

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
    return service.create(payload, session.userId);
  }));

  // Blocked once posted (must unpost first) — same as transfers:update, no password guard.
  ipcMain.handle('settlements:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('settlements:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('settlements:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId);
  }));

  ipcMain.handle('settlements:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId);
  }));
};
