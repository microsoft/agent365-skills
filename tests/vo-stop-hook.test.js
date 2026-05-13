'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '..', 'plugins/agent365/hooks/stop/validate-validate-observability.js');

test('no .a365-observability-capture dir → ok', () => {
  const dir = createFixture({});
  try { assert.deepEqual(runValidator(VALIDATOR, dir), { ok: true }); }
  finally { cleanup(dir); }
});

test('state.json present, claimed daemon PID alive → ok', () => {
  const dir = createFixture({
    '.a365-observability-capture/state.json': JSON.stringify({ pid: process.pid, port: 4318, mutations: [] }),
  });
  try { assert.deepEqual(runValidator(VALIDATOR, dir), { ok: true }); }
  finally { cleanup(dir); }
});

test('state.json present, daemon PID dead, mutations recorded → not ok', () => {
  const dir = createFixture({
    '.a365-observability-capture/state.json': JSON.stringify({ pid: 999999, port: 4318, mutations: [{ file: '.env.local', line: 'AGENT365_OBSERVABILITY_ENDPOINT=...' }] }),
  });
  try {
    const r = runValidator(VALIDATOR, dir);
    assert.equal(r.ok, false);
    assert.match(r.reason, /daemon dead/i);
  } finally { cleanup(dir); }
});
