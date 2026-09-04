/**
 * Reconstructs window.api.<feature>.<action>(payload) in the renderer's own JS.
 *
 * backend/electron/preload.js can only pass a Proxy-free primitive across
 * contextBridge (a Proxy fails to clone across the context-isolation boundary — see that
 * file's comment) — it exposes just `window.__ipcInvoke(channel, payload)`. This file
 * builds the ergonomic per-feature sugar around that primitive entirely within the
 * renderer, where Proxies are unrestricted, and installs it as `window.api` so every
 * other module's `window.api.<feature>.<action>(...)` calls (see milestone9.md's own
 * spec) work exactly as if preload had exposed it directly. Imported once, at the top
 * of main.tsx, before anything else can read window.api.
 */

// EVERY feature must be listed here. This is an allow-list, not a fallback: a feature missing from
// it leaves window.api.<feature> undefined, so the first call throws a TypeError rather than
// failing as a rejected ApiResult — which surfaces as an unrelated symptom elsewhere on the page
// (an empty dropdown, a list that never loads). Adding a backend feature means adding it here too;
// backend/CLAUDE.md's "adding a feature" checklist says so.
const FEATURES = [
  'auth', 'accountClasses', 'addas', 'alerts', 'backup', 'bankAccounts', 'businessAccounts', 'categories', 'chartAccounts', 'cheques',
  'cities', 'customers', 'draftExpenses', 'draftPurchases', 'draftPurchaseReturns', 'draftReceipts',
  'draftSaleBills', 'draftSaleReturns', 'employees', 'expenses', 'expenseVouchers',
  'groupAccounts', 'products', 'productColors', 'purchases', 'purchaseReturns', 'receipts',
  'receiptVouchers',
  'regions', 'reports', 'salaryRuns', 'saleBills', 'saleReturns', 'stages', 'stock', 'stores',
  'subCustomers', 'systemReset', 'transfers', 'settlements', 'journalVouchers', 'stockVouchers', 'deposits', 'updates', 'vendors', 'wageRuns',
  'windows',
  'zoom',
] as const;

// window.api.<feature> stays camelCase (normal JS property access); the wire channel name is
// kebab-case (sale-bills:list, not saleBills:list) to match every ipc/*.ipc.js registration.
function camelToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

declare global {
  interface Window {
    __ipcInvoke?: (channel: string, payload?: unknown) => Promise<unknown>;
  }
}

export function installApiBridge(): void {
  if (!window.__ipcInvoke || window.api) return; // not in Electron, or already installed
  const invoke = window.__ipcInvoke;

  const api: Record<string, unknown> = {};
  for (const feature of FEATURES) {
    const channelPrefix = camelToKebab(feature);
    api[feature] = new Proxy(
      {},
      {
        get: (_target, action) => (payload?: unknown) => invoke(`${channelPrefix}:${String(action)}`, payload)
      }
    );
  }

  // window.api's real shape is feature-specific (see lib/api.ts's declare global for `auth`); this
  // bootstrap builds it generically for every feature, so the cast is the one place that's untyped.
  window.api = api as Window['api'];
}
