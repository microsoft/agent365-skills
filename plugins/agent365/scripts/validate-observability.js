#!/usr/bin/env node
/**
 * validate-observability.js
 *
 * Stop hook validator for the instrument-observability skill.
 * Called by the skill's stop hook before the session ends.
 * Checks that observability instrumentation was actually applied.
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
      // Skip hidden *directories* (e.g. .git, .vs) but NOT hidden files (e.g. .env, .env.example)
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
const envFiles    = findFiles(cwd, ['.env', '.env.example', '.env.production']);
const jsonFiles   = findFiles(cwd, ['.json']).filter(f =>
  f.endsWith('appsettings.json') || f.endsWith('appsettings.Production.json') || f.endsWith('package.json'));

const isDotnet   = csprojFiles.length > 0;
const isNodejs   = tsFiles.some(f => f.endsWith('index.ts') || f.endsWith('index.js'));
const isUnknown  = !isDotnet && !isNodejs;

if (isUnknown) {
  // No agent project detected — nothing to validate
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}

// ── .NET validation ─────────────────────────────────────────────────────────

if (isDotnet) {
  // 1. Package installed
  const hasObservabilityPkg = csprojFiles.some(f =>
    fileContains(f, 'Microsoft.Agents.A365.Observability'));
  if (!hasObservabilityPkg) {
    issues.push('Microsoft.Agents.A365.Observability package is not referenced in any .csproj');
  }

  // 2. Program.cs wired
  const programFiles = findFiles(cwd, ['Program.cs']);
  const hasProgramWired = anyFileContains(programFiles,
    'AddA365Tracing', 'AddAgenticTracingExporter');
  if (!hasProgramWired) {
    issues.push('Program.cs does not call AddA365Tracing() or AddAgenticTracingExporter()');
  }

  // 3. BaggageBuilder in agent class
  const csFiles = findFiles(cwd, ['.cs']).filter(f =>
    !f.includes('obj') && !f.includes('bin'));
  const hasBaggage = anyFileContains(csFiles, 'BaggageBuilder');
  if (!hasBaggage) {
    issues.push('No .cs file contains BaggageBuilder — baggage context is missing from message handler');
  }

  // 4. appsettings has observability config
  const appSettingsFiles = findFiles(cwd, ['appsettings.json']);
  const hasAppSettingsConfig = anyFileContains(appSettingsFiles,
    'EnableAgent365Exporter', 'Agent365Observability');
  if (!hasAppSettingsConfig) {
    issues.push('appsettings.json does not contain A365 observability config (EnableAgent365Exporter)');
  }

  // 5. Logging config present — required for logs to appear in Microsoft Defender
  const hasLoggingConfig = appSettingsFiles.some(f =>
    fileContains(f, 'Microsoft.Agents.A365.Observability') && fileContains(f, 'OpenTelemetry'));
  if (!hasLoggingConfig) {
    issues.push('appsettings.json is missing Logging.LogLevel entries for Microsoft.Agents.A365.Observability and OpenTelemetry — logs will not appear in Microsoft Defender');
  }
}

// ── Node.js validation ──────────────────────────────────────────────────────

if (isNodejs) {
  // 1. Package installed
  const packageJsonFiles = findFiles(cwd, ['package.json']).filter(f =>
    !f.includes('node_modules'));
  const hasNpmPkg = packageJsonFiles.some(f =>
    fileContains(f, '@microsoft/agents-a365-observability'));
  if (!hasNpmPkg) {
    issues.push('@microsoft/agents-a365-observability is not in package.json');
  }

  // 2. ObservabilityManager.configure called
  const hasObsManager = anyFileContains(tsFiles, 'ObservabilityManager');
  if (!hasObsManager) {
    issues.push('No TypeScript/JS file calls ObservabilityManager.configure()');
  }

  // 3. BaggageBuilder in handler
  const hasBaggage = anyFileContains(tsFiles, 'BaggageBuilder');
  if (!hasBaggage) {
    issues.push('No TypeScript/JS file uses BaggageBuilder — baggage context missing from message handler');
  }

  // 4. .env has observability vars
  const hasEnvConfig = envFiles.some(f =>
    fileContains(f, 'ENABLE_A365_OBSERVABILITY_EXPORTER'));
  if (!hasEnvConfig) {
    issues.push('.env / .env.example does not contain ENABLE_A365_OBSERVABILITY_EXPORTER');
  }
}

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({
    ok: false,
    reason: issues.join('; ')
  }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
