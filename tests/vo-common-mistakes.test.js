'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const cmPath    = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/validators/common-mistakes.js');
const rulesPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/references/common-mistakes.json');
const fixDir    = path.join(__dirname, 'fixtures', 'vo');

function loadTrace(file) { return JSON.parse(fs.readFileSync(path.join(fixDir, file), 'utf8')); }

test('common-mistakes: missing CallerDetails fires rule-s2s_caller_details_required', () => {
  const { loadRules, validateTrace } = require(cmPath);
  const rules    = loadRules(rulesPath);
  const trace    = loadTrace('trace-bad-no-caller.json');
  const findings = validateTrace(trace, rules);
  const f        = findings.find(x => x.ruleId === 'rule-s2s_caller_details_required');
  assert.ok(f, JSON.stringify(findings, null, 2));
});

test('common-mistakes: child scope before parent fires rule-scope_ordering', () => {
  const { loadRules, validateTrace } = require(cmPath);
  const rules    = loadRules(rulesPath);
  const trace    = loadTrace('trace-bad-scope-order.json');
  const findings = validateTrace(trace, rules);
  const f        = findings.find(x => x.ruleId === 'rule-scope_ordering');
  assert.ok(f, JSON.stringify(findings, null, 2));
});

test('common-mistakes: clean trace passes (zero common-mistakes findings)', () => {
  const { loadRules, validateTrace } = require(cmPath);
  const rules = loadRules(rulesPath);
  const clean = [
    { traceId: 'cc00', spanId: '01', parentSpanId: '', name: 'invoke_agent',
      startTimeUnixNano: '1000', endTimeUnixNano: '5000',
      attributes: { 'gen_ai.operation.name': 'invoke_agent', 'microsoft.a365.caller.agent.id': 'cx', 'service.name': 'a' },
      _resource: { 'service.name': 'a' } },
    { traceId: 'cc00', spanId: '02', parentSpanId: '01', name: 'inference',
      startTimeUnixNano: '2000', endTimeUnixNano: '3000',
      attributes: { 'gen_ai.operation.name': 'inference', 'service.name': 'a',
                    'microsoft.a365.agent.id': 'agent-x', 'microsoft.a365.tenant.id': 'tenant-x' },
      _resource: { 'service.name': 'a' } },
    { traceId: 'cc00', spanId: '03', parentSpanId: '01', name: 'execute_tool',
      startTimeUnixNano: '3500', endTimeUnixNano: '4000',
      attributes: { 'gen_ai.operation.name': 'execute_tool', 'service.name': 'a',
                    'microsoft.a365.agent.id': 'agent-x', 'microsoft.a365.tenant.id': 'tenant-x' },
      _resource: { 'service.name': 'a' } },
  ];
  const findings = validateTrace(clean, rules);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});
