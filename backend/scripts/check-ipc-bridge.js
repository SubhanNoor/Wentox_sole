// Structural regression check, not a unit test: every backend IPC channel prefix registered in
// src/ipc/*.ipc.js must have a matching entry in the frontend's ipcBridge.ts FEATURES allow-list.
// A prefix missing from FEATURES means window.api.<feature> is undefined in the running app — the
// first call throws a TypeError instead of a rejected ApiResult, which then surfaces as an
// unrelated symptom (an empty dropdown, "no matching option"), not a clear error.
//
// This exact gap shipped twice as a fully-broken feature before being caught by hand: Journal
// Voucher and Direct Settlement were both missing from FEATURES for a while (see
// System_architecture/testing_priority_plan.md, 2026-08-10). This script makes that class of bug
// impossible to ship silently again — run it as part of every release (see release_pipeline.md).
const fs = require('fs');
const path = require('path');

const IPC_DIR = path.join(__dirname, '..', 'src', 'ipc');
const BRIDGE_FILE = path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'ipcBridge.ts');

function kebabToCamel(kebab) {
  return kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelToKebab(camel) {
  return camel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// Scans for `ipcMain.handle('<channel>', ...)` regardless of whether the string literal sits on
// the same line as `handle(` or a following one — most files in this repo wrap the call.
function extractBackendPrefixes() {
  const prefixes = new Set();
  for (const file of fs.readdirSync(IPC_DIR)) {
    if (!file.endsWith('.ipc.js')) continue;
    const text = fs.readFileSync(path.join(IPC_DIR, file), 'utf8');
    const re = /ipcMain\.handle\(\s*['"]([a-zA-Z0-9:_-]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      const channel = m[1];
      const sep = channel.indexOf(':');
      if (sep === -1) continue; // not a "<feature>:<action>" channel — nothing to check
      prefixes.add(channel.slice(0, sep));
    }
  }
  return prefixes;
}

function extractFeaturesList() {
  const text = fs.readFileSync(BRIDGE_FILE, 'utf8');
  const match = text.match(/const FEATURES = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error(`Could not find "const FEATURES = [...] as const;" in ${BRIDGE_FILE}`);
  return new Set([...match[1].matchAll(/'([a-zA-Z0-9]+)'/g)].map((m) => m[1]));
}

const backendPrefixes = extractBackendPrefixes();
const features = extractFeaturesList();

const missing = [...backendPrefixes]
  .map((prefix) => ({ prefix, camel: kebabToCamel(prefix) }))
  .filter(({ camel }) => !features.has(camel));

const unused = [...features].filter((feature) => !backendPrefixes.has(camelToKebab(feature)));

let failed = false;

if (missing.length) {
  failed = true;
  console.error('IPC bridge check FAILED — backend channel(s) with no matching frontend FEATURES entry:\n');
  for (const { prefix, camel } of missing) {
    console.error(`  '${prefix}:*' is registered on the backend, but '${camel}' is missing from`);
    console.error(`  frontend/src/lib/ipcBridge.ts's FEATURES array.`);
    console.error(`  -> window.api.${camel} would be undefined in the running app.\n`);
  }
}

if (unused.length) {
  console.warn('Note — FEATURES entries with no matching backend channel (dead code or a rename left behind):\n');
  for (const feature of unused) console.warn(`  '${feature}'`);
  console.warn('');
}

if (failed) {
  console.error('Fix: add the missing feature name(s) to FEATURES in frontend/src/lib/ipcBridge.ts.');
  process.exit(1);
}

console.log(`IPC bridge check passed: all ${backendPrefixes.size} backend feature prefixes are present in FEATURES.`);
