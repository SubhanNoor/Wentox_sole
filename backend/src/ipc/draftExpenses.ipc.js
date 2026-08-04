// IPC layer: registers ipcMain.handle channels for draftExpenses — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftExpenses.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('draft-expenses:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('draft-expenses:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('draft-expenses:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  ipcMain.handle('draft-expenses:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('draft-expenses:confirm', wrap((payload) => {
    const session = requireSession();
    return service.confirm(payload.id, session.userId);
  }));
};
