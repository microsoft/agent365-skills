#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
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
const { execSync } = require('child_process');

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

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function anyFileContains(files, ...patterns) {
  return files.some(f => fileContains(f, ...patterns));
}

const cwd = process.cwd();
const issues = [];

const workspaceDetection = readJson(path.join(cwd, '.a365-workspace-detection.json')) || {};
const authMode = (workspaceDetection.authMode || '').toLowerCase();

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
  // 1. Package installed (Runtime or unified OpenTelemetry distro)
  const hasObservabilityPkg = csprojFiles.some(f =>
    fileContains(f, 'Microsoft.Agents.A365.Observability.Runtime') ||
    fileContains(f, 'Microsoft.OpenTelemetry'));
  if (!hasObservabilityPkg) {
    issues.push('Microsoft.Agents.A365.Observability.Runtime or Microsoft.OpenTelemetry package is not referenced in any .csproj');
  }

  // 2. Program.cs wired
  // OBO path (user-delegated / agentic-identity): AddA365Tracing + AddAgenticTracingExporter
  // S2S path: UseMicrosoftOpenTelemetry + AddAgent365Observability (preferred) OR AddA365Tracing + AddAgent365Observability (legacy)
  const programFiles = findFiles(cwd, ['Program.cs']);
  const hasOBOWired = anyFileContains(programFiles, 'AddA365Tracing', 'AddAgenticTracingExporter');
  const hasS2SWired = anyFileContains(programFiles, 'AddA365Tracing', 'AddAgent365Observability') ||
                      anyFileContains(programFiles, 'UseMicrosoftOpenTelemetry', 'AddAgent365Observability');
  const hasProgramWired = hasOBOWired || hasS2SWired;
  if (!hasProgramWired) {
    issues.push('Program.cs does not call AddA365Tracing(config => { config.WithAgentFramework(); }) with AddAgenticTracingExporter(clusterCategory: "production") (OBO path) or AddAgent365Observability() with UseMicrosoftOpenTelemetry() (S2S path)');
  }

  // 2a. OBO: WithAgentFramework() must be configured in AddA365Tracing
  if (hasOBOWired && authMode !== 's2s') {
    const hasWithAgentFramework = anyFileContains(programFiles, 'WithAgentFramework');
    if (!hasWithAgentFramework) {
      issues.push('Program.cs calls AddA365Tracing() but WithAgentFramework() is missing — use AddA365Tracing(config => { config.WithAgentFramework(); }) for correct OBO tracing');
    }
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
    fileContains(f, '@microsoft/agents-a365-observability') ||
    fileContains(f, '@microsoft/opentelemetry'));
  if (!hasNpmPkg) {
    issues.push('@microsoft/opentelemetry (or @microsoft/agents-a365-observability) is not in package.json');
  }

  // 2. useMicrosoftOpenTelemetry called (or legacy ObservabilityManager.configure)
  const hasObsManager = anyFileContains(tsFiles, 'useMicrosoftOpenTelemetry') ||
                        anyFileContains(tsFiles, 'ObservabilityManager');
  if (!hasObsManager) {
    issues.push('No TypeScript/JS file calls useMicrosoftOpenTelemetry()');
  }

  // 3. BaggageBuilder or BaggageMiddleware in handler
  // BaggageBuilderUtils.fromTurnContext is the recommended OBO pattern (fromTurnContext is on Utils, not BaggageBuilder)
  const hasBaggage = anyFileContains(tsFiles, 'BaggageBuilder') ||
                     anyFileContains(tsFiles, 'BaggageMiddleware') ||
                     anyFileContains(tsFiles, 'BaggageBuilderUtils');
  if (!hasBaggage) {
    issues.push('No TypeScript/JS file uses BaggageBuilder, BaggageBuilderUtils, or BaggageMiddleware — baggage context missing');
  }

  // 4. Token caching wired (tokenResolver, AgenticTokenCacheInstance, preloadObservabilityToken helper, or S2S token service)
  const hasTokenCache = anyFileContains(tsFiles, 'tokenResolver') ||
                        anyFileContains(tsFiles, 'AgenticTokenCacheInstance') ||
                        anyFileContains(tsFiles, 'RefreshObservabilityToken') ||
                        anyFileContains(tsFiles, 'preloadObservabilityToken') ||
                        anyFileContains(tsFiles, 'getS2SObservabilityToken');
  if (!hasTokenCache) {
    issues.push('No TypeScript/JS file wires a token resolver — observability exports will fail');
  }

  // 4a. S2S scaffold: token service file must exist when authMode is S2S
  if (authMode === 's2s') {
    const hasS2SScaffold = anyFileContains(tsFiles, 'observability-token-service') ||
                           anyFileContains(tsFiles, 'startObservabilityTokenService') ||
                           anyFileContains(tsFiles, 'startTokenService');
    if (!hasS2SScaffold) {
      issues.push('S2S: observability/observability-token-service.ts scaffold or startTokenService() not found');
    }
    const hasS2SEndpoint = anyFileContains(tsFiles, 'useS2SEndpoint') ||
                           anyFileContains(tsFiles, 'useMicrosoftOpenTelemetry');
    if (!hasS2SEndpoint) {
      issues.push('S2S: useMicrosoftOpenTelemetry() or useS2SEndpoint not found in observability configuration');
    }
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
  const pyObservabilityPackages = [
    'microsoft-opentelemetry',
    'microsoft-agents-a365-observability-core',
    'microsoft-agents-a365-observability-hosting',
    'microsoft-agents-a365-observability-runtime',
    'microsoft-agents-a365-observability',
  ];
  const hasPyPkg = reqFiles.some(f =>
    pyObservabilityPackages.some(pkg => fileContains(f, pkg)));
  if (!hasPyPkg) {
    issues.push(
      'No Microsoft observability distribution found in requirements.txt or pyproject.toml ' +
      '(expected microsoft-opentelemetry or a microsoft-agents-a365-observability-* package)'
    );
  }

  // 2. use_microsoft_opentelemetry() called (or legacy configure())
  const hasConfigure = anyFileContains(pyFiles, 'use_microsoft_opentelemetry') ||
                       (anyFileContains(pyFiles, 'from microsoft_agents_a365.observability.core import') &&
                        anyFileContains(pyFiles, 'configure('));
  if (!hasConfigure) {
    issues.push('No Python file calls use_microsoft_opentelemetry()');
  }

  // 3. BaggageBuilder or BaggageMiddleware used (OBO path) OR use_microsoft_opentelemetry (S2S distro handles context internally)
  const hasBaggage = anyFileContains(pyFiles, 'BaggageBuilder') ||
                     anyFileContains(pyFiles, 'BaggageMiddleware') ||
                     anyFileContains(pyFiles, 'populate_baggage') ||
                     anyFileContains(pyFiles, 'use_microsoft_opentelemetry');
  if (!hasBaggage) {
    issues.push('No Python file uses BaggageBuilder, BaggageMiddleware, populate_baggage, or use_microsoft_opentelemetry — baggage context missing');
  }

  // 4. Token cache wired
  // OBO path: cache_agentic_token (new pattern) or AgenticTokenCache (legacy) or exchange_token helper
  // S2S path: get_s2s_observability_token or token_resolver
  // Distro path: use_microsoft_opentelemetry handles it internally
  const hasTokenCache = anyFileContains(pyFiles, 'cache_agentic_token') ||
                        anyFileContains(pyFiles, 'exchange_token') ||
                        anyFileContains(pyFiles, 'AgenticTokenCache') ||
                        anyFileContains(pyFiles, 'token_resolver') ||
                        anyFileContains(pyFiles, 'get_observability_authentication_scope') ||
                        anyFileContains(pyFiles, 'get_s2s_observability_token') ||
                        anyFileContains(pyFiles, 'use_microsoft_opentelemetry');
  if (!hasTokenCache) {
    issues.push('No Python file wires a token resolver — observability exports will fail');
  }

  // 4a. S2S scaffold: token service file must exist when authMode is S2S
  if (authMode === 's2s') {
    const hasS2SScaffold = anyFileContains(pyFiles, 'observability_token_service') ||
                           anyFileContains(pyFiles, 'start_observability_token_service') ||
                           anyFileContains(pyFiles, 'run_token_service');
    if (!hasS2SScaffold) {
      issues.push('S2S: observability/observability_token_service.py scaffold or run_token_service() not found');
    }
    const hasS2SEndpoint = anyFileContains(pyFiles, 'use_s2s_endpoint') ||
                           anyFileContains(pyFiles, 'use_microsoft_opentelemetry');
    if (!hasS2SEndpoint) {
      issues.push('S2S: use_microsoft_opentelemetry() or use_s2s_endpoint not found in observability configuration');
    }
  }

  // 5. .env has observability vars
  const hasEnvConfig = envFiles.some(f =>
    fileContains(f, 'ENABLE_A365_OBSERVABILITY_EXPORTER'));
  if (!hasEnvConfig) {
    issues.push('.env does not contain ENABLE_A365_OBSERVABILITY_EXPORTER');
  }
}

// ── Build check ─────────────────────────────────────────────────────────────

function runBuild(cmd, timeoutMs) {
  try {
    const out = execSync(cmd, { cwd, timeout: timeoutMs, stdio: 'pipe' }).toString();
    return { ok: true, output: out };
  } catch (e) {
    const out = [(e.stdout || '').toString(), (e.stderr || '').toString()].join('\n').trim();
    return { ok: false, output: out.slice(0, 400) };
  }
}

if (!process.env.VALIDATE_SKIP_EXEC) {
  if (isDotnet) {
    const result = runBuild('dotnet build --no-restore -v minimal', 25000);
    if (!result.ok || !result.output.includes('Build succeeded')) {
      issues.push('dotnet build --no-restore failed — fix compilation errors before ending the session');
    }
  } else if (isNodejs) {
    const result = runBuild('npx tsc --noEmit', 15000);
    if (!result.ok) {
      issues.push('TypeScript compilation failed (tsc --noEmit) — fix errors before ending the session');
    }
  }
}
// Python has no compilation step — import checks are covered by the pattern checks above.

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
