#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
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

// Determine the target project directory.
// When the script is invoked as `node install.js` from inside the scripts/
// directory of this repo (e.g. cd scripts && node install.js), process.cwd()
// equals __dirname and we would incorrectly install into scripts/. Detect that
// case and redirect to the repo root (parent of scripts/) instead.
const REPO_ROOT = path.resolve(__dirname, '..');
const _skillsSourceExists = fs.existsSync(path.join(REPO_ROOT, 'plugins', 'agent365', 'skills'));
const TARGET_DIR = (_skillsSourceExists && path.resolve(process.cwd()) === path.resolve(__dirname))
  ? REPO_ROOT
  : process.cwd();

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

function detectGhSkill() {
  // gh skill is the GitHub CLI Agent Skills extension
  return run('gh skill --version') !== null;
}

function detectVSCode() {
  // Avoid spawning `code --version` — on Windows it can open VS Code.
  // Instead check well-known install paths and environment markers.
  if (process.env.VSCODE_PID || process.env.TERM_PROGRAM === 'vscode') return true;
  const locations = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code'),
    '/usr/share/code',
    '/Applications/Visual Studio Code.app',
  ];
  return locations.some(p => fs.existsSync(p));
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

// ── GitHub Copilot / gh skill installation ───────────────────────────────────
// GitHub Copilot Chat (VS Code) and GitHub Copilot CLI (gh copilot) read
// .github/copilot-instructions.md from the workspace root automatically.
// Installing this file enables trigger-phrase-based skills for both surfaces.
//
// In addition, `gh skill add` installs skills from the repo's
// .github/plugin/marketplace.json, enabling /skills-style invocation
// in the GitHub Copilot CLI and cloud agent.

function installGhSkill() {
  header('GitHub Copilot — gh skill');
  const result = spawnSync(
    'gh', ['skill', 'add', MARKETPLACE_REPO],
    { encoding: 'utf8', stdio: 'pipe' }
  );
  if (result.status === 0) {
    ok(`Agent 365 skills installed via gh skill add ${MARKETPLACE_REPO}`);
    log('Use /skills list in gh copilot to see installed skills.');
  } else {
    warn('gh skill add failed — falling back to copilot-instructions.md method.');
    log('  ' + (result.stderr || '').trim());
    installCopilotInstructions();
  }
}

function installCopilotInstructions() {
  header('GitHub Copilot (Chat + CLI)');

  const srcInstructions = path.join(__dirname, '..', '.github', 'copilot-instructions.md');
  const destDir         = path.join(TARGET_DIR, '.github');
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

// ── Agent Skills open standard (.agents/skills/) ─────────────────────────────
// Copies each skill directory into .agents/skills/<skill-name>/ in the
// target project. This is the open agentskills.io standard location,
// recognised by VS Code agent mode, GitHub Copilot CLI, and cloud agent.
// Only SKILL.md and references/ are copied — Claude-specific hooks are excluded.

function installAgentsSkills() {
  header('Agent Skills — .agents/skills/ (open standard)');
  const skillsRoot = path.join(__dirname, '..', 'plugins', 'agent365', 'skills');
  if (!fs.existsSync(skillsRoot)) {
    warn('Skills source directory not found — skipping .agents/skills/ install');
    return;
  }

  const destRoot = path.join(TARGET_DIR, '.agents', 'skills');
  let installed = 0;
  let skipped   = 0;

  for (const skillName of fs.readdirSync(skillsRoot)) {
    const srcDir = path.join(skillsRoot, skillName);
    if (!fs.statSync(srcDir).isDirectory()) continue;

    const destDir   = path.join(destRoot, skillName);
    const destSkill = path.join(destDir, 'SKILL.md');

    if (fs.existsSync(destSkill)) {
      skipped++;
      continue;
    }

    fs.mkdirSync(destDir, { recursive: true });

    // Copy SKILL.md
    const srcSkill = path.join(srcDir, 'SKILL.md');
    if (fs.existsSync(srcSkill)) fs.copyFileSync(srcSkill, destSkill);

    // Copy references/ if present
    const srcRefs = path.join(srcDir, 'references');
    if (fs.existsSync(srcRefs)) {
      const destRefs = path.join(destDir, 'references');
      fs.mkdirSync(destRefs, { recursive: true });
      for (const f of fs.readdirSync(srcRefs)) {
        fs.copyFileSync(path.join(srcRefs, f), path.join(destRefs, f));
      }
    }

    installed++;
  }

  if (installed > 0) {
    ok(`Installed ${installed} skill(s) to .agents/skills/`);
    log('These skills are available in VS Code agent mode, Copilot CLI, and cloud agent.');
    log('Add .agents/skills/ to .gitignore if you do not want to commit them.');
  }
  if (skipped > 0) log(`${skipped} skill(s) already present — skipped.`);

  // VS Code Copilot Chat only scans .github/skills/ and .claude/skills/ by default.
  // Write chat.agentSkillsLocations to .vscode/settings.json so it also scans .agents/skills/.
  // The setting requires an object { "path": true } format — arrays are silently ignored.
  writeVSCodeSkillsLocation('.agents/skills');
}

function writeVSCodeSkillsLocation(relPath) {
  const settingsDir  = path.join(TARGET_DIR, '.vscode');
  const settingsFile = path.join(settingsDir, 'settings.json');
  const key = 'chat.agentSkillsLocations';

  let settings = readJson(settingsFile) || {};
  if (typeof settings[key] !== 'object' || Array.isArray(settings[key])) {
    settings[key] = {};
  }
  if (settings[key][relPath] === true) {
    log('chat.agentSkillsLocations already set — skipping');
    return;
  }
  settings[key][relPath] = true;
  writeJson(settingsFile, settings);
  ok(`Updated .vscode/settings.json — chat.agentSkillsLocations includes "${relPath}"`);
  log('Reload VS Code (Ctrl+Shift+P → Developer: Reload Window) for skills to appear.');
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

const hasClaude   = detectClaude();
const hasCopilot  = detectCopilot();
const hasVSCode   = detectVSCode();
const hasGhSkill  = detectGhSkill();

if (!hasClaude && !hasVSCode && !hasCopilot && !hasGhSkill) {
  warn('Neither Claude Code, VS Code, gh copilot, nor gh skill detected.');
  showManualInstructions();
} else {
  if (hasClaude) installClaudeCode();
  if (hasGhSkill) installGhSkill();
  else installCopilotInstructions(); // covers VS Code, gh copilot, and unknown hosts
}

// Always install to .agents/skills/ — works for VS Code agent mode, Copilot CLI, and cloud agent
installAgentsSkills();

checkA365();

header('Done');
console.log('\n  Skills installed! Try these trigger phrases:\n');
console.log('    💡 "Make this agent an AI Teammate"');
console.log('    💡 "Run a365 setup for this agent"');
console.log('    💡 "Registration setup for this agent"');
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
