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

function envFalse(name) {
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(false|0|no)\\s*$`, 'im');
  return env.some(f => re.test(read(f)));
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
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
  const s2sTrue = anyMatches(py, /\ba365_use_s2s_endpoint\s*=\s*True\b/);
  const s2sFalse = anyMatches(py, /\ba365_use_s2s_endpoint\s*=\s*False\b/);
  const s2sEnv = envTrue('A365_USE_S2S_ENDPOINT');
  const s2sIntent = anyContains(py, 'a365_contextual_token_resolver') ||
    anyContains(py, 'agent_source_identity') ||
    anyContains(py, 'AgentIdentityTokenResolver') ||
    s2sEnv;

  if (hasPackage && !hasDistro) {
    add('high', 'python-missing-distro-init', 'microsoft-opentelemetry is installed but no use_microsoft_opentelemetry() call was found.', req.find(f => read(f).includes('microsoft-opentelemetry')));
  }
  if (hasDistro && hasEnableA365 && exporterFalse) {
    add('critical', 'python-exporter-explicitly-disabled', 'Python passes a365_enable_observability_exporter=False; A365 backend export is disabled.', py.find(f => /a365_enable_observability_exporter\s*=\s*False\b/.test(read(f))));
  } else if (hasDistro && hasEnableA365 && !exporterTrue && !exporterEnv) {
    add('critical', 'python-exporter-not-enabled', 'Python enables A365 but does not explicitly enable the observability exporter and no truthy exporter env was found.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  } else if (hasDistro && hasEnableA365 && !exporterTrue && exporterEnv) {
    add('medium', 'python-exporter-env-dependent', 'Python does not pass a365_enable_observability_exporter=True in code and depends on runtime env ENABLE_A365_OBSERVABILITY_EXPORTER/EnableAgent365Exporter being true.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  }

  if (envFalse('ENABLE_A365_OBSERVABILITY_EXPORTER') || envFalse('EnableAgent365Exporter')) {
    add('high', 'exporter-env-disabled', 'An env file explicitly disables A365 export. This is fine for local console-only runs, but production/MAC Activity requires the exporter to be true.');
  }
  // Every auth mode exports over the S2S route; the legacy delegated route rejects app-only
  // tokens and needs admin consent. Contextual/agent-identity resolvers imply S2S intent too.
  const expectsS2S = hasDistro && (hasEnableA365 || s2sIntent);
  if (expectsS2S && s2sFalse) {
    add('critical', 'python-s2s-endpoint-disabled', 'Python passes a365_use_s2s_endpoint=False. A365 export must use the S2S route in every auth mode; the delegated route rejects app-only tokens and needs admin consent.', py.find(f => /a365_use_s2s_endpoint\s*=\s*False\b/.test(read(f))));
  } else if (expectsS2S && !s2sTrue && s2sEnv) {
    add('medium', 'python-s2s-endpoint-env-dependent', 'Python depends on A365_USE_S2S_ENDPOINT=true in env to select the S2S route. Prefer a365_use_s2s_endpoint=True in code.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  } else if (expectsS2S && !s2sTrue && !s2sEnv) {
    add('high', 'python-s2s-endpoint-not-set', 'Python does not set a365_use_s2s_endpoint=True (or A365_USE_S2S_ENDPOINT=true), so export uses the legacy delegated route. Every auth mode must export over the S2S route with an app-only token.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  }
  for (const file of py) {
    const content = read(file);
    const delegated = callBlocks(content, 'exchange_token').some(block => /observability/i.test(block)) ||
      /(?<!\bdef\s+)\bcache_agentic_token\s*\(/.test(content) ||
      /\ba365_token_resolver\s*=\s*(?:lambda\b[^:\n]*:\s*)?[^,)\n]*\b(get_cached_agentic_token|AgenticTokenCache|get_observability_token)\b/.test(content);
    if (delegated) {
      add('high', 'python-obs-delegated-token', 'Telemetry uses a delegated (OBO) token (exchange_token for the observability scope, cache_agentic_token, or an AgenticTokenCache / get_cached_agentic_token resolver). The S2S route rejects delegated tokens; acquire an app-only token for the agent identity instead (instrument-observability app-only resolver).', file);
    }
  }
  const prefetchFile = py.find(f => callBlocks(read(f), 'prefetch').some(block => /self\.connection_manager/.test(block)));
  if (prefetchFile && !anyMatches(py, /\bself\.connection_manager\s*=/)) {
    add('high', 'python-obs-prefetch-connection-missing', 'The app-only token prefetch uses self.connection_manager, but no file assigns it. CloudAdapter does not expose its connection manager, so every prefetch fails and no spans export. Store the MsalConnectionManager passed to CloudAdapter on the host.', prefetchFile);
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

  const pythonText = py.map(read).join('\n');
  const hasInvoke = /InvokeAgentScope|gen_ai\.operation\.name['"]?\s*[:=]|invoke_agent/.test(pythonText);
  const hasExecuteTool = /ExecuteToolScope|execute_tool/.test(pythonText);
  const hasAgentName = /gen_ai\.agent\.name|\bagent_name\s*=|AgentDetails\s*\([^)]*agent_name/s.test(pythonText);
  const hasConversation = /gen_ai\.conversation\.id|\bconversation_id\s*=|\.conversation_id\s*\(/.test(pythonText);
  const hasChannel = /microsoft\.channel\.name|\bchannel_name\s*=|\.channel_name\s*\(/.test(pythonText);
  const hasInputMessages = /gen_ai\.input\.messages|record_input_messages|Request\s*\(\s*content\s*=/.test(pythonText);
  const hasOutputMessages = /gen_ai\.output\.messages|record_output_messages|record_response/.test(pythonText);
  const hasAgentUser = /microsoft\.agent\.user\.id|\bagent_user_oid\s*=|\.agent_user_id\s*\(/.test(pythonText);

  if (hasDistro && hasInvoke && !hasAgentName) add('medium', 'python-missing-agent-name', 'No gen_ai.agent.name/AgentDetails agent_name signal found. Admin/reporting surfaces may show a GUID or blank agent name.');
  if (hasDistro && hasInvoke && !hasConversation) add('medium', 'python-missing-conversation-id', 'No gen_ai.conversation.id/conversation_id signal found. Reportable runs need a conversation or logical run ID.');
  if (hasDistro && hasInvoke && !hasChannel) add('medium', 'python-missing-channel-name', 'No microsoft.channel.name/channel_name signal found. Activity/reporting surfaces need a channel such as msteams, web, icm, or scheduler.');
  if (hasDistro && hasInvoke && !hasInputMessages) add('medium', 'python-missing-input-messages', 'No gen_ai.input.messages/record_input_messages signal found for invoke/chat spans.');
  if (hasDistro && hasInvoke && !hasOutputMessages) add('medium', 'python-missing-output-messages', 'No gen_ai.output.messages/record_output_messages/record_response signal found for invoke/chat/output spans.');
  if (hasDistro && hasExecuteTool) {
    const hasToolCallId = /gen_ai\.tool\.call\.id|tool_call_id/.test(pythonText);
    const hasToolArgs = /gen_ai\.tool\.call\.arguments|arguments\s*=/.test(pythonText);
    const hasToolResult = /gen_ai\.tool\.call\.result|record_response/.test(pythonText);
    if (!hasToolCallId || !hasToolArgs || !hasToolResult) add('medium', 'python-incomplete-tool-span-details', 'execute_tool spans found, but tool call id/arguments/result are not all visible. Tool activity can be incomplete.');
  }
  if (hasDistro && /a365_contextual_token_resolver/.test(pythonText) && /user\.id|\buser_oid\b/.test(pythonText) && !hasAgentUser) {
    add('medium', 'python-obo-agent-user-attribute-missing', 'Code uses contextual token resolution and user.id/user_oid, but no microsoft.agent.user.id/agent_user_oid signal is visible. OBO/Agent-User export may never trigger.');
  }
  if (hasDistro && /OPERATIONS\s*=\s*\[[^\]]*['"]inference['"]|gen_ai\.operation\.name[\s\S]{0,300}['"]inference['"]/.test(pythonText)) {
    add('medium', 'python-direct-inference-operation-name', 'Code appears to emit gen_ai.operation.name=inference directly. Public docs use chat for LLM spans; direct inference operations may not classify as expected.');
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
  // Every auth mode exports over the S2S route with an app-only token.
  if (hasDistro && hasEnabled && !anyMatches(ts, /\buseS2SEndpoint\s*:\s*true\b/)) {
    add('high', 'node-obs-delegated-route', 'Node code does not set useS2SEndpoint: true, so A365 export uses the legacy delegated route. Every auth mode must export over the S2S route with an app-only tokenResolver.', ts.find(f => read(f).includes('useMicrosoftOpenTelemetry')));
  }
  for (const file of ts) {
    const content = read(file);
    if (['refreshObservabilityToken', 'RefreshObservabilityToken'].some(name => callBlocks(content, name).some(block => /authorization/i.test(block))) ||
        /AgenticTokenCacheInstance\s*\.\s*getObservabilityToken\s*\(/.test(content)) {
      add('high', 'node-obs-delegated-token', 'Telemetry uses a delegated (OBO) token (refreshObservabilityToken(..., authorization) or AgenticTokenCacheInstance.getObservabilityToken). The S2S route rejects delegated tokens; use an app-only tokenResolver for the agent identity instead.', file);
    }
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
  const withExporter = appsettings.filter(f => read(f).includes('EnableAgent365Exporter'));
  const prodSettings = withExporter.filter(f => !path.basename(f).toLowerCase().includes('development'));
  const disabled = prodSettings.find(f => /"EnableAgent365Exporter"\s*:\s*false/i.test(read(f)));
  if (hasWiring && disabled) {
    add('high', 'dotnet-exporter-disabled', 'Production appsettings has EnableAgent365Exporter:false.', disabled);
  } else if (hasWiring && withExporter.length === 0) {
    add('medium', 'dotnet-exporter-config-missing', 'No EnableAgent365Exporter setting found. .NET exporter defaults can be console-only unless production config sets it true.');
  }
  if (hasWiring && !anyContains(cs, 'InvokeAgentScope')) {
    add('medium', 'dotnet-no-invoke-agent-scope', 'No InvokeAgentScope found; MAC Activity needs an invoke_agent parent span.');
  }
  // Every auth mode exports over the S2S route with an app-only token.
  if (anyContains(cs, 'UseMicrosoftOpenTelemetry') && !anyMatches(cs, /\bUseS2SEndpoint\s*=\s*true\b/)) {
    add('high', 'dotnet-obs-delegated-route', 'UseMicrosoftOpenTelemetry is wired without UseS2SEndpoint = true, so A365 export uses the legacy delegated route. Set o.Agent365.UseS2SEndpoint = true (o.Agent365.Exporter.UseS2SEndpoint on Microsoft.OpenTelemetry 1.0.2 and earlier) with an app-only TokenResolver in every auth mode.', cs.find(f => read(f).includes('UseMicrosoftOpenTelemetry')));
  }
  for (const file of cs) {
    const content = read(file);
    if (callBlocks(content, 'RegisterObservability').some(block => block.includes('AgenticTokenStruct')) ||
        /\bnew\s+AgenticTokenStruct\s*[({]|IExporterTokenCache\s*<\s*AgenticTokenStruct\s*>\s*\??\s+[A-Za-z_]\w*/.test(content)) {
      add('high', 'dotnet-obs-delegated-token', 'Telemetry uses a delegated (OBO) token (RegisterObservability with AgenticTokenStruct, new AgenticTokenStruct(...), or an IExporterTokenCache<AgenticTokenStruct> dependency). The S2S route rejects delegated tokens; wire an app-only TokenResolver for the agent identity instead.', file);
    }
  }
}

function validateSetupArtifacts() {
  const generated = readJsonSafe(path.join(cwd, 'a365.generated.config.json'));
  if (!generated) return;
  if (generated.completed === false) {
    add('medium', 'a365-generated-config-incomplete', 'a365.generated.config.json has completed:false. Setup may be partial; verify consent/resource grants before expecting MAC Activity.', path.join(cwd, 'a365.generated.config.json'));
  }
  if (generated.agentBlueprintId && generated.agenticAppId && generated.agentBlueprintId === generated.agenticAppId) {
    add('critical', 'blueprint-id-used-as-agent-id', 'a365.generated.config.json has identical blueprint and agentic app IDs. Verify runtime gen_ai.agent.id uses the agent instance/source agent ID, not the blueprint ID.', path.join(cwd, 'a365.generated.config.json'));
  }
  const staticConfig = readJsonSafe(path.join(cwd, 'a365.config.json'));
  if (staticConfig && staticConfig.aiTeammate === false && generated.agenticAppId && !generated.agentRegistrationId) {
    add('medium', 'agent-registration-not-recorded', 'a365.generated.config.json has an agent identity but no agentRegistrationId. The S2S route authorizes registered agent instances without an OtelWrite grant; an unregistered instance gets 403 insufficient_scope. Run a365 setup all --agent-registration-only (idempotent).', path.join(cwd, 'a365.generated.config.json'));
  }
}

validatePython();
validateNode();
validateDotnet();
validateSetupArtifacts();

const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
process.stdout.write(JSON.stringify({ ok: true, findingCount: findings.length, findings }, null, 2));
