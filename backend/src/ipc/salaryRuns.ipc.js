// IPC layer: registers ipcMain.handle channels for salaryRuns — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/salaryRuns.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('salary-runs:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('salary-runs:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('salary-runs:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  // Blocked once posted (must unpost first) — same as purchases:update/wage-runs:update.
  ipcMain.handle('salary-runs:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId);
  }));

  ipcMain.handle('salary-runs:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('salary-runs:post', wrap((payload) => {
    const session = requireSession();
    return service.post(payload.id, session.userId);
  }));

  ipcMain.handle('salary-runs:unpost', wrap((payload) => {
    const session = requireSession();
    return service.unpost(payload.id, session.userId);
  }));
};
