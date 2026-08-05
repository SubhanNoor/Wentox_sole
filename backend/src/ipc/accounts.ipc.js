// IPC layer: registers ipcMain.handle channels for the accounts-hierarchy tree — no business
// logic, no SQL. Separate from chartAccounts/groupAccounts/businessAccounts.ipc.js because this
// is a read-only cross-entity view (milestone8.md's "accounts:tree"), not CRUD for any one table.
const { ipcMain } = require('electron');
const service = require('../services/accountsTree.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('accounts:tree', wrap(() => {
    const session = requireSession();
    return service.tree(session);
  }));
};
