// IPC layer: registers ipcMain.handle channels for auth — no business logic, no SQL.
// Unlike every other feature, auth:login is callable with no prior session (it creates one).
const { ipcMain } = require('electron');
const service = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // TODO(Module 1.3): register channels, e.g.:
  // ipcMain.handle('auth:login', wrap((payload) => service.login(payload.username, payload.password)));
  // ipcMain.handle('auth:logout', wrap(() => service.logout()));
  // ipcMain.handle('auth:update-credentials', wrap((payload) => {
  //   const session = requireSession();
  //   return service.updateCredentials(session.userId, payload);
  // }));
};
