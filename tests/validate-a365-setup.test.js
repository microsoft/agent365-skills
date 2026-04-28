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

// ── .a365-workspace-detection.json authMode checks ────────────────────────────

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
      '.a365-workspace-detection.json': JSON.stringify({ agentStack: 'AgentFramework', authMode: 'obo' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with authMode=s2s → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.json': JSON.stringify({ agentStack: 'LangChain', authMode: 's2s' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with authMode=both → ok', () => {
    const dir = createFixture({
      '.a365-workspace-detection.json': JSON.stringify({ agentStack: 'LangChain', authMode: 'both' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('detection file with empty authMode → reports missing authMode', () => {
    const dir = createFixture({
      '.a365-workspace-detection.json': JSON.stringify({ agentStack: 'AgentFramework', authMode: '' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /authMode is empty/);
    } finally { cleanup(dir); }
  });

  test('detection file with missing authMode key → reports missing authMode', () => {
    const dir = createFixture({
      '.a365-workspace-detection.json': JSON.stringify({ agentStack: 'AgentFramework', agentType: 'system-agent' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /authMode is empty/);
    } finally { cleanup(dir); }
  });

  test('malformed detection file → reports parse error', () => {
    const dir = createFixture({
      '.a365-workspace-detection.json': '{ invalid json',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /cannot be parsed/);
    } finally { cleanup(dir); }
  });
});
