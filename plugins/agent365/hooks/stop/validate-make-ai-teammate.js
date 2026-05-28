#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-make-ai-teammate.js
 *
 * Stop hook validator for the make-ai-teammate skill.
 * Detects the project language (Node.js / .NET / Python) and validates
 * that the full AI Teammate hosting layer was added.
 *
 * State-matrix compatibility:
 *   The make-ai-teammate skill supports an 8-row state matrix driven by
 *   (has_obs, has_workiq, disk_blueprint_present) — disk_blueprint_present derived from disk
 *   plus the Phase 9.7.2 runTarget (prod | local) decision. This validator
 *   focuses on code-gen artifacts (hosting layer, agent class, notifications,
 *   packages) which are required regardless of which row the matrix routes
 *   through — those artifacts must always be present after the skill runs
 *   (or be present at entry, which is the precondition for skip-gates).
 *   Therefore no conditional logic is needed here: the absence of any
 *   required code-gen artifact is a real failure no matter which row ran.
 *
 *   The validator does respect `runTarget = "local"` for one thing: when
 *   set, it does NOT require any setup-all / publish / Dev-Portal artifact
 *   to be present (those are owned by validate-make-a365-agent.js and the
 *   make-ai-teammate Phase 9.7 stop-hook prompt, not by this script).
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  scanProject,
  filterByName,
  fileContains,
  anyFileContains,
} = require('../lib/project-scan');

const cwd    = process.cwd();
const issues = [];

// ── Detect language ─────────────────────────────────────────────────────────
// One walk; bucket by name afterwards.

const allFiles      = scanProject(cwd);
const csprojFiles   = filterByName(allFiles, '.csproj');
const hasCsproj     = csprojFiles.length > 0;
const hasPyproject  = fs.existsSync(path.join(cwd, 'pyproject.toml'));
const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));

let language = 'nodejs'; // default
if (hasCsproj) {
  language = 'dotnet';
} else if (hasPyproject) {
  language = 'python';
} else if (hasPackageJson) {
  language = 'nodejs';
}

// ── Validate: detection cache must exist when project has language indicator ─
// Per Phase 0A Step 1 triage, .a365-workspace-detection.local.json is written
// by a365-setup. If a language indicator is present (csproj/pyproject/
// package.json) but the cache is missing, the model skipped Step 1's "missing +
// hasProjectFiles=true → run a365-setup first" routing and instrumented the
// project without the cache. Hard fail with the remediation.

const hasLanguageIndicator = hasCsproj || hasPyproject || hasPackageJson;
const detectionCachePath = path.join(cwd, '.a365-workspace-detection.local.json');
if (hasLanguageIndicator && !fs.existsSync(detectionCachePath)) {
  issues.push('.a365-workspace-detection.local.json was not written — Phase 0A Step 1 triage was skipped. The skill must run a365-setup (which writes this cache) before any Phase 1 work. Re-run /agent365:a365-setup, then re-run /agent365:make-ai-teammate');
}

// ── Validate: ToolingManifest.json (optional — owned by add-workiq-tools) ───
// make-ai-teammate no longer pre-populates this file. It only exists when the
// user opted into WorkIQ (Phase 9.6 → add-workiq-tools) or carried it over
// from a sample. Absence is a valid completion state.
// We only validate shape IF the file exists.

const manifestFile = path.join(cwd, 'ToolingManifest.json');
if (fs.existsSync(manifestFile)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!Array.isArray(manifest.mcpServers)) {
      issues.push('ToolingManifest.json is missing mcpServers array — re-run add-workiq-tools to rewrite via the CLI');
    }
  } catch {
    issues.push('ToolingManifest.json exists but cannot be parsed as JSON — re-run add-workiq-tools or restore from a backup');
  }
}

// ── Node.js validations ─────────────────────────────────────────────────────

