// Child windows vs. the main window (per the user, 2026-10-11): clicking the main window used to
// bury every open document window behind it. Child windows now stay above the main window while
// Wentox is the active app, drop back to normal stacking when another app takes focus, and the
// main window's "Open Windows" list names each one and brings it back to the front.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { execFileSync } = require('node:child_process');
const { closePool } = require('../src/db/pool');

// The main process's view of every BrowserWindow: which is focused, which float on top, titles.
function windowState(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    // windowManager.js defers its on-top sync by one tick after a focus change — let it run.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const focused = BrowserWindow.getFocusedWindow();
    return BrowserWindow.getAllWindows().map((w) => ({
      id: w.id,
      title: w.getTitle(),
      onTop: w.isAlwaysOnTop(),
      focused: focused === w,
      child: w.webContents.getURL().includes('child=1'),
    }));
  });
}

test('child windows stay above the main window and are listed under Open Windows', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  await h.openInNewWindow(app, () => h.quickMenu(win, 'Sale Bill').click());
  let state = await windowState(app);
  const child = state.find((w) => w.child);
  const main = state.find((w) => !w.child);
  assert.ok(child, 'a child window opened');
  assert.match(child.title, /Sale Bill/, 'the child window is titled by its page, not just "Wentox"');
  assert.equal(child.onTop, true, 'child floats while Wentox is active');
  assert.equal(main.onTop, false, 'the main window itself never floats');

  // Clicking back into the main window must not drop the child behind it.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), main.id);
  state = await windowState(app);
  assert.equal(state.find((w) => w.id === child.id).onTop, true, 'child still floats after the main window takes focus');

  // Open Windows lists the child; picking it restores and focuses it even when minimized.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), child.id);
  await win.getByRole('button', { name: /^Open windows/ }).click();
  const entry = win.getByRole('menu', { name: 'Open windows' }).getByRole('menuitem', { name: new RegExp(child.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await entry.waitFor();
  await entry.click();
  state = await windowState(app);
  const after = state.find((w) => w.id === child.id);
  const minimized = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isMinimized(), child.id);
  assert.equal(minimized, false, 'Open Windows restores a minimized child');
  assert.equal(after.focused, true, 'Open Windows focuses the chosen child');

  // Another app taking focus (no Wentox window focused): the child stops floating over it.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.blur(); });
  state = await windowState(app);
  if (!state.some((w) => w.focused)) {
    assert.equal(state.find((w) => w.id === child.id).onTop, false, 'child stops floating once Wentox is inactive');
  } else {
    t.diagnostic('window manager kept focus on a Wentox window after blur(); app-inactive check skipped');
  }
});

// Bottom-to-top stacking order of the given windows, as the X server / window manager sees it —
// Electron itself can't report z-order. Linux/X11 (or XWayland) only; null when unavailable.
async function stackingOrder(app, ids) {
  let stack;
  try {
    const out = execFileSync('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], { encoding: 'utf8' });
    stack = (out.match(/0x[0-9a-f]+/gi) || []).map((x) => parseInt(x, 16));
  } catch {
    return null;
  }
  const xids = await app.evaluate(({ BrowserWindow }, list) =>
    list.map((id) => BrowserWindow.fromId(id).getNativeWindowHandle().readUInt32LE(0)), ids);
  const positions = xids.map((xid) => stack.indexOf(xid));
  if (positions.some((p) => p < 0)) return null;
  return ids.slice().sort((a, b) => positions[ids.indexOf(a)] - positions[ids.indexOf(b)]);
}

// The user's report (2026-10-11): opened several windows, Sale Bill last — and it came up BEHIND
// all the others. Ubuntu's focus-stealing prevention had refused it focus, and only focused
// windows were being floated. The newest window must always be the top one.
test('the most recently opened child window is on top of the others', async (t) => {
  if (process.platform !== 'linux') return t.skip('reads X11 stacking order');
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  const opened = [];
  const openVia = async (trigger) => {
    const before = new Set((await windowState(app)).map((w) => w.id));
    await h.openInNewWindow(app, trigger);
    const added = (await windowState(app)).find((w) => !before.has(w.id));
    opened.push(added.id);
  };
  await openVia(async () => (await h.menuItem(win, '2.DATA ENTRY', 'RECEIPTS (JAMMA)')).click());
  await openVia(async () => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE')).click());
  // Back in the main window before the last one, exactly as when clicking its Quick Menu.
  const mainId = (await windowState(app)).find((w) => !w.child).id;
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), mainId);
  await openVia(() => h.quickMenu(win, 'Sale Bill').click());

  const order = await stackingOrder(app, [mainId, ...opened]);
  if (!order) return t.skip('no X11 stacking information available');
  assert.equal(order.at(-1), opened.at(-1), `newest child window must be on top (bottom→top: ${order.join(', ')})`);
  assert.equal(order[0], mainId, 'the main window is below every child window');

  // Bringing an older one forward and leaving/returning to the app keeps it on top — re-raising
  // goes in most-recently-used order, not opening order.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), opened[0]);
  await windowState(app);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.blur(); });
  await windowState(app);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), mainId);
  await windowState(app);
  const reordered = await stackingOrder(app, [mainId, ...opened]);
  assert.equal(reordered.at(-1), opened[0], `last-used child stays on top after returning to the app (bottom→top: ${reordered.join(', ')})`);
});

test.after(() => closePool());
