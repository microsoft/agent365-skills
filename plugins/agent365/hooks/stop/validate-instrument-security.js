#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-instrument-security.js
 *
 * Stop hook validator for the instrument-security skill. Confirms that Defender
 * prevention was actually wired into the agent — package present, all enabled
 * inspection hooks bridged, enforcement implemented, configuration stamped, and
 * the project still compiles.
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
 */

'use strict';

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

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function anyMatches(files, regex) {
  return files.some(f => regex.test(read(f)));
}

// ── Bucket the project ──────────────────────────────────────────────────────

const allFiles = scanProject(cwd, { maxDepth: 7 })
  // Never validate the skill's own sources when run inside this repo.
  .filter(f => !f.includes(path.join('plugins', 'agent365')));

const pyFiles = filterByName(allFiles, '.py');
const tsFiles = filterByName(allFiles, '.ts', '.js');
const csFiles = filterByName(allFiles, '.cs');
const csprojFiles = filterByName(allFiles, '.csproj');
const envFiles = filterByName(allFiles, '.env', '.env.example', '.env.production', '.env.local');
const reqFiles = filterByName(allFiles, 'requirements.txt', 'pyproject.toml');
const packageJsonFiles = filterByName(allFiles, 'package.json');

const isDotnet = csprojFiles.length > 0;
const isNodejs = !isDotnet && packageJsonFiles.length > 0 && tsFiles.length > 0;
const isPython = !isDotnet && !isNodejs && (pyFiles.length > 0 || reqFiles.length > 0);

if (!isDotnet && !isNodejs && !isPython) {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}

const sourceFiles = isPython ? pyFiles : isNodejs ? tsFiles : csFiles;

// If the skill never ran here, stay silent — this hook also fires for sessions
// that merely opened the project.
const touched = anyFileContains(sourceFiles, 'instrument-security') ||
  anyMatches(sourceFiles, /tp\/v1\/protection\/analyze|prevention\.thirdparty\./) ||
  anyMatches(envFiles, /^\s*DEFENDER_/m);

if (!touched) {
  process.stdout.write(JSON.stringify({ ok: true, skipped: 'instrument-security did not run in this project' }));
  process.exit(0);
}

// ── Detection cache must exist ──────────────────────────────────────────────

if (!fs.existsSync(path.join(cwd, '.a365-workspace-detection.local.json'))) {
  issues.push('.a365-workspace-detection.local.json was not written — Phase 0 triage was skipped. Run /agent365:a365-setup, then re-run /agent365:instrument-security');
}

// ── Endpoint + payload ──────────────────────────────────────────────────────

const hasEndpoint = anyMatches(sourceFiles, /tp\/v1\/protection\/analyze/) ||
  anyMatches(envFiles, /^\s*DEFENDER_WEBHOOK_ENDPOINT\s*=/m);
if (!hasEndpoint) {
  issues.push('No Defender prevention endpoint (/tp/v1/protection/analyze) is referenced in code or configuration');
}

if (!anyFileContains(sourceFiles, 'evaluationPolicy')) {
  issues.push('AISession payload has no evaluationPolicy — without EVALUATION_POLICY_TYPE_BLOCKING the webhook may not return an enforceable verdict');
}

if (!anyFileContains(sourceFiles, 'sessionContext')) {
  issues.push('AISession payload has no sessionContext — a null session context makes the rule engine fail open and silently allow everything');
}

