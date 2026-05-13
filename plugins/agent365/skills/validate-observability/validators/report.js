'use strict';

const ORDER = { error: 0, warning: 1, info: 2 };

function format(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  const byTrace = new Map();
  for (const f of findings) {
    const arr = byTrace.get(f.traceId) || [];
    arr.push(f);
    byTrace.set(f.traceId, arr);
  }

  const lines = [];
  lines.push('# Observability validation report\n');
  const pluralize = (n, sing, plur) => `${n} ${n === 1 ? sing : (plur || sing + 's')}`;
  lines.push(`**Findings:** ${pluralize(counts.error, 'error')}, ${pluralize(counts.warning, 'warning')}, ${pluralize(counts.info, 'info', 'info')} across ${pluralize(byTrace.size, 'trace')}.\n`);
  for (const [traceId, fs] of byTrace) {
    lines.push(`## trace \`${traceId}\`\n`);
    fs.sort((a, b) => (ORDER[a.severity] - ORDER[b.severity]) || a.ruleId.localeCompare(b.ruleId));
    for (const f of fs) {
      lines.push(`### ${f.severity} · ${f.ruleId}`);
      lines.push(`- **Span:** \`${f.metadata?.spanName || '?'}\` (\`${f.spanId}\`)`);
      lines.push(`- **Fix:** ${f.fixHint}\n`);
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

module.exports = { format };
