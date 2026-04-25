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
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj' ||
          entry.name === '__pycache__' || entry.name === '.venv' || entry.name === 'venv') continue;
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

const csprojFiles   = findFiles(cwd, ['.csproj']);
const tsFiles       = findFiles(cwd, ['.ts', '.js']).filter(f => !f.includes('node_modules'));
const pyFiles       = findFiles(cwd, ['.py']).filter(f =>
  !f.includes('__pycache__') && !f.includes('.venv') && !f.includes('/venv/'));
const envFiles      = findFiles(cwd, ['.env', '.env.example', '.env.production', '.env.local']);
const reqFiles      = findFiles(cwd, ['requirements.txt', 'pyproject.toml']);

const packageJsonFiles = findFiles(cwd, ['package.json']).filter(f =>
  !f.includes('node_modules'));

const isDotnet   = csprojFiles.length > 0;
// Node.js: any project with a package.json + .ts/.js source files
const isNodejs   = !isDotnet && packageJsonFiles.length > 0 && tsFiles.length > 0;
const isPython   = !isDotnet && !isNodejs && (
  pyFiles.length > 0 ||
  reqFiles.some(f => f.endsWith('requirements.txt') || f.endsWith('pyproject.toml'))
);
const isUnknown  = !isDotnet && !isNodejs && !isPython;

if (isUnknown) {
  // No agent project detected — nothing to validate
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}

// ── .NET validation ─────────────────────────────────────────────────────────

if (isDotnet) {
  // 1. Package installed (Runtime is the required core package)
  const hasObservabilityPkg = csprojFiles.some(f =>
    fileContains(f, 'Microsoft.Agents.A365.Observability.Runtime'));
  if (!hasObservabilityPkg) {
    issues.push('Microsoft.Agents.A365.Observability.Runtime package is not referenced in any .csproj');
  }

  // 2. Program.cs wired
  // OBO path (user-delegated / agentic-identity): AddA365Tracing + AddAgenticTracingExporter
  // S2S path: AddA365Tracing + AddAgent365Observability (via scaffold files)
  const programFiles = findFiles(cwd, ['Program.cs']);
  const hasOBOWired = anyFileContains(programFiles, 'AddA365Tracing', 'AddAgenticTracingExporter');
  const hasS2SWired = anyFileContains(programFiles, 'AddA365Tracing', 'AddAgent365Observability');
  const hasProgramWired = hasOBOWired || hasS2SWired;
  if (!hasProgramWired) {
    issues.push('Program.cs does not call AddA365Tracing() with AddAgenticTracingExporter() (OBO path) or AddAgent365Observability() (S2S path)');
  }

  // 3. Observability context wired in agent code
  // OBO path: BaggageBuilder or BaggageTurnMiddleware
  // S2S path: ObservabilityTokenService scaffold + Agent365ObservabilityContext injection
  const csFiles = findFiles(cwd, ['.cs']).filter(f =>
    !f.includes('obj') && !f.includes('bin'));
  const hasS2SScaffold = anyFileContains(csFiles, 'ObservabilityTokenService') ||
                         anyFileContains(csFiles, 'Agent365ObservabilityContext');
  const hasBaggage = anyFileContains(csFiles, 'BaggageBuilder') ||
                     anyFileContains([...programFiles, ...csFiles], 'BaggageTurnMiddleware') ||
                     hasS2SScaffold;
  if (!hasBaggage) {
    issues.push('No .cs file uses BaggageBuilder, BaggageTurnMiddleware (OBO), or ObservabilityTokenService/Agent365ObservabilityContext (S2S) — observability context is missing');
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
  // 1. Core package installed
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

  // 3. BaggageBuilder or BaggageMiddleware in handler
  const hasBaggage = anyFileContains(tsFiles, 'BaggageBuilder') ||
                     anyFileContains(tsFiles, 'BaggageMiddleware');
  if (!hasBaggage) {
    issues.push('No TypeScript/JS file uses BaggageBuilder or BaggageMiddleware — baggage context missing');
  }

  // 4. Token caching wired (AgenticTokenCacheInstance or custom resolver)
  const hasTokenCache = anyFileContains(tsFiles, 'AgenticTokenCacheInstance') ||
                        anyFileContains(tsFiles, 'RefreshObservabilityToken') ||
                        anyFileContains(tsFiles, 'withTokenResolver');
  if (!hasTokenCache) {
    issues.push('No TypeScript/JS file wires a token resolver — observability exports will fail');
  }

  // 5. .env has observability vars
  const hasEnvConfig = envFiles.some(f =>
    fileContains(f, 'ENABLE_A365_OBSERVABILITY_EXPORTER'));
  if (!hasEnvConfig) {
    issues.push('.env / .env.example does not contain ENABLE_A365_OBSERVABILITY_EXPORTER');
  }
}

// ── Python validation ───────────────────────────────────────────────────────

if (isPython) {
  // 1. Core package installed
  const hasPyPkg = reqFiles.some(f =>
    fileContains(f, 'microsoft-agents-a365-observability-core') ||
    fileContains(f, 'microsoft-agents-a365-observability-hosting') ||
    fileContains(f, 'microsoft-agents-a365-observability'));
  if (!hasPyPkg) {
    issues.push('microsoft-agents-a365-observability-core is not in requirements.txt or pyproject.toml');
  }

  // 2. configure() called in a Python file
  const hasConfigure = anyFileContains(pyFiles, 'from microsoft_agents_a365.observability.core import') &&
                       anyFileContains(pyFiles, 'configure(');
  if (!hasConfigure) {
    issues.push('No Python file calls configure() from microsoft_agents_a365.observability.core');
  }

  // 3. BaggageBuilder or BaggageMiddleware used
  const hasBaggage = anyFileContains(pyFiles, 'BaggageBuilder') ||
                     anyFileContains(pyFiles, 'BaggageMiddleware') ||
                     anyFileContains(pyFiles, 'populate_baggage');
  if (!hasBaggage) {
    issues.push('No Python file uses BaggageBuilder, BaggageMiddleware, or populate_baggage — baggage context missing');
  }

  // 4. Token cache wired (AgenticTokenCache or manual token_resolver)
  const hasTokenCache = anyFileContains(pyFiles, 'AgenticTokenCache') ||
                        anyFileContains(pyFiles, 'token_resolver') ||
                        anyFileContains(pyFiles, 'get_observability_authentication_scope');
  if (!hasTokenCache) {
    issues.push('No Python file wires a token resolver — observability exports will fail');
  }

  // 5. .env has observability vars
  const hasEnvConfig = envFiles.some(f =>
    fileContains(f, 'ENABLE_A365_OBSERVABILITY_EXPORTER'));
  if (!hasEnvConfig) {
    issues.push('.env does not contain ENABLE_A365_OBSERVABILITY_EXPORTER');
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
