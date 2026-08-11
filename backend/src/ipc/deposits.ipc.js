// IPC layer: registers ipcMain.handle channels for deposits — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/deposits.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('deposits:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('deposits:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('deposits:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Blocked once posted (must unpost first) — same as transfers:update, no password guard.
  ipcMain.handle('deposits:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session);
  }));

  ipcMain.handle('deposits:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('deposits:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId, session);
  }));

  ipcMain.handle('deposits:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId, session);
  }));
};
