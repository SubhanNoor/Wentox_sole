// Extracted from main.js's original createWindow() so a second (or third...) window can be opened
// on demand from the renderer (windows:open, src/ipc/windows.ipc.js) using the exact same
// dev/packaged/unpackaged-prod loading logic as the first window, instead of duplicating it.
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

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

// Child windows float above the main window while Wentox is the active app, and drop back to
// normal stacking the moment the user switches to another application (per the user, 2026-10-11:
// clicking the main window used to bury every open child window behind it). `parent` would do the
// first half natively but breaks child minimize/maximize (see childWindows above), and a plain
// always-on-top would cover Chrome, WhatsApp, etc. too — so it's toggled with app focus instead.
//
// Deferred one tick: moving focus between two Wentox windows fires the old one's `blur` before the
// new one's `focus`, and checking in between would see "no Wentox window focused" and flicker every
// child down and back up. A native dialog (print, save, message box) isn't a BrowserWindow, so it
// also reads as "app inactive" — which is what lets that dialog show above the children.
//
// The Set doubles as the stacking order, oldest-used first: a child moves to the end whenever it
// gains focus (or opens). Re-raising always walks it in that order, so the newest / most recently
// used window ends up on top (per the user, 2026-10-11: "the last window should appear on top"). On
// Windows each setAlwaysOnTop(true) lands that window at the top of the topmost band, so raising in
// any other order would shuffle the user's own stacking every time they came back from another app.
function isAppActive() {
  const focused = BrowserWindow.getFocusedWindow();
  return !!focused && (focused === mainWindow || childWindows.has(focused));
}

function raiseChildren() {
  for (const w of childWindows) {
    if (w.isDestroyed()) continue;
    w.setAlwaysOnTop(true);
    // Raising a minimized window must not bring it back — only the user restores it.
    if (w.isVisible() && !w.isMinimized()) w.moveTop();
  }
}

let syncScheduled = false;
let childrenOnTop = false;
function scheduleOnTopSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  setImmediate(() => {
    syncScheduled = false;
    const appActive = isAppActive();
    if (appActive === childrenOnTop) return;
    childrenOnTop = appActive;
    if (appActive) raiseChildren();
    else for (const w of childWindows) { if (!w.isDestroyed()) w.setAlwaysOnTop(false); }
  });
}

// A newly opened child has to come up on top of every other child. It can't rely on gaining focus
// to get there: Ubuntu/GNOME's focus-stealing prevention often refuses it (the "'Sale Bill' is
// ready" notification instead), which left the newest window as the only one NOT floating, i.e.
// underneath all the older ones. So it's floated and raised explicitly, then asked for focus.
function showChild(win) {
  if (isAppActive() || childrenOnTop) {
    win.setAlwaysOnTop(true);
    childrenOnTop = true;
  }
  win.show();
  win.moveTop();
  win.focus();
}

// Where the main window's Quick Menu bar ends, in the main window's own CSS pixels from the top of
// its page — reported by AppLayout.tsx (windows:setQuickMenuBottom) whenever it can move. Kept in
// CSS pixels and turned into a screen position only when a window opens, so moving the main
// window or changing its zoom after the last report still places correctly.
let quickMenuCssBottom = 0;

function setQuickMenuBottom(win, cssBottom) {
  if (win !== mainWindow) return false;
  quickMenuCssBottom = Math.max(0, Number(cssBottom) || 0);
  return true;
}

// A new child window opens in the CENTRE of the main window's screen, and every further one opens at
// that same spot on top of the last, the earlier ones staying put behind it (per the user,
// 2026-10-25 — replacing the bottom-right corner with an up-left step from 2026-10-22). Its top edge
// still never goes above the main window's Quick Menu bar (per the user, 2026-10-22: "any screen
// that open should not hide the quick menu buttons"), so it is centred across the screen and, top to
// bottom, in the space BELOW the bar. If it doesn't fit there at its default height it is made
// shorter, down to MIN_CHILD_HEIGHT.
const MIN_CHILD_HEIGHT = 360;
// Breathing room between the Quick Menu bar and a window's top edge.
const BAR_GAP = 8;
// On Linux (GNOME/Mutter) the title bar is drawn ABOVE the bounds a window is given — getBounds()
// equals getContentBounds() there — so a window placed exactly at the bar still had ~40px of title
// bar over the Quick Menu row (reported by the user, 2026-10-22, at 75% zoom). On Windows the frame
// is part of the bounds already, so nothing is added.
const TITLE_BAR_ALLOWANCE = process.platform === 'linux' ? 40 : 0;

function childPlacement(width, height) {
  const mainUsable = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
  const display = mainUsable ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const work = display.workArea;
  const workBottom = work.y + work.height;

  let top = work.y;
  if (mainUsable && quickMenuCssBottom > 0) {
    const barBottom = mainWindow.getContentBounds().y + Math.round(quickMenuCssBottom * mainWindow.webContents.getZoomFactor());
    top = Math.min(Math.max(work.y, barBottom + BAR_GAP + TITLE_BAR_ALLOWANCE), workBottom - MIN_CHILD_HEIGHT);
  }

  const w = Math.min(width, work.width);
  const h = Math.max(Math.min(height, workBottom - top), Math.min(MIN_CHILD_HEIGHT, work.height));
  return {
    x: work.x + Math.round((work.width - w) / 2),
    y: top + Math.max(0, Math.round((workBottom - top - h) / 2)),
    width: w,
    height: h,
  };
}

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
// `opener` (windows:open only) is the window that asked for this one — closing this window via its
// own Exit/close action hands focus back there (closeChildAndFocusMain below), e.g. a report's
// print-preview window returning to the report's filter window rather than to the main window.
const openerOf = new WeakMap();

