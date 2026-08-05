// IPC layer: registers ipcMain.handle channels for the update-checker — no business logic beyond
// what belongs to updates.service.js, no SQL at all (there's nothing to query). Single word
// feature ('updates'), so preload.js's camelToKebab() leaves the channel prefix unchanged.
const { ipcMain } = require('electron');
const service = require('../services/updates.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('updates:check', wrap(() => {
    requireSession();
    return service.check();
  }));

  ipcMain.handle('updates:install', wrap(() => {
    requireSession();
    return service.install();
  }));
};
