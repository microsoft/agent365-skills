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
  issues.push('a365 CLI is not installed — run: dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli');
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
    // Non-blocking signals that the GA handoff is still pending.
    // Per the docs, when setup runs as Agent ID Developer (not GA), `completed` may
    // stay false and `resourceConsents` may be empty until a GA completes the grants.
    if (genConfig.completed === false) {
      console.warn('[validate-a365-setup] Warning: a365.generated.config.json has completed=false — OAuth2 permission grants are still pending. A Global Administrator must run the PowerShell script printed in the setup summary (or grant admin consent via Entra portal).');
    }
    if (Array.isArray(genConfig.resourceConsents) && genConfig.resourceConsents.length === 0) {
      console.warn('[validate-a365-setup] Warning: a365.generated.config.json has empty resourceConsents — OAuth2 grants for Graph / Agent 365 Tools / Bot API / Observability are not yet recorded. Expected if a non-GA developer ran setup; ask a Global Administrator to complete the grants.');
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
    const VALID_AUTH_MODES = new Set(['obo', 's2s', 'agentic-user']);
    if (!detection.authMode || detection.authMode === '') {
      issues.push('.a365-workspace-detection.json exists but authMode is empty — collect authMode from the user (obo/s2s/agentic-user) and write it to the detection cache');
    } else if (!VALID_AUTH_MODES.has((detection.authMode || '').toLowerCase())) {
      issues.push(`.a365-workspace-detection.json has unsupported authMode "${detection.authMode}" — expected obo, s2s, or agentic-user (old values like "both", "user-delegated", "S2S" are no longer valid)`);
    }
    // If an existing blueprint was detected, reuseBlueprint must have been explicitly set
    // (true = reuse, false = fresh) — the skill must ask, never assume.
    if ((detection.hasBlueprintConfig === 1 || detection.hasBlueprintConfig === true) &&
        (detection.reuseBlueprint === undefined || detection.reuseBlueprint === null)) {
      issues.push('.a365-workspace-detection.json has hasBlueprintConfig=1 but reuseBlueprint is not set — the skill must ask the developer whether to reuse the existing blueprint or create fresh before delegating');
    }
    // New 8-row state-matrix flags (introduced alongside make-ai-teammate Phase 0C):
    // has_aiteammate_structure, has_obs, has_workiq are all primary stored flags.
    // hasAITeammateChanges is DERIVED inline (has_aiteammate_structure && has_obs) — not stored.
    // Warn if the legacy field is still being written (it indicates an out-of-date a365-setup).
    if (detection.hasAITeammateChanges !== undefined) {
      console.warn('[validate-a365-setup] Warning: .a365-workspace-detection.json contains the legacy "hasAITeammateChanges" field — this is now derived inline. Remove it from the cache writer in a365-setup Phase 1C.');
    }
    // runTarget validation: optional at first run; if present, must be "prod" or "local".
    if (detection.runTarget !== undefined && detection.runTarget !== '' && detection.runTarget !== null) {
      const VALID_RUN_TARGETS = new Set(['prod', 'local']);
      if (!VALID_RUN_TARGETS.has(String(detection.runTarget).toLowerCase())) {
        issues.push(`.a365-workspace-detection.json has unsupported runTarget "${detection.runTarget}" — expected "prod" or "local" (set in make-ai-teammate Phase 9.7.2)`);
      }
    }
    // runTargetHosting validation: optional; only meaningful when runTarget = "prod".
    // Valid values: "devtunnel", "cloud", or empty/absent.
    if (detection.runTargetHosting !== undefined && detection.runTargetHosting !== '' && detection.runTargetHosting !== null) {
      const VALID_HOSTING = new Set(['devtunnel', 'cloud']);
      if (!VALID_HOSTING.has(String(detection.runTargetHosting).toLowerCase())) {
        issues.push(`.a365-workspace-detection.json has unsupported runTargetHosting "${detection.runTargetHosting}" — expected "devtunnel" or "cloud" (set in make-ai-teammate Phase 9.7.2b)`);
      }
      // runTargetHosting only meaningful with runTarget = "prod". Warn if mismatched.
      if (detection.runTarget && String(detection.runTarget).toLowerCase() === 'local') {
        console.warn('[validate-a365-setup] Warning: runTargetHosting is set but runTarget is "local" — runTargetHosting only applies when runTarget = "prod". The value will be ignored.');
      }
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
