// Extracted from main.js's original createWindow() so a second (or third...) window can be opened
// on demand from the renderer (windows:open, src/ipc/windows.ipc.js) using the exact same
// dev/packaged/unpackaged-prod loading logic as the first window, instead of duplicating it.
const path = require('path');
const { app, BrowserWindow } = require('electron');

// The app's one true main window — whichever non-child window was created most recently (normally
// just the one from main.js's own startup `createWindow()`, but also updated if it's reopened via
// the macOS dock-icon `activate` handler).
let mainWindow = null;

// Every currently-open child window (windows:open), so closing the main window can close them all
// (per the user, 2026-09-03) without using Electron's native `parent` option — a parented
// BrowserWindow is treated by the OS as an attached child, which disables its own minimize/zoom
// controls (reported by the user, 2026-09-03: "the new windows that open their minimize and
// maximize buttons doesnt work"). Tracking and closing manually keeps every window fully
// independent.
const childWindows = new Set();

// `page`/`tab` become a URL query string the fresh window's own AppContext reads on mount
// (frontend/src/context/AppContext.tsx's bootstrap effect) to land directly on that page/tab
// instead of Home — same `page`/`tab` shape the Quick Menu shortcuts already use internally.
//
// `child: true` (windows:open only — never the app's own first/main window) additionally tells
// AppLayout.tsx to render ONLY that page's own content — no top header, no MenuBar, no Quick Menu
// bar — matching the legacy app's own per-document floating windows (ref-pics/batch2), rather than
// a second full copy of the whole app shell. A smaller default size fits that "one document, not
// the whole app" shape too; still freely resizable.
//
// `params` (windows:open only) carries a page's current filter/selection state through to the new
// window as extra query-string keys, generic passthrough with no schema here — each page reads
// back only the keys it itself put in (frontend/src/lib/windowParams.ts), e.g. so "Show Print
// Preview" can open a new window landing on the exact same filtered report (per the user,
// 2026-09-03) instead of a blank default one.
function createAppWindow(page, tab, { child = false, params = {} } = {}) {
  const win = new BrowserWindow({
    width: child ? 1000 : 1280,
    height: child ? 720 : 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (child) {
    childWindows.add(win);
    win.on('closed', () => childWindows.delete(win));
  } else {
    mainWindow = win;
    win.on('closed', () => {
      for (const w of childWindows) { if (!w.isDestroyed()) w.close(); }
      childWindows.clear();
    });
  }

  const query = { ...params };
  if (page) query.page = page;
  if (tab) query.tab = tab;
  if (child) query.child = '1';

  if (process.env.VITE_DEV_SERVER_URL) {
    // dev: Vite server — loadFile's `query` option only applies to loadFile, so build the URL by hand.
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    win.loadURL(url.toString());
  } else if (app.isPackaged) {
    // electron-builder copies frontend/dist into resources/frontend/dist (see package.json's
    // "extraResources") rather than preserving the monorepo's ../../frontend layout, which
    // doesn't exist once packaged.
    win.loadFile(path.join(process.resourcesPath, 'frontend/dist/index.html'), { query });
  } else {
    // unpackaged prod: `npm start` against a local frontend build
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html'), { query });
  }

  return win;
}

module.exports = { createAppWindow };
