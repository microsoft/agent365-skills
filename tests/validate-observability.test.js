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
