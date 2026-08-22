// IPC layer: registers ipcMain.handle channels for draftExpenses — no business logic, no SQL.
//
// This is the channel every NEW expense now comes in through: an unposted expense lives in
// dbo.draft_expenses and only moves into dbo.expenses when it is posted (confirm).
const { ipcMain } = require('electron');
const service = require('../services/draftExpenses.service');
const authService = require('../services/auth.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('draft-expenses:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('draft-expenses:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('draft-expenses:create', wrap((payload) => {
    const session = requireSession();
    return service.create(payload, session.userId, session);
  }));

  // Editing an unposted expense — the normal edit path now.
  ipcMain.handle('draft-expenses:update', wrap((payload) => {
    const session = requireSession();
    return service.update(payload.id, payload, session.userId, session);
  }));

  // Password required, matching 'expenses:remove' — a deletion is irreversible and must be
  // deliberate. (The old draft-expenses:remove had no guard, back when a draft only ever meant a
  // genuinely incomplete scratch entry; it is now where every unposted expense lives.)
  ipcMain.handle('draft-expenses:remove', wrap(async (payload) => {
    const session = requireSession();
    await authService.verifyPassword(session.userId, payload.password);
    return service.remove(payload.id);
  }));

  ipcMain.handle('draft-expenses:confirm', wrap((payload) => {
    const session = requireSession();
    return service.confirm(payload.id, session.userId, session);
  }));
};
