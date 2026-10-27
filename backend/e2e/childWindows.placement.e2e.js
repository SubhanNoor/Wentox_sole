// A child window opens in the centre of the main window's screen (per the user, 2026-10-25) — centred
// across, and top to bottom in the space below the Quick Menu bar, which it never covers (per the
// user, 2026-10-22). The next one opens at exactly the same spot, on top, the first staying behind.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const { closePool } = require('../src/db/pool');

// Where a window's title bar really starts. On Linux the window manager draws it ABOVE the bounds
// Electron reports (getBounds() == getContentBounds()), so a check on the bounds alone passed while
// ~40px of title bar still covered the Quick Menu (2026-10-22). Matches windowManager.js.
const TITLE_BAR = process.platform === 'linux' ? 40 : 0;
// Gap windowManager.js leaves between the bar and a window's top edge.
const BAR_GAP = 8;

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
  test(`new windows open centred below the Quick Menu, each at the same spot on top of the last (zoom ${zoom * 100}%)`, async (t) => {
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
    const workBottom = g.work.y + g.work.height;
    t.diagnostic(`work ${JSON.stringify(g.work)} bar ends at y=${g.barBottom} first ${JSON.stringify(first)}`);
    assert.ok(first.y - TITLE_BAR >= g.barBottom, `first window's title bar (${first.y - TITLE_BAR}) starts below the Quick Menu (${g.barBottom})`);
    const leftGap = first.x - g.work.x;
    const rightGap = g.work.x + g.work.width - (first.x + first.width);
    assert.ok(Math.abs(leftGap - rightGap) <= 2, `first window is centred across (${leftGap} vs ${rightGap})`);
    const topGap = first.y - TITLE_BAR - g.barBottom;
    const bottomGap = workBottom - (first.y + first.height);
    assert.ok(Math.abs(topGap - bottomGap) <= TITLE_BAR + BAR_GAP + 2, `first window is centred below the bar (${topGap} vs ${bottomGap})`);
    assert.equal(first.width, 1000, 'only the height gives way, never the width');

    await h.openInNewWindow(app, async () => (await h.menuItem(win, '2.DATA ENTRY', 'PURCHASE')).click());
    g = await geometry(app, win);
    const next = g.children[1];
    assert.deepEqual(
      { x: next.x, y: next.y, width: next.width, height: next.height },
      { x: first.x, y: first.y, width: first.width, height: first.height },
      'second window opens at exactly the same spot',
    );
    const focusedIsNewest = await app.evaluate(({ BrowserWindow }) => {
      const kids = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('child=1')).sort((a, b) => a.id - b.id);
      return BrowserWindow.getFocusedWindow() === kids[kids.length - 1] || kids[kids.length - 1].isAlwaysOnTop();
    });
    assert.ok(focusedIsNewest, 'the newest window is the one in front');
  });
}

test.after(async () => {
  await closePool();
});
