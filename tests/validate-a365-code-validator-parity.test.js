// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

// Parity guard: the plugin stop-hook runner and the standalone open-standard
// runner that ship with the a365-code-validator skill MUST report the same
// findings. SKILL.md Phase 2 routes plugin installs to the former and
// `.agents/skills` installs to the latter, so any drift means one install path
// silently gives a weaker diagnosis. These two files diverged once (the
// standalone copy was missing the critical `blueprint-id-used-as-agent-id`
// check plus four others); this test fails if they drift again.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const PLUGIN = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-a365-code-validator.js');
const STANDALONE = path.join(__dirname, '../plugins/agent365/skills/a365-code-validator/references/a365-code-validator.js');

function sortedIds(result) {
  return (result.findings || []).map(f => f.id).sort();
}

// Each fixture targets a check that was previously missing from the standalone
// runner, plus one broad mixed-stack case.
const fixtures = {
  'python exporter env-dependent (was missing from standalone)': {
    'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
    '.env.example': 'ENABLE_A365_OBSERVABILITY_EXPORTER=true\n',
    'app.py': 'from microsoft.opentelemetry import use_microsoft_opentelemetry\n\nuse_microsoft_opentelemetry(enable_a365=True)\n',
  },
  'env explicitly disables exporter (was missing from standalone)': {
    'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
    '.env': 'ENABLE_A365_OBSERVABILITY_EXPORTER=false\n',
    'app.py': 'from microsoft.opentelemetry import use_microsoft_opentelemetry\n\nuse_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)\n',
  },
  'blueprint id == agentic app id (critical, was missing from standalone)': {
    'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
    'app.py': 'from microsoft.opentelemetry import use_microsoft_opentelemetry\n\nuse_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)\n',
    'a365.generated.config.json': JSON.stringify({
      completed: true,
      agentBlueprintId: '11111111-1111-1111-1111-111111111111',
      agenticAppId: '11111111-1111-1111-1111-111111111111',
    }, null, 2),
  },
  'dotnet wiring but no exporter config (was missing from standalone)': {
    'agent.csproj': '<Project><ItemGroup><PackageReference Include="Microsoft.OpenTelemetry" Version="1.0.0" /></ItemGroup></Project>',
    'Program.cs': 'builder.Services.UseMicrosoftOpenTelemetry();\n',
  },
  'broad mixed python case': {
    'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
    '.env.example': 'A365_USE_S2S_ENDPOINT=true\n',
    'app.py': [
      'from microsoft.opentelemetry import use_microsoft_opentelemetry',
      '',
      'use_microsoft_opentelemetry(',
      '    enable_a365=True,',
      '    a365_enable_observability_exporter=True,',
      '    a365_contextual_token_resolver=lambda ctx: "token",',
      ')',
      '',
      'with tracer.start_as_current_span("invoke_agent") as span:',
      '    span.set_attribute("gen_ai.operation.name", "invoke_agent")',
    ].join('\n'),
  },
};

describe('validate-a365-code-validator parity (plugin runner vs standalone runner)', () => {
  for (const [label, files] of Object.entries(fixtures)) {
    test(`identical finding IDs — ${label}`, () => {
      const dir = createFixture(files);
      try {
        const pluginResult = runValidator(PLUGIN, dir);
        const standaloneResult = runValidator(STANDALONE, dir);
        assert.equal(pluginResult.ok, true);
        assert.equal(standaloneResult.ok, true);
        assert.deepEqual(
          sortedIds(standaloneResult),
          sortedIds(pluginResult),
          `standalone runner drifted from plugin runner.\n` +
          `  plugin:     ${JSON.stringify(sortedIds(pluginResult))}\n` +
          `  standalone: ${JSON.stringify(sortedIds(standaloneResult))}`
        );
      } finally {
        cleanup(dir);
      }
    });
  }
});
