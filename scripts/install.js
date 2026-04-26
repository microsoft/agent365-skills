#!/usr/bin/env node
/**
 * install.js — Agent 365 Skills Installer
 *
 * Detects Claude Code and/or GitHub Copilot CLI and registers the
 * agent365-skills marketplace + plugin with auto-update enabled.
 *
 * Usage:
 *   node install.js
 *
 * Or one-liner:
 *   # Windows (PowerShell)
 *   iwr https://raw.githubusercontent.com/microsoft/agent365-skills/main/scripts/install.js -OutFile install.js; node install.js; del install.js
 *
 *   # macOS/Linux
 *   curl -fsSL https://raw.githubusercontent.com/microsoft/agent365-skills/main/scripts/install.js | node
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const MARKETPLACE_NAME = 'agent365-skills';
const MARKETPLACE_REPO = 'microsoft/agent365-skills';
const PLUGIN_NAME      = 'agent365';

// ── Utility helpers ──────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }
function header(msg) { console.log(`\n── ${msg} ${'─'.repeat(Math.max(0, 50 - msg.length))}`); }

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Tool detection ───────────────────────────────────────────────────────────

function detectClaude() {
  return run('claude --version') !== null;
}

function detectCopilot() {
  // gh copilot is the GitHub CLI Copilot extension
  return run('gh copilot --version') !== null;
}

function detectVSCode() {
  return run('code --version') !== null;
}

function detectA365() {
  return run('a365 --version') !== null;
}

// ── Claude Code installation ─────────────────────────────────────────────────

function installClaudeCode() {
  header('Claude Code');

  // /plugin commands are slash commands inside an active Claude Code session,
  // not CLI arguments. Patch the marketplace config for auto-update directly.
  enableAutoUpdateClaude();

  log('To complete installation, run these inside a Claude Code session:');
  log(`  /plugin marketplace add ${MARKETPLACE_REPO}`);
  log(`  /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
}

function enableAutoUpdateClaude() {
  const knownMarketplacesPath = path.join(
    os.homedir(), '.claude', 'plugins', 'known_marketplaces.json'
  );
  const data = readJson(knownMarketplacesPath) || {};
  if (!data[MARKETPLACE_NAME]) data[MARKETPLACE_NAME] = {};
  data[MARKETPLACE_NAME].autoUpdate = true;
  writeJson(knownMarketplacesPath, data);
  ok('Auto-update enabled for Claude Code');
}

// ── GitHub Copilot installation (Chat + CLI) ─────────────────────────────────
// Both GitHub Copilot Chat (VS Code) and GitHub Copilot CLI (gh copilot) read
// .github/copilot-instructions.md from the workspace root automatically.
// Installing this file enables skills for both surfaces.

function installCopilotInstructions() {
  header('GitHub Copilot (Chat + CLI)');

  const srcInstructions = path.join(__dirname, '..', '.github', 'copilot-instructions.md');
  const destDir         = path.join(process.cwd(), '.github');
  const destFile        = path.join(destDir, 'copilot-instructions.md');

  if (!fs.existsSync(srcInstructions)) {
    warn('copilot-instructions.md not found in this installation — skipping Copilot setup');
    return;
  }

  // If the user already has copilot-instructions.md, append rather than overwrite
  if (fs.existsSync(destFile)) {
    const existing = fs.readFileSync(destFile, 'utf8');
    if (existing.includes('Agent 365 Skills')) {
      ok('copilot-instructions.md already contains Agent 365 Skills — skipping');
      return;
    }
    const a365Block = '\n\n' + fs.readFileSync(srcInstructions, 'utf8');
    fs.appendFileSync(destFile, a365Block, 'utf8');
    ok('Agent 365 Skills appended to existing .github/copilot-instructions.md');
  } else {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcInstructions, destFile);
    ok('Created .github/copilot-instructions.md — Copilot Chat and gh copilot CLI will use these skill instructions');
  }

  log('Skills trigger when you type phrases like:');
  log('  Copilot Chat: "Make this agent an AI Teammate"');
  log('  gh copilot:   gh copilot suggest "Instrument observability for this agent"');
}

// ── Manual fallback ──────────────────────────────────────────────────────────

function showManualInstructions() {
  header('Manual Installation');
  log('Claude Code (run inside a Claude Code session):\n');
  log(`  /plugin marketplace add ${MARKETPLACE_REPO}`);
  log(`  /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  log('');
  log('Or launch Claude Code with the plugin directory directly:');
  log(`  claude --plugin-dir /path/to/agent365-skills/plugins/agent365`);
}

// ── Prerequisites ────────────────────────────────────────────────────────────

function checkA365() {
  header('A365 CLI');
  if (detectA365()) {
    const ver = run('a365 --version');
    ok(`a365 CLI found: ${ver}`);
  } else {
    warn('a365 CLI not found. Install with:');
    log('  dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease');
    log('  (requires .NET 8.0 or later)');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('\n🤖 Agent 365 Skills Installer');
console.log('━'.repeat(50));

const hasNode = run('node --version') !== null;
if (!hasNode) {
  err('Node.js is required. Install from https://nodejs.org');
  process.exit(1);
}

const hasClaude  = detectClaude();
const hasCopilot = detectCopilot();
const hasVSCode  = detectVSCode();

if (!hasClaude && !hasVSCode && !hasCopilot) {
  warn('Neither Claude Code, VS Code, nor gh copilot detected.');
  showManualInstructions();
} else {
  if (hasClaude)              installClaudeCode();
  if (hasVSCode || hasCopilot) installCopilotInstructions();
}

checkA365();

header('Done');
console.log('\n  Skills installed! Try these trigger phrases:\n');
console.log('    💡 "Make this agent an AI Teammate"');
console.log('    💡 "Run a365 setup for this agent"');
console.log('    💡 "Discoverability setup for this agent"');
console.log('    💡 "Add workiq tools to this agent"');
console.log('    💡 "Instrument observability for this agent"');
console.log('    💡 "Add A365 observability to this Python agent"');
console.log('    💡 "Test this agent locally"\n');
console.log('  Or invoke directly:');
console.log(`    /agent365:make-ai-teammate`);
console.log(`    /agent365:a365-setup`);
console.log(`    /agent365:make-a365-agent`);
console.log(`    /agent365:add-workiq-tools`);
console.log(`    /agent365:instrument-observability`);
console.log(`    /agent365:test-local\n`);
