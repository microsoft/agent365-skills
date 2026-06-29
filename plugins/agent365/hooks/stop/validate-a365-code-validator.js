#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-a365-code-validator.js
 *
 * Read-only static scanner for the a365-code-validator skill. This validator
 * reports potential A365 observability/MAC Activity issues, but it deliberately
 * returns ok:true because findings are the expected output of a validation skill.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  scanProject,
  filterByName,
  fileContains,
  anyFileContains,
  readJson,
} = require('../lib/project-scan');

const cwd = process.cwd();
function isTestPath(filePath) {
  const parts = filePath.split(path.sep).map(p => p.toLowerCase());
  return parts.includes('tests') || parts.includes('test') || parts.includes('__tests__');
}

const allFiles = scanProject(cwd, { maxDepth: 7 })
  .filter(f => !path.basename(f).includes('validate-a365-code-validator'))
  .filter(f => !f.includes(path.join('plugins', 'agent365', 'hooks')))
  .filter(f => !f.includes(path.join('plugins', 'agent365', 'skills', 'a365-code-validator')))
  .filter(f => !isTestPath(f));
const csprojFiles = filterByName(allFiles, '.csproj');
const tsFiles = filterByName(allFiles, '.ts', '.js');
const pyFiles = filterByName(allFiles, '.py');
const envFiles = filterByName(allFiles, '.env', '.env.example', '.env.production', '.env.local');
const appSettingsFiles = filterByName(allFiles, 'appsettings.json', 'appsettings.Development.json');
const reqFiles = filterByName(allFiles, 'requirements.txt', 'pyproject.toml');
const packageJsonFiles = filterByName(allFiles, 'package.json');

const findings = [];

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function rel(filePath) {
  return path.relative(cwd, filePath).replace(/\\/g, '/');
}

function add(severity, id, message, filePath = '') {
  findings.push({
    severity,
    id,
    message,
    file: filePath ? rel(filePath) : undefined,
  });
}

function envHasTruthy(name) {
  const truthy = new RegExp(`^\\s*${name}\\s*=\\s*(true|1|yes)\\s*$`, 'im');
  return envFiles.some(f => truthy.test(read(f)));
}

function envHasFalsy(name) {
  const falsy = new RegExp(`^\\s*${name}\\s*=\\s*(false|0|no)\\s*$`, 'im');
  return envFiles.some(f => falsy.test(read(f)));
}

function anyFileMatches(files, regex) {
  return files.some(f => regex.test(read(f)));
}

function isDevelopmentSettings(filePath) {
  return path.basename(filePath).toLowerCase().includes('development');
}

function findCallBlocks(content, functionName) {
  const blocks = [];
  let index = 0;
  const needle = `${functionName}(`;
  while ((index = content.indexOf(needle, index)) !== -1) {
    const start = index;
    let depth = 0;
    let end = -1;
    for (let i = index + functionName.length; i < content.length; i++) {
      const ch = content[i];
      if (ch === '(') depth++;
      if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) {
      break;
    }
    blocks.push(content.slice(start, end));
    index = end;
  }
  return blocks;
}

