# Release Pipeline — tag in, installed app out

How a Wentox release actually happens: you push a git tag, GitHub builds the Windows installer for
you, publishes it, and every machine already running Wentox can pull it down from inside the app.
Nobody needs a Windows machine, nobody uploads a file by hand, and the person installing it answers
one question.

This document explains **what it is**, **what it does at each stage**, and **how to implement it**
from nothing — including the mistakes that were made getting here, because most of the odd-looking
code exists to prevent one of them.

---

## 1. What it is, in one picture

```
    you                    GitHub                        the client's PC
    ───                    ──────                        ───────────────

  git push --tags
  (v1.0.2)  ────────────►  release.yml fires
                                │
                                ├─► job 1: nsis-lint      (Linux, ~30 s)
                                │     compile-check the installer script
                                │
                                └─► job 2: release        (Windows, ~3.5 min)
                                      npm install ×2
                                      download SQL Server Express (266 MB)
                                      build the React frontend
                                      electron-builder --win --publish always
                                              │
                                              ▼
                                      GitHub Release "1.0.2"
                                       • Wentox-Setup-1.0.2.exe   (363 MB)
                                       • Wentox-Setup-1.0.2.exe.blockmap
                                       • latest.yml               (341 bytes)
                                              │
                    ┌─────────────────────────┴────────────────────┐
                    ▼                                              ▼
            FIRST INSTALL                                  ALREADY INSTALLED
            download the .exe, run it                      Settings → Check for Updates
            Next → password → Next                         "v1.0.2 available. Update now?"
            (SQL Server installs itself)                   click once, app restarts updated
```

The whole thing hangs off **one action: pushing a tag**. Everything after that is automatic.

---

## 2. What it does, stage by stage

### Stage 1 — The trigger

`.github/workflows/release.yml` listens for any tag starting with `v`:

```yaml
on:
  push:
    tags:
      - 'v*'
```

So `git push origin v1.0.2` is the entire release command. Pushing to `main` does **not** build a
release; only a tag does.

### Stage 2 — The lint gate (Linux, ~30 seconds)

Before spending four minutes on a Windows runner, a Linux job compile-checks the NSIS installer
script (`backend/build/installer.nsh`).

This gate exists because of a specific, painful failure mode. electron-builder compiles the
installer script **twice** — once to produce the uninstaller, once for the real installer — and the
hooks that reference your functions are only present in the second pass. So a perfectly reasonable
script can compile fine in one pass and fail the other with `warning 6010: install function not
referenced`, which electron-builder turns into a fatal error via `-WX`. Discovering that partway
through the Windows job wastes minutes per attempt and the error message points nowhere useful.

`backend/build/lint-nsis.sh` reproduces both passes locally in seconds using two small harness
files (`backend/build/nsis-lint/pass_installer.nsi` and `pass_uninstaller.nsi`).

### Stage 3 — The build (Windows, ~3.5 minutes)

On GitHub's own `windows-latest` runner:

1. `npm install` in `frontend` and in `backend`
2. `npm run release:win`, which is three things chained:

   ```
   npm run download:sqlserver   → fetch SQLEXPR_x64_ENU.exe (~266 MB) from Microsoft
   npm run build:frontend       → vite build → frontend/dist
   electron-builder --win --publish always
   ```

