// Real-screen (end-to-end) test harness: launches the actual Electron app — the same main.js,
// preload, IPC and backend services a shop PC runs — against the throwaway wentox_test database
// and the BUILT frontend (frontend/dist), then drives it with Playwright like a person would.
//
// Why these exist (per the user, 2026-09-30): fixing one item kept breaking an earlier fix, and
// the unit tests couldn't see it — the regressions lived in how the screens behave (which
// dropdown value shows, whether New is clickable after Post, a Login page flashing in a new
// window). These tests click through those workflows so a later change can't silently undo them.
//
// Safety: nothing here may ever touch a real database. Two checks: this test process's own resolved
// database (below, before any fixture is created), and the launched app's (assertTestTarget(): the
// app process must see DB_NAME=wentox_test and there must be no machine-wide installer config).
// The app runs on a brand-new Electron profile (--user-data-dir), so no per-user config can exist
// either, and the user's own saved page drafts are untouched.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const BACKEND_DIR = path.join(__dirname, '..');
const DIST_INDEX = path.join(BACKEND_DIR, '..', 'frontend', 'dist', 'index.html');
const TEST_DB = 'wentox_test';

// The fixtures talk to the database directly (same services the app uses), so THIS process must be
// on the test DB too — and an installer's app-config.json (%ProgramData%\Wentox, or
// backend/app-config.json for a plain node process) beats DB_NAME in src/config/index.js. So check
// the name the config actually resolved, here at load time: every e2e file requires this harness
// before creating a single fixture row.
process.env.DB_NAME = TEST_DB;
const resolvedDb = require('../src/config').db.database;
if (resolvedDb !== TEST_DB) {
  throw new Error(`Refusing to run e2e tests: this process would use database "${resolvedDb}", not ${TEST_DB} (an app-config.json overrides DB_NAME)`);
}

async function launchApp() {
  if (!fs.existsSync(DIST_INDEX)) {
    throw new Error('frontend/dist is missing — run `npm run build` in frontend/ first (npm run test:e2e does this).');
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wentox-e2e-'));
  const env = { ...process.env, DB_NAME: TEST_DB };
  // Without the dev-server URL, windowManager.js loads frontend/dist — the code under test.
  delete env.VITE_DEV_SERVER_URL;

  const app = await _electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: BACKEND_DIR, env });
  await assertTestTarget(app, userDataDir);

  // Records, in every window from its very first DOM mutation, whether a Login form ever existed —
  // a screenshot taken after load would miss a flash that lasts a fraction of a second.
  await app.context().addInitScript(() => {
    window.__sawLogin = false;
    new MutationObserver(() => {
      if (document.querySelector('input[type="password"]')) window.__sawLogin = true;
    }).observe(document, { childList: true, subtree: true });
  });

  const win = await app.firstWindow();
  return {
    app,
    win,
    async close() {
      await app.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function assertTestTarget(app, userDataDir) {
  const dbName = await app.evaluate(() => process.env.DB_NAME);
  const configFiles = [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Wentox', 'app-config.json'),
    path.join(userDataDir, 'app-config.json'),
  ].filter((p) => p && fs.existsSync(p));
  if (dbName !== TEST_DB || configFiles.length) {
    await app.close().catch(() => {});
    throw new Error(`Refusing to run: app would use DB_NAME=${dbName}${configFiles.length ? ` and ${configFiles.join(', ')}` : ''}`);
  }
}

async function login(win) {
  await win.locator('input[type="password"]').waitFor();
  await win.locator('input[type="text"]').first().fill('admin');
  await win.locator('input[type="password"]').first().fill('admin123');
  await win.locator('button[type="submit"]').first().click();
  await quickMenu(win, 'Sale Bill').waitFor();
}

// A top menu item (lib/menu.ts) — the group opens on hover (MenuBar.tsx; a click only toggles it).
async function menuItem(win, group, label) {
  await win.getByText(group, { exact: true }).hover();
  const item = win.getByText(label, { exact: true });
  await item.waitFor();
  return item;
}

function quickMenu(win, name) {
  return win.getByRole('button', { name, exact: true });
}

// Clicks something in the main window that opens a page in its own window, and returns that
// window once its document toolbar has rendered.
async function openInNewWindow(app, trigger) {
  const [page] = await Promise.all([app.waitForEvent('window'), trigger()]);
  await page.waitForLoadState('domcontentloaded');
  await toolbar(page, 'New').waitFor({ timeout: 20000 });
  return page;
}

// A DocumentToolbar button by its visible label (exact, so "Post" never matches "Post All" or
// "Un Post"). Scoped to .toolbar-btn — pages also have other "New" buttons (customer quick-add etc.),
// and the buttons' titles are longer descriptions that differ page to page.
function toolbar(page, label) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return page.locator('button.toolbar-btn').filter({ has: page.locator('span', { hasText: exact }) }).first();
}

function browseFilter(page) {
  return page.locator('select', { has: page.locator('option[value="unposted"]') }).first();
}

// Selects Posted/Unposted and waits until the page has finished loading what that option opens.
async function chooseFilter(page, value) {
  await browseFilter(page).selectOption(value);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
}

async function click(page, label) {
  await toolbar(page, label).click();
  await page.waitForTimeout(800);
}

// Polls until read() returns `expected` (screens update a beat after a click), then returns it —
// or the last value seen, so the caller's assert.equal prints a real diff instead of a timeout.
async function eventually(read, expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (value === expected) return value;
    await new Promise((r) => setTimeout(r, 200));
  } while (Date.now() < deadline);
  return value;
}