if (language === 'nodejs') {
  const tsFiles   = filterByName(allFiles, '.ts');
  const jsonFiles = filterByName(allFiles, 'package.json');

  // Check 1: Hosting layer — index.ts
  const indexFile = path.join(cwd, 'src', 'index.ts');
  if (fs.existsSync(indexFile)) {
    if (!fileContains(indexFile, 'CloudAdapter')) {
      issues.push('src/index.ts exists but does not use CloudAdapter — hosting layer incomplete');
    }
    if (!fileContains(indexFile, '/api/messages')) {
      issues.push('src/index.ts is missing the /api/messages endpoint');
    }
    if (!fileContains(indexFile, '/api/health')) {
      issues.push('src/index.ts is missing the /api/health endpoint');
    }
    if (!fileContains(indexFile, 'authorizeJWT')) {
      issues.push('src/index.ts is missing authorizeJWT middleware');
    }
    if (!fileContains(indexFile, 'configDotenv') && !fileContains(indexFile, 'dotenv')) {
      issues.push('src/index.ts does not load .env — configDotenv() must be first line');
    }
  } else {
    issues.push('src/index.ts not found — hosting layer was not added');
  }

  // Check 2: Agent class
  if (!anyFileContains(tsFiles, 'AgentApplication')) {
    issues.push('No TypeScript file extends AgentApplication — agent class not added');
  }
  if (!anyFileContains(tsFiles, 'onAgentNotification')) {
    issues.push('onAgentNotification handler not found — notification routing not wired');
  }
  if (!anyFileContains(tsFiles, 'InstallationUpdate')) {
    issues.push('InstallationUpdate handler not found — lifecycle events not wired');
  }
  if (!anyFileContains(tsFiles, "agents-a365-notifications")) {
    issues.push("import '@microsoft/agents-a365-notifications' not found — notification deserialization will break");
  }

  // Check 3: Client factory
  if (!anyFileContains(tsFiles, 'getClient')) {
    issues.push('getClient() factory not found in src/client.ts — LLM client factory missing');
  }

  // Check 4: Required packages in package.json
  const pkgFile = jsonFiles.find(f => path.basename(f) === 'package.json' && !f.includes('/src/'));
  if (pkgFile) {
    const required = [
      '@microsoft/agents-hosting',
      '@microsoft/agents-a365-runtime',
      '@microsoft/agents-a365-notifications',
    ];
    for (const pkg of required) {
      if (!fileContains(pkgFile, pkg)) {
        issues.push(`${pkg} not found in package.json dependencies`);
      }
    }
  } else {
    issues.push('package.json not found');
  }

  // Check 6: tsconfig.json module resolution
  const tsconfigFile = path.join(cwd, 'tsconfig.json');
  if (fs.existsSync(tsconfigFile)) {
    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigFile, 'utf8'));
      const opts = tsconfig.compilerOptions ?? {};
      if (opts.module !== 'node16' && opts.module !== 'Node16') {
        issues.push('tsconfig.json: "module" is not "node16" — this will break @microsoft/agents-* imports');
      }
      if (opts.moduleResolution !== 'node16' && opts.moduleResolution !== 'Node16') {
        issues.push('tsconfig.json: "moduleResolution" is not "node16"');
      }
    } catch {
      issues.push('tsconfig.json exists but cannot be parsed');
    }
  } else {
    issues.push('tsconfig.json not found');
  }
}

// ── .NET validations ────────────────────────────────────────────────────────

if (language === 'dotnet') {
  const csFiles = filterByName(allFiles, '.cs');

  // Check 1: Program.cs — hosting layer
  const programFile = path.join(cwd, 'Program.cs');
  if (fs.existsSync(programFile)) {
    if (!fileContains(programFile, 'AddAgent<')) {
      issues.push('Program.cs is missing AddAgent<T>() — agent not registered with DI container');
    }
    if (!fileContains(programFile, '/api/messages')) {
      issues.push('Program.cs is missing /api/messages endpoint');
    }
    if (!fileContains(programFile, '/api/health')) {
      issues.push('Program.cs is missing /api/health endpoint');
    }
  } else {
    issues.push('Program.cs not found — hosting layer was not added');
  }

  // Check 2: Agent class
  if (!anyFileContains(csFiles, 'AgentApplication')) {
    issues.push('No .cs file extends AgentApplication — agent class not added');
  }
  if (!anyFileContains(csFiles, 'ActivityTypes.InstallationUpdate')) {
    issues.push('InstallationUpdate handler not found in agent class — lifecycle events not wired');
  }
  if (!anyFileContains(csFiles, 'ActivityTypes.Message')) {
    issues.push('Message handler not found in agent class');
  }
  if (!anyFileContains(csFiles, 'isAgenticOnly')) {
    issues.push('isAgenticOnly parameter not found — dual auth registration (agentic + OBO) not configured');
  }

  // Check 3: Required NuGet packages in .csproj — tooling/observability added by separate skills
  if (csprojFiles.length > 0) {
    const required = [
      'Microsoft.Agents.A365.Notifications',
    ];
    for (const pkg of required) {
      if (!anyFileContains(csprojFiles, pkg)) {
        issues.push(`${pkg} not found in .csproj — add with: dotnet add package ${pkg}`);
      }
    }
  } else {
    issues.push('.csproj file not found');
  }

  // Check 4: appsettings.json
  const appsettingsFile = path.join(cwd, 'appsettings.json');
  if (fs.existsSync(appsettingsFile)) {
    if (!fileContains(appsettingsFile, 'AgentApplication')) {
      issues.push('appsettings.json is missing AgentApplication section');
    }
    if (!fileContains(appsettingsFile, 'TokenValidation')) {
      issues.push('appsettings.json is missing TokenValidation section');
    }
  } else {
    issues.push('appsettings.json not found — A365 auth configuration is required');
  }
}

