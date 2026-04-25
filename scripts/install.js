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

  // Register marketplace
  log('Registering marketplace...');
  const addResult = run(`claude /plugin marketplace add ${MARKETPLACE_REPO}`);
  if (addResult !== null) {
    ok(`Marketplace registered: ${MARKETPLACE_REPO}`);
  } else {
    warn('Could not register marketplace via CLI — patching config directly');
    enableAutoUpdateClaude();
  }

  // Install plugin from official marketplace
  log(`Installing plugin: ${PLUGIN_NAME}...`);
  const installResult = run(`claude /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  if (installResult !== null) {
    ok(`Plugin installed: ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  } else {
    warn('Could not install via CLI — try manually:');
    log(`  /plugin marketplace add ${MARKETPLACE_REPO}`);
    log(`  /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  }

  // Patch auto-update
  enableAutoUpdateClaude();
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

// ── GitHub Copilot Chat (VS Code) installation ───────────────────────────────
// gh copilot CLI is a command-suggestion tool and has no plugin system.
// The integration point for Copilot Chat is .github/copilot-instructions.md,
// which VS Code Copilot Chat automatically picks up from the workspace root.

function installCopilotChat() {
  header('GitHub Copilot Chat (VS Code)');

  const srcInstructions = path.join(__dirname, '..', '.github', 'copilot-instructions.md');
  const destDir         = path.join(process.cwd(), '.github');
  const destFile        = path.join(destDir, 'copilot-instructions.md');

  if (!fs.existsSync(srcInstructions)) {
    warn('copilot-instructions.md not found in this installation — skipping Copilot Chat setup');
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
    ok('Created .github/copilot-instructions.md — Copilot Chat will use these skill instructions');
  }

  log('Copilot Chat will trigger skills when you type phrases like:');
  log('  "Instrument observability for this agent"');
  log('  "Run a365 setup"');
}

function showCopilotCLINote() {
  header('GitHub Copilot CLI (gh copilot)');
  log('gh copilot is a command-suggestion tool and does not support plugins.');
  log('Use GitHub Copilot Chat in VS Code for full skill support.');
  log('Or use Claude Code:');
  log(`  claude --plugin-dir /path/to/agent365-skills/plugins/agent365`);
}

// ── Manual fallback ──────────────────────────────────────────────────────────

function showManualInstructions() {
  header('Manual Installation');
  log('Claude Code:\n');
  log(`  /plugin marketplace add ${MARKETPLACE_REPO}`);
  log(`  /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  log('');
  log('Or launch Claude Code with the plugin directory directly:');
  log(`  claude --plugin-dir /path/to/agent365-skills/plugins/agent365`);
  log('');
  log('GitHub Copilot:\n');
  log(`  copilot plugin marketplace add ${MARKETPLACE_REPO}`);
  log(`  copilot plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`);
  log('');
  log('Or install from a local clone:');
  log(`  copilot plugin install /path/to/agent365-skills/plugins/agent365`);
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

if (!hasClaude && !hasVSCode) {
  warn('Neither Claude Code nor VS Code detected.');
  showManualInstructions();
} else {
  if (hasClaude)  installClaudeCode();
  if (hasVSCode)  installCopilotChat();
  if (hasCopilot) showCopilotCLINote();
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
