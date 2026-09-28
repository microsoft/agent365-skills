// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFixture, runValidator, cleanup } = require('./helpers');
const { getCopilotSdkProject } = require('../plugins/agent365/hooks/lib/copilot-sdk');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'agent365');
const FIXTURE = path.join(__dirname, 'fixtures', 'copilot-sdk');
const cache = {
  agentStack: 'GitHub Copilot SDK',
  programmingLanguage: 'NodeJS',
  agentType: 'system-agent',
  authMode: 's2s',
  usesTeamsOrCopilot: 0,
  has_aiteammate_structure: false,
  has_workiq: false,
  has_obs: false,
  capabilities: ['Register', 'Observability'],
  standaloneApprovals: { scope: true, s2s: true, registration: true, observability: true },
};
const files = {
  'package.json': fs.readFileSync(path.join(FIXTURE, 'package.json'), 'utf8'),
  'src/index.ts': fs.readFileSync(path.join(FIXTURE, 'src', 'index.ts'), 'utf8'),
  '.gitignore': fs.readFileSync(path.join(FIXTURE, '.gitignore'), 'utf8'),
  '.a365-workspace-detection.local.json': JSON.stringify(cache),
};
const validator = name => path.join(PLUGIN, 'hooks', 'stop', `validate-${name}.js`);

test('clean fixture detects SDK without auth and remains unchanged across repeated diagnostics', () => {
  const before = fs.readFileSync(path.join(FIXTURE, 'src', 'index.ts'), 'utf8');
  const command = path.join(PLUGIN, 'hooks', 'lib', 'copilot-sdk.js');
  const run = () => spawnSync(process.execPath, [command], { cwd: FIXTURE, encoding: 'utf8' });
  const first = run();
  const second = run();
  assert.equal(first.status, 1);
  assert.equal(second.status, 1);
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.agentStack, cache.agentStack);
  assert.match(report.route, /make-a365-agent/);
  assert.doesNotMatch(report.route, /make-ai-teammate/);
  assert.match(report.issues.join('; '), /cache|detection.local.json/);
  assert.match(report.evidence, /authentication.*unverified/);
  assert.equal(fs.readFileSync(path.join(FIXTURE, 'src', 'index.ts'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(FIXTURE, '.a365-workspace-detection.local.json')), false);
  assert.equal(fs.existsSync(path.join(FIXTURE, 'a365.generated.config.json')), false);
});

test('direct dependency takes precedence over other frameworks and stale cache', () => {
  const dir = createFixture({
    ...files,
    'package.json': JSON.stringify({
      dependencies: { '@github/copilot-sdk': '1.0.14', '@langchain/core': '1.0.0' },
    }),
    '.a365-workspace-detection.local.json': JSON.stringify({ ...cache, agentStack: 'LangChain' }),
  });
  try {
    const result = getCopilotSdkProject(dir);
    assert.equal(result.agentStack, 'GitHub Copilot SDK');
    assert.match(result.issues.join('; '), /conflicts with cached stack/);
  } finally { cleanup(dir); }
});

test('devDependency plus mts source is detected', () => {
  const dir = createFixture({
    ...files,
    'package.json': JSON.stringify({ devDependencies: { '@github/copilot-sdk': '1.0.14' } }),
    'src/index.ts': '',
    'src/agent.mts': "import { CopilotClient } from '@github/copilot-sdk';",
  });
  try { assert.deepEqual(getCopilotSdkProject(dir).issues, []); } finally { cleanup(dir); }
});

test('README, lockfile, and sibling package do not identify the selected root as Copilot SDK', () => {
  const dir = createFixture({
    'package.json': JSON.stringify({ dependencies: { copilot: '1.0.0' } }),
    'README.md': 'Uses @github/copilot-sdk',
    'package-lock.json': JSON.stringify({ packages: { '@github/copilot-sdk': {} } }),
    'sibling/package.json': files['package.json'],
    'sibling/src/index.ts': files['src/index.ts'],
  });
  try { assert.equal(getCopilotSdkProject(dir), null); } finally { cleanup(dir); }
});

test('stale SDK cache without the dependency blocks fallback', () => {
  const dir = createFixture({ ...files, 'package.json': '{}' });
  try {
    assert.match(getCopilotSdkProject(dir).issues.join('; '), /no direct.*dependency/);
  } finally { cleanup(dir); }
});

