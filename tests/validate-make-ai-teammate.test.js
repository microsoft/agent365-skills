// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(
  __dirname,
  '../plugins/agent365/hooks/stop/validate-make-ai-teammate.js'
);

// A valid ToolingManifest.json with the expected `mcpServers` array. Used by
// the per-language happy-path fixtures to mimic an agent that opted into
// WorkIQ via add-workiq-tools. make-ai-teammate itself no longer writes this
// file — its absence is a valid completion state.
const MANIFEST_VALID = JSON.stringify({
  mcpServers: [
    { mcpServerName: 'mcp_CalendarTools', url: 'https://example/calendar' },
    { mcpServerName: 'mcp_MailTools',     url: 'https://example/mail' },
  ],
}, null, 2);

// ── Cross-language: ToolingManifest.json (optional) ──────────────────────────

describe('validate-make-ai-teammate — ToolingManifest (optional)', () => {
  test('missing ToolingManifest.json is OK (user skipped WorkIQ at Phase 9.6)', () => {
    // Build a minimally-valid Node.js fixture so the rest of the validator passes,
    // then assert the missing manifest does NOT produce a ToolingManifest issue.
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'a',
        dependencies: {
          '@microsoft/agents-hosting':            '^1.0.0',
          '@microsoft/agents-a365-runtime':       '^1.0.0',
          '@microsoft/agents-a365-notifications': '^1.0.0',
        },
      }),
      'tsconfig.json': JSON.stringify({
        compilerOptions: { module: 'node16', moduleResolution: 'node16' },
      }),
      'src/index.ts': `import { configDotenv } from 'dotenv';
import { CloudAdapter, authorizeJWT } from '@microsoft/agents-hosting';
configDotenv();
const adapter = new CloudAdapter();
app.get('/api/health', () => {});
app.post('/api/messages', adapter.process);`,
      'src/agent.ts': `import '@microsoft/agents-a365-notifications';
import { AgentApplication } from '@microsoft/agents-hosting';
export class MyAgent extends AgentApplication {
  onAgentNotification = () => {};
  onInstallationUpdate = () => {};
}`,
      'src/client.ts': `export function getClient() { return {}; }`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      // Fixture is minimally-valid, so the validator must pass.
      assert.equal(r.ok, true, `validator failed: ${r.reason || ''}`);
      // Defense in depth: even if a future regression causes failure, it
      // must not be due to a missing ToolingManifest.json.
      assert.doesNotMatch(r.reason || '', /ToolingManifest/);
    } finally { cleanup(dir); }
  });

  test('ToolingManifest.json without mcpServers array → reports missing array', () => {
    const dir = createFixture({
      'ToolingManifest.json': JSON.stringify({ foo: 'bar' }),
      'package.json': JSON.stringify({ name: 'a' }),
      'src/index.ts': '',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /missing mcpServers array/);
    } finally { cleanup(dir); }
  });

  test('malformed ToolingManifest.json → reports parse error', () => {
    const dir = createFixture({
      'ToolingManifest.json': '{ this is not json',
      'package.json': JSON.stringify({ name: 'a' }),
      'src/index.ts': '',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /cannot be parsed/);
    } finally { cleanup(dir); }
  });
});

// ── Node.js ──────────────────────────────────────────────────────────────────

// The Node.js path is selected when there's a package.json and at least one .ts
// file, and no .csproj / pyproject.toml are present at the project root.

const NODE_INDEX_VALID = `import { configDotenv } from 'dotenv';
import { CloudAdapter, authorizeJWT } from '@microsoft/agents-hosting';
configDotenv();
const adapter = new CloudAdapter();
app.get('/api/health', () => {});
app.post('/api/messages', adapter.process);
`;

const NODE_AGENT_VALID = `import '@microsoft/agents-a365-notifications';
import { AgentApplication } from '@microsoft/agents-hosting';
export class MyAgent extends AgentApplication {
  constructor() { super(); }
  onAgentNotification = () => {};
  onInstallationUpdate = () => {};
}
`;

const NODE_CLIENT_VALID = `export function getClient() { return {}; }`;

const NODE_TSCONFIG_VALID = JSON.stringify({
  compilerOptions: { module: 'node16', moduleResolution: 'node16' },
}, null, 2);

const NODE_PACKAGE_VALID = JSON.stringify({
  name: 'my-agent',
  dependencies: {
    '@microsoft/agents-hosting':           '^1.0.0',
    '@microsoft/agents-a365-runtime':      '^1.0.0',
    '@microsoft/agents-a365-notifications': '^1.0.0',
  },
}, null, 2);

function nodeFixture(overrides = {}) {
  return createFixture({
    'ToolingManifest.json':   MANIFEST_VALID,
    'package.json':           NODE_PACKAGE_VALID,
    'tsconfig.json':          NODE_TSCONFIG_VALID,
    'src/index.ts':           NODE_INDEX_VALID,
    'src/agent.ts':           NODE_AGENT_VALID,
    'src/client.ts':          NODE_CLIENT_VALID,
    ...overrides,
  });
}

