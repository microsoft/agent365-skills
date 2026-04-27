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

// ── Check 2: Generated config exists (created by a365 setup all) ─────────────
const genConfigPath = path.join(cwd, 'a365.generated.config.json');
if (!fileExists(genConfigPath)) {
  issues.push('a365.generated.config.json not found — a365 setup all may not have completed');
} else {
  try {
    const genConfig = JSON.parse(fs.readFileSync(genConfigPath, 'utf8'));
    if (!genConfig.agentBlueprintId || genConfig.agentBlueprintId === '') {
      issues.push('agentBlueprintId is empty in a365.generated.config.json — Blueprint creation may have failed');
    }
  } catch {
    issues.push('Could not parse a365.generated.config.json — file may be malformed');
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
