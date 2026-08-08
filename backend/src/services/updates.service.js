// Service layer for the "Check for Updates" page (Milestone 9.3). No repository — nothing here
// touches SQL; it orchestrates `electron-updater` and a plain connectivity probe instead.
const https = require('https');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const ApiError = require('../errors/ApiError');

const GITHUB_OWNER = 'SubhanNoor';
const GITHUB_REPO = 'Wentox_sole';
const CONNECTIVITY_TIMEOUT_MS = 5000;

autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO });
// Never download without the user explicitly saying yes on the confirm prompt this feeds.
autoUpdater.autoDownload = false;

// A HEAD request to GitHub's own API, not a generic "ping" — this is the exact host the update
// check itself needs, so a false-positive (DNS resolves, some other host is reachable, but GitHub
// specifically is not) can't slip through as "internet is fine."
function checkInternet() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const req = https.request(
      { hostname: 'api.github.com', method: 'HEAD', timeout: CONNECTIVITY_TIMEOUT_MS },
      (res) => { res.destroy(); done(true); },
    );
    req.on('timeout', () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
    req.end();
  });
}

// Two distinct failure points, per explicit instruction:
//   1. No internet AT ALL, checked up front — a real, reportable error (ApiError, shown to the
//      user).
//   2. The connection drops (or GitHub errors) DURING the actual update lookup, having passed
//      step 1 — resolves as "no update found," never surfaced as an error. A flaky connection
//      mid-check isn't the user's problem to interpret; they just try again later.
async function check() {
  const online = await checkInternet();
  if (!online) {
    throw ApiError.conflict('No internet connection — check your network and try again', 'NO_INTERNET');
  }

  if (!app.isPackaged) {
    // electron-updater has nothing to check against outside a real packaged build (no
    // app-update.yml, no installed-app version to compare) — reported plainly, not as an error.
    return { updateAvailable: false, currentVersion: app.getVersion(), packaged: false };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const currentVersion = app.getVersion();
    const latestVersion = result?.updateInfo?.version;
    return {
      updateAvailable: Boolean(latestVersion && latestVersion !== currentVersion),
      currentVersion,
      latestVersion,
      packaged: true,
    };
  } catch (err) {
    // Still not thrown as an ApiError — a connection dropping mid-lookup shouldn't read as a hard
    // failure (see the note above). But it is no longer swallowed *silently*: a permanent,
    // actionable fault (a private repo returning 404, a release published as a draft, a missing
    // latest.yml) is indistinguishable here from a transient drop, and reporting both as a
    // confident "you are on the latest version" made the update check look broken with no clue
    // why. Logged for the main-process console, and returned so the page can say it couldn't
    // reach the update server rather than claim to be up to date.
    console.error('Update check failed:', err);
    return {
      updateAvailable: false,
      currentVersion: app.getVersion(),
      packaged: true,
      checkError: err?.message || String(err),
    };
  }
}

// Only called after the user says yes on the confirm prompt. Downloads, then restarts into the
// new version — one action for "do it," matching what was asked, rather than a separate
// download-then-install step the user would have to trigger twice.
function install() {
  if (!app.isPackaged) {
    throw ApiError.conflict('Cannot install an update outside a packaged build', 'NOT_PACKAGED');
  }
  return new Promise((resolve, reject) => {
    autoUpdater.once('update-downloaded', () => {
      autoUpdater.quitAndInstall();
      resolve({ ok: true });
    });
    autoUpdater.once('error', (err) => reject(err));
    autoUpdater.downloadUpdate().catch(reject);
  });
}

module.exports = { check, install };
