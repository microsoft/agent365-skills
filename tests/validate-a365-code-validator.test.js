// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-a365-code-validator.js');

function findingIds(result) {
  return (result.findings || []).map(f => f.id);
}

describe('validate-a365-code-validator', () => {
  test('Python enable_a365 without exporter flag reports critical exporter finding', () => {
    const dir = createFixture({
      'pyproject.toml': `
[project]
dependencies = ["microsoft-opentelemetry>=1.3.4"]
      `.trim(),
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True)
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-exporter-not-enabled'));
      assert.equal(
        result.findings.find(f => f.id === 'python-exporter-not-enabled').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python queue poller scope with blueprint_id only reports identity binding finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'observability.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)
      `.trim(),
      'queue_poller.py': `
from observability import a365_request_scope

def run_cycle(settings):
    with a365_request_scope(
        tenant_id=settings.agent_tenant_id,
        blueprint_id=settings.agent_blueprint_app_id,
    ):
        return "ok"
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-blueprint-as-agent-id'));
      assert.equal(
        result.findings.find(f => f.id === 'python-blueprint-as-agent-id').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python explicit exporter false reports disabled exporter finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=False)
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-exporter-explicitly-disabled'));
      assert.equal(
        result.findings.find(f => f.id === 'python-exporter-explicitly-disabled').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python explicit exporter and agent_id scope does not report critical Python findings', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)

def run(settings):
    with a365_request_scope(
        tenant_id=settings.agent_tenant_id,
        agent_id=settings.agent_identity_app_id,
        blueprint_id=settings.agent_blueprint_app_id,
    ):
        return "ok"
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(!findingIds(result).includes('python-exporter-not-enabled'));
      assert.ok(!findingIds(result).includes('python-blueprint-as-agent-id'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python S2S env-only endpoint reports env-dependent finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      '.env.example': 'A365_USE_S2S_ENDPOINT=true\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
    a365_contextual_token_resolver=lambda ctx: "token",
)
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-s2s-endpoint-env-dependent'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python missing activity context reports activity field findings', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)

def run():
    with tracer.start_as_current_span("invoke_agent") as span:
        span.set_attribute("gen_ai.operation.name", "invoke_agent")
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      const ids = findingIds(result);
      assert.ok(ids.includes('python-missing-agent-name'));
      assert.ok(ids.includes('python-missing-conversation-id'));
      assert.ok(ids.includes('python-missing-channel-name'));
      assert.ok(ids.includes('python-missing-input-messages'));
      assert.ok(ids.includes('python-missing-output-messages'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python contextual resolver with only user.id reports OBO agent user gap', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
    a365_use_s2s_endpoint=True,
    a365_contextual_token_resolver=lambda ctx: "token",
)

def run():
    span.set_attribute("gen_ai.operation.name", "invoke_agent")
    span.set_attribute("gen_ai.agent.name", "Agent")
    span.set_attribute("gen_ai.conversation.id", "conv")
    span.set_attribute("microsoft.channel.name", "msteams")
    span.set_attribute("gen_ai.input.messages", "[]")
    span.set_attribute("gen_ai.output.messages", "[]")
    span.set_attribute("user.id", "agent-user")
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-obo-agent-user-attribute-missing'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python direct inference operation reports unsupported operation finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)
OPERATIONS = ["invoke_agent", "chat", "execute_tool", "output_messages", "inference"]
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-direct-inference-operation-name'));
    } finally {
      cleanup(dir);
    }
  });

  test('Node baggage-only project reports missing semantic spans', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'node-agent',
        dependencies: { '@microsoft/opentelemetry': '^1.0.0' },
      }, null, 2),
      'index.ts': `
import { useMicrosoftOpenTelemetry, BaggageBuilder } from '@microsoft/opentelemetry';

useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
    tokenResolver: () => '',
  },
});

new BaggageBuilder().build();
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('node-no-explicit-a365-semantic-spans'));
    } finally {
      cleanup(dir);
    }
  });

  test('Node explicit exporter false reports disabled exporter finding', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'node-agent',
        dependencies: { '@microsoft/opentelemetry': '^1.0.0' },
      }, null, 2),
      'index.ts': `
import { useMicrosoftOpenTelemetry } from '@microsoft/opentelemetry';

useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: false,
    tokenResolver: () => '',
  },
});
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('node-exporter-explicitly-disabled'));
      assert.equal(
        result.findings.find(f => f.id === 'node-exporter-explicitly-disabled').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });
});

