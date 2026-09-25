// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-instrument-observability.js');

// ── Shared fixture templates ─────────────────────────────────────────────────

// Minimal detection cache stub — the validator only checks existence, not
// content. Required by the Phase 0A "cache must exist" guard added on the
// enforce-detection-cache branch; without it the validator reports the
// missing-cache failure on every per-language project.
const DETECTION_CACHE_STUB = JSON.stringify({
  agentStack: 'LangChain',
  programmingLanguage: 'NodeJS',
  detectedAt: '2026-01-01T00:00:00.000Z',
});

const DOTNET_VALID = {
  '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
  'MyAgent.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Microsoft.Agents.A365.Observability.Runtime" Version="1.0.0" />
    <PackageReference Include="Microsoft.Agents.A365.Observability.Hosting" Version="1.0.0" />
  </ItemGroup>
</Project>`,
  'Program.cs': `builder.Services.AddA365Tracing(config => { config.WithAgentFramework(); });\nbuilder.Services.AddAgenticTracingExporter(clusterCategory: "production");`,
  'MyAgent.cs': `var baggage = new BaggageBuilder().FromTurnContext(turnContext).Build();`,
  'appsettings.json': JSON.stringify({
    Agent365Observability: { EnableAgent365Exporter: true },
    Logging: { LogLevel: { 'Microsoft.Agents.A365.Observability': 'Information', OpenTelemetry: 'Warning' } },
  }, null, 2),
  '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true',
};

const NODEJS_VALID = {
  '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
  'package.json': JSON.stringify({
    name: 'my-agent',
    dependencies: { '@microsoft/agents-a365-observability': '^1.0.0', '@microsoft/agents-a365-observability-hosting': '^1.0.0' },
  }, null, 2),
  'index.ts': `
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { BaggageBuilder, AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';
ObservabilityManager.configure({ exporterOptions: { enabled: true }, withTokenResolver: AgenticTokenCacheInstance.getToken });
const baggage = new BaggageBuilder().fromActivity(activity).build();
  `.trim(),
  '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true',
};

const PYTHON_VALID = {
  '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
  'requirements.txt': 'microsoft-agents-a365-observability-core>=0.3.0\nmicrosoft-agents-a365-observability-hosting>=0.3.0\n',
  'app.py': `
from microsoft_agents_a365.observability.core import configure
from microsoft_agents_a365.observability.hosting.token_cache_helpers import AgenticTokenCache
configure(exporter_options=None, token_resolver=AgenticTokenCache.get_token)
baggage = BaggageBuilder().from_turn_context(tc).build()
  `.trim(),
  '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true',
};

// ── Cross-language: .a365-workspace-detection.local.json must exist ─────────

describe('validate-observability — detection cache (required)', () => {
  test('.NET project without detection cache → reports cache-required', () => {
    const { ['.a365-workspace-detection.local.json']: _omit, ...rest } = DOTNET_VALID;
    const dir = createFixture(rest);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });

  test('Node.js project without detection cache → reports cache-required', () => {
    const { ['.a365-workspace-detection.local.json']: _omit, ...rest } = NODEJS_VALID;
    const dir = createFixture(rest);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });

  test('Python project without detection cache → reports cache-required', () => {
    const { ['.a365-workspace-detection.local.json']: _omit, ...rest } = PYTHON_VALID;
    const dir = createFixture(rest);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });
});

// ── .NET tests ───────────────────────────────────────────────────────────────

describe('validate-observability — .NET', () => {
  test('valid OBO instrumentation → ok', () => {
    const dir = createFixture(DOTNET_VALID);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing observability package → reports package name', () => {
    const dir = createFixture({
      ...DOTNET_VALID,
      'MyAgent.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup></ItemGroup></Project>`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Microsoft\.Agents\.A365\.Observability\.Runtime/);
    } finally { cleanup(dir); }
  });

  test('missing Program.cs wiring → reports AddA365Tracing', () => {
    const dir = createFixture({ ...DOTNET_VALID, 'Program.cs': `// no observability` });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /AddA365Tracing/);
    } finally { cleanup(dir); }
  });

  test('missing BaggageBuilder → reports context missing', () => {
    const dir = createFixture({ ...DOTNET_VALID, 'MyAgent.cs': `// no baggage` });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /BaggageBuilder/);
    } finally { cleanup(dir); }
  });

  test('missing appsettings config → reports EnableAgent365Exporter', () => {
    const dir = createFixture({ ...DOTNET_VALID, 'appsettings.json': `{}` });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /EnableAgent365Exporter/);
    } finally { cleanup(dir); }
  });

  test('OBO wiring without WithAgentFramework → reports WithAgentFramework missing', () => {
    const dir = createFixture({
      ...DOTNET_VALID,
      'Program.cs': `builder.Services.AddA365Tracing();\nbuilder.Services.AddAgenticTracingExporter(clusterCategory: "production");`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /WithAgentFramework/);
    } finally { cleanup(dir); }
  });

  test('OBO wiring without clusterCategory → reports clusterCategory missing', () => {
    const dir = createFixture({
      ...DOTNET_VALID,
      'Program.cs': `builder.Services.AddA365Tracing(config => { config.WithAgentFramework(); });\nbuilder.Services.AddAgenticTracingExporter();`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /clusterCategory/);
    } finally { cleanup(dir); }
  });

  test('S2S path — ObservabilityTokenService scaffold satisfies baggage check', () => {
    const dir = createFixture({
      ...DOTNET_VALID,
      'MyAgent.cs': `// no BaggageBuilder here`,
      'Observability/ObservabilityTokenService.cs': `public class ObservabilityTokenService {}`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      // BaggageBuilder check should pass via S2S scaffold
      assert.doesNotMatch(r.reason ?? '', /BaggageBuilder/);
    } finally { cleanup(dir); }
  });
});

