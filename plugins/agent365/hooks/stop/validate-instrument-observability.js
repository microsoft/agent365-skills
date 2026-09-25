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

function read(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function anyFileMatches(files, regex) {
  return files.some(f => regex.test(read(f)));
}

// Returns the source text of every `name(...)` call in `content`, with balanced parentheses.
function callBlocks(content, name) {
  const blocks = [];
  const needle = `${name}(`;
  let index = 0;
  while ((index = content.indexOf(needle, index)) !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = index + name.length; i < content.length; i++) {
      if (content[i] === '(') depth++;
      if (content[i] === ')' && --depth === 0) { end = i + 1; break; }
    }
    if (end === -1) break;
    blocks.push(content.slice(index, end));
    index = end;
  }
  return blocks;
}

// True when any `name(...)` call in `files` has arguments matching `regex`.
function anyCallMatches(files, name, regex) {
  return files.some(f => callBlocks(read(f), name).some(block => regex.test(block)));
}

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

// ── Detection cache must exist ──────────────────────────────────────────────
// Phase 0.1 triage writes .a365-workspace-detection.local.json via a365-setup.
// Reaching this point means an agent project was detected; the cache must
// exist or the model skipped triage and instrumented against unknown
// authMode / agentStack.

if (!fs.existsSync(path.join(cwd, '.a365-workspace-detection.local.json'))) {
  issues.push('.a365-workspace-detection.local.json was not written — Phase 0 triage was skipped. The skill must run a365-setup (which writes this cache) before any Phase 1 work. Re-run /agent365:a365-setup, then re-run /agent365:instrument-observability');
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
  //   - OBO/agentic-user: UseMicrosoftOpenTelemetry + AgentAppTokenResolver (app-only token, S2S route)
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

  // 3a. Manual instrumentation scope wired — required for store publishing.
  // Only enforced on the modern Microsoft.OpenTelemetry distro path. Legacy
  // AddA365Tracing / AddAgenticTracingExporter wiring predates the scope API
  // and is not gated on it here to avoid breaking older agents — they cannot
  // pass store publishing without migrating to the distro anyway.
  if (hasDistroWired) {
    const hasScope = anyFileContains(csFiles, 'InvokeAgentScope') ||
                     anyFileContains(csFiles, 'InferenceScope') ||
                     anyFileContains(csFiles, 'ExecuteToolScope');
    if (!hasScope) {
      issues.push('No .cs file uses InvokeAgentScope.Start, InferenceScope.Start, or ExecuteToolScope.Start — manual instrumentation scopes are required for Agent 365 store publishing under the Microsoft.OpenTelemetry distro');
    }
  }

  // 3b. Telemetry uses the S2S route with an app-only token in every auth mode.
  // The S2S route rejects delegated (scp) tokens, and the distro defaults to the delegated route.
  if (hasDistroWired && !anyFileMatches(csFiles, /\bUseS2SEndpoint\s*=\s*true\b/)) {
    issues.push('Observability export must use the S2S route in every auth mode: set o.Agent365.UseS2SEndpoint = true in UseMicrosoftOpenTelemetry (o.Agent365.Exporter.UseS2SEndpoint on Microsoft.OpenTelemetry 1.0.2 and earlier) and wire an app-only token resolver (AgentAppTokenResolver, or ObservabilityTokenService for s2s)');
  }
  if (hasDistroWired && !anyFileMatches(csFiles, /\b(?:Contextual)?TokenResolver\s*=(?!=)/)) {
    issues.push('UseMicrosoftOpenTelemetry is wired without o.Agent365.TokenResolver, so the S2S route gets no app-only token (the distro default token cache holds delegated tokens, which the S2S route rejects) — set o.Agent365.TokenResolver to AgentAppTokenResolver.ResolveAsync (obo / agentic-user) or to the ServiceTokenCache fed by ObservabilityTokenService (s2s) (see dotnet-observability.md)');
  }
  if (anyCallMatches(csFiles, 'RegisterObservability', /AgenticTokenStruct/) ||
      anyFileMatches(csFiles, /\bnew\s+AgenticTokenStruct\s*[({]|IExporterTokenCache\s*<\s*AgenticTokenStruct\s*>\s*\??\s+[A-Za-z_]\w*/)) {
    issues.push('RegisterObservability(..., AgenticTokenStruct), new AgenticTokenStruct(...), or an IExporterTokenCache<AgenticTokenStruct> dependency wires a delegated (OBO) telemetry token, which the S2S route rejects — remove the per-turn registration and use AgentAppTokenResolver as o.Agent365.TokenResolver (see dotnet-observability.md)');
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

  // 3a. Manual instrumentation scope wired — required for store publishing.
  // Per nodejs-observability.md: InvokeAgentScope, InferenceScope, and ExecuteToolScope are
  // the store-publish-validation gate. The Claude SDK pattern uses only InferenceScope (per-call
  // wrap inside src/client.ts), so accept ANY of the three as sufficient evidence of scope wiring.
  // Only enforced on the modern @microsoft/opentelemetry distro path — legacy
  // ObservabilityManager.configure wiring predates the scope API.
  const usesDistro = anyFileContains(tsFiles, 'useMicrosoftOpenTelemetry');
  if (usesDistro) {
    const hasScope = anyFileContains(tsFiles, 'InvokeAgentScope') ||
                     anyFileContains(tsFiles, 'InferenceScope') ||
                     anyFileContains(tsFiles, 'ExecuteToolScope');
    if (!hasScope) {
      issues.push('No TypeScript/JS file uses InvokeAgentScope.start, InferenceScope.start, or ExecuteToolScope.start — manual instrumentation scopes are required for Agent 365 store publishing under the @microsoft/opentelemetry distro');
    }
  }

  // 4. Token resolver wired. With the distro, the a365 tokenResolver is the only export credential
  // for the S2S route, so it must be set. Legacy ObservabilityManager wiring may still use the
  // older token-cache helpers.
  if (usesDistro) {
    if (!anyFileMatches(tsFiles, /\btokenResolver\b\s*[:=,}](?!=)/)) {
      issues.push('useMicrosoftOpenTelemetry() has no a365 tokenResolver, so the S2S route gets no app-only token and export fails — pass tokenResolver: appTokenResolver from observability/app-token-resolver.ts (obo / agentic-user) or the observability-token-service resolver (s2s) (see nodejs-observability.md)');
    }
  } else {
    const hasTokenCache = anyFileContains(tsFiles, 'tokenResolver') ||
                          anyFileContains(tsFiles, 'AgenticTokenCacheInstance') ||
                          anyFileContains(tsFiles, 'RefreshObservabilityToken') ||
                          anyFileContains(tsFiles, 'preloadObservabilityToken') ||
                          anyFileContains(tsFiles, 'getS2SObservabilityToken');
    if (!hasTokenCache) {
      issues.push('No TypeScript/JS file wires a token resolver — observability exports will fail');
    }
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

  // 4b. Telemetry uses the S2S route with an app-only token in every auth mode.
  // The S2S route rejects delegated (scp) tokens, and the distro defaults to the delegated route.
  if (usesDistro && !anyFileMatches(tsFiles, /\buseS2SEndpoint\s*:\s*true\b/)) {
    issues.push('Observability export must use the S2S route in every auth mode: pass useS2SEndpoint: true in the a365 options of useMicrosoftOpenTelemetry() with an app-only tokenResolver (observability/app-token-resolver.ts for obo / agentic-user)');
  }
  if (anyCallMatches(tsFiles, 'refreshObservabilityToken', /authorization/i) ||
      anyCallMatches(tsFiles, 'RefreshObservabilityToken', /authorization/i) ||
      anyFileMatches(tsFiles, /AgenticTokenCacheInstance\s*\.\s*getObservabilityToken\s*\(/)) {
    issues.push('refreshObservabilityToken(..., authorization) or AgenticTokenCacheInstance.getObservabilityToken(...) feeds a delegated (OBO) telemetry token, which the S2S route rejects — remove it (and any preloadObservabilityToken helper) and use the app-only tokenResolver (see nodejs-observability.md)');
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

  // 3a. Manual instrumentation scope wired — required for store publishing.
  // Same rationale as Node.js: store-validation requires at least one of InvokeAgentScope,
  // InferenceScope, or ExecuteToolScope to be present in agent code. Only enforced on the
  // modern microsoft-opentelemetry distro path; legacy configure() wiring predates scopes.
  const usesDistroPy = anyFileContains(pyFiles, 'use_microsoft_opentelemetry');
  if (usesDistroPy) {
    const hasScope = anyFileContains(pyFiles, 'InvokeAgentScope') ||
                     anyFileContains(pyFiles, 'InferenceScope') ||
                     anyFileContains(pyFiles, 'ExecuteToolScope');
    if (!hasScope) {
      issues.push('No Python file uses InvokeAgentScope, InferenceScope, or ExecuteToolScope — manual instrumentation scopes are required for Agent 365 store publishing under the microsoft-opentelemetry distro');
    }
  }

  // 4. Token resolver wired. With the distro, a365_token_resolver (or a365_contextual_token_resolver)
  // is the only export credential for the S2S route; without it the exporter drops every span.
  // Legacy configure() wiring may still use the older token-cache helpers.
  if (usesDistroPy) {
    if (!anyFileMatches(pyFiles, /\ba365_(?:contextual_)?token_resolver\b['"]?\s*\]?\s*[=:](?!=)/)) {
      issues.push('use_microsoft_opentelemetry() has no a365_token_resolver, so the S2S route gets no app-only token and the exporter drops every span — pass a365_token_resolver=OBS_TOKENS.resolve from observability/app_token_resolver.py (obo / agentic-user) or the observability_token_service cache (s2s) (see python-observability.md)');
    }
  } else {
    const hasTokenCache = anyFileContains(pyFiles, 'cache_agentic_token') ||
                          anyFileContains(pyFiles, 'exchange_token') ||
                          anyFileContains(pyFiles, 'AgenticTokenCache') ||
                          anyFileContains(pyFiles, 'token_resolver') ||
                          anyFileContains(pyFiles, 'get_observability_authentication_scope') ||
                          anyFileContains(pyFiles, 'get_s2s_observability_token');
    if (!hasTokenCache) {
      issues.push('No Python file wires a token resolver — observability exports will fail');
    }
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

  // 4b. Telemetry uses the S2S route with an app-only token in every auth mode.
  // The S2S route rejects delegated (scp) tokens, and the distro defaults to the delegated route.
  const pyS2SInCode = anyFileMatches(pyFiles, /\ba365_use_s2s_endpoint\s*=\s*True\b/);
  const pyS2SInEnv = anyFileMatches(envFiles, /^\s*A365_USE_S2S_ENDPOINT\s*=\s*(true|1|yes)\s*$/im);
  if (usesDistroPy && !pyS2SInCode && !pyS2SInEnv) {
    issues.push('Observability export must use the S2S route in every auth mode: pass a365_use_s2s_endpoint=True to use_microsoft_opentelemetry() with an app-only a365_token_resolver (observability/app_token_resolver.py for obo / agentic-user)');
  }
  if (anyCallMatches(pyFiles, 'exchange_token', /observability/i) ||
      anyFileMatches(pyFiles, /(?<!\bdef\s+)\bcache_agentic_token\s*\(/) ||
      anyFileMatches(pyFiles, /\ba365_token_resolver\s*=\s*(?:lambda\b[^:\n]*:\s*)?[^,)\n]*\b(get_cached_agentic_token|AgenticTokenCache|get_observability_token)\b/)) {
    issues.push('exchange_token(...) for the observability scope, cache_agentic_token(...), or a delegated a365_token_resolver (AgenticTokenCache / get_cached_agentic_token) feeds a delegated (OBO) telemetry token, which the S2S route rejects — replace it with OBS_TOKENS.prefetch(...) and OBS_TOKENS.resolve from observability/app_token_resolver.py (see python-observability.md)');
  }
  // 4c. The per-turn prefetch needs the host's connection manager; CloudAdapter does not expose it.
  if (anyCallMatches(pyFiles, 'prefetch', /self\.connection_manager/) &&
      !anyFileMatches(pyFiles, /\bself\.connection_manager\s*=/)) {
    issues.push('OBS_TOKENS.prefetch(self.connection_manager, ...) is called, but no file assigns self.connection_manager — store the MsalConnectionManager you pass to CloudAdapter on the host (self.connection_manager = ...) or every prefetch fails and no spans export');
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
