'use strict';
const path     = require('path');
const protobuf = require('protobufjs');

const PROTO_ROOT = path.join(__dirname, 'opentelemetry-proto');
const PROTO_FILE = path.join(PROTO_ROOT, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');

let _rootPromise = null;
function loadRoot() {
  if (!_rootPromise) _rootPromise = _buildRoot();
  return _rootPromise;
}

async function _buildRoot() {
  const r = new protobuf.Root();
  r.resolvePath = (origin, target) => {
    if (target.startsWith('opentelemetry/')) return path.join(PROTO_ROOT, target);
    return target;
  };
  await r.load(PROTO_FILE, { keepCase: false });
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

class DecoderError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DecoderError';
    if (cause) this.cause = cause;
  }
}

function rehydrateBinaryStrings(req) {
  for (const rs of req.resourceSpans || []) {
    for (const ss of rs.scopeSpans || []) {
      for (const sp of ss.spans || []) {
        if (typeof sp.traceId      === 'string') sp.traceId      = decodeIdString(sp.traceId);
        if (typeof sp.spanId       === 'string') sp.spanId       = decodeIdString(sp.spanId);
        if (typeof sp.parentSpanId === 'string') sp.parentSpanId = decodeIdString(sp.parentSpanId);
      }
    }
  }
}

function decodeIdString(s) {
  // hex (16 or 32 chars) → Buffer; otherwise treat as base64
  if (/^[0-9a-f]+$/i.test(s) && (s.length === 16 || s.length === 32)) return Buffer.from(s, 'hex');
  return Buffer.from(s, 'base64');
}

async function decode(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  try {
    if (ct.includes('application/x-protobuf') || ct.includes('application/protobuf')) {
      const root = await loadRoot();
      const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
      const msg  = Req.decode(body);
      const obj  = Req.toObject(msg, { bytes: Buffer, longs: String, defaults: true });
      return shapeRequest(obj, 'protobuf');
    }
    if (ct.includes('application/json')) {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      const obj  = JSON.parse(text);
      rehydrateBinaryStrings(obj);
      return shapeRequest(obj, 'json');
    }
  } catch (e) {
    throw new DecoderError(`failed to decode (${ct || 'no content-type'}): ${e.message}`, e);
  }
  throw new DecoderError(`unsupported content-type: ${contentType}`);
}

module.exports = { decode, shapeRequest, flattenAttributes, normalizeSpan, DecoderError };
