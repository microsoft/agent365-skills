#!/usr/bin/env node
/**
 * validate-add-cli.js
 *
 * Stop hook validator for the add-cli skill.
 * Checks that a CLI entry point was scaffolded and a run script was added.
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
 */

const fs = require('fs');
const path = require('path');

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

function anyFileContains(files, ...patterns) {
  return files.some(f => fileContains(f, ...patterns));
}

const cwd = process.cwd();
const issues = [];

// ── Detect project type ─────────────────────────────────────────────────────

const csprojFiles = findFiles(cwd, ['.csproj']);
const tsFiles     = findFiles(cwd, ['.ts', '.js']).filter(f => !f.includes('node_modules'));
const jsonFiles   = findFiles(cwd, ['.json']).filter(f =>
  f.endsWith('package.json') && !f.includes('node_modules'));

const isDotnet  = csprojFiles.length > 0;
const isNodejs  = jsonFiles.some(f => fileContains(f, '@langchain') || fileContains(f, '"langchain"'));
const isUnknown = !isDotnet && !isNodejs;

if (isUnknown) {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}

// ── .NET validation ─────────────────────────────────────────────────────────

if (isDotnet) {
  // 1. CLI entry point file exists
  const csFiles = findFiles(cwd, ['.cs']).filter(f => !f.includes('obj') && !f.includes('bin'));
  const hasCliFile = csFiles.some(f =>
    path.basename(f) === 'ConsoleCli.cs' || path.basename(f) === 'CliRunner.cs');
  if (!hasCliFile) {
    issues.push('ConsoleCli.cs not found — CLI entry point was not scaffolded');
  }

  // 2. CLI mode check wired in Program.cs
  const programFiles = csFiles.filter(f => path.basename(f) === 'Program.cs');
  const hasCliMode = anyFileContains(programFiles, '--cli', 'RUN_MODE', 'ConsoleCli');
  if (!hasCliMode) {
    issues.push('Program.cs does not contain CLI mode check (--cli arg, RUN_MODE env var, or ConsoleCli reference)');
  }

  // 3. Launch profile or run docs added
  const launchFiles = findFiles(cwd, ['launchSettings.json']);
  const hasCliProfile = anyFileContains(launchFiles, '"cli"', 'CLI', '--cli');
  if (!hasCliProfile) {
    // Not a hard failure — developer may use dotnet run --cli directly
    console.warn('[validate-add-cli] Warning: No CLI launch profile found in launchSettings.json');
  }
}

// ── Node.js validation ──────────────────────────────────────────────────────

if (isNodejs) {
  // 1. CLI entry point file exists
  const hasCliFile = tsFiles.some(f =>
    path.basename(f) === 'cli.ts' || path.basename(f) === 'cli.js');
  if (!hasCliFile) {
    issues.push('src/cli.ts (or cli.js) not found — CLI entry point was not scaffolded');
  }

  // 2. CLI script in package.json
  const hasCliScript = jsonFiles.some(f => fileContains(f, '"cli"'));
  if (!hasCliScript) {
    issues.push('No "cli" script in package.json — run script was not added');
  }

  // 3. readline used in CLI file (no extra deps)
  const cliFiles = tsFiles.filter(f =>
    path.basename(f) === 'cli.ts' || path.basename(f) === 'cli.js');
  const hasReadline = anyFileContains(cliFiles, 'readline');
  if (cliFiles.length > 0 && !hasReadline) {
    issues.push('CLI file does not use readline — input loop may be missing');
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