function validatePython() {
  const hasMicrosoftOpenTelemetryPackage = reqFiles.some(f => fileContains(f, 'microsoft-opentelemetry'));
  const hasDistroCall = anyFileContains(pyFiles, 'use_microsoft_opentelemetry');
  const hasEnableA365 = anyFileContains(pyFiles, 'enable_a365');
  const hasExplicitExporter = anyFileMatches(pyFiles, /\ba365_enable_observability_exporter\s*=\s*True\b/);
  const hasExplicitExporterFalse = anyFileMatches(pyFiles, /\ba365_enable_observability_exporter\s*=\s*False\b/);
  const hasExporterEnv = envHasTruthy('ENABLE_A365_OBSERVABILITY_EXPORTER') || envHasTruthy('EnableAgent365Exporter');

  if (hasMicrosoftOpenTelemetryPackage && !hasDistroCall) {
    add(
      'high',
      'python-missing-distro-init',
      'microsoft-opentelemetry is installed, but no Python file calls use_microsoft_opentelemetry(). A365 spans will not export.',
      reqFiles.find(f => fileContains(f, 'microsoft-opentelemetry'))
    );
  }

  if (hasDistroCall && hasEnableA365 && hasExplicitExporterFalse) {
    add(
      'critical',
      'python-exporter-explicitly-disabled',
      'Python passes a365_enable_observability_exporter=False. This disables A365 backend export.',
      pyFiles.find(f => /a365_enable_observability_exporter\s*=\s*False\b/.test(read(f)))
    );
  } else if (hasDistroCall && hasEnableA365 && !hasExplicitExporter && !hasExporterEnv) {
    add(
      'critical',
      'python-exporter-not-enabled',
      'Python enables A365 processing but neither passes a365_enable_observability_exporter=True nor sets ENABLE_A365_OBSERVABILITY_EXPORTER=true. Spans may be enriched locally but never sent to the A365 backend.',
      pyFiles.find(f => fileContains(f, 'use_microsoft_opentelemetry'))
    );
  } else if (hasDistroCall && hasEnableA365 && !hasExplicitExporter && hasExporterEnv) {
    add(
      'medium',
      'python-exporter-env-dependent',
      'Python does not pass a365_enable_observability_exporter=True in code and depends on runtime env ENABLE_A365_OBSERVABILITY_EXPORTER/EnableAgent365Exporter being true.',
      pyFiles.find(f => fileContains(f, 'use_microsoft_opentelemetry'))
    );
  }

  if (envHasFalsy('ENABLE_A365_OBSERVABILITY_EXPORTER') || envHasFalsy('EnableAgent365Exporter')) {
    add(
      'high',
      'exporter-env-disabled',
      'An env file explicitly disables A365 export. This is fine for local console-only runs, but production/MAC Activity requires the exporter to be true.'
    );
  }

  for (const file of pyFiles) {
    const content = read(file);
    for (const block of findCallBlocks(content, 'a365_request_scope')) {
      if (block.includes('blueprint_id') && !/\bagent_id\s*=/.test(block)) {
        add(
          'critical',
          'python-blueprint-as-agent-id',
          'a365_request_scope passes blueprint_id but no agent_id. If the helper falls back to blueprint_id, gen_ai.agent.id becomes the blueprint ID and S2S/MAC Activity can fail identity binding.',
          file
        );
      }
    }
  }

  const hasManualScopes = anyFileContains(pyFiles, 'InvokeAgentScope') ||
    anyFileContains(pyFiles, 'InferenceScope') ||
    anyFileContains(pyFiles, 'ExecuteToolScope');
  const hasOperationName = anyFileContains(pyFiles, 'gen_ai.operation.name') ||
    anyFileContains(pyFiles, 'invoke_agent') ||
    anyFileContains(pyFiles, 'execute_tool') ||
    anyFileContains(pyFiles, 'output_messages');

  if (hasDistroCall && !hasManualScopes && !hasOperationName) {
    add(
      'medium',
      'python-no-explicit-a365-semantic-spans',
      'No explicit InvokeAgentScope/InferenceScope/ExecuteToolScope or gen_ai.operation.name markers found. The app may rely entirely on auto-instrumentation; MAC Activity needs invoke_agent/chat/execute_tool/output_messages spans.'
    );
  }
}

function validateNode() {
  const hasMicrosoftOtelPackage = packageJsonFiles.some(f => fileContains(f, '@microsoft/opentelemetry'));
  const hasDistroCall = anyFileContains(tsFiles, 'useMicrosoftOpenTelemetry');
  const hasA365Enabled = anyFileContains(tsFiles, 'enabled: true') || anyFileContains(tsFiles, 'enabled:true');
  const hasExporterFlag = anyFileMatches(tsFiles, /\benableObservabilityExporter\s*:\s*true\b/);
  const hasExporterFalse = anyFileMatches(tsFiles, /\benableObservabilityExporter\s*:\s*false\b/);
  const hasExporterEnv = envHasTruthy('ENABLE_A365_OBSERVABILITY_EXPORTER');

  if (hasMicrosoftOtelPackage && !hasDistroCall) {
    add(
      'high',
      'node-missing-distro-init',
      '@microsoft/opentelemetry is installed, but no JS/TS file calls useMicrosoftOpenTelemetry().',
      packageJsonFiles.find(f => fileContains(f, '@microsoft/opentelemetry'))
    );
  }

  if (hasDistroCall && hasA365Enabled && hasExporterFalse) {
    add(
      'critical',
      'node-exporter-explicitly-disabled',
      'Node code sets enableObservabilityExporter:false. This disables A365 backend export.',
      tsFiles.find(f => /enableObservabilityExporter\s*:\s*false\b/.test(read(f)))
    );
  } else if (hasDistroCall && hasA365Enabled && !hasExporterFlag && !hasExporterEnv) {
    add(
      'critical',
      'node-exporter-not-enabled',
      'Node code enables A365 but does not set enableObservabilityExporter:true or ENABLE_A365_OBSERVABILITY_EXPORTER=true. Spans may not reach the A365 backend.',
      tsFiles.find(f => fileContains(f, 'useMicrosoftOpenTelemetry'))
    );
  }

  if (hasDistroCall && !anyFileContains(tsFiles, 'BaggageBuilder') && !anyFileContains(tsFiles, 'InvokeAgentScope') && !anyFileContains(tsFiles, 'configureA365Hosting')) {
    add(
      'high',
      'node-missing-identity-scope',
      'No BaggageBuilder/InvokeAgentScope/configureA365Hosting usage found. Spans can be filtered as missing tenant/agent identity.'
    );
  }

  const hasSemanticSpans = anyFileContains(tsFiles, 'InvokeAgentScope') ||
    anyFileContains(tsFiles, 'InferenceScope') ||
    anyFileContains(tsFiles, 'ExecuteToolScope') ||
    anyFileContains(tsFiles, 'gen_ai.operation.name') ||
    anyFileContains(tsFiles, 'invoke_agent') ||
    anyFileContains(tsFiles, 'execute_tool') ||
    anyFileContains(tsFiles, 'output_messages');

  if (hasDistroCall && !hasSemanticSpans) {
    add(
      'medium',
      'node-no-explicit-a365-semantic-spans',
      'No InvokeAgentScope/InferenceScope/ExecuteToolScope or supported gen_ai.operation.name markers found. Baggage alone is not enough for MAC Activity.'
    );
  }
}

