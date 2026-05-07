'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

const storePath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/daemon/capture-store.js');

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vo-store-'));
}

test('append() then readAll() returns the appended entry', () => {
  const { CaptureStore } = require(storePath);
  const dir   = freshDir();
  const store = CaptureStore({ captureDir: dir });
  store.append({ receivedAt: 't0', span: { spanId: 'aa' } });
  const all = store.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].span.spanId, 'aa');
  store.close();
});