// One window per screen (per the user, 2026-10-22): clicking Receipt while a Receipt window is open
// brings that window forward instead of opening a duplicate. A window is known by what it was
// OPENED for — page, tab and params — so two different filtered views (customer A's ledger, then
// customer B's) are still two windows, while the same request twice is one.
const childByKey = new Map();

function windowKey(page, tab, params = {}) {
  const sortedParams = Object.keys(params).sort().map((k) => [k, String(params[k])]);
  return JSON.stringify([page, tab || '', sortedParams]);
}

// Restore + raise + focus, the same way a new child comes up (showChild), so it also lands on top
// where GNOME's focus-stealing prevention refuses the focus itself.
function bringChildForward(win) {
  // Still loading (a quick double-click) — it is about to show itself on top anyway.
  if (!win.isVisible() && !win.isMinimized()) return;
  if (win.isMinimized()) win.restore();
  childWindows.delete(win);
  childWindows.add(win);
  showChild(win);
}

function openChildWindow(page, tab, { params = {}, opener = null } = {}) {
  const key = windowKey(page, tab, params);
  const existing = childByKey.get(key);
  if (existing && !existing.isDestroyed()) {
    bringChildForward(existing);
    return existing;
  }
  const win = createAppWindow(page, tab, { child: true, params, opener });
  childByKey.set(key, win);
  win.on('closed', () => { if (childByKey.get(key) === win) childByKey.delete(key); });
  return win;
}

function createAppWindow(page, tab, { child = false, params = {}, opener = null } = {}) {
  const width = child ? 1000 : 1280;
  const height = child ? 720 : 800;
  const win = new BrowserWindow({
    // The main window is maximized as it is revealed (see reveal below); this is the size and spot
    // it goes back to when un-maximized — centred on the screen.
    ...(child ? childPlacement(width, height) : { width, height, center: true }),
    // Hidden until its first paint, on the app's own --app-bg (frontend/src/index.css) — a window
    // shown immediately flashed white, then the Login page, before landing on the page it was
    // opened for (reported by the user, 2026-09-30). The Login half of that is fixed in the
    // renderer (AppContext.tsx's sessionChecked); this covers the empty-window half.
    show: false,
    backgroundColor: '#FAF8F3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // ready-to-show never fires if the page fails to load, so a fallback timer makes sure a window
  // can never stay invisible.
  // The main window opens maximized (per the user, 2026-10-22). Retried once shortly after: a Linux
  // window manager ignores maximize() until it has actually mapped the window, which is still in
  // flight right after show().
  const reveal = () => {
    if (child) { showChild(win); return; }
    win.show();
    win.maximize();
    setTimeout(() => { if (!win.isDestroyed() && !win.isMaximized()) win.maximize(); }, 200);
  };
  const showTimer = setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) reveal(); }, 3000);
  win.once('ready-to-show', () => { clearTimeout(showTimer); reveal(); });
  win.on('closed', () => clearTimeout(showTimer));

  win.on('focus', scheduleOnTopSync);
  win.on('blur', scheduleOnTopSync);

  if (child) {
    childWindows.add(win);
    if (opener && !opener.isDestroyed()) openerOf.set(win, opener);
    // Most recently used goes last — see raiseChildren().
    win.on('focus', () => { childWindows.delete(win); childWindows.add(win); });
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

// The main window's "Open Windows" list (frontend/src/components/OpenWindowsMenu.tsx). A child's
// title is its page's own name — AppLayout.tsx sets document.title in child windows, and Electron
// mirrors that onto the BrowserWindow.
function listChildWindows() {
  return [...childWindows]
    .filter((w) => !w.isDestroyed())
    .map((w) => ({ id: w.id, title: w.getTitle(), minimized: w.isMinimized() }));
}

function focusChildWindow(id) {
  const win = [...childWindows].find((w) => !w.isDestroyed() && w.id === id);
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

// Exit on a document opened in its own window: close that window and bring forward the window that
// opened it — or the main ("mother") window when that one is gone or unknown — rather than letting
// the OS hand focus to whichever window happens to be next.
function closeChildAndFocusMain(win) {
  if (!win || win.isDestroyed() || !childWindows.has(win)) return false;
  const opener = openerOf.get(win);
  const target = opener && !opener.isDestroyed() ? opener : mainWindow;
  win.close();
  if (target && !target.isDestroyed()) {
    if (target.isMinimized()) target.restore();
    target.focus();
  }
  return true;
}

module.exports = { createAppWindow, openChildWindow, setQuickMenuBottom, closeChildAndFocusMain, listChildWindows, focusChildWindow };
