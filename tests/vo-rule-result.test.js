'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');

const rrPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/validators/rule-result.js');

test('RuleResult() returns object with all required fields and defaults', () => {
  const { RuleResult } = require(rrPath);
  const rr = RuleResult({ ruleId: 'rule-x', value: 'absent', valueType: 'string', spanId: 'aa', traceId: 'bb' });
  assert.equal(rr.ruleId,    'rule-x');
  assert.equal(rr.confidence, 1.0);
  assert.equal(rr.severity,  'error');
  assert.equal(rr.metadata,  null);
});

test('toUpstreamShape() strips skill-only fields (severity, fixHint)', () => {
  const { RuleResult, toUpstreamShape } = require(rrPath);
  const rr = RuleResult({ ruleId: 'rule-x', value: 'v', valueType: 'string', spanId: 'a', traceId: 'b', severity: 'warning', fixHint: 'do x' });
  const u  = toUpstreamShape(rr);
  assert.equal(u.severity, undefined);
  assert.equal(u.fixHint,  undefined);
  assert.equal(u.ruleId,   'rule-x');
});
