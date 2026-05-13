'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const sdPath     = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/validators/schema-driven.js');
const schemaPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/references/maven-schema.json');
const fixDir     = path.join(__dirname, 'fixtures', 'vo');
const goodSpan   = JSON.parse(fs.readFileSync(path.join(fixDir, 'span-good-invoke.json'), 'utf8'));

test('evalRequiredPredicate: empty array means always-required', () => {
  const { evalRequiredPredicate } = require(sdPath);
  assert.equal(evalRequiredPredicate([[]], goodSpan), true);
});

test('evalRequiredPredicate: AND-of-OR — clause matches when all predicates are true', () => {
  const { evalRequiredPredicate } = require(sdPath);
  const required = [[
    { field: 'gen_ai.operation.name', condition: 'in',     values: ['invoke_agent'] },
    { field: 'request.ingestionSource', condition: 'not_in', values: ['Sydney']     },
  ]];
  assert.equal(evalRequiredPredicate(required, goodSpan), true);
});

test('evalRequiredPredicate: clause fails when any predicate is false', () => {
  const { evalRequiredPredicate } = require(sdPath);
  const required = [[
    { field: 'gen_ai.operation.name', condition: 'in',  values: ['execute_tool'] }, // false
  ]];
  assert.equal(evalRequiredPredicate(required, goodSpan), false);
});

test('validateSpan: clean invoke_agent span produces no errors (privacy warnings expected)', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const findings = validateSpan(goodSpan, schema);
  // CustomerContent / EUII fields legitimately fire warning-severity privacy findings.
  // The clean span should have ZERO error-severity findings.
  const errors = findings.filter(f => f.severity === 'error');
  assert.equal(errors.length, 0, JSON.stringify(errors, null, 2));
});

test('validateSpan: missing required field produces a presence_check finding', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const span = JSON.parse(fs.readFileSync(path.join(fixDir, 'span-bad-missing-field.json'), 'utf8'));
  const findings = validateSpan(span, schema);
  const presenceFinding = findings.find(f => f.ruleId === 'rule-presence_check' && f.metadata.field === 'gen_ai.conversation.id');
  assert.ok(presenceFinding, JSON.stringify(findings, null, 2));
});

test('validateSpan: wrong-type field produces a type_conformance finding', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const span = JSON.parse(fs.readFileSync(path.join(fixDir, 'span-bad-wrong-type.json'), 'utf8'));
  const findings = validateSpan(span, schema);
  const typeFinding = findings.find(f => f.ruleId === 'rule-type_conformance' && f.metadata.field === 'gen_ai.agent.id');
  assert.ok(typeFinding, JSON.stringify(findings, null, 2));
});

test('validateSpan: customer-content field emits rule-privacy_classification warning', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  // goodSpan has gen_ai.input.messages and gen_ai.output.messages — both CustomerContent.
  const findings = validateSpan(goodSpan, schema);
  const privacy = findings.filter(f => f.ruleId === 'rule-privacy_classification');
  // At minimum, the two messages fields fire.
  assert.ok(privacy.length >= 2, JSON.stringify(privacy, null, 2));
  // Severity is warning, not error.
  for (const f of privacy) assert.equal(f.severity, 'warning');
  // Confidence is below 1.0 (heuristic).
  for (const f of privacy) assert.equal(f.confidence, 0.5);
});

test('validateSpan: empty CustomerContent field does not fire rule-privacy_classification', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const span = JSON.parse(JSON.stringify(goodSpan));
  // Empty out one CustomerContent field (the schema lists gen_ai.input.messages as CustomerContent).
  span.attributes['gen_ai.input.messages'] = '';
  const findings = validateSpan(span, schema);
  const onInput = findings.find(f => f.ruleId === 'rule-privacy_classification' && f.metadata.field === 'gen_ai.input.messages');
  assert.equal(onInput, undefined, 'empty value should not fire privacy rule');
});

test('validateSpan: findings populate metadata.spanName for the report formatter', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const span = JSON.parse(fs.readFileSync(path.join(fixDir, 'span-bad-missing-field.json'), 'utf8'));
  const findings = validateSpan(span, schema);
  for (const f of findings) {
    assert.equal(f.metadata.spanName, span.name, `${f.ruleId} should carry spanName`);
  }
});

test('Bytes type checker rejects empty string', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const span = JSON.parse(JSON.stringify(goodSpan));
  span.traceId = '';
  const findings = validateSpan(span, schema);
  const typeMismatch = findings.find(f => f.ruleId === 'rule-type_conformance' && f.metadata.field === 'traceId');
  assert.ok(typeMismatch, 'empty Bytes value should fire rule-type_conformance');
});

test('Bytes type checker rejects odd-length hex string', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const span = JSON.parse(JSON.stringify(goodSpan));
  span.traceId = '0123456789abcde';   // 15 chars — odd
  const findings = validateSpan(span, schema);
  const typeMismatch = findings.find(f => f.ruleId === 'rule-type_conformance' && f.metadata.field === 'traceId');
  assert.ok(typeMismatch, 'odd-length Bytes value should fire rule-type_conformance');
});
