#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Standalone open-standard runner for the a365-code-validator skill.
// Keep this dependency-free so it works after scripts/install.js copies only
// SKILL.md + references/ into .agents/skills/.

'use strict';

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const skipDirs = new Set(['node_modules', 'dist', 'bin', 'obj', '__pycache__', '.venv', 'venv']);
const files = [];

function walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (full.includes(path.join('plugins', 'agent365', 'hooks')) ||
        full.includes(path.join('plugins', 'agent365', 'skills', 'a365-code-validator'))) {
      continue;
    }
    if (entry.isDirectory()) {
      const lowerName = entry.name.toLowerCase();
      if (entry.name.startsWith('.') || skipDirs.has(entry.name) || lowerName === 'tests' || lowerName === 'test' || lowerName === '__tests__') continue;
      walk(full, depth + 1);
    } else if (entry.isFile() && !entry.name.includes('a365-code-validator')) {
      files.push(full);
    }
  }
}

walk(cwd);

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function rel(file) {
  return path.relative(cwd, file).replace(/\\/g, '/');
}

function byName(...names) {
  return files.filter(f => names.some(n => path.basename(f) === n || path.basename(f).endsWith(n)));
}

function anyContains(list, pattern) {
  return list.some(f => read(f).includes(pattern));
}

function anyMatches(list, regex) {
  return list.some(f => regex.test(read(f)));
}

const findings = [];
function add(severity, id, message, file) {
  findings.push({ severity, id, message, file: file ? rel(file) : undefined });
}

const py = byName('.py');
const ts = byName('.ts', '.js');
const req = byName('requirements.txt', 'pyproject.toml');
const pkg = byName('package.json');
const env = byName('.env', '.env.example', '.env.production', '.env.local');
const cs = byName('.cs');
const csproj = byName('.csproj');
const appsettings = byName('appsettings.json', 'appsettings.Development.json');

