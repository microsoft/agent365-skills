'use strict';
const fs   = require('fs');
const { RuleResult } = require('./rule-result');

function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function readField(span, field) {
  if (span.attributes && field in span.attributes) return span.attributes[field];
  return span[field];
}

function evalPredicate(p, span) {
  const v = readField(span, p.field);
  const inValues = p.values.includes(v) || (p.values.includes('*') && v != null);
  if (p.condition === 'in')     return inValues;
  if (p.condition === 'not_in') return !inValues;
  return false;
}

function evalRequiredPredicate(required, span) {
  if (!Array.isArray(required) || required.length === 0)        return false;
  if (required.length === 1 && required[0].length === 0)        return true;   // [[]] = always
  return required.some(clause =>
    Array.isArray(clause) && clause.length > 0 &&
    clause.every(pred => evalPredicate(pred, span)));
}

const TYPE_CHECKERS = {
  String:      v => typeof v === 'string',
  Int:         v => typeof v === 'number' && Number.isInteger(v),
  StringArray: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
  Bytes:       v => typeof v === 'string' && /^[0-9a-f]*$/i.test(v),
  UInt64:      v => typeof v === 'string' && /^\d+$/.test(v),
  Object:      v => v !== null && typeof v === 'object',
};

function validateSpan(span, schema) {
  const findings = [];
  for (const f of schema.fields) {
    const value    = readField(span, f.key);
    const present  = value !== undefined;
    const required = evalRequiredPredicate(f.required, span);
    if (required && !present) {
      findings.push(RuleResult({
        ruleId: 'rule-presence_check',
        value: 'absent',
        valueType: 'string',
        confidence: 1.0,
        metadata: { field: f.key },
        severity: 'error',
        fixHint: `Field "${f.key}" is required for this span. ${f.description || ''}`,
        spanId: span.spanId,
        traceId: span.traceId,
      }));
      continue;
    }
    if (present) {
      const checker = TYPE_CHECKERS[f.type];
      if (checker && !checker(value)) {
        findings.push(RuleResult({
          ruleId: 'rule-type_conformance',
          value: 'type_mismatch',
          valueType: 'json',
          confidence: 1.0,
          metadata: { field: f.key, expected: f.type, actual: typeof value },
          severity: 'error',
          fixHint: `Field "${f.key}" must be of type ${f.type}.`,
          spanId: span.spanId,
          traceId: span.traceId,
        }));
      }
    }
    if (present && (f.privacy === 'CustomerContent' || f.privacy === 'EUII')) {
      const v = readField(span, f.key);
      const isEmpty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (!isEmpty) {
        findings.push(RuleResult({
          ruleId: 'rule-privacy_classification',
          value: 'present',
          valueType: 'string',
          confidence: 0.5,
          metadata: { field: f.key, classification: f.privacy },
          severity: 'warning',
          fixHint: `Field "${f.key}" is classified ${f.privacy}. v1 only flags presence; the unredacted-detection heuristic is deferred (spec §12 open question 2). Confirm your redaction policy covers this field.`,
          spanId: span.spanId,
          traceId: span.traceId,
        }));
      }
    }
  }
  return findings;
}

module.exports = { loadSchema, evalPredicate, evalRequiredPredicate, validateSpan };