const filterValue = (page) => () => browseFilter(page).inputValue();
const isEnabled = (page, label) => () => toolbar(page, label).isEnabled({ timeout: 2000 }).catch(() => null);

// The one rule every document page must keep: the Posted/Unposted dropdown describes what is on
// screen. "Un Post" is clickable exactly when a posted document is loaded, so the dropdown must read
// 'posted' then and 'unposted' otherwise (a draft, or a blank New document).
async function dropdownMatchesScreen(page) {
  const expected = (await isEnabled(page, 'Un Post')()) ? 'posted' : 'unposted';
  return (await eventually(filterValue(page), expected)) === expected ? true : `dropdown says ${await filterValue(page)()}, screen is ${expected}`;
}

// The shared Posted/Unposted workflow, run against one document page. `setup` must create (through
// the backend services) one POSTED document and then one newer UNPOSTED one, register its own
// cleanup on `t`, and resolve once both exist. Steps, checking dropdownMatchesScreen() after each:
//   1. open the page in a new window — no Login frame, ever;
//   2. pick Posted immediately — it must stick (the page's auto-open used to undo it);
//   3. New — clickable on Posted, lands on Unposted;
//   4. pick Unposted — the newest draft (ours) opens;
//   5. Post — whether the page keeps the document (dropdown → Posted) or clears to a blank one,
//      the label must match and New must still be clickable (it used to grey out);
//   6. pick Posted, Un Post — back to a draft under Unposted.
async function browseFilterScenario(t, { menuLabel, setup }) {
  const assert = require('node:assert/strict');
  await setup(t);

  const session = await launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await login(win);

  const page = await openInNewWindow(app, async () => (await menuItem(win, '2.DATA ENTRY', menuLabel)).click());
  assert.equal(await page.evaluate(() => window.__sawLogin), false, 'a new window must never show the Login page');

  await chooseFilter(page, 'posted');
  assert.equal(await eventually(isEnabled(page, 'Un Post'), true), true, 'Posted should open a posted document');
  await page.waitForTimeout(2000);
  assert.equal(await filterValue(page)(), 'posted', 'the page auto-open must not undo the Posted choice');
  assert.equal(await isEnabled(page, 'Un Post')(), true, 'the posted document must still be on screen');

  assert.equal(await isEnabled(page, 'New')(), true, 'New must be clickable while on Posted');
  await click(page, 'New');
  assert.equal(await eventually(filterValue(page), 'unposted'), 'unposted', 'New must switch back to Unposted');
  assert.equal(await dropdownMatchesScreen(page), true, 'after New');

  await chooseFilter(page, 'unposted');
  assert.equal(await eventually(isEnabled(page, 'Post'), true), true, 'Unposted should open our draft');
  assert.equal(await dropdownMatchesScreen(page), true, 'after picking Unposted');

  await click(page, 'Post');
  assert.equal(await eventually(isEnabled(page, 'Post'), false), false, 'Post should have gone through');
  assert.equal(await dropdownMatchesScreen(page), true, 'after Post');
  assert.equal(await eventually(isEnabled(page, 'New'), true), true, 'New must not grey out after Post');

  await chooseFilter(page, 'posted');
  assert.equal(await eventually(isEnabled(page, 'Un Post'), true), true, 'Posted should open the posted document');
  await click(page, 'Un Post');
  assert.equal(await eventually(filterValue(page), 'unposted'), 'unposted', 'Unpost must switch back to Unposted');
  assert.equal(await dropdownMatchesScreen(page), true, 'after Unpost');
}

