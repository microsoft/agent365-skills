#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-setup.js
 *
 * Stop hook validator for the a365-setup skill.
 * a365-setup is responsible for Steps 1-2 only (CLI + Azure prereqs), then
 * delegates to make-ai-teammate or make-a365-agent. Those skills have their
 * own validators that check their respective artifacts (a365.config.json,
 * a365.generated.config.json, Blueprint ID, etc.).
 *
 * This validator checks only what a365-setup itself is responsible for:
 *   - a365 CLI is installed and on PATH
 *   - If a365.generated.config.json happens to exist (delegated skill ran),
 *     validate it has a non-empty agentBlueprintId (non-blocking warning if missing)
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
const a365Version = process.env.VALIDATE_SKIP_EXEC ? 'skipped' : runCmd('a365 --version');
if (!a365Version) {
  issues.push('a365 CLI is not installed — run: dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease');
}

// ── Check 2: If generated config exists, verify Blueprint ID is present ─────
// (Non-blocking — a365-setup delegates setup to make-ai-teammate or make-a365-agent.
//  The generated config is created by those skills, not by a365-setup itself.
//  Only fail if the file exists but appears malformed or missing the Blueprint ID.)
const genConfigPath = path.join(cwd, 'a365.generated.config.json');
if (fileExists(genConfigPath)) {
  try {
    const genConfig = JSON.parse(fs.readFileSync(genConfigPath, 'utf8'));
    if (!genConfig.agentBlueprintId || genConfig.agentBlueprintId === '') {
      issues.push('a365.generated.config.json exists but agentBlueprintId is empty — Blueprint creation may have failed');
    }
  } catch {
    issues.push('a365.generated.config.json exists but cannot be parsed — file may be malformed');
  }
}

// ── Check 3: .gitignore excludes generated config (non-blocking warning) ────
const gitignorePath = path.join(cwd, '.gitignore');
if (fileExists(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignore.includes('a365.generated.config.json')) {
    console.warn('[validate-setup] Warning: a365.generated.config.json is not in .gitignore');
  }
}

// ── Check 4: .a365-workspace-detection.json has authMode ────────────────────
// authMode must be collected in Phase 1B and written to the cache so downstream
// skills (instrument-observability, add-workiq-tools) can skip re-asking.
const detectionPath = path.join(cwd, '.a365-workspace-detection.json');
if (fileExists(detectionPath)) {
  try {
    const detection = JSON.parse(fs.readFileSync(detectionPath, 'utf8'));
    if (!detection.authMode || detection.authMode === '') {
      issues.push('.a365-workspace-detection.json exists but authMode is empty — collect authMode from the user (OBO/S2S/Both) and write it to the detection cache');
    }
  } catch {
    issues.push('.a365-workspace-detection.json exists but cannot be parsed — file may be malformed');
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
