// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-make-a365-agent.js');

// ── Blueprint config checks ───────────────────────────────────────────────────

describe('validate-make-a365-agent — blueprint config', () => {
  test('a365.generated.config.json with agentBlueprintId → ok', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('a365.config.json with blueprintId (reuseBlueprint=true) → ok', () => {
    const dir = createFixture({
      'a365.config.json': JSON.stringify({ blueprintId: 'bp-abc-123' }),
      '.a365-workspace-detection.json': JSON.stringify({ reuseBlueprint: true }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('a365.config.json with agentBlueprintId field (reuseBlueprint=true) → ok', () => {
    const dir = createFixture({
      'a365.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123' }),
      '.a365-workspace-detection.json': JSON.stringify({ reuseBlueprint: true }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('reuseBlueprint=true with existingBlueprintId in cache (no ID in file) → ok', () => {
    const dir = createFixture({
      'a365.config.json': JSON.stringify({ agentName: 'my-agent' }),
      '.a365-workspace-detection.json': JSON.stringify({ reuseBlueprint: true, existingBlueprintId: 'bp-abc-123' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('no config files → reports missing', () => {
    const dir = createFixture({ 'README.md': '# My Agent' });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365.generated.config.json/);
    } finally { cleanup(dir); }
  });

  test('a365.generated.config.json with empty agentBlueprintId → reports missing', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: '' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Blueprint ID not found/);
    } finally { cleanup(dir); }
  });

  test('a365.config.json with empty blueprintId and no cache ID (reuseBlueprint=true) → reports missing', () => {
    const dir = createFixture({
      'a365.config.json': JSON.stringify({ blueprintId: '' }),
      '.a365-workspace-detection.json': JSON.stringify({ reuseBlueprint: true }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Blueprint ID not found/);
    } finally { cleanup(dir); }
  });

  test('reuseBlueprint=true but no config files found → reports missing', () => {
    const dir = createFixture({
      '.a365-workspace-detection.json': JSON.stringify({ reuseBlueprint: true }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /reuseBlueprint=true but neither/);
    } finally { cleanup(dir); }
  });

  test('malformed a365.generated.config.json → reports parse error', () => {
    const dir = createFixture({
      'a365.generated.config.json': '{ invalid json',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Could not parse/);
    } finally { cleanup(dir); }
  });

  // GA-handoff signals — non-blocking warnings, must not change ok status.
  test('a365.generated.config.json with completed=false → ok (non-blocking warning for pending GA consent)', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123', completed: false }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('a365.generated.config.json with empty resourceConsents → ok (non-blocking warning for pending GA consent)', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123', resourceConsents: [] }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('a365.generated.config.json missing managedIdentityPrincipalId → ok (non-blocking warning)', () => {
    const dir = createFixture({
      'a365.generated.config.json': JSON.stringify({ agentBlueprintId: 'bp-abc-123' }),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});