test('nested packages cannot supply TypeScript evidence or conflicting hosting for the selected package', () => {
  const noSource = { ...files };
  delete noSource['src/index.ts'];
  const dir = createFixture({
    ...noSource,
    'sibling/package.json': '{}',
    'sibling/src/agent.ts': 'class Agent extends AgentApplication {}',
    'sibling/teamsapp.yml': '{}',
  });
  try {
    const issues = getCopilotSdkProject(dir).issues.join('; ');
    assert.match(issues, /requires TypeScript source/);
    assert.doesNotMatch(issues, /artifacts conflict|notification code conflicts/);
  } finally { cleanup(dir); }
});

test('real CEA manifest or AgentApplication source blocks standalone routing', () => {
  for (const conflict of [
    { 'appPackage/manifest.json': JSON.stringify({ copilotAgents: { customEngineAgents: [{}] } }) },
    { 'src/agent.ts': 'class Agent extends AgentApplication {}' },
  ]) {
    const dir = createFixture({ ...files, ...conflict });
    try {
      assert.match(getCopilotSdkProject(dir).issues.join('; '), /M365|conflicts with the standalone/);
    } finally { cleanup(dir); }
  }
});

test('standalone local guard does not launch external commands or require AgentsPlayground', () => {
  const dir = createFixture(files);
  try {
    const result = spawnSync(process.execPath, [validator('test-local')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, VALIDATE_SKIP_EXEC: '', PATH: '' },
    });

    test('uninstrumented Copilot SDK reports verified contract gaps, not hosted-agent repairs', () => {
      const dir = createFixture(files);
      try {
        const result = runValidator(validator('instrument-observability'), dir);
        assert.equal(result.ok, false);
        assert.match(result.reason, /verified explicit NodeTracerProvider bootstrap/);
        assert.match(result.reason, /deterministic invoke_agent/);
        assert.doesNotMatch(result.reason, /configureA365Hosting|BaggageBuilder|preloadObservabilityToken|observability-token-service\.ts/);
        assert.match(result.note, /No proof of tenant grants/);
      } finally { cleanup(dir); }
    });

    const telemetryFiles = {
      ...files,
      'package.json': JSON.stringify({
        dependencies: {
          '@github/copilot-sdk': '1.0.14',
          '@microsoft/opentelemetry': '1.4.0',
          '@azure/msal-node': '7.0.0',
          '@opentelemetry/api': '1.9.1',
          '@opentelemetry/core': '2.10.0',
          '@opentelemetry/resources': '2.10.0',
          '@opentelemetry/sdk-trace-base': '2.10.0',
          '@opentelemetry/sdk-trace-node': '2.10.0',
        },
      }),
      'src/telemetry.ts': [
        'const provider = new NodeTracerProvider({});',
        'if (config.exportToA365) { new Agent365Exporter({ tokenResolver, useS2SEndpoint: true }); }',
        'const root = InvokeAgentScope.start(request, {}, agent);',
        'ExecuteToolScope.start(request, tool, agent, undefined, { parentContext: root.getSpanContext() });',
        'await provider.forceFlush();',
        'await provider.shutdown();',
      ].join('\n'),
      'src/config.ts': [
        "const exportToA365 = flag(env, 'ENABLE_A365_OBSERVABILITY_EXPORTER', false);",
        'const agent = { agentId: env.AGENT365_AGENT_ID, agentBlueprintId: env.AGENT365_BLUEPRINT_CLIENT_ID };',
      ].join('\n'),
      'src/auth.ts': 'const tokenResolver = createTokenResolver(identity);',
    };

    test('verified sample static signals pass without TurnContext or a generic S2S service filename', () => {
      const dir = createFixture(telemetryFiles);
      try {
        const result = runValidator(validator('instrument-observability'), dir);
        assert.equal(result.ok, true, result.reason);
        assert.match(result.note, /static wiring checks only/);
        assert.match(result.note, /No proof of tenant grants/);
      } finally { cleanup(dir); }
    });

    test('report-first validation recognizes explicit provider without requiring duplicate distro initialization', () => {
      const dir = createFixture(telemetryFiles);
      try {
        const result = runValidator(validator('a365-code-validator'), dir);
        assert.equal(result.ok, true);
        assert.ok(result.findings.some(item => item.id === 'copilot-sdk-standalone-review-required'));
        assert.ok(!result.findings.some(item => item.id === 'node-missing-distro-init'));
      } finally { cleanup(dir); }
    });

    test('instrumentation does not restore dependencies automatically when the local compiler is missing', () => {
      const dir = createFixture(telemetryFiles);
      try {
        const result = spawnSync(process.execPath, [validator('instrument-observability')], {
          cwd: dir, encoding: 'utf8', env: { ...process.env, VALIDATE_SKIP_EXEC: '', PATH: '' },
        });
        assert.equal(result.status, 1);
        assert.match(JSON.parse(result.stdout).reason, /Local TypeScript compiler is missing.*no automatic install/);
      } finally { cleanup(dir); }
    });

    for (const [file, before, after, expected] of [
      ['src/config.ts', "'ENABLE_A365_OBSERVABILITY_EXPORTER', false", "'ENABLE_A365_OBSERVABILITY_EXPORTER', true", /defaulting to false/],
      ['src/telemetry.ts', 'useS2SEndpoint: true', 'useS2SEndpoint: false', /explicit useS2SEndpoint/],
      ['src/telemetry.ts', 'parentContext:', 'unrelated:', /parent context/],
      ['src/telemetry.ts', 'provider.forceFlush()', 'provider.flushLater()', /forceFlush lifecycle/],
    ]) {
      test(`standalone telemetry missing ${expected} blocks completion`, () => {
        const dir = createFixture({ ...telemetryFiles, [file]: telemetryFiles[file].replace(before, after) });
        try {
          const result = runValidator(validator('instrument-observability'), dir);
          assert.equal(result.ok, false);
          assert.match(result.reason, expected);
        } finally { cleanup(dir); }
      });
    }

    test('duplicate distro bootstrap is a review blocker, never a suggested fallback', () => {
      const dir = createFixture({
        ...telemetryFiles, 'src/old-bootstrap.ts': 'useMicrosoftOpenTelemetry({});',
      });
      try {
        const result = runValidator(validator('instrument-observability'), dir);
        assert.equal(result.ok, false);
        assert.match(result.reason, /duplicate providers/);
      } finally { cleanup(dir); }
    });
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.match(report.note, /no AgentsPlayground, runtime, login, or export was launched/);
  } finally { cleanup(dir); }
});