The SQL Server Express installer is downloaded at build time rather than committed to git (far too
large) or fetched by the installer at install time (that would need an extra NSIS plugin and would
add a way for the install to fail on a client's flaky connection). `download-sqlserver.js` skips the
download if the file is already there and sane, and **deletes** anything under 200 MB as truncated
rather than bundling a broken file.

### Stage 4 — Publishing

`--publish always` uploads to GitHub Releases using `GITHUB_TOKEN`, the credential Actions injects
automatically. There is no personal access token to create, rotate, or leak — but it only works
because the workflow declares:

```yaml
permissions:
  contents: write
```

Three files land on the release:

| File | Size | Purpose |
|---|---|---|
| `Wentox-Setup-1.0.2.exe` | ~363 MB | the installer the client runs |
| `Wentox-Setup-1.0.2.exe.blockmap` | ~380 KB | lets updates download only changed blocks |
| `latest.yml` | 341 B | **the file the auto-updater reads** — version number + checksum |

`latest.yml` is the one that matters most and is the easiest to forget. Without it, an installed app
asking "is there a new version?" gets no answer.

### Stage 5 — The client installs it (first time)

The installer is NSIS, configured `oneClick: false` (a real wizard, not a silent blast),
`perMachine: true` (installed for all users), and the install folder is fixed.

The client sees the normal wizard, plus **one custom page** asking for two things:

- a **database password** (typed twice)
- a **backup folder** (defaults to `Documents\Wentox Backup`)

That is the only question the whole process asks. Then `customInstall` in `installer.nsh` runs
`setup-sqlserver.ps1`, which takes a PC from "no database at all" to "Wentox can log in":

1. Look for an existing SQL Server instance (in the 64-bit registry view)
2. If there is none, install SQL Server Express from the bundled package
3. Force the settings Wentox needs — mixed-mode auth, TCP/IP pinned to port 1433
4. Enable the `sa` login and set its password to the one just typed
5. Create the `Wentox_db` database if missing
6. **Verify by actually connecting** as `sa` over TCP and running a query

Steps 3–4 run over Windows Integrated auth, which always works for a local administrator regardless
of how `sa` is currently configured. That is what lets this *repair* a PC that already has SQL
Server with a disabled `sa` or a forgotten password — the given password always ends up working.

The script writes `%ProgramData%\Wentox\app-config.json` (machine-wide, so every Windows user on the
PC sees the same settings) and logs every step to `sqlserver-setup.log` in the install folder. If
setup fails the installer says so and names the log, and Wentox still installs so the problem can be
fixed without reinstalling.

On the app's **first launch**, `backend/electron/main.js` runs the migrations and seeds before
opening the window — both idempotent — so the schema, the default admin user, and the reserved chart
accounts create themselves. The client never runs a database script.

### Stage 6 — The client updates (every time after)

In the app: **Check for Updates** (`frontend/src/pages/CheckForUpdatesPage.tsx`).

1. It first sends a `HEAD` request to `api.github.com` — deliberately that exact host, not a generic
   internet ping, so "the internet works but GitHub is blocked" can't slip through as *fine*. No
   connection is a clear, reportable error.
2. `electron-updater` reads `latest.yml` from the newest release and compares it to the running
   version.
3. If a newer one exists the app asks; **it never downloads on its own** (`autoDownload = false`).
4. On "Update Now" it downloads and restarts straight into the new version.

The update runs the same installer again — but this time it asks nothing. `installer.nsh` detects an
update by checking the uninstall registry key **and** the existence of `app-config.json`, and skips
the setup page. `setup-sqlserver.ps1` still runs, with no password argument, and reads the existing
password and backup folder back out of the config. So every update also silently verifies and, if
necessary, repairs the database.

---

## 3. The pieces, and what each one is for

| File | Role |
|---|---|
| `.github/workflows/release.yml` | The trigger. Tag → lint → Windows build → publish. |
| `.github/workflows/nsis-lint.yml` | The gate. Also runs on its own for any push touching `backend/build/`. |
| `backend/build/lint-nsis.sh` | Compiles `installer.nsh` under both electron-builder passes with `-WX`. |
| `backend/build/nsis-lint/*.nsi` | Two harnesses simulating those passes. |
| `backend/package.json` → `build` | electron-builder config: what to package, NSIS options, publish target. |
| `backend/package.json` → `version` | **The version that actually ships.** See the warning below. |
| `backend/build/download-sqlserver.js` | Fetches SQL Server Express at build time, with a size sanity check. |
| `backend/build/installer.nsh` | The one custom wizard page, and the hook that runs the setup script. |
| `backend/build/setup-sqlserver.ps1` | Installs/configures/verifies SQL Server; writes `app-config.json`. |
| `backend/src/services/updates.service.js` | Connectivity probe, update check, download-and-restart. |
| `backend/src/ipc/updates.ipc.js` | Exposes `updates:check` / `updates:install` to the UI. |
| `frontend/src/pages/CheckForUpdatesPage.tsx` | The user-facing button and confirm prompt. |
| `backend/src/config/appConfig.js` | Reads the machine-wide config the installer wrote. |
| `backend/.gitignore` | Keeps `build/sqlserver/` and `dist-installer/` out of git. |

---

## 4. ⚠️ The one rule that will bite you

**The version comes from `backend/package.json`, not from the tag.**

electron-builder names the `.exe` and writes `latest.yml` from `package.json`. Git only decides
*when* to build. If they disagree — tag `v1.0.3` while `package.json` still says `1.0.2` — the build
succeeds, the release is attached to the `v1.0.3` tag, and the assets inside it say `1.0.2`. The
auto-updater then compares wrongly and clients never see the update.

So the order is always:

```
1. edit backend/package.json  → "version": "1.0.2"
2. git commit
3. git tag -a v1.0.2
4. git push origin main && git push origin v1.0.2
```

Bump `backend/package-lock.json`'s root `version` in the same commit. It doesn't affect the build,
but leaving it stale makes `npm ci` disagree with the installer — it sat at `0.1.12` through two
releases before anyone noticed.

---

## 5. Cutting a release (the actual procedure)

```bash
# 0. clean tree, up to date with origin
git status && git pull --ff-only

# 1. verify what you're about to ship
cd frontend && npx tsc -b && npm run build && cd ..

# 2. bump the version (package.json AND package-lock.json root)
#    then commit
git commit -am "chore(release): 1.0.2"

# 3. annotated tag — the message is the changelog, there is no CHANGELOG file
git tag -a v1.0.2

# 4. push both
git push origin main
git push origin v1.0.2

# 5. watch it build (~4 minutes total)
gh run watch

# 6. confirm all three assets landed
gh release view v1.0.2 --json assets --jq '[.assets[].name]'
```

Step 6 is the one worth never skipping. A release missing `latest.yml` looks fine on GitHub and
silently breaks every client's update check.

**Do not create an empty GitHub Release by hand.** It becomes "Latest" with no `latest.yml`, and
installed clients get an error instead of an answer until real assets appear.

---

## 6. How to implement this from scratch

For a new Electron + SQL Server desktop app, in order. Each step is independently testable — resist
doing them all before trying any.

### Step 1 — electron-builder config

In `backend/package.json`:

```json
{
  "version": "1.0.0",
  "main": "electron/main.js",
  "scripts": {
    "download:sqlserver": "node build/download-sqlserver.js",
    "build:frontend": "npm --prefix ../frontend run build",
    "dist:win": "npm run download:sqlserver && npm run build:frontend && electron-builder --win",
    "release:win": "npm run download:sqlserver && npm run build:frontend && electron-builder --win --publish always"
  },
  "build": {
    "appId": "com.yourcompany.yourapp",
    "productName": "YourApp",
    "directories": { "output": "dist-installer" },
    "files": ["electron/**/*", "src/**/*", "package.json", "!**/*.test.js"],
    "extraResources": [
      { "from": "../frontend/dist", "to": "frontend/dist" },
      { "from": "../database/schema.sql", "to": "database/schema.sql" },
      { "from": "build/sqlserver/SQLEXPR_x64_ENU.exe", "to": "sqlserver/SQLEXPR_x64_ENU.exe" },
      { "from": "build/setup-sqlserver.ps1", "to": "setup-sqlserver.ps1" }
    ],
    "win": { "target": "nsis" },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": false,
      "perMachine": true,
      "include": "build/installer.nsh"
    },
    "publish": {
      "provider": "github",
      "owner": "YOUR_GITHUB_USER",
      "repo": "YOUR_REPO",
      "releaseType": "release"
    }
  }
}
```

Keep `dist:win` alongside `release:win`. It builds the installer locally **without** publishing,
which is how you test installer changes without burning tags.

Two things that are easy to get wrong: `extraResources` is what puts files *outside* the asar so the
installer and PowerShell can reach them by path, and `perMachine: true` is what forces the elevation
that SQL Server setup requires.

### Step 2 — Fetch the database engine at build time

`backend/build/download-sqlserver.js`: download the SQL Server Express bootstrapper, follow
redirects, skip if already present, and **delete anything suspiciously small** — a truncated
download that gets bundled produces an installer that fails on the client's PC with no clue why.

Add `build/sqlserver/` and `dist-installer/` to `.gitignore`.

### Step 3 — The installer page

`backend/build/installer.nsh`. Three rules learned the hard way:

1. **Wrap everything that declares a `Var` or emits a `Function` in `!ifndef BUILD_UNINSTALLER`.**
   The uninstaller pass includes this file but not the hooks that reference your code, and unused
   vars/functions are fatal warnings under `-WX`.
2. **Detect update-vs-fresh using both the uninstall registry key and the config file.** Keyed on
   the registry alone, deleting the config while the app stays installed skips the page *and* leaves
   the setup script with no password — it exits 1 and no database gets configured. Keyed on the
   config alone, an uninstall-then-reinstall silently skips setup with no way to change the
   password. Both conditions must hold before you skip.
3. **Pass the password through a file in `$PLUGINSDIR`, not the command line.** It never reaches the
   process list, and NSIS never has to escape quotes into a command string. `$PLUGINSDIR` is wiped
   automatically when the installer exits.

Also: NSIS runs as a 32-bit process, so a bare `powershell.exe` gets redirected to the 32-bit
PowerShell, which sees the `WOW6432Node` registry view where SQL Server isn't registered at all. Use
`$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe`, with `powershell.exe` as the fallback.

### Step 4 — The setup script

`backend/build/setup-sqlserver.ps1`. Design constraints that matter more than the code:

- **Every step idempotent** — it runs on every install *and* every update, which is what makes
  reinstalling a genuine repair rather than a no-op.
- **End with a real connection test.** Not "the installer returned 0" — actually connect as `sa`
  over TCP and run a query. Several classes of failure only appear here.
- **The script writes the config, not NSIS.** An earlier version had NSIS hand-roll the JSON
  escaping, which produced a config whose password didn't match the one set on `sa`: setup reported
  success and the app still failed to log in. PowerShell's `ConvertTo-Json` escapes correctly by
  construction, and the script already holds the exact password it just verified.
- **Write the config machine-wide** (`%ProgramData%\...`), never per-user. The installer runs
  elevated, so a per-user path lands in the *elevating admin's* profile and is invisible to whoever
  actually runs the app.
- **Log everything to a file**, and have the installer name that file in its error message.
- **Make the password argument optional.** Absent = the update path: read it back from the existing
  config.

### Step 5 — Startup self-sufficiency

In `electron/main.js`, run migrations and seeds **before** opening the window, and make both
idempotent (a `schema_migrations` table; existence checks per seeded row). This is what lets a
first-ever launch build its own schema and admin user, so the installer never has to.

### Step 6 — The workflows

`.github/workflows/nsis-lint.yml`:

```yaml
name: NSIS script lint
on:
  push:
    branches: [main]
    paths: ['backend/build/**', '.github/workflows/nsis-lint.yml']
  pull_request:
    paths: ['backend/build/**']
  workflow_call:            # <- lets release.yml reuse it as a gate
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y nsis
      - run: backend/build/lint-nsis.sh
```

`.github/workflows/release.yml`:

```yaml
name: Release Windows build
on:
  push:
    tags: ['v*']
permissions:
  contents: write            # <- without this, publishing 403s
jobs:
  nsis-lint:
    uses: ./.github/workflows/nsis-lint.yml
  release:
    needs: nsis-lint
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
        working-directory: frontend
      - run: npm install
        working-directory: backend
      - run: npm run release:win
        working-directory: backend
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`secrets.GITHUB_TOKEN` is provided by Actions automatically — nothing to create.

### Step 7 — Auto-update in the app

Add `electron-updater`. In a service:

```js
autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO });
autoUpdater.autoDownload = false;    // never download without the user saying yes
```

Then:

- **Probe the actual update host first** (`HEAD https://api.github.com`) so "no internet" is a
  distinct, clear message rather than a mysterious failed check.
