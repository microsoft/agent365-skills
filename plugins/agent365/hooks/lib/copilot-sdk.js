// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const fs = require('fs');
const path = require('path');
const { scanProject, DEFAULT_SKIP_DIRS } = require('./project-scan');

const STACK = 'GitHub Copilot SDK';
const SDK = '@github/copilot-sdk';
const EXACT_RELEASE = /^\d+\.\d+\.\d+$/;

function readOptionalJson(root, name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return { value: null };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { value: null, error: `${name} must contain a JSON object` };
    }
    return { value };
  } catch {
    return { value: null, error: `${name} could not be read as JSON` };
  }
}

function getCopilotSdkProject(root) {
  const pkg = readOptionalJson(root, 'package.json');
  const cache = readOptionalJson(root, '.a365-workspace-detection.local.json');
  const dependencySections = [pkg.value?.dependencies, pkg.value?.devDependencies];
  const versions = dependencySections
    .filter(section => section && Object.hasOwn(section, SDK))
    .map(section => section[SDK]);
  if (!versions.length && cache.value?.agentStack !== STACK) return null;

  const issues = [pkg.error, cache.error].filter(Boolean);
  const prerequisites = [];
  const detection = cache.value;
  if (!versions.length) {
    issues.push('Cached GitHub Copilot SDK stack has no direct @github/copilot-sdk dependency; re-detect the selected package before routing');
  }
  if (versions.some(version => typeof version !== 'string' || !EXACT_RELEASE.test(version))) {
    issues.push('Pin @github/copilot-sdk to the verified exact published stable release; do not use ranges, prereleases, or local SDK builds');
  }
  const scannedFiles = scanProject(root, {
    skipDirs: new Set([...DEFAULT_SKIP_DIRS, 'build', 'coverage']),
  });
  const nestedPackages = scannedFiles
    .filter(file => path.basename(file) === 'package.json' && path.dirname(file) !== root)
    .map(file => path.dirname(file) + path.sep);
  const allFiles = scannedFiles.filter(file => !nestedPackages.some(prefix => file.startsWith(prefix)));
  const sourceFiles = allFiles.filter(file => {
    const relative = path.relative(root, file);
    return /\.(?:ts|mts|cts)$/.test(file) && !/\.d\.(?:ts|mts|cts)$/.test(file) &&
      !/\.(?:test|spec)\.(?:ts|mts|cts)$/.test(file) &&
      !relative.split(path.sep).some(part => ['test', 'tests', '__tests__'].includes(part));
  });
  if (!sourceFiles.length) {
    issues.push('GitHub Copilot SDK spike requires TypeScript source; no generic Node.js/hosting fallback is supported');
  }
  if (!detection) {
    prerequisites.push('GitHub Copilot SDK requires .a365-workspace-detection.local.json from confirmed standalone setup decisions before edits');
  } else {
    if (detection.agentStack !== STACK || detection.programmingLanguage !== 'NodeJS') {
      issues.push('GitHub Copilot SDK dependency conflicts with cached stack/language; re-detect rather than falling back to another framework');
    }
    if (detection.agentType !== 'system-agent' ||
        String(detection.authMode).toLowerCase() !== 's2s' ||
        ![0, false].includes(detection.usesTeamsOrCopilot) ||
        ![0, false].includes(detection.has_aiteammate_structure) ||
        ![0, false].includes(detection.has_workiq)) {
      issues.push('GitHub Copilot SDK route must remain standalone system-agent/S2S with no Teams, AI Teammate, agentic-user, or WorkIQ state');
    }
    if (!Array.isArray(detection.capabilities) ||
        !detection.capabilities.includes('Register') ||
        detection.capabilities.some(value => !['Register', 'Observability'].includes(value))) {
      issues.push('GitHub Copilot SDK capabilities must be Register with optional Observability only');
    }
  }
  const approvals = detection?.standaloneApprovals;
  if (approvals !== undefined &&
      (!approvals || typeof approvals !== 'object' || Array.isArray(approvals))) {
    issues.push('standaloneApprovals must be an object recording explicit user decisions');
  }
  for (const approval of ['scope', 's2s']) {
    if (approvals?.[approval] !== true) {
      prerequisites.push(`Standalone ${approval} confirmation is missing; record explicit approval before proceeding`);
    }
  }
  const forbiddenPackages = [
    '@microsoft/teams-ai', '@microsoft/agents-hosting', '@microsoft/agents-a365-notifications',
  ];
  if (dependencySections.some(section => section &&
      forbiddenPackages.some(name => Object.hasOwn(section, name)))) {
    issues.push('Hosting/Teams/notifications dependencies conflict with the standalone spike; stop without removing existing features');
  }
  if (allFiles.some(file =>
    ['teamsapp.yml', 'teamsapp.local.yml', 'ToolingManifest.json'].includes(path.basename(file)))) {
    issues.push('Teams or ToolingManifest artifacts conflict with the standalone spike; do not auto-route to AI Teammate or WorkIQ');
  }
  if (allFiles.filter(file => path.basename(file) === 'manifest.json').some(file => {
    const manifest = readOptionalJson(path.dirname(file), 'manifest.json');
    return manifest.error || manifest.value?.copilotAgents?.customEngineAgents;
  })) {
    issues.push('A manifest is unreadable or declares M365 customEngineAgents; verify the conflicting artifact before standalone routing');
  }
  if (sourceFiles.some(file =>
    /\bextends\s+AgentApplication\b|\bnew\s+CloudAdapter(?:Aiohttp)?\s*\(|\bNotificationType\./.test(fs.readFileSync(file, 'utf8')))) {
    issues.push('AgentApplication/CloudAdapter/notification code conflicts with the standalone spike; preserve it and stop rather than converting hosting');
  }
  return {
    agentStack: STACK, issues: [...issues, ...prerequisites],
    reportIssues: issues, prerequisites, detection, packageJson: pkg.value, sourceFiles,
  };
}

function getCopilotSdkRegistrationIssues(root, project) {
  const issues = [...project.issues];
  if (project.detection?.standaloneApprovals?.registration !== true) {
    issues.push('Standalone registration/reuse approval is missing; a report is not permission to provision');
  }
  if (typeof project.detection?.reuseBlueprint !== 'boolean') {
    issues.push('Standalone blueprint reuse/create decision is missing');
  }
  const input = readOptionalJson(root, 'a365.config.json');
  const generated = readOptionalJson(root, 'a365.generated.config.json');
  issues.push(...[input.error, generated.error].filter(Boolean));
  const id = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const inputId = id(input.value?.blueprintId);
  const generatedId = id(generated.value?.agentBlueprintId);
  if (generated.value && !generatedId) {
    issues.push('Generated standalone blueprint config has no valid agentBlueprintId');
  }
  if (inputId && generatedId && inputId !== generatedId) {
    issues.push('Standalone input/generated blueprint IDs conflict; verify the intended identity before reuse');
  }
  if (input.value?.tenantId && generated.value?.tenantId &&
      input.value.tenantId !== generated.value.tenantId) {
    issues.push('Standalone input/generated tenants conflict; do not reuse this configuration');
  }
  const blueprintId = generatedId || (project.detection?.reuseBlueprint === true ? inputId : null);
  if (!blueprintId) {
    issues.push('Standalone blueprint configuration is missing; registration remains unverified');
  }
  const cachedId = id(project.detection?.existingBlueprintId);
  if (project.detection?.reuseBlueprint === true && cachedId && blueprintId && cachedId !== blueprintId) {
    issues.push('Cached standalone blueprint ID conflicts with the selected configuration');
  }
  return issues;
}

function getCopilotSdkObservabilityIssues(project) {
  const issues = [...project.issues];
  if (project.detection?.standaloneApprovals?.observability !== true) {
    issues.push('Standalone observability source-contract/diff approval is missing; do not instrument from a report');
  }
  if (!Array.isArray(project.detection?.capabilities) ||
      !project.detection.capabilities.includes('Observability')) {
    issues.push('Standalone Observability capability was not confirmed');
  }
  const pins = {
    '@github/copilot-sdk': '1.0.14',
    '@microsoft/opentelemetry': '1.4.0',
    '@azure/msal-node': '7.0.0',
    '@opentelemetry/api': '1.9.1',
    '@opentelemetry/core': '2.10.0',
    '@opentelemetry/resources': '2.10.0',
    '@opentelemetry/sdk-trace-base': '2.10.0',
    '@opentelemetry/sdk-trace-node': '2.10.0',
  };
  for (const [name, expected] of Object.entries(pins)) {
    const version = project.packageJson?.dependencies?.[name];
    if (version !== expected) {
      issues.push(`Standalone observability sample contract requires ${name}@${expected}; review version mismatches rather than silently upgrading`);
    }
  }
  const source = project.sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  for (const [pattern, message] of [
    [/\bnew\s+NodeTracerProvider\s*\(/, 'verified explicit NodeTracerProvider bootstrap'],
    [/\bnew\s+Agent365Exporter\s*\(/, 'explicit opt-in Agent365Exporter'],
    [/\bcreateTokenResolver\s*\(/, 'verified non-user createTokenResolver helper'],
    [/\buseS2SEndpoint\s*:\s*true\b/, 'explicit useS2SEndpoint: true for opt-in S2S export'],
    [/\bif\s*\(\s*config\.exportToA365\s*\)/, 'exportToA365 guard around exporter creation'],
    [/\bflag\s*\(\s*env\s*,\s*['"]ENABLE_A365_OBSERVABILITY_EXPORTER['"]\s*,\s*false\s*\)/, 'exporter opt-in environment gate defaulting to false'],
    [/\bInvokeAgentScope\.start\s*\(/, 'deterministic invoke_agent boundary'],
    [/\bExecuteToolScope\.start\s*\(/, 'deterministic custom execute_tool boundary'],
    [/\bparentContext\s*:/, 'explicit custom-tool parent context'],
    [/\bagentBlueprintId\s*:/, 'blueprint attribution separate from runtime agent identity'],
    [/\bAGENT365_AGENT_ID\b/, 'runtime agent identity input distinct from the blueprint ID'],
    [/\bforceFlush\s*\(/, 'telemetry forceFlush lifecycle'],
    [/\bshutdown\s*\(/, 'telemetry shutdown/flush lifecycle'],
  ]) {
    if (!pattern.test(source)) issues.push(`Standalone observability is missing ${message}; inspect the verified local Copilot SDK sample contract`);
  }
  if (/\buseMicrosoftOpenTelemetry\s*\(|\bconfigureA365Hosting\s*\(/.test(source)) {
    issues.push('Standalone sample uses an explicit provider; review existing distro/hosting bootstrap to avoid duplicate providers or a hosted-agent fallback');
  }
  return issues;
}

module.exports = {
  getCopilotSdkProject, getCopilotSdkRegistrationIssues, getCopilotSdkObservabilityIssues,
  EXACT_RELEASE, STACK,
};

if (require.main === module) {
  const project = getCopilotSdkProject(process.cwd());
  process.stdout.write(JSON.stringify(project ? {
    agentStack: project.agentStack,
    route: 'a365-setup -> make-a365-agent -> optional instrument-observability (standalone)',
    ok: project.issues.length === 0,
    issues: project.issues,
    evidence: 'Local static checks only; tenant authentication, registration, and export are unverified',
  } : { ok: false, issues: ['No direct GitHub Copilot SDK project detected in this directory'] }, null, 2));
  process.exitCode = project && project.issues.length === 0 ? 0 : 1;
}
