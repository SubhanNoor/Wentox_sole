// IPC layer: registers ipcMain.handle channels for auth — no business logic, no SQL.
// Unlike every other feature, auth:login is callable with no prior session (it creates one).
const { ipcMain } = require('electron');
const service = require('../services/auth.service');
const { wrap } = require('./wrap');
const session = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'auth:login',
    wrap(async (payload) => {
      const user = await service.login(payload.username, payload.password);
      return session.login(user); // { userId, username, role }
    }),
  );

  ipcMain.handle(
    'auth:logout',
    wrap(() => {
      session.logout();
      return { ok: true };
    }),
  );

  ipcMain.handle(
    'auth:update-credentials',
    wrap(async (payload) => {
      const current = session.requireSession();
      return service.updateCredentials(current.userId, payload);
    }),
  );

  ipcMain.handle(
    'auth:verify-password',
    wrap(async (payload) => {
      const current = session.requireSession();
      return service.verifyPassword(current.userId, payload.password);
    }),
  );
};