test('JavaScript, declaration, test, dependency and build output files are not TypeScript evidence', () => {
  const noSource = { ...files };
  delete noSource['src/index.ts'];
  const dir = createFixture({
    ...noSource,
    'index.js': 'export {};',
    'index.d.ts': 'export {};',
    'src/agent.test.ts': 'export {};',
    'test/agent.ts': 'export {};',
    'node_modules/example/index.ts': 'export {};',
    'dist/index.ts': 'export {};',
    'build/index.ts': 'export {};',
  });
  try {
    assert.match(getCopilotSdkProject(dir).issues.join('; '), /requires TypeScript source/);
  } finally { cleanup(dir); }
});

for (const version of ['^1.0.14', 'latest', '1.0.15-preview.1', 'file:../sdk', 'workspace:*']) {
  test(`rejects unpinned/unreleased SDK spec ${version}`, () => {
    const dir = createFixture({
      ...files, 'package.json': JSON.stringify({ dependencies: { '@github/copilot-sdk': version } }),
    });
    try {
      assert.match(getCopilotSdkProject(dir).issues.join('; '), /exact published stable release/);
    } finally { cleanup(dir); }
  });
}

for (const overrides of [
  { agentType: 'ai-teammate' }, { authMode: 'agentic-user' }, { authMode: 'obo' },
  { usesTeamsOrCopilot: 1 }, { has_aiteammate_structure: true }, { has_workiq: true },
  { capabilities: ['Register', 'AI Teammate'] }, { capabilities: ['Register', 'WorkIQ'] },
]) {
  test(`rejects standalone routing conflict ${JSON.stringify(overrides)}`, () => {
    const dir = createFixture({
      ...files,
      '.a365-workspace-detection.local.json': JSON.stringify({ ...cache, ...overrides }),
    });
    try {
      const result = runValidator(validator('a365-setup'), dir);
      assert.equal(result.ok, false);
      assert.match(result.reason, /standalone|capabilities/);
    } finally { cleanup(dir); }
  });
}

