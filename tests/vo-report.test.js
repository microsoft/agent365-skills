'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const reportPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/validators/report.js');
const expected   = fs.readFileSync(path.join(__dirname, 'fixtures', 'vo', 'expected-report.md'), 'utf8');

test('report.format() snapshot matches expected', () => {
  const { format } = require(reportPath);
  const findings = [
    { ruleId: 'rule-s2s_caller_details_required',  severity: 'error',
      spanId: 'aa00000000000001', traceId: 'aa00000000000000aa00000000000000',
      metadata: { spanName: 'invoke_agent' },
      fixHint: 'S2S agents must populate CallerDetails on InvokeAgentScope.Start(); without it, traces reach the API (200) but stay invisible in the MAC portal.' },
    { ruleId: 'rule-resource_service_name_present', severity: 'warning',
      spanId: 'aa00000000000001', traceId: 'aa00000000000000aa00000000000000',
      metadata: { spanName: 'invoke_agent' },
      fixHint: 'service.name resource attribute is missing — set SERVICE_NAME (Node.js/Python) or use_microsoft_opentelemetry(service_name=...).' },
  ];
  const md = format(findings);
  assert.equal(md.trim(), expected.trim());
});
