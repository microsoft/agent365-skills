// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-a365-setup.js');

// ── a365 CLI check ────────────────────────────────────────────────────────────
// VALIDATE_SKIP_EXEC=1 stubs the CLI check as 'skipped' (truthy), so the
// CLI-installed check always passes in tests. We only test the file-based checks.

describe('validate-a365-setup — no generated config', () => {
  test('empty project → ok (CLI check skipped, no generated config)', () => {
    const dir = createFixture({ 'README.md': '# My Agent' });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});

// ── Generated config checks ───────────────────────────────────────────────────

describe('validate-a365-setup — a365.generated.config.json', () => {
  test('valid config with agentBlueprintId → ok', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('config with empty agentBlueprintId → reports missing Blueprint ID', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: '' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /agentBlueprintId is empty/);
    } finally { cleanup(dir); }
  });

  test('config missing agentBlueprintId key → reports missing Blueprint ID', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ somethingElse: 'value' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /agentBlueprintId is empty/);
    } finally { cleanup(dir); }
  });

  test('malformed generated config → reports parse error', () => {
    const dir = createFixture({
      'a365.generated.config.json': '{ invalid json',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /cannot be parsed/);
    } finally { cleanup(dir); }
  });

  // GA-handoff signals — non-blocking warnings, must not change ok status.
  test('config with completed=false → ok (non-blocking warning for pending GA consent)', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123', completed: false }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('config with empty resourceConsents → ok (non-blocking warning for pending GA consent)', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123', resourceConsents: [] }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});

// ── .gitignore check (non-blocking warning — does not affect ok/fail) ─────────

describe('validate-a365-setup — .gitignore warning', () => {
  test('valid config + gitignore includes generated config → ok', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123' }),
      '.gitignore': 'a365.generated.config.json\n.env\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('valid config + gitignore missing generated config → ok (warning only)', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123' }),
      '.gitignore': 'node_modules/\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      // Warning is printed to stderr but result is still ok
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});

// ── .a365-workspace-detection.local.json authMode checks ────────────────────────────

describe('validate-a365-setup — authMode in detection cache', () => {
  test('no detection file → ok (a365-setup may not have written it yet)', () => {
    const dir = createFixture({ 'README.md': '# My Agent' });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with authMode=obo → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ agentStack: 'AgentFramework', authMode: 'obo' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with authMode=s2s → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ agentStack: 'LangChain', authMode: 's2s' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with authMode=agentic-user → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ agentStack: 'LangChain', authMode: 'agentic-user' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with legacy authMode=both → reports unsupported', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ agentStack: 'LangChain', authMode: 'both' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /unsupported authMode/);
    } finally { cleanup(dir); }
  });

  test('detection file with empty authMode → reports missing authMode', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ agentStack: 'AgentFramework', authMode: '' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /authMode is empty/);
    } finally { cleanup(dir); }
  });

  test('detection file with missing authMode key → reports missing authMode', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({ agentStack: 'AgentFramework', agentType: 'system-agent' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /authMode is empty/);
    } finally { cleanup(dir); }
  });

  test('hasBlueprintConfig=1 with reuseBlueprint set → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework', authMode: 'obo',
        hasBlueprintConfig: 1, reuseBlueprint: true, existingBlueprintId: 'bp-abc-123',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('hasBlueprintConfig=1 but reuseBlueprint not set → reports missing reuseBlueprint', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework', authMode: 'obo', hasBlueprintConfig: 1,
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /reuseBlueprint/);
    } finally { cleanup(dir); }
  });

  test('malformed detection file → reports parse error', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': '{ invalid json',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /cannot be parsed/);
    } finally { cleanup(dir); }
  });

  // 8-row state-matrix flags (introduced alongside make-ai-teammate Phase 0C).
  test('detection file with has_obs / has_workiq / has_aiteammate_structure flags → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        has_aiteammate_structure: 1,
        has_obs: 1,
        has_workiq: 0,
        hasBlueprintConfig: 0,
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with legacy hasAITeammateChanges field → ok with warning (no longer stored)', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'obo',
        hasAITeammateChanges: 1,
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with runTarget=prod → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'prod',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with runTarget=local → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'local',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with invalid runTarget → reports unsupported value', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'staging',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /unsupported runTarget/);
    } finally { cleanup(dir); }
  });

  test('detection file with empty runTarget → ok (not yet asked)', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: '',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  // runTargetHosting — Phase 9.7.2b sub-question (devtunnel | cloud).
  test('detection file with runTargetHosting=devtunnel + runTarget=prod → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'prod',
        runTargetHosting: 'devtunnel',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with runTargetHosting=cloud + runTarget=prod → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'prod',
        runTargetHosting: 'cloud',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with invalid runTargetHosting → reports unsupported value', () => {
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'prod',
        runTargetHosting: 'ngrok',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /unsupported runTargetHosting/);
    } finally { cleanup(dir); }
  });

  test('detection file with runTargetHosting set but runTarget=local → ok with warning', () => {
    // Non-fatal: hosting sub-choice is ignored when runTarget=local; validator warns but does not block.
    const dir = createFixture({
      '.a365-workspace-detection.local.json': JSON.stringify({
        agentStack: 'AgentFramework',
        authMode: 'agentic-user',
        runTarget: 'local',
        runTargetHosting: 'devtunnel',
      }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});
