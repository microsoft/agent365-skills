#!/usr/bin/env node
/**
 * validate-setup.js
 *
 * Stop hook validator for the a365-setup skill.
 * Checks that blueprint setup and publish completed successfully.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const issues = [];
const cwd = process.cwd();

function fileExists(filePath) {
  try { fs.accessSync(filePath); return true; } catch { return false; }
}

function runCmd(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 8000 }); } catch { return ''; }
}

// ── Check 1: a365 CLI is installed ──────────────────────────────────────────
const a365Version = runCmd('a365 --version');
if (!a365Version) {
  issues.push('a365 CLI is not installed — run: dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease');
}

// ── Check 2: Config files exist ─────────────────────────────────────────────
const configExists    = fileExists(path.join(cwd, 'a365.config.json'));
const genConfigExists = fileExists(path.join(cwd, 'a365.generated.config.json'));

if (!configExists) {
  issues.push('a365.config.json not found — run a365 config init first');
}

if (!genConfigExists && configExists) {
  // generated config is created by setup all — may not exist if setup wasn't run
  issues.push('a365.generated.config.json not found — a365 setup all may not have completed');
}

// ── Check 3: Blueprint ID present in generated config ───────────────────────
if (genConfigExists) {
  try {
    const genConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'a365.generated.config.json'), 'utf8'));
    if (!genConfig.agentBlueprintId || genConfig.agentBlueprintId === '') {
      issues.push('agentBlueprintId is empty in a365.generated.config.json — blueprint creation may have failed');
    }
  } catch {
    issues.push('Could not parse a365.generated.config.json — file may be malformed');
  }
}

// ── Check 4: Blueprint ID is shown in output ─────────────────────────────────
// Note: a365-setup skill does NOT run publish — manifest.zip is not expected here.
// Blueprint creation is confirmed by a365.generated.config.json (checked above).

// ── Check 5: .gitignore excludes generated config ───────────────────────────
const gitignorePath = path.join(cwd, '.gitignore');
if (fileExists(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignore.includes('a365.generated.config.json')) {
    // Not a blocking error — just note it
    console.warn('[validate-setup] Warning: a365.generated.config.json is not in .gitignore');
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, reason: issues.join('; ') }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
