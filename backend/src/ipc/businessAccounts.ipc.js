// IPC layer: registers ipcMain.handle channels for businessAccounts — no business logic, no SQL.
// Channel prefix is kebab-case ('business-accounts') to match preload.js's camelToKebab(feature) —
// window.api.businessAccounts.list() still works via plain JS property access; only the wire
// channel name changes case. Action segments stay camelCase (untouched by that conversion).
const { ipcMain } = require('electron');
const service = require('../services/businessAccounts.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('business-accounts:list', wrap((payload) => {
    const session = requireSession();
    return service.list(payload, session);
  }));

  ipcMain.handle('business-accounts:get', wrap((payload) => {
    const session = requireSession();
    return service.getForSetup(payload.id, session);
  }));

  ipcMain.handle('business-accounts:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  // UC-17 multi-account entry — one parent, several accounts, one save.
  ipcMain.handle('business-accounts:createBatch', wrap((payload) => {
    const session = requireSession();
    return service.createBatch(payload, session);
  }));

  ipcMain.handle('business-accounts:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session);
  }));

  // "Remove" = close (status CLOSED) — see businessAccounts.service.js#remove(); no hard delete.
  ipcMain.handle('business-accounts:remove', wrap((payload) => {
    const session = requireSession();
    return service.remove(payload.id, session);
  }));

  ipcMain.handle('business-accounts:reactivate', wrap((payload) => {
    const session = requireSession();
    return service.reactivate(payload.id, session);
  }));

  // Transfer screen's "Cash" option — the one business account seeded for cash, resolved by
  // chart code rather than a hardcoded id (see businessAccounts.service.js#getCashAccount).
  ipcMain.handle('business-accounts:getCashAccount', wrap(() => {
    requireSession();
    return service.getCashAccount();
  }));
};
