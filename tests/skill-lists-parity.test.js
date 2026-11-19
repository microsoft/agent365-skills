// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

// Parity guard: plugin.json and Claude Code auto-discover skills from
// plugins/agent365/skills/, but several other places hold an explicit skill
// list. `gh skill add` installs only what .github/plugin/marketplace.json lists,
// so a missing entry silently drops that skill for Copilot CLI users (this
// happened to purview-dlp-integration). This test fails if any list drifts.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const skillDirs = fs.readdirSync(path.join(ROOT, 'plugins/agent365/skills'), { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

function block(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `marker not found: ${start}`);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from + start.length, to);
}

describe('explicit skill lists match plugins/agent365/skills/', () => {
  test('skills directory is non-empty', () => {
    assert.ok(skillDirs.length > 0);
  });

  test('.github/plugin/marketplace.json plugins[0].skills', () => {
    const manifest = JSON.parse(read('.github/plugin/marketplace.json'));
    const listed = manifest.plugins[0].skills.map(s => s.replace(/^\.\/skills\//, '')).sort();
    assert.deepEqual(listed, skillDirs);
  });

  test('scripts/refresh.sh plugin_skills', () => {
    const names = block(read('scripts/refresh.sh'), 'plugin_skills=(', ')')
      .split(/\s+/).filter(Boolean).sort();
    assert.deepEqual(names, skillDirs);
  });

  test('scripts/refresh.ps1 $pluginSkills', () => {
    const names = [...block(read('scripts/refresh.ps1'), '$pluginSkills = @(', ')').matchAll(/'([^']+)'/g)]
      .map(m => m[1]).sort();
    assert.deepEqual(names, skillDirs);
  });

  for (const template of ['bug_report.yml', 'feature_request.yml']) {
    test(`.github/ISSUE_TEMPLATE/${template} skill dropdown`, () => {
      const options = block(read(`.github/ISSUE_TEMPLATE/${template}`), 'options:', 'validations:')
        .split('\n')
        .map(l => l.match(/^\s*-\s+(.+?)\s*$/))
        .filter(Boolean)
        .map(m => m[1])
        .filter(n => n !== 'new skill')
        .sort();
      assert.deepEqual(options, skillDirs);
    });
  }
});
