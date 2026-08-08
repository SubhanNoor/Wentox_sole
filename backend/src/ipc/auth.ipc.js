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

  // Action names stay camelCase (not kebab-case) — the preload Proxy passes the JS property
  // access straight through as the action segment with no case conversion, so this must match
  // window.api.auth.updateCredentials(...) / window.api.auth.verifyPassword(...) exactly.
  ipcMain.handle(
    'auth:updateCredentials',
    wrap(async (payload) => {
      const current = session.requireSession();
      return service.updateCredentials(current.userId, payload);
    }),
  );

  ipcMain.handle(
    'auth:verifyPassword',
    wrap(async (payload) => {
      const current = session.requireSession();
      return service.verifyPassword(current.userId, payload.password);
    }),
  );

  ipcMain.handle(
    'auth:createUser',
    wrap(async (payload) => {
      session.requireRole('ADMIN');
      return service.createUser(payload);
    }),
  );

  ipcMain.handle(
    'auth:listUsers',
    wrap(async () => {
      session.requireRole('ADMIN');
      return service.listUsers();
    }),
  );

  ipcMain.handle(
    'auth:setUserActive',
    wrap(async (payload) => {
      const current = session.requireRole('ADMIN');
      return service.setUserActive(payload.id, payload.is_active, current.userId);
    }),
  );

  ipcMain.handle(
    'auth:resetPassword',
    wrap(async (payload) => {
      session.requireRole('ADMIN');
      return service.resetPassword(payload.id, payload.newPassword);
    }),
  );
};
