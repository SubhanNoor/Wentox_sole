// IPC layer: registers ipcMain.handle channels for the Books Check — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/booksCheck.service');
const { wrap } = require('./wrap');
const { requireRole } = require('./session');

module.exports = function register() {
  // ADMIN only: it lists parties and amounts across every account, restricted ones included.
  ipcMain.handle('books-check:run', wrap(() => {
    requireRole('ADMIN');
    return service.run();
  }));

  // Mark one flagged item as already settled by hand / undo that (2026-11-28). ADMIN only, like run.
  ipcMain.handle('books-check:clear', wrap((payload) => {
    const session = requireRole('ADMIN');
    return service.clearItem(payload, session.userId);
  }));

  ipcMain.handle('books-check:restore', wrap((payload) => {
    requireRole('ADMIN');
    return service.restoreItem(payload);
  }));
};
