// IPC layer: registers ipcMain.handle channels for products — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/products.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  ipcMain.handle('products:list', wrap((payload) => {
    requireSession();
    return service.list(payload);
  }));

  ipcMain.handle('products:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  ipcMain.handle('products:create', wrap((payload) => {
    requireSession();
    return service.create(payload);
  }));

  ipcMain.handle('products:createBatch', wrap((payload) => {
    requireSession();
    return service.createBatch(payload);
  }));

  ipcMain.handle('products:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('products:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));

  ipcMain.handle('products:reactivate', wrap((payload) => {
    requireSession();
    return service.reactivate(payload.id);
  }));
};
