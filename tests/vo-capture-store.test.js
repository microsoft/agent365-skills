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

test('readSinceCursor() returns only entries after the last advanceCursor()', () => {
  const { CaptureStore } = require(storePath);
  const dir   = freshDir();
  const store = CaptureStore({ captureDir: dir });
  store.append({ span: { spanId: 'a' } });
  store.append({ span: { spanId: 'b' } });
  store.advanceCursor();
  store.append({ span: { spanId: 'c' } });
  const since = store.readSinceCursor();
  assert.equal(since.length, 1);
  assert.equal(since[0].span.spanId, 'c');
  store.close();
});

test('rotation: when traces.jsonl exceeds rotationBytes it is renamed to .1', () => {
  const { CaptureStore } = require(storePath);
  const dir   = freshDir();
  const store = CaptureStore({ captureDir: dir, rotationBytes: 50 });
  store.append({ pad: 'x'.repeat(40) });   // small line
  store.append({ pad: 'x'.repeat(40) });   // pushes file past 50 bytes -> rotates AFTER append
  assert.ok(fs.existsSync(path.join(dir, 'traces.jsonl.1')), 'expected traces.jsonl.1 to exist');
  store.close();
});

test('getCursor() returns zeroed cursor when cursor.json is corrupt', () => {
  const { CaptureStore } = require(storePath);
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'cursor.json'), '{ this is not json');
  const store = CaptureStore({ captureDir: dir });
  const c = store.getCursor();
  assert.equal(c.lastReadCount, 0);
  store.close();
});
