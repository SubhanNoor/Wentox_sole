const { contextBridge, ipcRenderer } = require('electron');

<<<<<<< HEAD
// contextBridge.exposeInMainWorld can only pass values across the context-isolation boundary that
// it can clone (plain functions, plain objects/arrays, primitives) — a Proxy is none of those, and
// silently fails ("An object could not be cloned") the moment the renderer touches ANY property on
// it. So the ergonomic window.api.<feature>.<action>(payload) sugar (Proxy-based, to avoid
// hand-listing every action for every feature) is built in the RENDERER's own JS instead — see
// frontend/src/lib/ipcBridge.ts, which wraps this one raw primitive. Only a single real function
// crosses the bridge here.
contextBridge.exposeInMainWorld('__ipcInvoke', (channel, payload) => ipcRenderer.invoke(channel, payload));
=======
// The renderer never talks HTTP — every backend feature is an IPC channel named
// '<feature>:<action>' (see src/ipc/*.ipc.js). This exposes window.api.<feature>.<action>(payload)
// as a thin wrapper over ipcRenderer.invoke, without hand-listing every action for every feature.
const FEATURES = [
  'accounts', 'accountClasses', 'alerts', 'auth', 'addas', 'bankAccounts', 'businessAccounts', 'categories',
  'chartAccounts', 'cheques', 'cities', 'customers', 'draftExpenses', 'draftPurchases',
  'draftPurchaseReturns', 'draftReceipts', 'draftSaleBills', 'draftSaleReturns', 'employees',
  'expenses', 'groupAccounts', 'products', 'productColors', 'purchases', 'purchaseReturns',
  'receipts', 'regions', 'reports', 'salaryRuns', 'saleBills', 'saleReturns', 'stages', 'stock',
  'stores', 'subCustomers', 'transfers', 'updates', 'vendors', 'wageRuns',
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
>>>>>>> subhan
