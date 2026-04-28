// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

/**
 * Create a temp directory populated with the given file tree.
 * @param {Record<string, string>} files  Map of relative path → content
 * @returns {string} Absolute path to the temp directory
 */
function createFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a365-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

/**
 * Run a validator script against a fixture directory.
 * Sets VALIDATE_SKIP_EXEC=1 to bypass external CLI/build commands.
 * @param {string} validatorPath  Absolute path to the validator .js file
 * @param {string} fixtureDir     Directory to use as cwd
 * @returns {{ ok: boolean, reason?: string }}
 */
function runValidator(validatorPath, fixtureDir) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(validatorPath)],
    {
      cwd: fixtureDir,
      env: { ...process.env, VALIDATE_SKIP_EXEC: '1' },
      encoding: 'utf8',
      timeout: 10000,
    }
  );
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return { ok: false, reason: `parse error — stdout: ${result.stdout} stderr: ${result.stderr}` };
  }
}

/** Remove a temp fixture directory. */
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { createFixture, runValidator, cleanup };
