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
};
