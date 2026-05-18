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
const a365Version = process.env.VALIDATE_SKIP_EXEC ? 'skipped' : runCmd('a365 --version');
if (!a365Version) {
  issues.push('a365 CLI is not installed — run: dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli');
}

// ── Check 1.5: Read detection cache for reuseBlueprint flag ──────────────────
// When reuseBlueprint=true, the skill intentionally skips a365 setup all.
// In that case, a365.config.json (the existing input config) satisfies the check.
const detectionPath = path.join(cwd, '.a365-workspace-detection.local.json');
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
    // a365.generated.config.json uses agentBlueprintId; a365.config.json uses blueprintId.
    // Accept either field, then fall back to existingBlueprintId from the detection cache.
    const hasId = !!(blueprintConfig.agentBlueprintId || blueprintConfig.blueprintId)
                || (reuseBlueprint && existingBlueprintId !== '');
    if (!hasId) {
      issues.push('Blueprint ID not found in ' + path.basename(blueprintConfigPath) + ' (checked agentBlueprintId and blueprintId) — Blueprint creation may have failed');
    }
    // Non-blocking signals that the GA handoff is still pending. Only apply to
    // a365.generated.config.json (a365.config.json doesn't carry these fields).
    if (path.basename(blueprintConfigPath) === 'a365.generated.config.json') {
      if (blueprintConfig.completed === false) {
        console.warn('[validate-make-a365-agent] Warning: a365.generated.config.json has completed=false — OAuth2 permission grants are still pending. A Global Administrator must complete the consent grants via the PowerShell script printed in the setup summary (or Entra portal admin consent).');
      }
      if (Array.isArray(blueprintConfig.resourceConsents) && blueprintConfig.resourceConsents.length === 0) {
        console.warn('[validate-make-a365-agent] Warning: a365.generated.config.json has empty resourceConsents — OAuth2 grants for Graph / Bot API / Observability are not yet recorded. Expected if a non-GA developer ran setup; ask a Global Administrator to complete the grants.');
      }
      if (!blueprintConfig.managedIdentityPrincipalId) {
        console.warn('[validate-make-a365-agent] Warning: a365.generated.config.json is missing managedIdentityPrincipalId — the Web App managed identity may not be enabled. Run "az webapp identity show --name <web-app> --resource-group <rg>" to verify and "az webapp identity assign ..." to enable. Observability instrumentation depends on this.');
      }
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
