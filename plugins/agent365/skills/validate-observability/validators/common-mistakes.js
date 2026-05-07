'use strict';
const fs   = require('fs');
const { RuleResult } = require('./rule-result');

function loadRules(rulesPath) {
  return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
}

const CHECKS = {
  trace_must_contain_operation_names(span, trace, rule) {
    const want = rule.args.names;
    const have = new Set(trace.map(s => s.attributes?.['gen_ai.operation.name']));
    return want.every(n => have.has(n));
  },
  any_attribute_present(span, _trace, rule) {
    const prefixes = rule.args.prefixes;
    return Object.keys(span.attributes || {}).some(k => prefixes.some(p => k.startsWith(p)));
  },
  url_path_pattern(span, _trace, rule) {
    if (span._urlPath === undefined) return true;  // can't evaluate without URL — skip
    const url = span._urlPath;
    if (rule.args.deny  && url.includes(rule.args.deny))   return false;
    if (rule.args.allow && !url.includes(rule.args.allow)) return false;
    return true;
  },
  url_path_does_not_contain(span, _trace, rule) {
    if (span._urlPath === undefined) return true;  // can't evaluate without URL — skip
    return !span._urlPath.includes(rule.args.fragment);
  },
  resource_attribute_present(span, _trace, rule) {
    return Boolean(span._resource && span._resource[rule.args.key]);
  },
  resource_attribute_equals_if_present(span, _trace, rule) {
    const v = span._resource && span._resource[rule.args.key];
    if (v === undefined || v === null) return true;
    return v === rule.args.expected;
  },
  parent_span_resolves_in_trace(span, trace) {
    if (!span.parentSpanId) return true;
    return trace.some(s => s.spanId === span.parentSpanId);
  },
  trace_attribute_consistent(span, trace, rule) {
    const seen = new Set(trace.map(s => s.attributes?.[rule.args.key]).filter(v => v !== undefined));
    return seen.size <= 1;
  },
  baggage_keys_present(span, _trace, rule) {
    if (!span.parentSpanId) return true;   // root spans aren't expected to carry baggage
    return rule.args.keys.every(k => span.attributes && span.attributes[k] !== undefined);
  },
  child_within_parent_time_window(span, trace) {
    if (!span.parentSpanId) return true;
    const parent = trace.find(s => s.spanId === span.parentSpanId);
    if (!parent) return true;
    const cs = BigInt(span.startTimeUnixNano   || '0');
    const ce = BigInt(span.endTimeUnixNano     || '0');
    const ps = BigInt(parent.startTimeUnixNano || '0');
    const pe = BigInt(parent.endTimeUnixNano   || '0');
    return cs >= ps && ce <= pe;
  },
};

function operationMatches(rule, span) {
  const target = rule.appliesTo?.operationName;
  if (!target || target === '*') return true;
  return span.attributes?.['gen_ai.operation.name'] === target;
}

function validateTrace(trace, rules) {
  const findings = [];
  for (const rule of rules.rules) {
    const check = CHECKS[rule.check];
    if (!check) continue;
    for (const span of trace) {
      if (!operationMatches(rule, span)) continue;
      const checkResult = check(span, trace, rule);
      // All check functions return true = "condition is satisfied / OK".
      // negate:true on a rule means the check was written to detect presence of a required
      // thing, but the rule fires when that thing is ABSENT — i.e. when check returns false.
      // In both cases we fire when the check says the condition is NOT met: !checkResult.
      if (!checkResult) {
        findings.push(RuleResult({
          ruleId: rule.ruleId,
          value: 'failed',
          valueType: 'bool',
          confidence: 1.0,
          metadata: { spanName: span.name },
          severity: rule.severity,
          fixHint:  rule.fixHint,
          spanId:   span.spanId,
          traceId:  span.traceId,
        }));
      }
    }
  }
  return findings;
}

module.exports = { loadRules, validateTrace, CHECKS };