// ── Python validations ──────────────────────────────────────────────────────

if (language === 'python') {
  const pyFiles = filterByName(allFiles, '.py');

  // Check 1: host_agent_server.py — hosting layer
  const hostFile = path.join(cwd, 'host_agent_server.py');
  if (fs.existsSync(hostFile)) {
    // CloudAdapter (current) or CloudAdapterAiohttp (legacy) — both acceptable
    if (!fileContains(hostFile, 'CloudAdapter')) {
      issues.push('host_agent_server.py is missing CloudAdapter — hosting layer incomplete');
    }
    if (!fileContains(hostFile, '/api/messages')) {
      issues.push('host_agent_server.py is missing /api/messages route');
    }
    if (!fileContains(hostFile, '/api/health')) {
      issues.push('host_agent_server.py is missing /api/health route');
    }
    if (!fileContains(hostFile, 'on_agent_notification') && !anyFileContains(pyFiles, 'on_agent_notification')) {
      issues.push('on_agent_notification handler not found — notification routing not wired');
    }
  } else {
    issues.push('host_agent_server.py not found — hosting layer was not added');
  }

  // Check 2: agent.py — agent interface implementation
  const agentFile = path.join(cwd, 'agent.py');
  if (fs.existsSync(agentFile)) {
    if (!fileContains(agentFile, 'AgentInterface') && !fileContains(agentFile, 'process_user_message')) {
      issues.push('agent.py does not implement AgentInterface / process_user_message — agent class incomplete');
    }
    if (!fileContains(agentFile, 'handle_agent_notification_activity')) {
      issues.push('agent.py is missing handle_agent_notification_activity — notification handling not implemented');
    }
  } else {
    issues.push('agent.py not found — agent implementation was not added');
  }

  // Check 3: agent_interface.py
  const interfaceFile = path.join(cwd, 'agent_interface.py');
  if (!fs.existsSync(interfaceFile)) {
    issues.push('agent_interface.py not found — AgentInterface ABC is required');
  }

  // Check 4: Required packages in pyproject.toml — tooling/observability added by separate skills
  if (hasPyproject) {
    const required = [
      'microsoft_agents_a365_notifications',
      'microsoft_agents_a365_runtime',
      'microsoft-agents-hosting-aiohttp',
    ];
    for (const pkg of required) {
      if (!fileContains(path.join(cwd, 'pyproject.toml'), pkg)) {
        issues.push(`${pkg} not found in pyproject.toml dependencies`);
      }
    }
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

// Build check is bypassed in unit tests via VALIDATE_SKIP_EXEC=1 — matching
// the convention used by validate-instrument-observability and
// validate-add-workiq-tools, so test fixtures don't have to be buildable.
if (!process.env.VALIDATE_SKIP_EXEC) {
  if (language === 'nodejs') {
    const result = runBuild('npx tsc --noEmit', 15000);
    if (!result.ok) {
      issues.push('TypeScript compilation failed (tsc --noEmit) — fix errors before ending the session');
    }
  } else if (language === 'dotnet') {
    const result = runBuild('dotnet build --no-restore -v minimal', 25000);
    if (!result.ok || !result.output.includes('Build succeeded')) {
      issues.push('dotnet build --no-restore failed — fix compilation errors before ending the session');
    }
  }
  // Python has no compilation step.
}

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, reason: issues.join('; ') }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
