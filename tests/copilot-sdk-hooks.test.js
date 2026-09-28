// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { createFixture, cleanup } = require('./helpers');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'agent365');
const CACHE = '.a365-workspace-detection.local.json';
const project = {
  'package.json': JSON.stringify({ dependencies: { '@github/copilot-sdk': '1.0.14' } }),
  'src/index.ts': "import { CopilotClient } from '@github/copilot-sdk';",
};
const confirmed = {
  agentStack: 'GitHub Copilot SDK', programmingLanguage: 'NodeJS',
  agentType: 'system-agent', authMode: 's2s', usesTeamsOrCopilot: 0,
  has_aiteammate_structure: false, has_workiq: false,
  capabilities: ['Register', 'Observability'],
  standaloneApprovals: { scope: true, s2s: true },
};

function snapshot(root) {
  return fs.readdirSync(root, { recursive: true }).sort().map(relative => {
    const file = path.join(root, relative);
    return [relative, fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null];
  });
}

function inspectHook(name, files, args = []) {
  const dir = createFixture(files);
  try {
    const before = snapshot(dir);
    const script = path.join(PLUGIN, 'hooks', 'stop', `validate-${name}.js`);
    const localRequire = createRequire(script);
    const calls = [];
    const forbiddenProcesses = new Proxy({}, {
      get: (_, method) => () => {
        calls.push(method);
        throw new Error('External process execution is forbidden in this test');
      },
    });
    const stopped = new Error('hook exit');
    let output = '';
    let exitCode;
    try {
      vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
        require: module => module === 'child_process' ? forbiddenProcesses : localRequire(module),
        process: {
          cwd: () => dir, env: { PATH: '' }, execPath: process.execPath,
          argv: [process.execPath, script, ...args],
          stdout: { write: text => { output += text; } },
          exit: code => { exitCode = code; throw stopped; },
        },
        console: { warn: () => {} },
      }, { filename: script, timeout: 5000 });
    } catch (error) {
      if (error !== stopped) throw error;
    }
    assert.deepEqual(calls, [], 'no CLI/build/global install may run before gates');
    assert.deepEqual(snapshot(dir), before, 'validator cannot change the project');
    return { ...JSON.parse(output), exitCode };
  } finally { cleanup(dir); }
}

test('explicit setup report with no cache or CLI ends without authorizing work', () => {
  const result = inspectHook('a365-setup', project, ['--report-only']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'report-only');
  assert.equal(result.operationAllowed, false);
  assert.match(result.pending.join('; '), /detection.local.json.*scope.*s2s/);
  assert.match(result.pending.join('; '), /Tenant authentication.*not verified/);
  assert.doesNotMatch(JSON.stringify(result), /dotnet tool|setup all|az login/);
});

test('ordinary setup invocation does not infer report permission from missing cache', () => {
  const result = inspectHook('a365-setup', project);
  assert.equal(result.exitCode, 1);
  assert.equal(result.status, 'blocked');
  assert.equal(result.operationAllowed, false);
  assert.match(result.reason, /detection.local.json/);
});

for (const [label, cache] of [
  ['malformed cache', '{'],
  ['stale stack', JSON.stringify({ ...confirmed, agentStack: 'LangChain' })],
  ['mismatched auth mode', JSON.stringify({ ...confirmed, authMode: 'obo' })],
  ['malformed approval record', JSON.stringify({ ...confirmed, standaloneApprovals: [] })],
  ['malformed capability list', JSON.stringify({ ...confirmed, capabilities: {} })],
]) {
  test(`report-only cannot hide ${label}`, () => {
    const result = inspectHook('a365-setup', { ...project, [CACHE]: cache }, ['--report-only']);
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'blocked');
    assert.equal(result.operationAllowed, false);
  });
}

test('cached SDK with removed dependency cannot fall through to generic setup', () => {
  const result = inspectHook('a365-setup', {
    ...project, 'package.json': '{}', [CACHE]: JSON.stringify(confirmed),
  }, ['--report-only']);
  assert.equal(result.exitCode, 1);
  assert.match(result.reason, /no direct/);
});