describe('validate-make-ai-teammate — Node.js', () => {
  test('valid project → ok', () => {
    const dir = nodeFixture();
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('missing src/index.ts → reports hosting not added', () => {
    // Build a fixture that omits src/index.ts entirely (createFixture only
    // writes the keys you give it).
    const dir = createFixture({
      'ToolingManifest.json': MANIFEST_VALID,
      'package.json':         NODE_PACKAGE_VALID,
      'tsconfig.json':        NODE_TSCONFIG_VALID,
      'src/agent.ts':         NODE_AGENT_VALID,
      'src/client.ts':        NODE_CLIENT_VALID,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /index\.ts not found/);
    } finally { cleanup(dir); }
  });

  test('index.ts without CloudAdapter → reports hosting incomplete', () => {
    // No literal CloudAdapter or authorizeJWT anywhere — the validator does
    // a substring match across the whole file (comments included), so any
    // mention of those identifiers would mask the missing-import.
    const dir = nodeFixture({
      'src/index.ts': `import { configDotenv } from 'dotenv';
const adapter = makeAdapter();
app.get('/api/health', () => {});
app.post('/api/messages', () => {});`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /does not use CloudAdapter/);
    } finally { cleanup(dir); }
  });

  test('missing AgentApplication → reports agent class not added', () => {
    // Replace agent.ts with content that does NOT contain the substring
    // "AgentApplication" anywhere — including comments. Also strip the other
    // tokens that the validator searches for, so the test isolates the
    // "agent class missing" failure mode rather than reporting collaterals.
    const dir = nodeFixture({
      'src/agent.ts': `// agent module — class not yet defined
export const placeholder = true;`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /No TypeScript file extends AgentApplication/);
    } finally { cleanup(dir); }
  });

  test('missing @microsoft/agents-a365-notifications import → reports notification deserialization break', () => {
    const dir = nodeFixture({
      'src/agent.ts': `import { AgentApplication } from '@microsoft/agents-hosting';
export class A extends AgentApplication {
  onAgentNotification = () => {};
  onInstallationUpdate = () => {};
}`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /agents-a365-notifications/);
    } finally { cleanup(dir); }
  });

  test('missing getClient() factory → reports client factory missing', () => {
    const dir = nodeFixture({
      'src/client.ts': `// no factory`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /getClient\(\) factory not found/);
    } finally { cleanup(dir); }
  });

  test('missing required @microsoft/agents-* package → reports each missing package', () => {
    const dir = nodeFixture({
      'package.json': JSON.stringify({
        name: 'my-agent',
        dependencies: { '@microsoft/agents-hosting': '^1.0.0' },
      }, null, 2),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /@microsoft\/agents-a365-runtime not found/);
      assert.match(r.reason, /@microsoft\/agents-a365-notifications not found/);
    } finally { cleanup(dir); }
  });

  test('tsconfig with wrong module → reports node16 required', () => {
    const dir = nodeFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /"module" is not "node16"/);
    } finally { cleanup(dir); }
  });

  test('tsconfig with Pascal-case Node16 → accepted', () => {
    const dir = nodeFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { module: 'Node16', moduleResolution: 'Node16' },
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});

// ── .NET ─────────────────────────────────────────────────────────────────────

const DOTNET_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Microsoft.Agents.A365.Notifications" Version="1.0.0" />
  </ItemGroup>
</Project>`;

const DOTNET_PROGRAM = `using Microsoft.Agents.Hosting;
var builder = WebApplication.CreateBuilder(args);
builder.AddAgent<MyAgent>();
var app = builder.Build();
app.MapPost("/api/messages", adapter.ProcessAsync);
app.MapGet("/api/health", () => Results.Ok());
app.Run();`;

const DOTNET_AGENT = `using Microsoft.Agents.Hosting;
public class MyAgent : AgentApplication
{
    public MyAgent()
    {
        OnActivity(ActivityTypes.Message, OnMessageAsync, isAgenticOnly: true);
        OnActivity(ActivityTypes.Message, OnMessageAsync, isAgenticOnly: false);
        OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync, isAgenticOnly: false);
    }
}`;

const DOTNET_APPSETTINGS = JSON.stringify({
  AgentApplication: { AgenticAuthHandlerName: 'agentic' },
  TokenValidation:  { Audiences: [] },
  Connections:      { ServiceConnection: {} },
}, null, 2);

function dotnetFixture(overrides = {}) {
  return createFixture({
    'ToolingManifest.json': MANIFEST_VALID,
    'MyAgent.csproj':       DOTNET_CSPROJ,
    'Program.cs':           DOTNET_PROGRAM,
    'MyAgent.cs':           DOTNET_AGENT,
    'appsettings.json':     DOTNET_APPSETTINGS,
    ...overrides,
  });
}

describe('validate-make-ai-teammate — .NET', () => {
  test('valid project → ok', () => {
    const dir = dotnetFixture();
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Program.cs missing /api/messages → reports endpoint missing', () => {
    const dir = dotnetFixture({
      'Program.cs': `var builder = WebApplication.CreateBuilder(args);
builder.AddAgent<MyAgent>();
var app = builder.Build();
app.MapGet("/api/health", () => Results.Ok());
app.Run();`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /missing \/api\/messages endpoint/);
    } finally { cleanup(dir); }
  });

  test('Program.cs missing AddAgent<> → reports DI registration missing', () => {
    const dir = dotnetFixture({
      'Program.cs': `var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapPost("/api/messages", () => {});
app.MapGet("/api/health", () => {});
app.Run();`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /missing AddAgent<T>\(\)/);
    } finally { cleanup(dir); }
  });

  test('agent class missing isAgenticOnly → reports dual auth not configured', () => {
    const dir = dotnetFixture({
      'MyAgent.cs': `public class MyAgent : AgentApplication
{
    public MyAgent()
    {
        OnActivity(ActivityTypes.Message, OnMessageAsync);
        OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync);
    }
}`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /isAgenticOnly parameter not found/);
    } finally { cleanup(dir); }
  });

  test('.csproj missing Microsoft.Agents.A365.Notifications → reports package missing', () => {
    const dir = dotnetFixture({
      'MyAgent.csproj': `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup></ItemGroup></Project>`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Microsoft\.Agents\.A365\.Notifications not found in \.csproj/);
    } finally { cleanup(dir); }
  });

  test('appsettings.json missing AgentApplication section → reports missing', () => {
    const dir = dotnetFixture({
      'appsettings.json': JSON.stringify({ TokenValidation: {} }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /missing AgentApplication section/);
    } finally { cleanup(dir); }
  });
});

// ── Python ───────────────────────────────────────────────────────────────────

const PY_HOST = `from microsoft_agents_a365_runtime.hosting import CloudAdapter
from aiohttp import web
async def messages(request): pass
async def health(request): pass
async def on_agent_notification(ctx): pass
app = web.Application()
app.router.add_post('/api/messages', messages)
app.router.add_get('/api/health', health)
`;

const PY_AGENT = `from agent_interface import AgentInterface
class MyAgent(AgentInterface):
    async def process_user_message(self, ctx, msg): pass
    async def handle_agent_notification_activity(self, ctx): pass
