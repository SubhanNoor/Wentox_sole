const { contextBridge, ipcRenderer } = require('electron');

// The renderer never talks HTTP — every backend feature is an IPC channel named
// '<feature>:<action>' (see src/ipc/*.ipc.js). This exposes window.api.<feature>.<action>(payload)
// as a thin wrapper over ipcRenderer.invoke, without hand-listing every action for every feature.
const FEATURES = [
  'auth', 'addas', 'bankAccounts', 'businessAccounts', 'categories', 'chartAccounts', 'cheques',
  'cities', 'customers', 'draftExpenses', 'draftPurchases', 'draftPurchaseReturns', 'draftReceipts',
  'draftSaleBills', 'draftSaleReturns', 'employees', 'expenses',
  'groupAccounts', 'products', 'productColors', 'purchases', 'purchaseReturns', 'receipts',
  'regions', 'reports', 'salaryRuns', 'saleBills', 'saleReturns', 'stages', 'stock', 'stores',
  'subCustomers', 'transfers', 'vendors', 'wageRuns',
];

// window.api.<feature> stays camelCase (normal JS property access); the wire channel name is
// kebab-case (sale-bills:list, not saleBills:list) to match every ipc/*.ipc.js registration.
function camelToKebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const api = {};
for (const feature of FEATURES) {
  const channelPrefix = camelToKebab(feature);
  api[feature] = new Proxy(
    {},
    {
      get: (_target, action) => (payload) => ipcRenderer.invoke(`${channelPrefix}:${String(action)}`, payload),
    },
  );
}

contextBridge.exposeInMainWorld('api', api);
