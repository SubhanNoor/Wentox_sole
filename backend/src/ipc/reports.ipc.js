// IPC layer: registers ipcMain.handle channels for reports — no business logic, no SQL.
// Only the Module 5.1 reports (stock, production) are built here — the rest of Module 5.2's
// report channels are deliberately deferred (see backend/milestones/milestone5.md).
const { ipcMain } = require('electron');
const service = require('../services/reports.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('reports:stock', wrap((payload) => {
    requireSession();
    return service.stock(payload);
  }));

  ipcMain.handle('reports:production', wrap((payload) => {
    requireSession();
    return service.production(payload);
  }));
};
