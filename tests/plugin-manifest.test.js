// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'plugins', 'agent365');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const copilot = readJson('plugin.json');
const claude = readJson(path.join('.claude-plugin', 'plugin.json'));

test('standard root manifest preserves shared Claude plugin metadata and skill path', () => {
  for (const field of ['name', 'version', 'description', 'skills']) {
    assert.equal(copilot[field], claude[field], field);
  }
  assert.equal(copilot.name, 'agent365');
  assert.match(copilot.description, /GitHub Copilot SDK standalone/);
});

test('standard manifest exposes all existing skill directories including standalone onboarding', () => {
  const skillsRoot = path.resolve(ROOT, copilot.skills);
  assert.equal(skillsRoot, path.join(ROOT, 'skills'));
  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(skills, [
    'a365-code-validator', 'a365-setup', 'add-workiq-tools', 'instrument-observability',
    'make-a365-agent', 'make-ai-teammate', 'purview-dlp-integration', 'test-local',
  ]);
  for (const name of skills) {
    const skill = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^name: ${name}\\r?$`, 'm'), name);
  }
});

test('Copilot manifest does not inherit Claude-only automatic version-check hooks', () => {
  assert.deepEqual(Object.keys(copilot).sort(), ['description', 'name', 'skills', 'version']);
  assert.equal(copilot.hooks, undefined);
  const hooks = claude.hooks.SessionStart.flatMap(entry => entry.hooks);
  assert.ok(hooks.some(hook =>
    hook.command === 'node ${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js'));
});

test('onboarding guidance distinguishes the full CLI from the bundled agent runtime', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'shared', 'copilot-sdk-standalone.md'), 'utf8');
  assert.match(guide, /plugin-capable full Copilot CLI development host/);
  assert.match(guide, /An empty catalog alone does not establish a runtime limitation/);
  assert.match(guide, /Do not assume the bundled agent runtime accepts full-CLI launch arguments/);
  assert.match(guide, /strict response-format and no-follow-up adherence[\s\S]*are not guaranteed/);
  assert.match(guide, /not inside the agent's SDK runtime/);
  assert.match(guide, /without a discovered\/invoked skill does not count/);
});

test('public standalone guidance identifies the pending helper and separates static from live evidence', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'shared', 'copilot-sdk-standalone.md'), 'utf8');
  assert.match(guide, /\*\*pending\/unpublished\*\*/);
  assert.match(guide, /microsoft\/Agent365-Samples/);
  assert.match(guide, /No public immutable sample revision is linked/);
  assert.match(guide, /a365IngestionVerified: false/);
  assert.match(guide, /Registry registration and portal indexing require their/);
  assert.match(guide, /operationAllowed: false/);
  assert.match(guide, /not completed setup or permission to proceed/);
});

test('local artifact ignores preserve public examples and arbitrary JSON visibility', () => {
  for (const file of [
    path.join(ROOT, '..', '..', '.gitignore'),
    path.join(ROOT, '..', '..', 'tests', 'fixtures', 'copilot-sdk', '.gitignore'),
  ]) {
    const rules = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const required of [
      '.env', '.env.*', '!.env.example', '.a365-workspace-detection.local.json',
      'a365.generated.config.json', '.copilot-local/', '.copilot-traces/',
    ]) assert.ok(rules.includes(required), `${file}: ${required}`);
    assert.ok(!rules.includes('*.json'));
    assert.ok(!rules.includes('*.log'));
    assert.ok(!rules.includes('*.pem'));
  }
});
