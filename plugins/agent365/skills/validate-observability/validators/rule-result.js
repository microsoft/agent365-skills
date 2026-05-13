'use strict';

function RuleResult({
  ruleId, value, valueType,
  confidence = 1.0,
  metadata   = null,
  severity   = 'error',
  fixHint    = '',
  spanId     = '',
  traceId    = '',
}) {
  return { ruleId, value, valueType, confidence, metadata, severity, fixHint, spanId, traceId };
}

const SKILL_ONLY_KEYS = ['severity', 'fixHint'];

function toUpstreamShape(rr) {
  const out = { ...rr };
  for (const k of SKILL_ONLY_KEYS) delete out[k];
  return out;
}

module.exports = { RuleResult, toUpstreamShape, SKILL_ONLY_KEYS };
