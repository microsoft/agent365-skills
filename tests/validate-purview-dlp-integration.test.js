// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-purview-dlp-integration.js');

function findingIds(result) {
  return (result.findings || []).map(f => f.id);
}

// A minimal stand-in for the Purview guard: it is the only module that calls the
// Graph processContent API, and it carries the PURVIEW_DLP_ENABLED marker.
const NODE_GUARD = `
// Microsoft Purview DLP guard. Reads PURVIEW_DLP_ENABLED.
export const purviewGuard = {
  isEnabled: process.env.PURVIEW_DLP_ENABLED === 'true',
  isCheckOutput: true,
  async evaluatePrompt() {
    await fetch('https://graph.microsoft.com/beta/me/processContent', { method: 'POST' });
    return { blocked: false, decision: 'allowed' };
  },
};
`.trim();

const PY_GUARD = `
# Microsoft Purview DLP guard. Reads PURVIEW_DLP_ENABLED.
class _Guard:
    is_enabled = True
    async def evaluate_prompt(self, *a):
        # POST to Graph processContent
        await _client.post("https://graph.microsoft.com/beta/me/processContent")
        return type("V", (), {"blocked": False, "decision": "allowed"})()

purview_guard = _Guard()  # PURVIEW_DLP_ENABLED gate
`.trim();

const CS_GUARD = `
// Microsoft Purview DLP guard. Reads PURVIEW_DLP_ENABLED.
namespace Agent365.Purview;
public sealed class PurviewGuard {
    public static readonly PurviewGuard Instance = new();
    public bool IsEnabled => Environment.GetEnvironmentVariable("PURVIEW_DLP_ENABLED") == "true";
    public async Task EvaluatePromptAsync() {
        await _http.PostAsync("https://graph.microsoft.com/beta/me/processContent", null);
    }
}
`.trim();

describe('validate-purview-dlp-integration', () => {
  test('always returns ok:true (report-first)', () => {
    const dir = createFixture({ 'app.ts': 'export const x = 1;\n' });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
    } finally {
      cleanup(dir);
    }
  });

  test('no Purview artifacts → no findings', () => {
    const dir = createFixture({
      'package.json': '{"name":"agent"}',
      'agent.ts': 'export async function onMessage() { return "hi"; }\n',
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.equal(result.findingCount, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('Node.js guard wired + enabled → clean (no high/medium findings)', () => {
    const dir = createFixture({
      'package.json': '{"name":"agent","dependencies":{"@microsoft/agents-hosting":"1.0.0"}}',
      'purview.ts': NODE_GUARD,
      'agent.ts': `
import { purviewGuard } from './purview.js';
export async function onMessage(ctx) {
  if (purviewGuard.isEnabled) {
    const gate = await purviewGuard.evaluatePrompt(this.authorization, '', 'hi', ctx);
    if (gate.blocked) return;
  }
  return 'ok';
}
      `.trim(),
      '.env': 'PURVIEW_DLP_ENABLED=true\n',
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(!findingIds(result).includes('purview-guard-not-wired'));
      assert.ok(!findingIds(result).includes('purview-env-flag-missing'));
      assert.equal(result.findingCount, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('Node.js guard copied but NOT wired → purview-guard-not-wired', () => {
    const dir = createFixture({
      'package.json': '{"name":"agent","dependencies":{"@microsoft/agents-hosting":"1.0.0"}}',
      'purview.ts': NODE_GUARD,
      '.env': 'PURVIEW_DLP_ENABLED=true\n',
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('purview-guard-not-wired'));
      assert.equal(
        result.findings.find(f => f.id === 'purview-guard-not-wired').severity,
        'high'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python guard wired but env flag missing → purview-env-flag-missing', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-agents-hosting-core\nhttpx\n',
      'purview.py': PY_GUARD,
      'agent.py': `
from purview import purview_guard

async def process_user_message(self, message, auth, auth_handler_name, context):
    if purview_guard.is_enabled:
        gate = await purview_guard.evaluate_prompt(auth, auth_handler_name, "", message, context)
        if gate.blocked:
            return "blocked"
    return "ok"
      `.trim(),
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('purview-env-flag-missing'));
    } finally {
      cleanup(dir);
    }
  });

  test('.NET guard wired, no .env → best-effort + dotnet env findings', () => {
    const dir = createFixture({
      'Agent.csproj': '<Project><ItemGroup><PackageReference Include="Microsoft.Agents.Hosting" /></ItemGroup></Project>',
      'Purview.cs': CS_GUARD,
      'Agent.cs': `
using Agent365.Purview;
public class MyAgent {
    public async Task OnMessageAsync(ITurnContext turnContext) {
        if (PurviewGuard.Instance.IsEnabled) {
            var gate = await PurviewGuard.Instance.EvaluatePromptAsync();
        }
    }
}
      `.trim(),
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('purview-env-flag-missing-dotnet'));
      assert.ok(findingIds(result).includes('purview-dotnet-best-effort'));
      assert.ok(!findingIds(result).includes('purview-guard-not-wired'));
    } finally {
      cleanup(dir);
    }
  });

  test('DLP flag explicitly false → purview-dlp-disabled (low, non-blocking)', () => {
    const dir = createFixture({
      'package.json': '{"name":"agent"}',
      'purview.ts': NODE_GUARD,
      'agent.ts': `import { purviewGuard } from './purview.js';\nconst e = purviewGuard.isEnabled;\n`,
      '.env': 'PURVIEW_DLP_ENABLED=false\n',
    });
    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('purview-dlp-disabled'));
    } finally {
      cleanup(dir);
    }
  });
});
