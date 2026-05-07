'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const http     = require('http');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

const serverPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/daemon/server.js');
const fixtures   = path.join(__dirname, 'fixtures', 'vo');

function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vo-server-')); }

function postBinary({ port, contentType, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/v1/traces',
      headers: { 'content-type': contentType, 'content-length': body.length },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('server: protobuf POST is decoded and persisted, returns 200', async () => {
  const { startServer } = require(serverPath);
  const dir    = freshDir();
  const server = await startServer({ port: 0, captureDir: dir });
  try {
    const body = fs.readFileSync(path.join(fixtures, 'otlp-protobuf-clean.bin'));
    const r = await postBinary({ port: server.port, contentType: 'application/x-protobuf', body });
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(path.join(dir, 'traces.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.span.name, 'invoke_agent');
    assert.equal(entry.wireFormat, 'protobuf');
  } finally {
    await server.close();
  }
});

test('server: JSON POST is also captured', async () => {
  const { startServer } = require(serverPath);
  const dir    = freshDir();
  const server = await startServer({ port: 0, captureDir: dir });
  try {
    const body = fs.readFileSync(path.join(fixtures, 'otlp-json-clean.json'));
    const r = await postBinary({ port: server.port, contentType: 'application/json', body });
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(path.join(dir, 'traces.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).wireFormat, 'json');
  } finally {
    await server.close();
  }
});

test('server: malformed body persists a decode_failure entry, still returns 200', async () => {
  const { startServer } = require(serverPath);
  const dir    = freshDir();
  const server = await startServer({ port: 0, captureDir: dir });
  try {
    const r = await postBinary({ port: server.port, contentType: 'application/x-protobuf', body: Buffer.from('garbage') });
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(path.join(dir, 'traces.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.ok(JSON.parse(lines[0]).decodeError);
  } finally {
    await server.close();
  }
});
