// A freshly opened window (windows:open, backend/electron/windowManager.js) can carry more than
// just `page`/`tab` in its URL — e.g. a page's own filter/selection state, so its "Show Print
// Preview" button can open a new window landing on the exact same filtered report instead of one
// reset to defaults (per the user, 2026-09-03). `openWindow`'s own `params` argument (src/lib/api.ts)
// is what writes these; this is the read side, used once on mount by the page that receives them.
//
// `window.location.search` never changes after a window is created (this app has no client-side
// router), so reading it fresh on every call is fine — no caching needed.
export function getWindowParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

// Shared flag every print-preview-enabled page checks once its data has loaded, to open straight
// into the preview instead of landing on the plain report first.
export function shouldAutoPreview(): boolean {
  return getWindowParam('autoPreview') === '1';
}

// Same check as AppLayout.tsx's own (unexported) IS_CHILD_WINDOW — whether this window was opened
// via windows:open rather than being the app's own main window.
export function isChildWindow(): boolean {
  return getWindowParam('child') === '1';
}