if (!anyMatches(sourceFiles, /["']a365["']\s*:/)) {
  issues.push('AISession environment.agent.id does not set the a365 identifier case — agent identity is resolved from that oneof and the session will be rejected');
}

// ── Enforcement: the verdict must be honored ────────────────────────────────

if (!anyFileContains(sourceFiles, 'blockAction')) {
  issues.push('Nothing reads blockAction from the webhook response — the verdict is not being enforced');
}

const surfacesReason = anyMatches(sourceFiles, /block_message|blockMessage/) ||
  (anyFileContains(sourceFiles, 'reason') && anyMatches(sourceFiles, /blocked by Microsoft Defender/i));
if (!surfacesReason) {
  issues.push('Blocking does not surface a readable reason — the block message must include the Defender reason (and diagnostics when present)');
}

// A fail policy must be *implemented*, not merely named: look for the derived
// "is this fail-closed" signal or an explicit comparison against the mode.
// Listing DEFENDER_FAIL_MODE among forwarded env keys is not an implementation.
const hasFailPolicy = anyMatches(
  sourceFiles,
  /fail_closed|failClosed|(?:fail_mode|failMode|FAIL_MODE)\s*(?:==|===)\s*['"]closed['"]/
);
if (!hasFailPolicy) {
  issues.push('No fail-open/fail-closed policy is implemented — webhook errors must resolve to an explicit configured behavior, not an accidental one');
}

// ── Hook coverage ───────────────────────────────────────────────────────────

const HOOKS = isPython || isNodejs
  ? {
      before_agent: /before_agent_callback|beforeAgentCallback/,
      after_agent: /after_agent_callback|afterAgentCallback/,
      before_tool: /before_tool_callback|beforeToolCallback/,
      after_tool: /after_tool_callback|afterToolCallback/,
    }
  : {};

// Only hooks the user enabled are required.
let enabledHooks = Object.keys(HOOKS);
const hooksSetting = envFiles
  .map(read)
  .map(content => (content.match(/^\s*DEFENDER_HOOKS\s*=\s*(.+)$/m) || [])[1])
  .find(Boolean);
if (hooksSetting) {
  const requested = hooksSetting.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  enabledHooks = enabledHooks.filter(h => requested.includes(h));
}

const missingHooks = enabledHooks.filter(hook => !anyMatches(sourceFiles, HOOKS[hook]));
if (missingHooks.length > 0) {
  issues.push(`Inspection hooks are enabled but not wired in code: ${missingHooks.join(', ')}`);
}

// The tool-result hook is the indirect prompt-injection checkpoint.
if (enabledHooks.includes('after_tool') && !anyMatches(sourceFiles, /toolResponse/)) {
  issues.push('after_tool is enabled but no toolResponse activity is built — tool results are not being inspected');
}
if (enabledHooks.includes('before_tool') && !anyMatches(sourceFiles, /toolRequest/)) {
  issues.push('before_tool is enabled but no toolRequest activity is built — tool arguments are not being inspected');
}
if (enabledHooks.includes('before_agent') && !anyMatches(sourceFiles, /agentRequest/)) {
  issues.push('before_agent is enabled but no agentRequest activity is built — user prompts are not being inspected');
}
if (enabledHooks.includes('after_agent') && !anyMatches(sourceFiles, /agentResponse/)) {
  issues.push('after_agent is enabled but no agentResponse activity is built — agent responses are not being inspected');
}

// ── Identity: the agent's own Entra identity, no embedded secrets ───────────

const usesAgentIdentity = anyMatches(sourceFiles, /AGENT365_AGENT_ID|agenticAppId|agent_id/) &&
  anyMatches(sourceFiles, /login\.microsoftonline\.com|ConfidentialClientApplication|client_credentials/);
if (!usesAgentIdentity) {
  issues.push("No Entra token acquisition using the agent's identity was found — prevention must authenticate with the Agent 365 identity created by make-a365-agent");
}

const secretLiteral = sourceFiles.find(f =>
  /(client_secret|clientSecret)\s*[:=]\s*["'][A-Za-z0-9~._\-]{16,}["']/.test(read(f)));
if (secretLiteral) {
  issues.push(`A credential appears to be hardcoded in ${path.relative(cwd, secretLiteral).replace(/\\/g, '/')} — credentials must come from the environment only`);
}

// ── Configuration reaches the deployed runtime ──────────────────────────────

if (envFiles.length > 0 && !anyMatches(envFiles, /^\s*DEFENDER_/m)) {
  issues.push('No DEFENDER_* settings were stamped into any .env file');
}

// A locally-configured agent whose deployment script does not forward the
// settings looks wired but runs unprotected.
const deployFiles = allFiles.filter(f => /deploy\.(py|ts|js)$/i.test(path.basename(f)));
if (deployFiles.length > 0 && !anyMatches(deployFiles, /DEFENDER_/)) {
  issues.push('deploy script does not forward any DEFENDER_* environment variables — the deployed agent would run with prevention configured off');
}

// ── Build / import check ────────────────────────────────────────────────────
// Bypassed in unit tests via VALIDATE_SKIP_EXEC=1 — matching the convention
// used by the other validators, so fixtures need not be buildable.

function tryExec(command) {
  try {
    execSync(command, { cwd, stdio: 'pipe', timeout: 20000 });
    return null;
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`.trim();
    return out.split('\n').slice(-12).join('\n');
  }
}

if (!process.env.VALIDATE_SKIP_EXEC) {
  if (isPython) {
    const securityConfig = allFiles.find(f => f.includes(`${path.sep}security${path.sep}`) &&
      path.basename(f) === 'config.py');
    if (securityConfig) {
      const pkgRoot = path.dirname(path.dirname(securityConfig));
      const failure = tryExec(`python -m compileall -q "${pkgRoot}"`);
      if (failure) {
        issues.push(`Python compilation failed:\n${failure}`);
      }
    }
  } else if (isNodejs) {
    const hasTsconfig = allFiles.some(f => path.basename(f) === 'tsconfig.json');
    if (hasTsconfig) {
      const failure = tryExec('npx --no-install tsc --noEmit');
      if (failure && /error TS/.test(failure)) {
        issues.push(`TypeScript compilation failed:\n${failure}`);
      }
    }
  } else if (isDotnet) {
    const failure = tryExec('dotnet build --no-restore --nologo -v q');
    if (failure && /error/i.test(failure)) {
      issues.push(`.NET build failed:\n${failure}`);
    }
  }
}

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({
    ok: false,
    reason: `instrument-security did not complete:\n- ${issues.join('\n- ')}`,
  }, null, 2));
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  ok: true,
  hooks: enabledHooks,
}, null, 2));
