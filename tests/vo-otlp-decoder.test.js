'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const decoderPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js');
const fixturesDir = path.join(__dirname, 'fixtures', 'vo');

test('decode() — protobuf payload yields uniform shape with one span', async () => {
  const decoder = require(decoderPath);
  const body = fs.readFileSync(path.join(fixturesDir, 'otlp-protobuf-clean.bin'));
  const result = await decoder.decode(body, 'application/x-protobuf');
  assert.equal(result.spans.length, 1);
  assert.equal(result.spans[0].name, 'invoke_agent');
  assert.equal(result.resource['service.name'], 'demo-agent');
  assert.equal(result.scope.name, 'Microsoft.Agents.A365.Observability');
});

test('decode() — JSON payload yields uniform shape with normalized IDs', async () => {
  const decoder = require(decoderPath);
  const body = fs.readFileSync(path.join(fixturesDir, 'otlp-json-clean.json'), 'utf8');
  const result = await decoder.decode(body, 'application/json');
  assert.equal(result.spans.length, 1);
  assert.equal(result.wireFormat, 'json');
  // IDs must be normalized into hex strings (matching what the protobuf path produces).
  assert.match(result.spans[0].traceId, /^[0-9a-f]{32}$/);
  assert.match(result.spans[0].spanId,  /^[0-9a-f]{16}$/);
});

test('decode() — JSON and protobuf inputs produce equivalent normalized IDs', async () => {
  const decoder = require(decoderPath);
  const protobufBody = fs.readFileSync(path.join(fixturesDir, 'otlp-protobuf-clean.bin'));
  const jsonBody     = fs.readFileSync(path.join(fixturesDir, 'otlp-json-clean.json'), 'utf8');
  const fromPb   = await decoder.decode(protobufBody, 'application/x-protobuf');
  const fromJson = await decoder.decode(jsonBody,     'application/json');
  assert.equal(fromPb.spans[0].traceId, fromJson.spans[0].traceId);
  assert.equal(fromPb.spans[0].spanId,  fromJson.spans[0].spanId);
});

test('decode() — malformed protobuf body throws DecoderError', async () => {
  const decoder = require(decoderPath);
  await assert.rejects(
    () => decoder.decode(Buffer.from('not a real protobuf payload'), 'application/x-protobuf'),
    err => err.name === 'DecoderError' && /failed to decode/i.test(err.message),
  );
});

test('decode() — malformed JSON body throws DecoderError', async () => {
  const decoder = require(decoderPath);
  await assert.rejects(
    () => decoder.decode('this is not json {', 'application/json'),
    err => err.name === 'DecoderError',
  );
});

test('decode() — unknown content-type throws DecoderError', async () => {
  const decoder = require(decoderPath);
  await assert.rejects(
    () => decoder.decode(Buffer.from('whatever'), 'text/plain'),
    err => err.name === 'DecoderError' && /unsupported content-type/i.test(err.message),
  );
});