test('scope and S2S approval are explicit booleans, not inferred from selected capabilities', () => {
  for (const approvals of [undefined, {}, { scope: true }, { scope: 'true', s2s: true }]) {
    const files = { ...project, [CACHE]: JSON.stringify({ ...confirmed, standaloneApprovals: approvals }) };
    const result = inspectHook('a365-setup', files);
    assert.equal(result.exitCode, 1);
    assert.match(result.reason, /confirmation is missing/);
    const report = inspectHook('a365-setup', files, ['--report-only']);
    assert.equal(report.status, 'report-only');
    assert.equal(report.operationAllowed, false);
    assert.match(report.pending.join('; '), /confirmation is missing/);
  }
});

test('confirmed setup checks local metadata without demanding installed CLI', () => {
  const result = inspectHook('a365-setup', { ...project, [CACHE]: JSON.stringify(confirmed) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'local-context-validated');
  assert.equal(result.operationAllowed, false);
});

for (const name of ['make-a365-agent', 'instrument-observability']) {
  test(`${name} ignores report flag and fails closed without cache or operation approval`, () => {
    for (const files of [project, { ...project, [CACHE]: JSON.stringify(confirmed) }]) {
      const result = inspectHook(name, files, ['--report-only']);
      assert.equal(result.exitCode, 1);
      assert.equal(result.operationAllowed, false);
      assert.match(result.reason, /approval is missing/);
      assert.doesNotMatch(result.reason, /dotnet tool|setup all|useMicrosoftOpenTelemetry/);
    }
  });
}

test('malformed instrumentation capabilities return a blocked report instead of throwing', () => {
  const result = inspectHook('instrument-observability', {
    ...project, [CACHE]: JSON.stringify({ ...confirmed, capabilities: {} }),
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.reason, /capabilities|capability/i);
});

const registration = {
  ...project,
  [CACHE]: JSON.stringify({
    ...confirmed, reuseBlueprint: true, existingBlueprintId: 'fixture-blueprint',
    standaloneApprovals: { ...confirmed.standaloneApprovals, registration: true },
  }),
  'a365.config.json': JSON.stringify({ blueprintId: 'fixture-blueprint' }),
};

test('approved reuse validates local config only, with no CLI or live success claim', () => {
  const result = inspectHook('make-a365-agent', registration);
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'local-config-validated');
  assert.equal(result.operationAllowed, false);
  assert.match(result.note, /registry registration.*not verified/);
});

for (const [label, changes] of [
  ['missing config', { 'a365.config.json': '{}' }],
  ['malformed config', { 'a365.config.json': '{' }],
  ['conflicting IDs', { 'a365.generated.config.json': '{"agentBlueprintId":"another-fixture"}' }],
  ['empty generated ID', { 'a365.generated.config.json': '{}' }],
  ['conflicting tenants', {
    'a365.config.json': '{"blueprintId":"fixture-blueprint","tenantId":"fixture-tenant-a"}',
    'a365.generated.config.json': '{"agentBlueprintId":"fixture-blueprint","tenantId":"fixture-tenant-b"}',
  }],
]) {
  test(`standalone registration fails closed on ${label}`, () => {
    const result = inspectHook('make-a365-agent', { ...registration, ...changes });
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'blocked');
  });
}

test('setup report-only is wired only to setup, not action validators', () => {
  for (const name of ['a365-setup', 'make-a365-agent', 'instrument-observability']) {
    const skill = fs.readFileSync(path.join(PLUGIN, 'skills', name, 'SKILL.md'), 'utf8');
    const command = skill.split(/\r?\n/).find(line => line.includes(`validate-${name}.js`));
    assert.equal(command.includes('--report-only'), name === 'a365-setup');
    assert.match(skill, /STOP; do not evaluate the generic/);
  }
});