test('malformed cache is surfaced without a generic runtime fallback', () => {
  const dir = createFixture({ ...files, '.a365-workspace-detection.local.json': '{' });
  try {
    assert.match(getCopilotSdkProject(dir).issues.join('; '), /could not be read as JSON/);
  } finally { cleanup(dir); }
});

for (const artifact of ['teamsapp.yml', 'ToolingManifest.json']) {
  test(`existing ${artifact} is a conflict, never deleted or routed to teammate`, () => {
    const dir = createFixture({ ...files, [artifact]: '{}' });
    try {
      assert.match(getCopilotSdkProject(dir).issues.join('; '), /artifacts conflict/);
      assert.equal(fs.readFileSync(path.join(dir, artifact), 'utf8'), '{}');
    } finally { cleanup(dir); }
  });
}

test('standalone blueprint can be reused without hosting or Web App identity warnings', () => {
  const dir = createFixture({
    ...files,
    '.a365-workspace-detection.local.json': JSON.stringify({
      ...cache, reuseBlueprint: true, existingBlueprintId: 'fixture-blueprint',
    }),
    'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'fixture-blueprint' }),
  });
  try {
    const before = fs.readFileSync(path.join(dir, 'src', 'index.ts'), 'utf8');
    const run = () => spawnSync(process.execPath, [validator('make-a365-agent')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, VALIDATE_SKIP_EXEC: '1' },
    });
    for (let i = 0; i < 2; i++) {
      const result = run();
      assert.equal(result.status, 0, result.stdout);
      assert.equal(JSON.parse(result.stdout).ok, true);
      assert.match(JSON.parse(result.stdout).note, /separate Agent 365 registry registration.*not verified/);
      assert.doesNotMatch(result.stderr, /managed.identity|webapp|Playground/i);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'index.ts'), 'utf8'), before);
  } finally { cleanup(dir); }
});

for (const name of ['make-ai-teammate', 'add-workiq-tools']) {
  test(`${name} cannot silently scaffold unsupported features`, () => {
    const dir = createFixture(files);
    try {
      const result = runValidator(validator(name), dir);
      assert.equal(result.ok, false);
      assert.match(result.reason, /standalone spike does not support/);
      assert.equal(fs.existsSync(path.join(dir, 'ToolingManifest.json')), false);
    } finally { cleanup(dir); }
  });
}

