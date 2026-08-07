// Fetches the SQL Server Express bootstrapper into build/sqlserver/ so package.json's
// extraResources can bundle it into the installer (see build/installer.nsh's customInstall,
// which runs it silently when the user picks "auto-install"). Run before electron-builder, not
// committed to git (too large — see .gitignore) or downloaded by NSIS itself at install time
// (would need an extra plugin and adds a runtime failure point, same class of problem the custom
// page compilation already caused).
const https = require('https');
const fs = require('fs');
const path = require('path');

// Verified reachable (200, ~266MB) before wiring this up. If Microsoft ever moves this, replace
// with the current link from https://www.microsoft.com/en-us/download/details.aspx?id=104781.
const URL = 'https://download.microsoft.com/download/3/8/d/38de7036-2433-4207-8eae-06e247e17b25/SQLEXPR_x64_ENU.exe';
const MIN_EXPECTED_BYTES = 200 * 1024 * 1024; // sanity floor — a truncated/failed download would be much smaller
const OUT_DIR = path.join(__dirname, 'sqlserver');
const OUT_FILE = path.join(OUT_DIR, 'SQLEXPR_x64_ENU.exe');

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        return resolve(download(res.headers.location, dest, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUT_FILE) && fs.statSync(OUT_FILE).size > MIN_EXPECTED_BYTES) {
    console.log('SQL Server Express installer already downloaded, skipping.');
    return;
  }
  console.log('Downloading SQL Server Express installer (~266MB)...');
  await download(URL, OUT_FILE);
  const size = fs.statSync(OUT_FILE).size;
  if (size < MIN_EXPECTED_BYTES) {
    fs.unlinkSync(OUT_FILE);
    throw new Error(`Downloaded file is only ${size} bytes — looks truncated/failed, removed it`);
  }
  console.log(`Downloaded ${(size / 1024 / 1024).toFixed(0)}MB to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Failed to download SQL Server Express installer:', err.message);
  process.exitCode = 1;
});
