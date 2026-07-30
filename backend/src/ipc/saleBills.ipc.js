// IPC layer: registers ipcMain.handle channels for sale-bills — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/saleBills.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle(
    'sale-bills:create',
    wrap((payload) => {
      const session = requireSession();
      return service.create(payload, session.userId);
    }),
  );

  // TODO(milestone2.md remaining bullets): sale-bills:list, sale-bills:get, sale-bills:update,
  // sale-bills:post, sale-bills:unpost.
};