// ── S2S route with an app-only token in every auth mode ─────────────────────

const STANDALONE = path.join(__dirname, '../plugins/agent365/skills/a365-code-validator/references/a365-code-validator.js');

const NODE_PKG = JSON.stringify({ name: 'node-agent', dependencies: { '@microsoft/opentelemetry': '^1.4.0' } }, null, 2);
const NODE_S2S_INDEX = `
import { useMicrosoftOpenTelemetry } from '@microsoft/opentelemetry';
useMicrosoftOpenTelemetry({
  a365: { enabled: true, enableObservabilityExporter: true, useS2SEndpoint: true, tokenResolver: appTokenResolver },
});
`.trim();

describe('validate-a365-code-validator — S2S route and delegated telemetry', () => {
  test('Node distro without useS2SEndpoint reports delegated route (high)', () => {
    const dir = createFixture({
      'package.json': NODE_PKG,
      'index.ts': NODE_S2S_INDEX.replace(' useS2SEndpoint: true,', ''),
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      const finding = result.findings.find(f => f.id === 'node-obs-delegated-route');
      assert.ok(finding, 'expected node-obs-delegated-route');
      assert.equal(finding.severity, 'high');
    } finally {
      cleanup(dir);
    }
  });

  test('Node refreshObservabilityToken(..., authorization) reports delegated token; app-only S2S wiring does not', () => {
    const dir = createFixture({
      'package.json': NODE_PKG,
      'index.ts': NODE_S2S_INDEX,
      'agent.ts': `
await AgenticTokenCacheInstance.refreshObservabilityToken(
  agentId, tenantId, turnContext as any, this.authorization as any);
      `.trim(),
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      const ids = findingIds(result);
      assert.ok(ids.includes('node-obs-delegated-token'));
      assert.ok(!ids.includes('node-obs-delegated-route'));
    } finally {
      cleanup(dir);
    }
  });

  test('.NET distro without UseS2SEndpoint and with AgenticTokenStruct registration reports both findings', () => {
    const dir = createFixture({
      'Agent.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>',
      'Program.cs': 'builder.UseMicrosoftOpenTelemetry(o => { o.Exporters = ExportTarget.Agent365; });',
      'MyAgent.cs': `
_agentTokenCache?.RegisterObservability(agentId, tenantId,
    new AgenticTokenStruct(userAuthorization: UserAuthorization, turnContext: turnContext, authHandlerName: name),
    EnvironmentUtils.GetObservabilityAuthenticationScope());
      `.trim(),
      'appsettings.json': '{ "EnableAgent365Exporter": true }',
    });
    try {
      const ids = findingIds(runValidator(VALIDATOR, dir));
      assert.ok(ids.includes('dotnet-obs-delegated-route'));
      assert.ok(ids.includes('dotnet-obs-delegated-token'));
    } finally {
      cleanup(dir);
    }
  });

  test('.NET distro with UseS2SEndpoint = true and S2S scaffold registration reports no delegated findings', () => {
    const dir = createFixture({
      'Agent.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>',
      'Program.cs': 'builder.UseMicrosoftOpenTelemetry(o => { o.Agent365.UseS2SEndpoint = true; o.Agent365.TokenResolver = (a, t) => r.ResolveAsync(a, t); });',
      'ObservabilityTokenService.cs': '_tokenCache.RegisterObservability(_agentId, _tenantId, obsResult.AccessToken, ObservabilityScopes);',
      'appsettings.json': '{ "EnableAgent365Exporter": true }',
    });
    try {
      const ids = findingIds(runValidator(VALIDATOR, dir));
      assert.ok(!ids.includes('dotnet-obs-delegated-route'));
      assert.ok(!ids.includes('dotnet-obs-delegated-token'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python OBO agent without the S2S flag and with a delegated observability exchange reports both findings', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry
use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_token_resolver=cache.get)

async def setup(self, context):
    token = await self.agent_app.auth.exchange_token(context, scopes=get_observability_authentication_scope(), auth_handler_id=h)
      `.trim(),
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      const ids = findingIds(result);
      assert.ok(ids.includes('python-s2s-endpoint-not-set'));
      assert.ok(ids.includes('python-obs-delegated-token'));
      assert.equal(result.findings.find(f => f.id === 'python-s2s-endpoint-not-set').severity, 'high');
    } finally {
      cleanup(dir);
    }
  });

  test('Python workload exchange_token for MCP scopes is not reported as delegated telemetry', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry
use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=OBS_TOKENS.resolve)
token = await auth.exchange_token(context, scopes=["ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default"], auth_handler_id=h)
      `.trim(),
    });
    try {
      const ids = findingIds(runValidator(VALIDATOR, dir));
      assert.ok(!ids.includes('python-obs-delegated-token'));
      assert.ok(!ids.includes('python-s2s-endpoint-not-set'));
    } finally {
      cleanup(dir);
    }
  });

  test('Blueprint agent without a recorded registration reports agent-registration-not-recorded', () => {
    const agentId = '22222222-2222-2222-2222-222222222222';
    const blueprintId = '33333333-3333-3333-3333-333333333333';
    const unregistered = createFixture({
      'a365.config.json': JSON.stringify({ aiTeammate: false }),
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: blueprintId, agenticAppId: agentId }),
    });
    const registered = createFixture({
      'a365.config.json': JSON.stringify({ aiTeammate: false }),
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: blueprintId, agenticAppId: agentId, agentRegistrationId: 'reg-1' }),
    });
    const aiTeammate = createFixture({
      'a365.config.json': JSON.stringify({ aiTeammate: true }),
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: blueprintId, agenticAppId: agentId }),
    });
    try {
      const finding = runValidator(VALIDATOR, unregistered).findings.find(f => f.id === 'agent-registration-not-recorded');
      assert.ok(finding, 'expected agent-registration-not-recorded');
      assert.equal(finding.severity, 'medium');
      assert.ok(!findingIds(runValidator(VALIDATOR, registered)).includes('agent-registration-not-recorded'));
      assert.ok(!findingIds(runValidator(VALIDATOR, aiTeammate)).includes('agent-registration-not-recorded'));
    } finally {
      cleanup(unregistered);
      cleanup(registered);
      cleanup(aiTeammate);
    }
  });

  test('standalone references/a365-code-validator.js reports the same S2S findings as the stop hook', () => {
    const dir = createFixture({
      'package.json': NODE_PKG,
      'index.ts': NODE_S2S_INDEX.replace(' useS2SEndpoint: true,', ''),
      'agent.ts': 'await AgenticTokenCacheInstance.refreshObservabilityToken(agentId, tenantId, turnContext, this.authorization);',
      'Agent.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>',
      'Program.cs': 'builder.UseMicrosoftOpenTelemetry(o => { });',
      'MyAgent.cs': '_c.RegisterObservability(a, t, new AgenticTokenStruct(userAuthorization: u, turnContext: c, authHandlerName: n), s);',
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'app.py': 'use_microsoft_opentelemetry(enable_a365=True)\nt = await auth.exchange_token(ctx, scopes=get_observability_authentication_scope())',
      'a365.config.json': JSON.stringify({ aiTeammate: false }),
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'b', agenticAppId: 'a' }),
    });
    const s2sIds = ids => ids.filter(id => /obs-delegated|s2s-endpoint|agent-registration/.test(id)).sort();
    try {
      const hook = s2sIds(findingIds(runValidator(VALIDATOR, dir)));
      const standalone = s2sIds(findingIds(runValidator(STANDALONE, dir)));
      assert.deepEqual(standalone, hook);
      assert.deepEqual(hook, [
        'agent-registration-not-recorded',
        'dotnet-obs-delegated-route',
        'dotnet-obs-delegated-token',
        'node-obs-delegated-route',
        'node-obs-delegated-token',
        'python-obs-delegated-token',
        'python-s2s-endpoint-not-set',
      ]);
    } finally {
      cleanup(dir);
    }
  });

  test('standalone and stop-hook scanners flag non-inline delegated telemetry and a missing connection manager identically', () => {
    const dir = createFixture({
      'package.json': NODE_PKG,
      'index.ts': NODE_S2S_INDEX.replace('tokenResolver: appTokenResolver', "tokenResolver: (a, t) => AgenticTokenCacheInstance.getObservabilityToken(a, t) ?? ''"),
      'Agent.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>',
      'Program.cs': 'builder.UseMicrosoftOpenTelemetry(o => { o.Agent365.UseS2SEndpoint = true; });',
      'A365OtelWrapper.cs': 'var agenticToken = new AgenticTokenStruct(userAuthorization: u, turnContext: c, authHandlerName: n);\nagentTokenCache?.RegisterObservability(agentId, tenantId, agenticToken, scopes);',
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'host.py': [
        'use_microsoft_opentelemetry(enable_a365=True, a365_use_s2s_endpoint=True, a365_token_resolver=get_cached_agentic_token)',
        'token = await self.agent_app.auth.exchange_token(context, auth_handler_id=h)',
        'cache_agentic_token(tenant_id, agent_id, token.token)',
        'await OBS_TOKENS.prefetch(self.connection_manager, tenant_id, agent_id)',
      ].join('\n'),
      'token_cache.py': 'def cache_agentic_token(tenant_id, agent_id, token):\n    pass\n',
    });
    const s2sIds = ids => ids.filter(id => /obs-|s2s-endpoint|agent-registration/.test(id)).sort();
    try {
      const hook = s2sIds(findingIds(runValidator(VALIDATOR, dir)));
      const standalone = s2sIds(findingIds(runValidator(STANDALONE, dir)));
      assert.deepEqual(standalone, hook);
      assert.deepEqual(hook, [
        'dotnet-obs-delegated-token',
        'dotnet-obs-token-resolver-missing',
        'node-obs-delegated-token',
        'python-obs-delegated-token',
        'python-obs-prefetch-connection-missing',
      ]);
    } finally {
      cleanup(dir);
    }
  });

  test('Python lambda resolver over get_cached_agentic_token is flagged by both scanners; a lambda over the app-only resolver is not', () => {
    const delegated = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'host.py': 'use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=lambda agent_id, tenant_id: get_cached_agentic_token(tenant_id, agent_id))',
    });
    const appOnly = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'host.py': 'use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=lambda agent_id, tenant_id: OBS_TOKENS.resolve(agent_id, tenant_id))',
    });
    try {
      for (const scanner of [VALIDATOR, STANDALONE]) {
        assert.ok(findingIds(runValidator(scanner, delegated)).includes('python-obs-delegated-token'), scanner);
        assert.ok(!findingIds(runValidator(scanner, appOnly)).includes('python-obs-delegated-token'), scanner);
      }
    } finally {
      cleanup(delegated);
      cleanup(appOnly);
    }
  });

  test('route-only distro configs without a token resolver are flagged in every language by both scanners', () => {
    const dir = createFixture({
      'package.json': NODE_PKG,
      'index.ts': NODE_S2S_INDEX.replace(', tokenResolver: appTokenResolver', ''),
      'Agent.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>',
      'Program.cs': 'builder.UseMicrosoftOpenTelemetry(o => { o.Agent365.UseS2SEndpoint = true; });',
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'host.py': 'use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True)',
    });
    const resolverIds = ids => ids.filter(id => /token-resolver-missing/.test(id)).sort();
    try {
      const hook = resolverIds(findingIds(runValidator(VALIDATOR, dir)));
      assert.deepEqual(hook, [
        'dotnet-obs-token-resolver-missing',
        'node-obs-token-resolver-missing',
        'python-obs-token-resolver-missing',
      ]);
      assert.deepEqual(resolverIds(findingIds(runValidator(STANDALONE, dir))), hook);
    } finally {
      cleanup(dir);
    }
  });

  test('app-only S2S wiring in all three languages produces no delegated-telemetry findings in either scanner', () => {
    const dir = createFixture({
      'package.json': NODE_PKG,
      'index.ts': NODE_S2S_INDEX,
      'Agent.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.1.0" /></ItemGroup></Project>',
      'Program.cs': 'builder.UseMicrosoftOpenTelemetry(o => { o.Agent365.UseS2SEndpoint = true; o.Agent365.TokenResolver = (a, t) => r.ResolveAsync(a, t); });',
      'requirements.txt': 'microsoft-opentelemetry>=1.1.0\n',
      'host.py': [
        'use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=OBS_TOKENS.resolve)',
        'self.connection_manager = MsalConnectionManager.from_environment()',
        'await OBS_TOKENS.prefetch(self.connection_manager, tenant_id, agent_id)',
      ].join('\n'),
    });
    const s2sIds = ids => ids.filter(id => /obs-|s2s-endpoint/.test(id));
    try {
      assert.deepEqual(s2sIds(findingIds(runValidator(VALIDATOR, dir))), []);
      assert.deepEqual(s2sIds(findingIds(runValidator(STANDALONE, dir))), []);
    } finally {
      cleanup(dir);
    }
  });
});
