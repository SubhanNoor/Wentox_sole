// New windows never cover the Quick Menu (per the user, 2026-10-22): a child window opens at the
// bottom-right of the main window's screen with its top edge below the main window's Quick Menu
// bar; the next one steps up-left from the corner but never above the bar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

// Where a window's title bar really starts. On Linux the window manager draws it ABOVE the bounds
// Electron reports (getBounds() == getContentBounds()), so a check on the bounds alone passed while
// ~40px of title bar still covered the Quick Menu (2026-10-22). Matches windowManager.js.
const TITLE_BAR = process.platform === 'linux' ? 40 : 0;

// Screen geometry from the main process: the work area, where the Quick Menu bar ends on screen,
// and every child window's frame bounds (newest last).
async function geometry(app, win) {
  const cssBottom = await win.evaluate(() => {
    const label = [...document.querySelectorAll('span')].find((s) => /Quick Menu:/.test(s.textContent || ''));
    return label.closest('[data-no-print]').getBoundingClientRect().bottom;
  });
  return app.evaluate(({ BrowserWindow, screen }, bottom) => {
    const all = BrowserWindow.getAllWindows();
    const main = all.find((w) => !w.webContents.getURL().includes('child=1'));
    const work = screen.getDisplayMatching(main.getBounds()).workArea;
    return {
      work,
      barBottom: main.getContentBounds().y + Math.round(bottom * main.webContents.getZoomFactor()),
      children: all.filter((w) => w.webContents.getURL().includes('child=1')).sort((a, b) => a.id - b.id).map((w) => w.getBounds()),
    };
  }, cssBottom);
}

test('the main window opens maximized', async (t) => {
  const { app, win, close } = await h.launchApp();
  t.after(close);
  await h.login(win);
  const maximized = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
  assert.equal(maximized, true);
});

for (const zoom of [1, 0.75]) {
  test(`new windows open bottom-right, fully below the Quick Menu, and step up-left without crossing it (zoom ${zoom * 100}%)`, async (t) => {
    const { app, win, close } = await h.launchApp();
    t.after(close);
    await h.login(win);
    // The main window fills the screen like a shop PC's, so the bar sits at the top of the work area.
    await app.evaluate(({ BrowserWindow }, factor) => {
      const main = BrowserWindow.getAllWindows()[0];
      main.maximize();
      main.webContents.setZoomFactor(factor);
    }, zoom);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await h.openInNewWindow(app, () => h.quickMenu(win, 'Sale Bill').click());
    let g = await geometry(app, win);
    const [first] = g.children;
    const workRight = g.work.x + g.work.width;
    const workBottom = g.work.y + g.work.height;
    t.diagnostic(`work ${JSON.stringify(g.work)} bar ends at y=${g.barBottom} first ${JSON.stringify(first)}`);
    assert.ok(first.y - TITLE_BAR >= g.barBottom, `first window's title bar (${first.y - TITLE_BAR}) starts below the Quick Menu (${g.barBottom})`);
    assert.ok(Math.abs(first.x + first.width - workRight) <= 2, 'first window is right-aligned');
    assert.ok(Math.abs(first.y + first.height - workBottom) <= 2, 'first window is bottom-aligned');
    assert.equal(first.width, 1000, 'only the height gives way, never the width');

    await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE')).click());
    g = await geometry(app, win);
    const next = g.children[1];
    assert.ok(next.y - TITLE_BAR >= g.barBottom, 'second window is still below the Quick Menu');
    assert.ok(next.x < first.x, 'second window steps left so the first still peeks out');
  });
}

test.after(async () => {
  await closePool();
});
