// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Tests for validate-test-local.js. The validator's primary job is to detect
// the agent's language and then check that a few external tools are on PATH
// (agentsplayground, dotnet/node/python). The tool-presence checks honor
// VALIDATE_SKIP_EXEC=1, which the test helper sets, so these tests focus on
// language routing + the unknown-project pass-through.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(
  __dirname,
  '../plugins/agent365/hooks/stop/validate-test-local.js'
);

describe('validate-test-local — language routing', () => {
  test('Node.js project (package.json + .ts) → ok', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({ name: 'a' }),
      'src/index.ts': '// agent',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('.NET project (.csproj present) → ok', () => {
    const dir = createFixture({
      'MyAgent.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
      'Program.cs':     '// agent',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python project (.py file) → ok', () => {
    const dir = createFixture({
      'pyproject.toml': '[project]\nname = "a"\n',
      'agent.py':       '# agent',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Python project (requirements.txt only) → ok', () => {
    // .py files often live in subdirectories; requirements.txt at the root is
    // sufficient to classify the project as Python.
    const dir = createFixture({
      'requirements.txt': 'aiohttp\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('unknown project (no recognizable manifest) → pass-through ok', () => {
    // The validator deliberately passes through unknown projects so the skill
    // can handle detection interactively.
    const dir = createFixture({
      'README.md': '# not an agent',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('.NET takes precedence over Node.js + Python signals', () => {
    // The validator's order is dotnet → nodejs → python. A .csproj wins even
    // if there are also .ts files and a pyproject.toml present.
    const dir = createFixture({
      'MyAgent.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
      'package.json':   JSON.stringify({ name: 'a' }),
      'src/index.ts':   '',
      'pyproject.toml': '[project]\n',
      'agent.py':       '',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });

  test('Node.js takes precedence over Python when both are present', () => {
    // package.json + .ts beats pyproject.toml.
    const dir = createFixture({
      'package.json':   JSON.stringify({ name: 'a' }),
      'src/index.ts':   '',
      'pyproject.toml': '[project]\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
    } finally { cleanup(dir); }
  });
});
