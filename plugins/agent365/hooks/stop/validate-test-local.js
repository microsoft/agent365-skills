#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-test-local.js
 *
 * Stop hook validator for the test-local skill.
 * Checks agentsplayground is installed and the agent project can build.
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
 */

const { execSync } = require('child_process');
const { scanProject, filterByName } = require('../lib/project-scan');

// In unit tests we set VALIDATE_SKIP_EXEC=1 to bypass the tool-presence
// checks — otherwise test results depend on what happens to be installed on
// the dev machine. When the flag is set, every `run()` call returns a sentinel
// string so the validator treats every external tool as available.
function run(cmd) {
  if (process.env.VALIDATE_SKIP_EXEC) return 'skipped';
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

const cwd = process.cwd();
const issues = [];

// ── Detect project type ─────────────────────────────────────────────────────

const allFiles    = scanProject(cwd);
const csprojFiles = filterByName(allFiles, '.csproj');
const tsFiles     = filterByName(allFiles, '.ts', '.js');
const pkgJsonFiles = filterByName(allFiles, 'package.json');
const pyFiles     = filterByName(allFiles, '.py');
const reqFiles    = filterByName(allFiles, 'requirements.txt', 'pyproject.toml');

const isDotnet  = csprojFiles.length > 0;
const isNodejs  = !isDotnet && pkgJsonFiles.length > 0 && tsFiles.length > 0;
const isPython  = !isDotnet && !isNodejs && (pyFiles.length > 0 || reqFiles.length > 0);
const isUnknown = !isDotnet && !isNodejs && !isPython;

// Unknown project — pass through, skill handles detection interactively
if (isUnknown) {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}

// ── Check agentsplayground is installed ─────────────────────────────────────

const playgroundVersion = run('agentsplayground --version');
if (!playgroundVersion) {
  issues.push(
    'agentsplayground CLI not found. Install with: npm install -g @microsoft/agentsplayground'
  );
  // npm is required to install agentsplayground regardless of agent stack
  const npmVersion = run('npm --version');
  if (!npmVersion) {
    issues.push('npm not found — Node.js/npm is required to install agentsplayground for all stacks. Install from https://nodejs.org');
  }
}

// ── Check build tools are available ─────────────────────────────────────────
// The skill handles missing build tools interactively (Phase 1.3).
// Validator only blocks if the tool is still missing after the skill ran.

if (isDotnet) {
  const dotnetVersion = run('dotnet --version');
  if (!dotnetVersion) {
    issues.push('.NET SDK not found — Phase 1.3 should have installed it. Run: winget install Microsoft.DotNet.SDK.8 (Windows) or brew install dotnet (macOS), restart your terminal, then re-run the skill.');
  }
}

if (isNodejs) {
  const nodeVersion = run('node --version');
  if (!nodeVersion) {
    issues.push('Node.js not found — Phase 1.3 should have installed it. Run: winget install OpenJS.NodeJS.LTS (Windows) or brew install node (macOS), restart your terminal, then re-run the skill.');
  }
}

if (isPython) {
  const pythonVersion = run('python --version') || run('python3 --version');
  if (!pythonVersion) {
    issues.push('Python not found — Phase 1.3 should have installed it. Run: winget install Python.Python.3.11 (Windows) or brew install python@3.11 (macOS), restart your terminal, then re-run the skill.');
  }
}

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, reason: issues.join('; ') }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