test('all entry skills route through the same standalone reference', () => {
  for (const skill of [
    'a365-setup', 'make-a365-agent', 'instrument-observability',
    'make-ai-teammate', 'add-workiq-tools', 'test-local', 'a365-code-validator',
  ]) {
    const content = fs.readFileSync(path.join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(content, /@github\/copilot-sdk/, skill);
    assert.match(content, /shared\/copilot-sdk-standalone\.md/, skill);
  }
});

test('standalone reference preserves approval, pinning, auth, and evidence boundaries', () => {
  const reference = fs.readFileSync(path.join(PLUGIN, 'shared', 'copilot-sdk-standalone.md'), 'utf8');
  for (const requirement of [
    /before trusting a[\s\S]*fresh detection cache/,
    /setup blueprint --agent-name <confirmed-name> --tenant-id <confirmed-tenant-id> --no-endpoint --dry-run/,
    /1\.1\.221/, /not auth-free/, /explicit approval/,
    /exact published stable release versions/, /no hosting, Teams, teammate/,
    /model-produced telemetry/, /No static validator/,
    /observability wiring pending verified sample contract/,
  ]) assert.match(reference, requirement);
  assert.doesNotMatch(reference, /a365 setup all --agent-name/);
});

test('setup standalone branch dominates generic phases, prerequisites, and completion', () => {
  const setup = fs.readFileSync(path.join(PLUGIN, 'skills', 'a365-setup', 'SKILL.md'), 'utf8');
  const routeStart = setup.indexOf('## Exclusive route selection');
  const genericStart = setup.indexOf('## Generic workflow');
  const detectionStart = setup.indexOf('### Phase 1A');
  assert.ok(routeStart > 0 && genericStart > routeStart && detectionStart > genericStart);
  const route = setup.slice(routeStart, genericStart);
  assert.match(route, /@github\/copilot-sdk/);
  assert.match(route, /shared\/copilot-sdk-standalone\.md/);
  assert.match(route, /RETURN after Route A; never continue into the Generic workflow/);
  assert.match(route, /Do not execute OR recommend/);
  assert.match(route, /read-only or approval is[\s\S]*absent[\s\S]*\*\*STOP\*\*/);
  assert.match(route, /Do not require `useMicrosoftOpenTelemetry`/);
  assert.match(route, /unread source means \*\*not evaluated\*\*/);
  assert.match(setup, /STOP; do not evaluate the generic checklist/);
  assert.match(setup, /## Final route check[\s\S]*unsafe recommendation/);
  assert.doesNotMatch(setup.slice(0, routeStart), /I'll install any missing prerequisites/);
});

test('standalone final answer and eval reject the observed model fallback', () => {
  const reference = fs.readFileSync(path.join(PLUGIN, 'shared', 'copilot-sdk-standalone.md'), 'utf8');
  const response = reference.slice(
    reference.indexOf('### Standalone final-response check'),
    reference.indexOf('## 2. make-a365-agent'),
  );
  for (const field of ['Detected / preserved', 'Local evidence', 'Blocked / not verified']) {
    assert.ok(response.includes(`**${field}:**`), field);
  }
  assert.match(response, /omitting runnable commands/);
  assert.match(response, /missing distro initializer is \*\*not\*\*/);
  assert.match(response, /forbidden recommendations, not merely forbidden tool/);
  assert.match(response, /Steps 1-3\/\.NET quick scan/);
  assert.match(response, /never count correct detection/i);
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'agent365', 'a365-setup', 'evals.json'), 'utf8'));
  const expectations = suite.evals.find(item => item.id === 1001).expectations.join('\n');
  assert.match(expectations, /Final answer must not recommend setup all/);
  assert.match(expectations, /Missing useMicrosoftOpenTelemetry alone/);
  assert.match(expectations, /insufficient for a safe-routing pass/);
});

test('read-only standalone template ends without command or admin-handoff recommendations', () => {
  const reference = fs.readFileSync(path.join(PLUGIN, 'shared', 'copilot-sdk-standalone.md'), 'utf8');
  const response = reference.slice(
    reference.indexOf('### Standalone final-response check'),
    reference.indexOf('## 2. make-a365-agent'),
  );
  const match = response.match(/```text\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(match, 'positive response template is present');
  const template = match[1];
  assert.equal(template.split(/\r?\n\r?\n/).length, 3);
  assert.doesNotMatch(template, /setup all|az login|dotnet|next gate|next steps|ask an admin/i);
  assert.match(template, /Confirmed onboarding cache:[\s\S]*approved tenant authentication:[\s\S]*runtime identity and grants:[\s\S]*observability wiring\/export:/);
  assert.match(response, /\*\*END after the report\.\*\*/);
  assert.match(response, /recommendations as well as execution/);
  assert.match(response, /even in parentheses, a negated explanation/);
  assert.match(response, /request for secrets\/tokens/);
  const setup = fs.readFileSync(path.join(PLUGIN, 'skills', 'a365-setup', 'SKILL.md'), 'utf8');
  const entry = setup.slice(0, setup.indexOf('## Generic workflow'));
  assert.match(entry, /Read-only Copilot SDK request exception/);
  assert.match(entry, /MUST use exactly the shared three-paragraph template/);
  assert.match(entry, /must not appear anywhere in that response, including parentheses/);
});

test('existing onboarding eval suites carry unique standalone cases and valid fixture paths', () => {
  for (const skill of ['a365-setup', 'make-a365-agent', 'instrument-observability']) {
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'agent365', skill, 'evals.json'), 'utf8'));
    assert.equal(new Set(suite.evals.map(item => item.id)).size, suite.evals.length, skill);
    const spike = suite.evals.find(item => item.id === 1001);
    assert.ok(spike, skill);
    assert.ok(spike.expectations.length >= 6, skill);
    for (const file of spike.files) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  }
});
