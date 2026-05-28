// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-add-workiq-tools.js');

const MANIFEST_VALID = JSON.stringify([{ mcpServerName: 'Work IQ Mail' }], null, 2);

// Minimal detection cache stub — the validator only checks existence, not
// content. Required by the Phase 0A Step 1 "cache must exist" guard.
const DETECTION_CACHE_STUB = JSON.stringify({
  agentStack: 'LangChain',
  programmingLanguage: 'NodeJS',
  detectedAt: '2026-01-01T00:00:00.000Z',
});

// ── Cross-language: .a365-workspace-detection.local.json must exist ─────────

describe('validate-workiq — detection cache (required)', () => {
  test('Node.js project without detection cache → reports cache-required', () => {
    const dir = createFixture({
      'ToolingManifest.json': MANIFEST_VALID,
      'package.json': JSON.stringify({ name: 'a', dependencies: { '@microsoft/agents-a365-tooling': '^1.0.0', '@microsoft/agents-a365-tooling-extensions-langchain': '^1.0.0' } }),
      'index.ts': `import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-langchain';`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });

  test('.NET project without detection cache → reports cache-required', () => {
    const dir = createFixture({
      'ToolingManifest.json': MANIFEST_VALID,
      'MyAgent.csproj': `<Project><ItemGroup><PackageReference Include="Microsoft.Agents.A365.Tooling.Extensions.AgentFramework" Version="1.0.0"/></ItemGroup></Project>`,
      'Agent.cs': `await mcpService.GetMcpToolsAsync(toolingManifest);`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });

  test('Python project without detection cache → reports cache-required', () => {
    const dir = createFixture({
      'ToolingManifest.json': MANIFEST_VALID,
      'requirements.txt': 'microsoft-agents-a365-tooling>=1.0.0\n',
      'agent.py': `from microsoft_agents_a365.tooling import McpToolRegistrationService\nawait svc.get_mcp_tools_async(manifest)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });
});

// ── Manifest checks ───────────────────────────────────────────────────────────

describe('validate-workiq — ToolingManifest', () => {
  test('no ToolingManifest.json → reports missing manifest', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({ name: 'my-agent', dependencies: { '@microsoft/agents-a365-tooling': '^1.0.0' } }),
      'index.ts': `import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling';`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /ToolingManifest\.json not found/);
    } finally { cleanup(dir); }
  });

  test('ToolingManifest.json without WorkIQ servers → reports missing servers', () => {
    const dir = createFixture({
      'ToolingManifest.json': JSON.stringify([{ mcpServerName: 'some-other-server' }]),
      'package.json': JSON.stringify({ name: 'my-agent', dependencies: { '@microsoft/agents-a365-tooling': '^1.0.0' } }),
      'index.ts': `import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling';`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /does not contain any WorkIQ/);
    } finally { cleanup(dir); }
  });

  test('malformed ToolingManifest.json → reports parse error', () => {
    const dir = createFixture({
      'ToolingManifest.json': '{ invalid json',
      'package.json': JSON.stringify({ name: 'my-agent' }),
      'index.ts': `// empty`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /could not be parsed/);
    } finally { cleanup(dir); }
  });
});

// ── Node.js checks ────────────────────────────────────────────────────────────

describe('validate-workiq — Node.js', () => {
  test('valid wiring → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ programmingLanguage: 'NodeJS', agentStack: 'LangChain' }),
      'ToolingManifest.json': MANIFEST_VALID,
      'package.json': JSON.stringify({
        name: 'my-agent',
        dependencies: {
          '@microsoft/agents-a365-tooling': '^1.0.0',
          '@microsoft/agents-a365-tooling-extensions-langchain': '^1.0.0',
        },
      }),
      'index.ts': `import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-langchain';`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing tooling package in package.json → reports package', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ programmingLanguage: 'NodeJS', agentStack: 'LangChain' }),
      'ToolingManifest.json': MANIFEST_VALID,
      'package.json': JSON.stringify({ name: 'my-agent', dependencies: {} }),
      'index.ts': `import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-langchain';`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /agents-a365-tooling.*not in package\.json/);
    } finally { cleanup(dir); }
  });

  test('missing McpToolRegistrationService wiring → reports service name', () => {
    const dir = createFixture({
      'ToolingManifest.json': MANIFEST_VALID,
      'package.json': JSON.stringify({ name: 'my-agent', dependencies: { '@microsoft/agents-a365-tooling': '^1.0.0' } }),
      'index.ts': `// no mcp wiring`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /McpToolRegistrationService/);
    } finally { cleanup(dir); }
  });
});

// ── .NET checks ───────────────────────────────────────────────────────────────

describe('validate-workiq — .NET', () => {
  test('valid wiring → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
      'ToolingManifest.json': MANIFEST_VALID,
      'MyAgent.csproj': `<Project><ItemGroup><PackageReference Include="Microsoft.Agents.A365.Tooling.Extensions.AgentFramework" Version="1.0.0"/></ItemGroup></Project>`,
      'Agent.cs': `await mcpService.GetMcpToolsAsync(toolingManifest);`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing tooling package → reports package name', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
      'ToolingManifest.json': MANIFEST_VALID,
      'MyAgent.csproj': `<Project><ItemGroup></ItemGroup></Project>`,
      'Agent.cs': `await mcpService.GetMcpToolsAsync(toolingManifest);`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Microsoft\.Agents\.A365\.Tooling/);
    } finally { cleanup(dir); }
  });
});

// ── Python checks ─────────────────────────────────────────────────────────────

describe('validate-workiq — Python', () => {
  test('valid wiring → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
      'ToolingManifest.json': MANIFEST_VALID,
      'requirements.txt': 'microsoft-agents-a365-tooling>=1.0.0\n',
      'agent.py': `from microsoft_agents_a365.tooling import McpToolRegistrationService\nawait svc.get_mcp_tools_async(manifest)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing tooling package in requirements.txt → reports package', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
      'ToolingManifest.json': MANIFEST_VALID,
      'requirements.txt': 'requests>=2.0\n',
      'agent.py': `from microsoft_agents_a365.tooling import McpToolRegistrationService\nawait svc.get_mcp_tools_async(manifest)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /microsoft-agents-a365-tooling/);
    } finally { cleanup(dir); }
  });
});
