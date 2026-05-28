#!/usr/bin/env node
// plugins/agent365/scripts/check-version.js
// Checks if the installed plugin version is up to date.
//
// Wired as a SessionStart hook in plugins/agent365/.claude-plugin/plugin.json so
// it runs once per session — not once per skill invocation. Outputs a warning if
// behind the latest release; silent if up to date or check unavailable.
//
// Cache strategy (no-cache by default — prevents staleness after `git pull`):
//   - Every session attempts a fresh `gh release view` (~300ms).
//   - The result is cached at <cache-dir>/version.json with a SHORT 1h TTL,
//     used ONLY as a fallback when the network call fails (offline, gh not
//     installed, rate-limited).
//   - The cache file records the installed version too; if the installed
//     version changes between sessions (user upgraded or downgraded), the
//     cache is dropped immediately so the next check is fresh.
//
// To force-refresh from outside this script, run:
//     scripts/refresh.ps1  (Windows)   or   scripts/refresh.sh  (Unix)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const FALLBACK_TTL_MS = 60 * 60 * 1000; // 1h — only used when the live `gh` call fails

const pluginJson = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');

let installedVersion;
try {
  installedVersion = JSON.parse(fs.readFileSync(pluginJson, 'utf8')).version;
} catch {
  process.exit(0); // can't read local version — skip silently
}

function cacheFilePath() {
  const dir = process.env.XDG_CACHE_HOME
    || (process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Local', 'agent365-skills')
        : path.join(os.homedir(), '.cache', 'agent365-skills'));
  return path.join(dir, 'version.json');
}

function readCache() {
  try {
    const raw = fs.readFileSync(cacheFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.checkedAt !== 'number' || typeof data.latestVersion !== 'string') return null;
    // Invalidate the cache immediately if the installed version changed since
    // the cache was written (user upgraded / downgraded the plugin).
    if (data.installedVersion && data.installedVersion !== installedVersion) return null;
    if (Date.now() - data.checkedAt > FALLBACK_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(latestVersion) {
  try {
    const p = cacheFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      checkedAt: Date.now(),
      installedVersion,
      latestVersion,
    }) + '\n', 'utf8');
  } catch {
    // cache write failures are non-fatal
  }
}

function fetchLatestVersion() {
  try {
    const raw = execSync(
      'gh release view --repo microsoft/agent365-skills --json tagName -q .tagName',
      { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    return raw.replace(/^v/, '');
  } catch {
    return null;
  }
}

// Always attempt a live fetch first. Cache is consulted only when the live call
// fails — this is the no-cache-by-default behaviour that prevents staleness
// after `git pull` or `gh release` updates upstream.
let latestVersion = fetchLatestVersion();
if (latestVersion) {
  writeCache(latestVersion);
} else {
  const cached = readCache();
  if (cached) latestVersion = cached.latestVersion;
}

if (latestVersion && latestVersion !== installedVersion) {
  console.log(`> [!WARNING]`);
  console.log(`> **Agent 365 Skills update available**: installed v${installedVersion}, latest v${latestVersion}.`);
  console.log(`> Force-refresh (clears version cache + reinstalls):`);
  console.log(`>   Windows: \`./scripts/refresh.ps1\``);
  console.log(`>   macOS/Linux: \`./scripts/refresh.sh\``);
  console.log(`> Or update manually with: \`gh skill add microsoft/agent365-skills\``);
}