// The Master/Detail edit flow (document_page_standard.md §5–§6), run against one document page.
// `setup` must create (through the backend services) ONE unposted document with exactly TWO lines,
// newer than any other unposted one of its type, so it is what the page opens on. Checks:
//   - it opens read-only; a row click only SELECTS (gold, aria-selected) and unlocks nothing;
//   - Edit with Detail picked edits the selected row (blue); a click on another row while editing
//     moves the selection only; Edit Row switches the edit to it; Cancel goes back to read-only;
//   - a row's own Delete works from view mode and puts the document into edit (Save live);
//     Cancel brings the line back;
//   - New with Detail picked adds a line to the document on screen — never a new document — and
//     leaves the header locked; Edit with Master picked unlocks the header;
//   - Exit closes the window.
async function masterDetailScenario(t, { menuLabel, setup }) {
  const assert = require('node:assert/strict');
  await setup(t);

  const session = await launchApp();
  t.after(() => session.close());
  const { app, win } = session;
  await login(win);
  const page = await openInNewWindow(app, async () => (await menuItem(win, '2.DATA ENTRY', menuLabel)).click());

  const rows = page.locator('tbody tr[aria-selected]');
  const radio = (i) => page.locator('input[type="radio"][name$="edit-scope"]').nth(i);
  const headerDate = page.locator('input[type="date"]').first();
  const isBlue = (i) => async () => /bg-blue-100/.test((await rows.nth(i).getAttribute('class')) || '');
  const isSelected = (i) => async () => (await rows.nth(i).getAttribute('aria-selected')) === 'true';

  assert.equal(await eventually(() => rows.count(), 2, 15000), 2, 'the two-line document should open');
  assert.equal(await eventually(isEnabled(page, 'Post'), true), true, 'it opens as a saved, unposted document');
  assert.equal(await isEnabled(page, 'Save')(), false, 'it opens read-only');

  await rows.nth(0).click();
  assert.equal(await eventually(isSelected(0), true), true, 'a row click selects the row');
  assert.equal(await isBlue(0)(), false, 'a row click never loads the row for editing');
  assert.equal(await isEnabled(page, 'Save')(), false, 'a row click unlocks nothing');

  await radio(1).check();
  await click(page, 'Edit');
  assert.equal(await eventually(isBlue(0), true), true, 'Edit with Detail edits the selected row');
  assert.equal(await eventually(isEnabled(page, 'Save'), true), true, 'editing a line unlocks Save');
  assert.equal(await headerDate.isDisabled(), true, 'editing a line keeps the header locked');

  await rows.nth(1).click();
  assert.equal(await eventually(isSelected(1), true), true, 'another row can be selected while editing');
  assert.equal(await isBlue(0)(), true, 'selecting another row leaves the edited one as it is');
  await click(page, 'Edit Row');
  assert.equal(await eventually(isBlue(1), true), true, 'Edit Row switches the edit to the selected row');
  assert.equal(await isBlue(0)(), false, 'only one row is being edited');

  await click(page, 'Cancel');
  assert.equal(await eventually(isEnabled(page, 'Save'), false), false, 'Cancel goes back to read-only');
  assert.equal(await rows.count(), 2, 'Cancel keeps the saved lines');

  await rows.nth(0).locator('button[title^="Delete this"]').click();
  assert.equal(await eventually(() => rows.count(), 1), 1, "a row's Delete works from view mode");
  assert.equal(await eventually(isEnabled(page, 'Save'), true), true, 'and puts the document into edit, so Save can keep it');
  await click(page, 'Cancel');
  assert.equal(await eventually(() => rows.count(), 2), 2, 'Cancel brings the deleted line back');

  await radio(1).check();
  await click(page, 'New');
  assert.equal(await eventually(isEnabled(page, 'Save'), true), true, 'New with Detail opens the document for a new line');
  assert.equal(await rows.count(), 2, 'New with Detail keeps the lines — it is not a new document');
  assert.equal(await isEnabled(page, 'Post')(), false, 'still the same saved document, now being edited');
  assert.equal(await headerDate.isDisabled(), true, 'New with Detail leaves the header locked');
  await click(page, 'Cancel');

  await radio(0).check();
  await click(page, 'Edit');
  assert.equal(await eventually(() => headerDate.isDisabled(), false), false, 'Edit with Master unlocks the header');
  await click(page, 'Cancel');

  await toolbar(page, 'Exit').click();
  assert.equal(await eventually(async () => page.isClosed(), true), true, 'Exit closes the document window');
}

module.exports = {
  launchApp, login, menuItem, quickMenu, openInNewWindow, toolbar, browseFilter, chooseFilter, click,
  eventually, filterValue, isEnabled, dropdownMatchesScreen, browseFilterScenario, masterDetailScenario,
};
