const { contextBridge, ipcRenderer } = require('electron');

// The renderer never talks HTTP — every backend feature is an IPC channel named
// '<feature>:<action>' (see src/ipc/*.ipc.js). This exposes window.api.<feature>.<action>(payload)
// as a thin wrapper over ipcRenderer.invoke, without hand-listing every action for every feature.
const FEATURES = [
  'auth', 'addas', 'businessAccounts', 'categories', 'chartAccounts', 'cities', 'customers',
  'expenses', 'groupAccounts', 'products', 'receipts', 'reports', 'saleBills', 'saleReturns',
  'stock', 'stores', 'subCustomers', 'vendors',
];

const api = {};
for (const feature of FEATURES) {
  api[feature] = new Proxy(
    {},
    {
      get: (_target, action) => (payload) => ipcRenderer.invoke(`${feature}:${String(action)}`, payload),
    },
  );
}

contextBridge.exposeInMainWorld('api', api);
