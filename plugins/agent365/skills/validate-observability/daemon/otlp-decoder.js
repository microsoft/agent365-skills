'use strict';
const path     = require('path');
const protobuf = require('protobufjs');

const PROTO_ROOT = path.join(__dirname, 'opentelemetry-proto');
const PROTO_FILE = path.join(PROTO_ROOT, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');

let _root = null;
async function loadRoot() {
  if (_root) return _root;
  const r = new protobuf.Root();
  r.resolvePath = (origin, target) => {
    if (target.startsWith('opentelemetry/')) return path.join(PROTO_ROOT, target);
    return target;
  };
  await r.load(PROTO_FILE, { keepCase: false });
  _root = r;
  return r;
}

function flattenAttributes(attrs) {
  const out = {};
  for (const a of attrs || []) {
    const v = a.value || {};
    if      (v.stringValue !== undefined) out[a.key] = v.stringValue;
    else if (v.intValue    !== undefined) out[a.key] = Number(v.intValue);
    else if (v.boolValue   !== undefined) out[a.key] = v.boolValue;
    else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    else if (v.bytesValue  !== undefined) out[a.key] = Buffer.from(v.bytesValue).toString('hex');
    else if (v.arrayValue && v.arrayValue.values) {
      out[a.key] = v.arrayValue.values.map(x => x.stringValue ?? x.intValue ?? x.boolValue ?? null);
    } else {
      out[a.key] = null;
    }
  }
  return out;
}

function normalizeSpan(s) {
  return {
    traceId:           Buffer.isBuffer(s.traceId)      ? s.traceId.toString('hex')      : s.traceId,
    spanId:            Buffer.isBuffer(s.spanId)       ? s.spanId.toString('hex')       : s.spanId,
    parentSpanId:      Buffer.isBuffer(s.parentSpanId) ? s.parentSpanId.toString('hex') : (s.parentSpanId || ''),
    name:              s.name,
    kind:              s.kind,
    startTimeUnixNano: typeof s.startTimeUnixNano === 'bigint' ? s.startTimeUnixNano.toString() : String(s.startTimeUnixNano ?? ''),
    endTimeUnixNano:   typeof s.endTimeUnixNano   === 'bigint' ? s.endTimeUnixNano.toString()   : String(s.endTimeUnixNano   ?? ''),
    attributes:        flattenAttributes(s.attributes),
    status:            s.status || null,
  };
}

function shapeRequest(req, wireFormat) {
  const out = { resource: {}, scope: {}, spans: [], wireFormat };
  for (const rs of req.resourceSpans || []) {
    Object.assign(out.resource, flattenAttributes(rs.resource && rs.resource.attributes));
    for (const ss of rs.scopeSpans || []) {
      out.scope = { name: ss.scope?.name || '', version: ss.scope?.version || '' };
      for (const sp of ss.spans || []) out.spans.push(normalizeSpan(sp));
    }
  }
  return out;
}

async function decode(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/x-protobuf') || ct.includes('application/protobuf')) {
    const root = await loadRoot();
    const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
    const msg  = Req.decode(body);
    const obj  = Req.toObject(msg, { bytes: Buffer, longs: String, defaults: true });
    return shapeRequest(obj, 'protobuf');
  }
  throw new Error(`Unsupported content-type: ${contentType}`);
}

module.exports = { decode, shapeRequest, flattenAttributes, normalizeSpan };
