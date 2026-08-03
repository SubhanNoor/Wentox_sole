// IPC layer: registers ipcMain.handle channels for product-colors — no business logic, no SQL.
const { ipcMain } = require('electron');
const service = require('../services/productColors.service');
const { wrap } = require('./wrap');
const { requireSession } = require('./session');

module.exports = function register() {
  // Action names stay camelCase here (not kebab-case) — the preload Proxy passes the JS property
  // access straight through as the action segment with no case conversion (only the feature
  // prefix gets camelToKebab'd), so 'listByArticle' must match window.api.productColors.listByArticle(...) exactly.
  ipcMain.handle('product-colors:listByArticle', wrap((payload) => {
    requireSession();
    return service.listByArticle(payload.article_id, payload);
  }));

  ipcMain.handle('product-colors:get', wrap((payload) => {
    requireSession();
    return service.getById(payload.id);
  }));

  // Resolves an existing color for the article or creates a new one — the Current Stock "Add"
  // dialog (UC-28) is the actual UI trigger for this, not the Product Details form.
  ipcMain.handle('product-colors:resolveOrCreate', wrap((payload) => {
    requireSession();
    return service.resolveOrCreate(payload.article_id, payload.color, payload.packing);
  }));

  ipcMain.handle('product-colors:update', wrap((payload) => {
    requireSession();
    return service.update(payload.id, payload);
  }));

  ipcMain.handle('product-colors:remove', wrap((payload) => {
    requireSession();
    return service.remove(payload.id);
  }));
};
