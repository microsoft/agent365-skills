#!/usr/bin/env node
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
const fs = require('fs');
const path = require('path');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function findFiles(dir, extensions, maxDepth = 5) {
  const results = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (extensions.some(e => entry.name === e || entry.name.endsWith(e))) results.push(full);
    }
  }
  walk(dir, 0);
  return results;
}

function fileContains(filePath, ...patterns) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return patterns.every(p => content.includes(p));
  } catch { return false; }
}

const cwd = process.cwd();
const issues = [];

// ── Detect project type ─────────────────────────────────────────────────────

const csprojFiles = findFiles(cwd, ['.csproj']);
const tsFiles     = findFiles(cwd, ['.ts', '.js']).filter(f => !f.includes('node_modules'));
const jsonFiles   = findFiles(cwd, ['.json']).filter(f =>
  f.endsWith('package.json') && !f.includes('node_modules'));
const pyFiles     = findFiles(cwd, ['.py']).filter(f =>
  !f.includes('__pycache__') && !f.includes('.venv') && !f.includes('/venv/'));
const reqFiles    = findFiles(cwd, ['requirements.txt', 'pyproject.toml']);

const isDotnet  = csprojFiles.length > 0;
const isNodejs  = !isDotnet && jsonFiles.length > 0 && tsFiles.length > 0;
const isPython  = !isDotnet && !isNodejs && (
  pyFiles.length > 0 ||
  reqFiles.some(f => f.endsWith('requirements.txt') || f.endsWith('pyproject.toml'))
);
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
}

// ── Check build tools are available ─────────────────────────────────────────

if (isDotnet) {
  const dotnetVersion = run('dotnet --version');
  if (!dotnetVersion) {
    issues.push('dotnet CLI not found. Install .NET 8.0+ from https://dotnet.microsoft.com/download');
  }
}

if (isNodejs) {
  const nodeVersion = run('node --version');
  if (!nodeVersion) {
    issues.push('node not found. Install Node.js 18+ from https://nodejs.org');
  }
}

if (isPython) {
  const pythonVersion = run('python --version') || run('python3 --version');
  if (!pythonVersion) {
    issues.push('python not found. Install Python 3.11+ from https://python.org');
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