function validateDotnet() {
  const hasOtelPackage = csprojFiles.some(f =>
    fileContains(f, 'Microsoft.OpenTelemetry') ||
    fileContains(f, 'Microsoft.Agents.A365.Observability'));
  const hasOtelWiring = anyFileContains(allFiles.filter(f => f.endsWith('.cs')), 'UseMicrosoftOpenTelemetry') ||
    anyFileContains(allFiles.filter(f => f.endsWith('.cs')), 'AddA365Tracing');

  if (hasOtelPackage && !hasOtelWiring) {
    add(
      'high',
      'dotnet-missing-observability-wiring',
      'A365/.NET observability packages are referenced, but no UseMicrosoftOpenTelemetry/AddA365Tracing wiring was found.',
      csprojFiles.find(f => fileContains(f, 'Microsoft.OpenTelemetry') || fileContains(f, 'Microsoft.Agents.A365.Observability'))
    );
  }

  const appSettingsWithExporter = appSettingsFiles.filter(f => fileContains(f, 'EnableAgent365Exporter'));
  const productionSettings = appSettingsWithExporter.filter(f => !isDevelopmentSettings(f));
  const appSettingsFalse = productionSettings.find(f => /"EnableAgent365Exporter"\s*:\s*false/i.test(read(f)));
  if (hasOtelWiring && appSettingsFalse) {
    add(
      'high',
      'dotnet-exporter-disabled',
      'appsettings has EnableAgent365Exporter:false. Backend export is disabled until this is true in production.',
      appSettingsFalse
    );
  } else if (hasOtelWiring && appSettingsWithExporter.length === 0) {
    add(
      'medium',
      'dotnet-exporter-config-missing',
      'No EnableAgent365Exporter setting found. .NET exporter defaults can be console-only unless production config sets it true.'
    );
  }

  if (hasOtelWiring && !anyFileContains(allFiles.filter(f => f.endsWith('.cs')), 'InvokeAgentScope')) {
    add(
      'medium',
      'dotnet-no-invoke-agent-scope',
      'No InvokeAgentScope found. MAC Activity needs invoke_agent parent spans to anchor chat/tool/inference activity.'
    );
  }
}

function validateSetupArtifacts() {
  const generated = readJson(path.join(cwd, 'a365.generated.config.json'));
  if (generated) {
    if (generated.completed === false) {
      add(
        'medium',
        'a365-generated-config-incomplete',
        'a365.generated.config.json has completed:false. Setup may be partial; verify consent/resource grants before expecting MAC Activity.',
        path.join(cwd, 'a365.generated.config.json')
      );
    }
    if (generated.agentBlueprintId && generated.agenticAppId && generated.agentBlueprintId === generated.agenticAppId) {
      add(
        'critical',
        'blueprint-id-used-as-agent-id',
        'a365.generated.config.json has identical blueprint and agentic app IDs. Verify runtime gen_ai.agent.id uses the agent instance/source agent ID, not the blueprint ID.',
        path.join(cwd, 'a365.generated.config.json')
      );
    }
  }
}

validatePython();
validateNode();
validateDotnet();
validateSetupArtifacts();

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

process.stdout.write(JSON.stringify({
  ok: true,
  findingCount: findings.length,
  findings,
}, null, 2));
