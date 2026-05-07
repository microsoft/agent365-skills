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

test('validateSpan: clean invoke_agent span produces zero findings', () => {
  const { validateSpan, loadSchema } = require(sdPath);
  const schema = loadSchema(schemaPath);
  const findings = validateSpan(goodSpan, schema);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
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
