// IPC layer: registers ipcMain.handle channels for alerts — no business logic, no SQL.
// 'alerts' is a single word, so preload.js's camelToKebab() leaves the channel prefix unchanged.
const { ipcMain } = require('electron');
const service = require('../services/alerts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('alerts:list', wrap(() => {
    requireSession();
    return service.list();
  }));

  ipcMain.handle('alerts:dismiss', wrap((payload) => {
    const session = requireSession();
    return service.dismiss(payload.alert_key, session.userId);
  }));

  // Manual refresh — runs the same computation as the startup/interval job, on demand, so a user
  // doesn't have to wait for the next 15-minute tick to see a just-created cheque/bill's alert.
  // Returns the fresh list directly (not just a count) so the renderer doesn't need a second
  // round trip to redraw after refreshing.
  ipcMain.handle('alerts:refresh', wrap(async () => {
    requireSession();
    await service.refreshAlerts();
    return service.list();
  }));
};
