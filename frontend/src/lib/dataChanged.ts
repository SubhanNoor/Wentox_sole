/**
 * Live update across windows (per the user, 2026-10-15): each window loads its data once, so a save
 * in one window used to show in another only after closing and reopening it.
 *
 * Every IPC call goes through installApiBridge (lib/ipcBridge.ts). After a successful WRITE it calls
 * announceDataChanged(), which tells every OTHER Wentox window over a BroadcastChannel (all windows
 * share one origin; a BroadcastChannel never delivers to its own sender, and the window that saved
 * already refreshes itself). Screens re-run their loads through hooks/useDataVersion.ts.
 */

// Actions that change data. Everything else (list, get, the reports, windows/zoom/updates...) is a
// read and announces nothing. Matched on the action half of `<feature>:<action>`.
const WRITE_ACTIONS = new Set([
  'create', 'update', 'remove', 'reactivate', 'post', 'unpost', 'confirm', 'unconfirm',
  'deposit', 'bounce', 'endorse-to-vendor', 'endorse-to-expense', 'return-to-sender', 'reverse-allocation',
  'mark-cleared', 'adjust', 'log-production', 'reduce-vendor-stock', 'run',
]);
// `<feature>:run` is only a write for these (system reset, salary/wage runs are create/post).
const RUN_WRITES = new Set(['system-reset']);

export function isWriteChannel(channel: string): boolean {
  const [feature, action] = channel.split(':');
  if (action === 'run') return RUN_WRITES.has(feature);
  return WRITE_ACTIONS.has(action);
}

const CHANNEL_NAME = 'wentox-data-changed';
let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

// A post or a multi-step save makes several calls in a row: send one notice for the burst.
let sendTimer: ReturnType<typeof setTimeout> | null = null;
export function announceDataChanged(): void {
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    sendTimer = null;
    getChannel()?.postMessage({ at: Date.now() });
  }, 150);
}

// The receiving side: a version number that goes up on every notice from another window.
let version = 0;
const listeners = new Set<() => void>();
let listening = false;
function startListening() {
  if (listening) return;
  const ch = getChannel();
  if (!ch) return;
  listening = true;
  ch.onmessage = () => {
    version += 1;
    listeners.forEach(l => l());
  };
}

export function subscribeDataChanged(listener: () => void): () => void {
  startListening();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getDataVersion(): number {
  return version;
}