function envTrue(name) {
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(true|1|yes)\\s*$`, 'im');
  return env.some(f => re.test(read(f)));
}

function callBlocks(content, name) {
  const blocks = [];
  let index = 0;
  const needle = `${name}(`;
  while ((index = content.indexOf(needle, index)) !== -1) {
    const start = index;
    let depth = 0;
    let end = -1;
    for (let i = index + name.length; i < content.length; i++) {
      if (content[i] === '(') depth++;
      if (content[i] === ')') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) break;
    blocks.push(content.slice(start, end));
    index = end;
  }
  return blocks;
}

function validatePython() {
  const hasPackage = req.some(f => read(f).includes('microsoft-opentelemetry'));
  const hasDistro = anyContains(py, 'use_microsoft_opentelemetry');
  const hasEnableA365 = anyContains(py, 'enable_a365');
  const exporterTrue = anyMatches(py, /\ba365_enable_observability_exporter\s*=\s*True\b/);
  const exporterFalse = anyMatches(py, /\ba365_enable_observability_exporter\s*=\s*False\b/);
  const exporterEnv = envTrue('ENABLE_A365_OBSERVABILITY_EXPORTER') || envTrue('EnableAgent365Exporter');

  if (hasPackage && !hasDistro) {
    add('high', 'python-missing-distro-init', 'microsoft-opentelemetry is installed but no use_microsoft_opentelemetry() call was found.', req.find(f => read(f).includes('microsoft-opentelemetry')));
  }
  if (hasDistro && hasEnableA365 && exporterFalse) {
    add('critical', 'python-exporter-explicitly-disabled', 'Python passes a365_enable_observability_exporter=False; A365 backend export is disabled.', py.find(f => /a365_enable_observability_exporter\s*=\s*False\b/.test(read(f))));
  } else if (hasDistro && hasEnableA365 && !exporterTrue && !exporterEnv) {
    add('critical', 'python-exporter-not-enabled', 'Python enables A365 but does not explicitly enable the observability exporter and no truthy exporter env was found.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  }

  for (const file of py) {
    for (const block of callBlocks(read(file), 'a365_request_scope')) {
      if (block.includes('blueprint_id') && !/\bagent_id\s*=/.test(block)) {
        add('critical', 'python-blueprint-as-agent-id', 'a365_request_scope passes blueprint_id but no agent_id; gen_ai.agent.id can become the Blueprint ID.', file);
      }
    }
  }

  const hasSemantic = anyContains(py, 'InvokeAgentScope') ||
    anyContains(py, 'InferenceScope') ||
    anyContains(py, 'ExecuteToolScope') ||
    anyContains(py, 'gen_ai.operation.name') ||
    anyContains(py, 'invoke_agent') ||
    anyContains(py, 'execute_tool') ||
    anyContains(py, 'output_messages');
  if (hasDistro && !hasSemantic) {
    add('medium', 'python-no-explicit-a365-semantic-spans', 'No explicit supported A365 semantic spans found; MAC Activity needs invoke_agent/chat/execute_tool/output_messages.');
  }
}

function validateNode() {
  const hasPackage = pkg.some(f => read(f).includes('@microsoft/opentelemetry'));
  const hasDistro = anyContains(ts, 'useMicrosoftOpenTelemetry');
  const hasEnabled = anyMatches(ts, /\benabled\s*:\s*true\b/);
  const exporterTrue = anyMatches(ts, /\benableObservabilityExporter\s*:\s*true\b/);
  const exporterFalse = anyMatches(ts, /\benableObservabilityExporter\s*:\s*false\b/);
  const exporterEnv = envTrue('ENABLE_A365_OBSERVABILITY_EXPORTER');

  if (hasPackage && !hasDistro) {
    add('high', 'node-missing-distro-init', '@microsoft/opentelemetry is installed but no useMicrosoftOpenTelemetry() call was found.', pkg.find(f => read(f).includes('@microsoft/opentelemetry')));
  }
  if (hasDistro && hasEnabled && exporterFalse) {
    add('critical', 'node-exporter-explicitly-disabled', 'Node code sets enableObservabilityExporter:false; A365 backend export is disabled.', ts.find(f => /enableObservabilityExporter\s*:\s*false\b/.test(read(f))));
  } else if (hasDistro && hasEnabled && !exporterTrue && !exporterEnv) {
    add('critical', 'node-exporter-not-enabled', 'Node code enables A365 but does not enable the exporter and no truthy exporter env was found.', ts.find(f => read(f).includes('useMicrosoftOpenTelemetry')));
  }
  const hasIdentity = anyContains(ts, 'BaggageBuilder') || anyContains(ts, 'InvokeAgentScope') || anyContains(ts, 'configureA365Hosting');
  if (hasDistro && !hasIdentity) {
    add('high', 'node-missing-identity-scope', 'No BaggageBuilder/InvokeAgentScope/configureA365Hosting usage found; spans may lack agent identity.');
  }
  const hasSemantic = anyContains(ts, 'InvokeAgentScope') ||
    anyContains(ts, 'InferenceScope') ||
    anyContains(ts, 'ExecuteToolScope') ||
    anyContains(ts, 'gen_ai.operation.name') ||
    anyContains(ts, 'invoke_agent') ||
    anyContains(ts, 'execute_tool') ||
    anyContains(ts, 'output_messages');
  if (hasDistro && !hasSemantic) {
    add('medium', 'node-no-explicit-a365-semantic-spans', 'No explicit supported A365 semantic spans found; baggage alone is not enough for MAC Activity.');
  }
}

function validateDotnet() {
  const hasPackage = csproj.some(f => read(f).includes('Microsoft.OpenTelemetry') || read(f).includes('Microsoft.Agents.A365.Observability'));
  const hasWiring = anyContains(cs, 'UseMicrosoftOpenTelemetry') || anyContains(cs, 'AddA365Tracing');
  if (hasPackage && !hasWiring) {
    add('high', 'dotnet-missing-observability-wiring', 'A365/.NET packages are referenced but no UseMicrosoftOpenTelemetry/AddA365Tracing wiring was found.', csproj.find(f => read(f).includes('Microsoft.OpenTelemetry') || read(f).includes('Microsoft.Agents.A365.Observability')));
  }
  const prodSettings = appsettings.filter(f => !path.basename(f).toLowerCase().includes('development'));
  const disabled = prodSettings.find(f => /"EnableAgent365Exporter"\s*:\s*false/i.test(read(f)));
  if (hasWiring && disabled) {
    add('high', 'dotnet-exporter-disabled', 'Production appsettings has EnableAgent365Exporter:false.', disabled);
  }
  if (hasWiring && !anyContains(cs, 'InvokeAgentScope')) {
    add('medium', 'dotnet-no-invoke-agent-scope', 'No InvokeAgentScope found; MAC Activity needs an invoke_agent parent span.');
  }
}

validatePython();
validateNode();
validateDotnet();

const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
process.stdout.write(JSON.stringify({ ok: true, findingCount: findings.length, findings }, null, 2));