`;

const PY_AGENT_INTERFACE = `from abc import ABC, abstractmethod
class AgentInterface(ABC):
    @abstractmethod
    async def process_user_message(self, ctx, msg): ...
`;

const PY_PYPROJECT = `[project]
name = "my-agent"
dependencies = [
  "microsoft_agents_a365_notifications>=1.0",
  "microsoft_agents_a365_runtime>=1.0",
  "microsoft-agents-hosting-aiohttp>=1.0",
]
`;

function pythonFixture(overrides = {}) {
  return createFixture({
    'ToolingManifest.json': MANIFEST_VALID,
    'pyproject.toml':       PY_PYPROJECT,
    'host_agent_server.py': PY_HOST,
    'agent.py':             PY_AGENT,
    'agent_interface.py':   PY_AGENT_INTERFACE,
    ...overrides,
  });
}

describe('validate-make-ai-teammate — Python', () => {
  test('valid project → ok', () => {
    const dir = pythonFixture();
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('host_agent_server.py missing CloudAdapter → reports hosting incomplete', () => {
    const dir = pythonFixture({
      'host_agent_server.py': `from aiohttp import web
async def messages(request): pass
async def health(request): pass
async def on_agent_notification(ctx): pass
app = web.Application()
app.router.add_post('/api/messages', messages)
app.router.add_get('/api/health', health)`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /missing CloudAdapter/);
    } finally { cleanup(dir); }
  });

  test('agent.py missing notification handler → reports handler missing', () => {
    const dir = pythonFixture({
      'agent.py': `from agent_interface import AgentInterface
class MyAgent(AgentInterface):
    async def process_user_message(self, ctx, msg): pass
`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /handle_agent_notification_activity/);
    } finally { cleanup(dir); }
  });

  test('missing agent_interface.py → reports ABC required', () => {
    const dir = createFixture({
      'ToolingManifest.json': MANIFEST_VALID,
      'pyproject.toml':       PY_PYPROJECT,
      'host_agent_server.py': PY_HOST,
      'agent.py':             PY_AGENT,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /agent_interface\.py not found/);
    } finally { cleanup(dir); }
  });

  test('pyproject.toml missing required package → reports each missing', () => {
    const dir = pythonFixture({
      'pyproject.toml': `[project]
name = "my-agent"
dependencies = [ "microsoft_agents_a365_notifications>=1.0" ]
`,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /microsoft_agents_a365_runtime not found/);
      assert.match(r.reason, /microsoft-agents-hosting-aiohttp not found/);
    } finally { cleanup(dir); }
  });
});
