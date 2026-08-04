// IPC layer: registers ipcMain.handle channels for draftReceipts — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/draftReceipts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('draft-receipts:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('draft-receipts:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('draft-receipts:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId);
  }));

  ipcMain.handle('draft-receipts:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('draft-receipts:confirm', wrap((payload) => {
    const session = requireSession();
    return service.confirm(payload.id, session.userId);
  }));
};
