#!/usr/bin/env node
// scripts/check-version.js
// Checks if the installed plugin version is up to date.
//
// Invoked automatically at skill start via:
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"
//
// Outputs a warning if behind the latest release; silent if up to date or check unavailable.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pluginJson = path.join(__dirname, '..', 'plugins', 'agent365', '.claude-plugin', 'plugin.json');

let installedVersion;
try {
  installedVersion = JSON.parse(fs.readFileSync(pluginJson, 'utf8')).version;
} catch {
  process.exit(0); // can't read local version — skip silently
}

let latestVersion = null;
try {
  const raw = execSync(
    'gh release view --repo microsoft/agent365-skills --json tagName -q .tagName',
    { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
  ).toString().trim();
  latestVersion = raw.replace(/^v/, '');
} catch {
  // gh CLI unavailable, no auth, or no releases yet — skip silently
  process.exit(0);
}

if (latestVersion && latestVersion !== installedVersion) {
  console.log(`> [!WARNING]`);
  console.log(`> **Agent 365 Skills update available**: installed v${installedVersion}, latest v${latestVersion}.`);
  console.log(`> Update with: \`gh skill add microsoft/agent365-skills\``);
  console.log(`> Or re-run: \`node /path/to/agent365-skills/scripts/install.js\``);
}
// Up to date or check unavailable → exit 0, no output
