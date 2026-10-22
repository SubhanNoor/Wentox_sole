// One window per screen (per the user, 2026-10-22): clicking a screen that is already open in its
// own window brings that window forward — restoring it if minimized — instead of opening a
// duplicate. A different screen still opens its own window.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

function childWindows(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const focused = BrowserWindow.getFocusedWindow();
    return BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().includes('child=1'))
      .map((w) => ({ id: w.id, title: w.getTitle(), minimized: w.isMinimized(), focused: focused === w }));
  });
}

test('opening a screen that is already open brings its window forward instead of duplicating it', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);

  await h.openInNewWindow(app, () => h.quickMenu(win, 'Sale Bill').click());
  let children = await childWindows(app);
  assert.equal(children.length, 1);
  const saleBill = children[0];

  // Same screen again, from the main window: still one window, and it is the focused one.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('child=1')).focus());
  await h.quickMenu(win, 'Sale Bill').click();
  children = await childWindows(app);
  assert.equal(children.length, 1, 'no duplicate Sale Bill window');
  assert.equal(children[0].id, saleBill.id);
  assert.equal(children[0].focused, true, 'the existing window is brought forward');

  // Minimized: clicking it again restores it rather than opening another.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), saleBill.id);
  await h.quickMenu(win, 'Sale Bill').click();
  children = await childWindows(app);
  assert.equal(children.length, 1);
  assert.equal(children[0].minimized, false, 'a minimized window is restored');

  // A rapid double-click while the window is still loading must not open two either.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), saleBill.id);
  await h.quickMenu(win, 'Sale Bill').dblclick();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  children = await childWindows(app);
  assert.equal(children.length, 1, 'a double-click opens one window');
});

test.after(async () => {
  await closePool();
});
