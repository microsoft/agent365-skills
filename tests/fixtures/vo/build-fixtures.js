'use strict';
// Generates OTLP test fixtures (.bin protobuf + .json) from a single in-memory
// span. Run once: `node tests/fixtures/vo/build-fixtures.js`. Commit outputs.

const fs   = require('fs');
const path = require('path');
const { join } = path;

const protobuf = require(path.resolve(
  __dirname, '..', '..', '..',
  'plugins', 'agent365', 'skills', 'validate-observability', 'daemon', 'node_modules', 'protobufjs'
));
const Long = protobuf.util.Long;

const OTLP_PROTO = join(
  __dirname, '..', '..', '..', 'plugins', 'agent365', 'skills',
  'validate-observability', 'daemon', 'opentelemetry-proto'
);

const REQ = {
  resourceSpans: [{
    resource: {
      attributes: [
        { key: 'service.name',      value: { stringValue: 'demo-agent' } },
        { key: 'service.namespace', value: { stringValue: 'demo' } },
      ],
    },
    scopeSpans: [{
      scope: { name: 'Microsoft.Agents.A365.Observability', version: '1.0.0' },
      spans: [{
        traceId:  Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
        spanId:   Buffer.from('0123456789abcdef', 'hex'),
        name:     'invoke_agent',
        kind:     1,
        startTimeUnixNano: Long.fromString('1714932000000000000'),
        endTimeUnixNano:   Long.fromString('1714932001000000000'),
        attributes: [
          { key: 'gen_ai.operation.name',  value: { stringValue: 'invoke_agent' } },
          { key: 'gen_ai.agent.id',        value: { stringValue: '30ed5699-b157-4e87-bb45-9b0cfb13b8e5' } },
          { key: 'gen_ai.conversation.id', value: { stringValue: '19:thread@demo' } },
        ],
        status: { code: 1 },
      }],
    }],
  }],
};

async function main() {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => {
    if (target.startsWith('opentelemetry/')) return join(OTLP_PROTO, target);
    return target;
  };
  await root.load(join(OTLP_PROTO, 'opentelemetry/proto/collector/trace/v1/trace_service.proto'));
  const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
  const err  = Req.verify(REQ);
  if (err) throw new Error(err);
  const buf  = Req.encode(Req.fromObject(REQ)).finish();
  fs.writeFileSync(join(__dirname, 'otlp-protobuf-clean.bin'), buf);
  fs.writeFileSync(
    join(__dirname, 'otlp-json-clean.json'),
    JSON.stringify(REQ, (k, v) => Buffer.isBuffer(v) ? v.toString('base64') : (v && typeof v === 'object' && v.constructor && v.constructor.name === 'Long' ? v.toString() : v), 2)
  );
  console.log('wrote otlp-protobuf-clean.bin (', buf.length, 'bytes) and otlp-json-clean.json');
}

main().catch(e => { console.error(e); process.exit(1); });
