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

const path = require('path');
const { execSync } = require('child_process');
const {
  scanProject,
  filterByName,
  fileContains,
  anyFileContains,
  readJson,
} = require('../lib/project-scan');

const cwd = process.cwd();
const issues = [];

const workspaceDetection = readJson(path.join(cwd, '.a365-workspace-detection.local.json')) || {};
const authMode = (workspaceDetection.authMode || '').toLowerCase();

// ── Detect project type ─────────────────────────────────────────────────────
// Walk the project tree once, then bucket by name.

const allFiles    = scanProject(cwd);
const csprojFiles = filterByName(allFiles, '.csproj');
const tsFiles     = filterByName(allFiles, '.ts', '.js');
const pyFiles     = filterByName(allFiles, '.py');
const envFiles    = filterByName(allFiles, '.env', '.env.example', '.env.production', '.env.local');
const reqFiles    = filterByName(allFiles, 'requirements.txt', 'pyproject.toml');
const packageJsonFiles = filterByName(allFiles, 'package.json');

const isDotnet   = csprojFiles.length > 0;
// Node.js: any project with a package.json + .ts/.js source files
const isNodejs   = !isDotnet && packageJsonFiles.length > 0 && tsFiles.length > 0;
const isPython   = !isDotnet && !isNodejs && (pyFiles.length > 0 || reqFiles.length > 0);
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
  // Preferred (Microsoft.OpenTelemetry distro): UseMicrosoftOpenTelemetry covers both OBO and S2S
  //   - OBO/agentic-user: distro auto-registers IExporterTokenCache<AgenticTokenStruct>; no extra DI calls
  //   - S2S: UseMicrosoftOpenTelemetry + AddAgent365Observability for the scaffold token service
  // Legacy (pre-distro, kept for older agents): AddA365Tracing + AddAgenticTracingExporter (OBO)
  //   or AddA365Tracing + AddAgent365Observability (S2S)
  const programFiles = filterByName(allFiles, 'Program.cs');
  const hasDistroWired = anyFileContains(programFiles, 'UseMicrosoftOpenTelemetry');
  const hasLegacyOBOWired = anyFileContains(programFiles, 'AddA365Tracing', 'AddAgenticTracingExporter');
  const hasLegacyS2SWired = anyFileContains(programFiles, 'AddA365Tracing', 'AddAgent365Observability') ||
                            anyFileContains(programFiles, 'UseMicrosoftOpenTelemetry', 'AddAgent365Observability');
  const hasProgramWired = hasDistroWired || hasLegacyOBOWired || hasLegacyS2SWired;
  if (!hasProgramWired) {
    issues.push('Program.cs does not wire A365 observability: expected builder.UseMicrosoftOpenTelemetry(o => ...) (preferred — Microsoft.OpenTelemetry distro) or the legacy AddA365Tracing(...) + AddAgenticTracingExporter(...) (OBO) / AddAgent365Observability() (S2S) calls');
  }

  // 2a. Legacy OBO only: WithAgentFramework() must be configured in AddA365Tracing.
  // The distro auto-instruments AgentFramework via o.Instrumentation.EnableAgentFrameworkInstrumentation
  // (default true), so this check does NOT apply when UseMicrosoftOpenTelemetry is used.
  if (hasLegacyOBOWired && !hasDistroWired && authMode !== 's2s') {
    const hasWithAgentFramework = anyFileContains(programFiles, 'WithAgentFramework');
    if (!hasWithAgentFramework) {
      issues.push('Program.cs calls AddA365Tracing() but WithAgentFramework() is missing — use AddA365Tracing(config => { config.WithAgentFramework(); }) for correct OBO tracing (legacy path; prefer migrating to UseMicrosoftOpenTelemetry from the Microsoft.OpenTelemetry distro)');
    }
    // 2b. clusterCategory: "production" must be present in AddAgenticTracingExporter (legacy only)
    const hasClusterCategory = anyFileContains(programFiles, 'clusterCategory');
    if (!hasClusterCategory) {
      issues.push('AddAgenticTracingExporter() is missing the required clusterCategory: "production" argument — use AddAgenticTracingExporter(clusterCategory: "production") (legacy path; prefer migrating to UseMicrosoftOpenTelemetry)');
    }
  }

  // 3. Observability context wired in agent code
  // OBO path: BaggageBuilder or BaggageTurnMiddleware
  // S2S path: ObservabilityTokenService scaffold + Agent365ObservabilityContext injection
  const csFiles = filterByName(allFiles, '.cs');
  const hasS2SScaffold = anyFileContains(csFiles, 'ObservabilityTokenService') ||
                         anyFileContains(csFiles, 'Agent365ObservabilityContext');
  const hasBaggage = anyFileContains(csFiles, 'BaggageBuilder') ||
                     anyFileContains([...programFiles, ...csFiles], 'BaggageTurnMiddleware') ||
                     hasS2SScaffold;
  if (!hasBaggage) {
    issues.push('No .cs file uses BaggageBuilder, BaggageTurnMiddleware (OBO), or ObservabilityTokenService/Agent365ObservabilityContext (S2S) — observability context is missing');
  }

  // 4. appsettings has observability config
  const appSettingsFiles = filterByName(allFiles, 'appsettings.json');
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
  // 1. Core package installed — @microsoft/opentelemetry (GA 1.0+) is the unified package.
  // Legacy @microsoft/agents-a365-observability* packages are deprecated but still accepted
  // here so agents instrumented before the rewrite pass validation until they migrate.
  const hasNpmPkg = packageJsonFiles.some(f =>
    fileContains(f, '@microsoft/opentelemetry') ||
    fileContains(f, '@microsoft/agents-a365-observability'));
  if (!hasNpmPkg) {
    issues.push('@microsoft/opentelemetry is not in package.json');
  }

  // 2. useMicrosoftOpenTelemetry called (or legacy ObservabilityManager.configure)
  const hasObsManager = anyFileContains(tsFiles, 'useMicrosoftOpenTelemetry') ||
                        anyFileContains(tsFiles, 'ObservabilityManager');
  if (!hasObsManager) {
    issues.push('No TypeScript/JS file calls useMicrosoftOpenTelemetry()');
  }

  // 3. Baggage wiring — in 1.0+ the recommended pattern is configureA365Hosting({ enableBaggage: true }).
  // Legacy patterns (BaggageBuilder, BaggageMiddleware, BaggageBuilderUtils) still accepted.
  const hasBaggage = anyFileContains(tsFiles, 'configureA365Hosting') ||
                     anyFileContains(tsFiles, 'BaggageMiddleware') ||
                     anyFileContains(tsFiles, 'BaggageBuilder') ||
                     anyFileContains(tsFiles, 'BaggageBuilderUtils');
  if (!hasBaggage) {
    issues.push('No TypeScript/JS file uses configureA365Hosting, BaggageMiddleware, BaggageBuilder, or BaggageBuilderUtils — baggage context missing');
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

  // 4a. S2S scaffold: token service file must exist when authMode is s2s
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
  // 1. Core package installed — microsoft-opentelemetry (GA 1.1+) is the unified package.
  // Legacy microsoft-agents-a365-* packages are deprecated but still accepted here so
  // agents instrumented before the rewrite pass validation until they migrate.
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
      'microsoft-opentelemetry not found in requirements.txt or pyproject.toml'
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

  // 4a. S2S scaffold: token service file must exist when authMode is s2s
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
