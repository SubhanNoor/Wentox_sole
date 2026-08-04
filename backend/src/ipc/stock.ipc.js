// IPC layer: registers ipcMain.handle channels for stock — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/stock.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('stock:log-production', wrap((payload) => {
    const session = requireSession();
    return service.logProduction(payload, session.userId);
  }));

  ipcMain.handle('stock:adjust', wrap((payload) => {
    const session = requireSession();
    return service.adjust(payload, session.userId);
  }));

  ipcMain.handle('stock:movements', wrap((payload) => {
    requireSession();
    return service.movements(payload);
  }));
};
