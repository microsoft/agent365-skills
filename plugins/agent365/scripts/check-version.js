#!/usr/bin/env node
// plugins/agent365/scripts/check-version.js
// Checks if the installed plugin version is up to date.
//
// Wired as a SessionStart hook in plugins/agent365/.claude-plugin/plugin.json so
// it runs once per session — not once per skill invocation. Outputs a warning if
// behind the latest release; silent if up to date or check unavailable.
//
// Result is cached at <cache-dir>/version.json with a 24h TTL so repeated
// sessions don't pay the cost of spawning gh + a network round-trip every time.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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
    if (Date.now() - data.checkedAt > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(latestVersion) {
  try {
    const p = cacheFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ checkedAt: Date.now(), latestVersion }) + '\n', 'utf8');
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

const cached = readCache();
let latestVersion = cached ? cached.latestVersion : null;

if (!cached) {
  latestVersion = fetchLatestVersion();
  if (latestVersion) writeCache(latestVersion);
}

if (latestVersion && latestVersion !== installedVersion) {
  console.log(`> [!WARNING]`);
  console.log(`> **Agent 365 Skills update available**: installed v${installedVersion}, latest v${latestVersion}.`);
  console.log(`> Update with: \`gh skill add microsoft/agent365-skills\``);
  console.log(`> Or re-run: \`node /path/to/agent365-skills/scripts/install.js\``);
}