- **Guard on `app.isPackaged`.** Outside a packaged build there's no `app-update.yml` and no
  installed version to compare, so report that plainly instead of erroring.
- **Don't swallow errors from the check.** A private repo, a draft release, or a missing
  `latest.yml` are permanent and actionable, and reporting them as a confident "you're on the latest
  version" makes the feature look broken with no clue why. Return the error so the page can say it
  couldn't reach the update server.
- A connection dropping *mid-check* is different — that's just "try again later", not an error worth
  showing.

### Step 8 — Prove it end to end

Tag a throwaway version, let it build, install the `.exe` on a clean Windows VM, then tag one more
and confirm the installed app offers the update and takes it. Auto-update cannot be tested any other
way — it needs two real published releases and a genuinely packaged build.

---

## 7. When something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| No build after pushing a tag | Tag doesn't start with `v` | Retag |
| Build fails in ~30 s | NSIS lint gate | Run `backend/build/lint-nsis.sh` locally |
| Publish fails with 403 | Missing `permissions: contents: write` | Add it to `release.yml` |
| Release exists, assets named a different version | `package.json` version ≠ tag | Fix the version, delete tag + release, retag |
| Client's check says "up to date" when it isn't | `latest.yml` missing, or the release is a draft | Check `gh release view` |
| Client's check fails with no internet message | GitHub blocked on their network | Hand over the `.exe` directly |
| Install ends with "Database setup did not complete" | SQL Server step failed | Read `sqlserver-setup.log` in the install folder |
| App installs but says "Login failed for user 'sa'" | `app-config.json` missing or in a per-user path | Confirm it exists in `%ProgramData%\Wentox\` |

**Handing over the `.exe` manually** is always a valid fallback — download it from the release page,
or build it locally with `npm run dist:win`, which produces the same installer in
`backend/dist-installer` without publishing anything.

---

## 8. Current state

- Live pipeline, working. Releases `v0.1.10` through `v1.0.2` were all built and published this way.
- Typical end-to-end time: **~3.5 minutes** from `git push --tags` to a downloadable installer.
- Installer size ~363 MB, almost entirely the bundled SQL Server Express.
- Repo: `SubhanNoor/Wentox_sole`. Feed configured in `backend/src/services/updates.service.js` and
  `backend/package.json` → `build.publish` — **both** must be updated if the repo ever moves.
