#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-make-a365-agent.js
 *
 * Stop hook validator for the make-a365-agent skill.
 * Checks that a365 setup all completed successfully — the primary artifact
 * is a365.generated.config.json with a valid agentBlueprintId.
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
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

// ── Check 1.5: Read detection cache for reuseBlueprint flag ──────────────────
// When reuseBlueprint=true, the skill intentionally skips a365 setup all.
// In that case, a365.config.json (the existing input config) satisfies the check.
const detectionPath = path.join(cwd, '.a365-workspace-detection.json');
let reuseBlueprint = false;
let existingBlueprintId = '';
if (fileExists(detectionPath)) {
  try {
    const detection = JSON.parse(fs.readFileSync(detectionPath, 'utf8'));
    reuseBlueprint = detection.reuseBlueprint === true || detection.reuseBlueprint === 'true';
    existingBlueprintId = detection.existingBlueprintId || '';
  } catch { /* ignore — detection cache is optional */ }
}

// ── Check 2: Blueprint config exists ─────────────────────────────────────────
const genConfigPath = path.join(cwd, 'a365.generated.config.json');
const configPath    = path.join(cwd, 'a365.config.json');
const blueprintConfigPath = fileExists(genConfigPath) ? genConfigPath
  : (reuseBlueprint && fileExists(configPath))        ? configPath
  : null;

if (!blueprintConfigPath) {
  const msg = reuseBlueprint
    ? 'reuseBlueprint=true but neither a365.generated.config.json nor a365.config.json was found — existing blueprint config is missing'
    : 'a365.generated.config.json not found — a365 setup all may not have completed';
  issues.push(msg);
} else {
  try {
    const blueprintConfig = JSON.parse(fs.readFileSync(blueprintConfigPath, 'utf8'));
    const hasId = (blueprintConfig.agentBlueprintId && blueprintConfig.agentBlueprintId !== '')
                || (reuseBlueprint && existingBlueprintId !== '');
    if (!hasId) {
      issues.push('agentBlueprintId is empty in ' + path.basename(blueprintConfigPath) + ' — Blueprint creation may have failed');
    }
  } catch {
    issues.push('Could not parse ' + path.basename(blueprintConfigPath) + ' — file may be malformed');
  }
}

// ── Check 3: .gitignore excludes generated config (non-blocking warning) ────
const gitignorePath = path.join(cwd, '.gitignore');
if (fileExists(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignore.includes('a365.generated.config.json')) {
    console.warn('[validate-make-a365-agent] Warning: a365.generated.config.json is not in .gitignore');
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