// ── Node.js tests ────────────────────────────────────────────────────────────

describe('validate-observability — Node.js', () => {
  test('valid OBO instrumentation → ok', () => {
    const dir = createFixture(NODEJS_VALID);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing npm package → reports @microsoft/opentelemetry', () => {
    const dir = createFixture({
      ...NODEJS_VALID,
      'package.json': JSON.stringify({ name: 'my-agent', dependencies: {} }, null, 2),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /@microsoft\/opentelemetry/);
    } finally { cleanup(dir); }
  });

  test('missing ObservabilityManager → reports configure', () => {
    const dir = createFixture({
      ...NODEJS_VALID,
      'index.ts': `import { BaggageBuilder, AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /useMicrosoftOpenTelemetry/);
    } finally { cleanup(dir); }
  });

  test('S2S — valid scaffold with useS2SEndpoint → ok', () => {
    const dir = createFixture({
      ...NODEJS_VALID,
      '.a365-workspace-detection.local.json': JSON.stringify({ authMode: 's2s' }),
      'index.ts': `
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { BaggageBuilder } from '@microsoft/agents-a365-observability-hosting';
import { getS2SObservabilityToken } from './observability/observability-token-service';
ObservabilityManager.configure({ exporterOptions: { useS2SEndpoint: true }, withTokenResolver: getS2SObservabilityToken });
      `.trim(),
      'observability/observability-token-service.ts': `export async function startObservabilityTokenService() {}
export function getS2SObservabilityToken() { return ''; }`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('S2S — missing scaffold file → reports scaffold missing', () => {
    const dir = createFixture({
      ...NODEJS_VALID,
      '.a365-workspace-detection.local.json': JSON.stringify({ authMode: 's2s' }),
      'index.ts': `
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { BaggageBuilder, AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';
ObservabilityManager.configure({ exporterOptions: {}, withTokenResolver: AgenticTokenCacheInstance.getToken });
      `.trim(),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /observability-token-service/);
    } finally { cleanup(dir); }
  });

  test('S2S — missing useS2SEndpoint → reports useS2SEndpoint', () => {
    const dir = createFixture({
      ...NODEJS_VALID,
      '.a365-workspace-detection.local.json': JSON.stringify({ authMode: 's2s' }),
      'index.ts': `
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { BaggageBuilder } from '@microsoft/agents-a365-observability-hosting';
import { startObservabilityTokenService, getS2SObservabilityToken } from './observability/observability-token-service';
ObservabilityManager.configure({ exporterOptions: {}, withTokenResolver: getS2SObservabilityToken });
      `.trim(),
      'observability/observability-token-service.ts': `export async function startObservabilityTokenService() {}
export function getS2SObservabilityToken() { return ''; }`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /useS2SEndpoint/);
    } finally { cleanup(dir); }
  });
});

// ── Python tests ─────────────────────────────────────────────────────────────

describe('validate-observability — Python', () => {
  test('valid OBO instrumentation → ok', () => {
    const dir = createFixture(PYTHON_VALID);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing package in requirements.txt → reports distribution name', () => {
    const dir = createFixture({ ...PYTHON_VALID, 'requirements.txt': 'requests>=2.0\n' });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /microsoft-opentelemetry/);
    } finally { cleanup(dir); }
  });

  test('missing configure() call → reports configure', () => {
    const dir = createFixture({
      ...PYTHON_VALID,
      'app.py': `from microsoft_agents_a365.observability.core import something\nbaggage = BaggageBuilder().build()\ntoken_resolver = None`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /use_microsoft_opentelemetry/);
    } finally { cleanup(dir); }
  });

  test('S2S — valid scaffold → ok', () => {
    const dir = createFixture({
      ...PYTHON_VALID,
      '.a365-workspace-detection.local.json': JSON.stringify({ authMode: 's2s' }),
      'app.py': `
from microsoft_agents_a365.observability.core import configure
configure(use_s2s_endpoint=True, token_resolver=get_s2s_observability_token)
baggage = BaggageBuilder().build()
      `.trim(),
      'observability/observability_token_service.py': `async def start_observability_token_service(): pass\ndef get_s2s_observability_token(): return ''`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('S2S — missing use_s2s_endpoint → reports use_s2s_endpoint', () => {
    const dir = createFixture({
      ...PYTHON_VALID,
      '.a365-workspace-detection.local.json': JSON.stringify({ authMode: 's2s' }),
      'app.py': `
from microsoft_agents_a365.observability.core import configure
configure(token_resolver=get_s2s_observability_token)
baggage = BaggageBuilder().build()
      `.trim(),
      'observability/observability_token_service.py': `async def start_observability_token_service(): pass\ndef get_s2s_observability_token(): return ''`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /use_s2s_endpoint/);
    } finally { cleanup(dir); }
  });
});

// ── Distro: telemetry must use the S2S route with an app-only token ─────────

const DOTNET_DISTRO_VALID = {
  '.a365-workspace-detection.local.json': JSON.stringify({ agentType: 'ai-teammate', authMode: 'agentic-user' }),
  'MyAgent.csproj': `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>`,
  'Program.cs': `builder.Services.AddSingleton<AgentAppTokenResolver>();
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Agent365.UseS2SEndpoint = true;
    o.Agent365.TokenResolver = (agentId, tenantId) => obsTokens?.ResolveAsync(agentId, tenantId) ?? Task.FromResult<string?>(null);
});`,
  'MyAgent.cs': `using IDisposable? baggageScope = new BaggageBuilder().TenantId(t).AgentId(a).Build();
invokeScope = InvokeAgentScope.Start(request: r, scopeDetails: d, agentDetails: ad, callerDetails: cd);`,
  'Observability/AgentAppTokenResolver.cs': `public sealed class AgentAppTokenResolver { }`,
  'appsettings.json': DOTNET_VALID['appsettings.json'],
};

const NODEJS_DISTRO_VALID = {
  '.a365-workspace-detection.local.json': JSON.stringify({ agentType: 'ai-teammate', authMode: 'agentic-user' }),
  'package.json': JSON.stringify({ name: 'my-agent', dependencies: { '@microsoft/opentelemetry': '^1.4.0' } }, null, 2),
  'src/index.ts': `
import { useMicrosoftOpenTelemetry } from '@microsoft/opentelemetry';
import { createAppTokenResolver } from './observability/app-token-resolver';
const appTokenResolver = createAppTokenResolver(() => getObsConnection());
useMicrosoftOpenTelemetry({ a365: { enabled: true, enableObservabilityExporter: true, useS2SEndpoint: true, tokenResolver: appTokenResolver } });
  `.trim(),
  'src/agent.ts': `
const baggageScope = BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), turnContext as any).build();
await baggageScope.run(async () => { const scope = InvokeAgentScope.start(request, details, agentDetails, callerDetails); });
  `.trim(),
  'src/observability/app-token-resolver.ts': `export function createAppTokenResolver(getProvider: any) { return async () => ''; }`,
  '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true',
};

const PYTHON_DISTRO_VALID = {
  '.a365-workspace-detection.local.json': JSON.stringify({ agentType: 'system-agent', authMode: 'obo' }),
  'pyproject.toml': '[project]\ndependencies = ["microsoft-opentelemetry"]\n',
  'host_agent_server.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry
from observability.app_token_resolver import AppTokenResolver
OBS_TOKENS = AppTokenResolver()
use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=OBS_TOKENS.resolve)

class GenericAgentHost:
    def __init__(self):
        self.connection_manager = MsalConnectionManager(**agents_sdk_config)
        self.adapter = CloudAdapter(connection_manager=self.connection_manager)

    async def _setup_observability_token(self, context, tenant_id, agent_id):
        await OBS_TOKENS.prefetch(self.connection_manager, tenant_id, agent_id)

with BaggageBuilder().tenant_id(t).agent_id(a).build():
    with InvokeAgentScope.start(request, details, agent_details, caller_details):
        pass
  `.trim(),
  'observability/app_token_resolver.py': 'class AppTokenResolver:\n    pass\n',
  '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true',
};

describe('validate-observability — S2S route with app-only token (distro, every auth mode)', () => {
  test('.NET distro with UseS2SEndpoint and AgentAppTokenResolver → ok', () => {
    const dir = createFixture(DOTNET_DISTRO_VALID);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('.NET distro without UseS2SEndpoint = true → reports the S2S route requirement', () => {
    const dir = createFixture({
      ...DOTNET_DISTRO_VALID,
      'Program.cs': DOTNET_DISTRO_VALID['Program.cs'].replace('o.Agent365.UseS2SEndpoint = true;', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /S2S route in every auth mode.*UseS2SEndpoint = true/);
    } finally { cleanup(dir); }
  });

  test('.NET per-turn RegisterObservability with AgenticTokenStruct → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...DOTNET_DISTRO_VALID,
      'MyAgent.cs': `${DOTNET_DISTRO_VALID['MyAgent.cs']}
_agentTokenCache?.RegisterObservability(agentId, tenantId,
    new AgenticTokenStruct(userAuthorization: UserAuthorization, turnContext: turnContext, authHandlerName: name),
    EnvironmentUtils.GetObservabilityAuthenticationScope());`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /RegisterObservability.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('.NET S2S scaffold RegisterObservability(agentId, tenantId, token, scopes) is not flagged', () => {
    const dir = createFixture({
      ...DOTNET_DISTRO_VALID,
      'Observability/ObservabilityTokenService.cs': `_tokenCache.RegisterObservability(_agentId, _tenantId, obsResult.AccessToken, ObservabilityScopes);`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Node.js distro with useS2SEndpoint and app-only resolver → ok', () => {
    const dir = createFixture(NODEJS_DISTRO_VALID);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Node.js distro without useS2SEndpoint: true → reports the S2S route requirement', () => {
    const dir = createFixture({
      ...NODEJS_DISTRO_VALID,
      'src/index.ts': NODEJS_DISTRO_VALID['src/index.ts'].replace(' useS2SEndpoint: true,', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /S2S route in every auth mode.*useS2SEndpoint: true/);
    } finally { cleanup(dir); }
  });

  test('Node.js refreshObservabilityToken(..., authorization) → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...NODEJS_DISTRO_VALID,
      'src/agent.ts': `${NODEJS_DISTRO_VALID['src/agent.ts']}
await AgenticTokenCacheInstance.refreshObservabilityToken(
  agentId, tenantId, turnContext as any, this.authorization as any);`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /refreshObservabilityToken.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Node.js comment mentioning refreshObservabilityToken is not flagged', () => {
    const dir = createFixture({
      ...NODEJS_DISTRO_VALID,
      'src/agent.ts': `${NODEJS_DISTRO_VALID['src/agent.ts']}
// Do NOT call AgenticTokenCacheInstance.refreshObservabilityToken in any auth mode (authorization is for workload calls).`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python distro with a365_use_s2s_endpoint=True and app-only resolver → ok', () => {
    const dir = createFixture(PYTHON_DISTRO_VALID);
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python distro without a365_use_s2s_endpoint → reports the S2S route requirement', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': PYTHON_DISTRO_VALID['host_agent_server.py'].replace(' a365_use_s2s_endpoint=True,', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /S2S route in every auth mode.*a365_use_s2s_endpoint=True/);
    } finally { cleanup(dir); }
  });

  test('Python distro relying on A365_USE_S2S_ENDPOINT=true in .env → ok', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': PYTHON_DISTRO_VALID['host_agent_server.py'].replace(' a365_use_s2s_endpoint=True,', ''),
      '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true\nA365_USE_S2S_ENDPOINT=true\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python exchange_token with the observability scope → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': `${PYTHON_DISTRO_VALID['host_agent_server.py']}

async def _legacy(self, context):
    token = await self.agent_app.auth.exchange_token(
        context, scopes=get_observability_authentication_scope(), auth_handler_id=self.auth_handler_name)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /exchange_token.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Python workload exchange_token for MCP scopes is not flagged', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'mcp_tools.py': `token = await auth.exchange_token(context, scopes=["ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default"], auth_handler_id=handler)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('.NET AgenticTokenStruct built in a variable (A365OtelWrapper shape) → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...DOTNET_DISTRO_VALID,
      'A365OtelWrapper.cs': `var agenticToken = new AgenticTokenStruct(userAuthorization: auth, turnContext: turnContext, authHandlerName: name);
agentTokenCache?.RegisterObservability(agentId, tenantId, agenticToken, scopes);`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /RegisterObservability.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('.NET IExporterTokenCache<AgenticTokenStruct> constructor dependency → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...DOTNET_DISTRO_VALID,
      'MyAgent.cs': `${DOTNET_DISTRO_VALID['MyAgent.cs']}
public MyAgent(AgentApplicationOptions options, IExporterTokenCache<AgenticTokenStruct> agentTokenCache) : base(options) { }`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Node.js tokenResolver reading AgenticTokenCacheInstance.getObservabilityToken → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...NODEJS_DISTRO_VALID,
      'src/index.ts': NODEJS_DISTRO_VALID['src/index.ts'].replace('tokenResolver: appTokenResolver',
        "tokenResolver: (agentId, tenantId) => AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId) ?? ''"),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /getObservabilityToken.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Python cache_agentic_token + get_cached_agentic_token resolver (no inline scope) → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': PYTHON_DISTRO_VALID['host_agent_server.py']
        .replace('a365_token_resolver=OBS_TOKENS.resolve', 'a365_token_resolver=get_cached_agentic_token')
        .replace('await OBS_TOKENS.prefetch(self.connection_manager, tenant_id, agent_id)',
          'token = await self.agent_app.auth.exchange_token(context, auth_handler_id=self.auth_handler_name)\n        cache_agentic_token(tenant_id, agent_id, token.token)'),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /cache_agentic_token.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Python leftover legacy token_cache.py definition alone is not flagged', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'token_cache.py': 'def cache_agentic_token(tenant_id, agent_id, token):\n    _cache[(tenant_id, agent_id)] = token\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python leftover per-turn cache_agentic_token(...) beside an app-only resolver → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': `${PYTHON_DISTRO_VALID['host_agent_server.py']}

async def _legacy_cache(self, context, tenant_id, agent_id):
    token = await self.agent_app.auth.exchange_token(context, auth_handler_id=self.auth_handler_name)
    cache_agentic_token(tenant_id, agent_id, token.token)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /cache_agentic_token.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Python lambda a365_token_resolver over get_cached_agentic_token → reports delegated telemetry token', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': PYTHON_DISTRO_VALID['host_agent_server.py'].replace('a365_token_resolver=OBS_TOKENS.resolve',
        'a365_token_resolver=lambda agent_id, tenant_id: get_cached_agentic_token(tenant_id, agent_id)'),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /delegated a365_token_resolver.*delegated \(OBO\) telemetry token/);
    } finally { cleanup(dir); }
  });

  test('Python lambda a365_token_resolver over the app-only resolver is not flagged', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': PYTHON_DISTRO_VALID['host_agent_server.py'].replace('a365_token_resolver=OBS_TOKENS.resolve',
        'a365_token_resolver=lambda agent_id, tenant_id: OBS_TOKENS.resolve(agent_id, tenant_id)'),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python prefetch(self.connection_manager) without storing it on the host → reports missing connection manager', () => {
    const dir = createFixture({
      ...PYTHON_DISTRO_VALID,
      'host_agent_server.py': PYTHON_DISTRO_VALID['host_agent_server.py']
        .replace('self.connection_manager = MsalConnectionManager(**agents_sdk_config)', 'connection_manager = MsalConnectionManager(**agents_sdk_config)')
        .replace('CloudAdapter(connection_manager=self.connection_manager)', 'CloudAdapter(connection_manager=connection_manager)'),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /no file assigns self\.connection_manager/);
    } finally { cleanup(dir); }
  });
});

// ── Unknown project ───────────────────────────────────────────────────────────

describe('validate-observability — unknown project', () => {
  test('empty directory → ok (nothing to validate)', () => {
    const dir = createFixture({ 'README.md': '# My Project' });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});
