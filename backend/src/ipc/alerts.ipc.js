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
};
