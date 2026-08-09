// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-instrument-security.js');

const DETECTION_CACHE_STUB = JSON.stringify({
  agentStack: 'GoogleADK',
  programmingLanguage: 'Python',
  detectedAt: '2026-01-01T00:00:00.000Z',
});

const ENV_FULL = [
  'AGENT365_TENANT_ID=11111111-1111-1111-1111-111111111111',
  'AGENT365_AGENT_ID=22222222-2222-2222-2222-222222222222',
  'DEFENDER_PREVENTION_ENABLED=true',
  'DEFENDER_FAIL_MODE=open',
  'DEFENDER_HOOKS=before_agent,after_agent,before_tool,after_tool',
].join('\n');

// Minimal stand-in for the generated security package: every signal the
// validator looks for, in the same shape the skill produces.
const SECURITY_PACKAGE = `# A365 Security — added by instrument-security skill
import msal
WEBHOOK = "https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze"
AUTHORITY = "https://login.microsoftonline.com/{tenant}"
AGENT_ID = os.environ.get("AGENT365_AGENT_ID", "")

def build(kind, cfg):
    identifier = {"a365": {"id": cfg.agent_id}}
    activity = {
        "agentRequest": {},
        "agentResponse": {},
        "toolRequest": {},
        "toolResponse": {},
    }[kind]
    return {
        "environment": {"agent": {"id": identifier}},
        "sessionContext": {"a365": {"id": "s"}},
        "activities": [activity],
        "evaluationPolicy": {"type": "EVALUATION_POLICY_TYPE_BLOCKING"},
    }

def token(cfg):
    app = msal.ConfidentialClientApplication(client_id=cfg.agent_id)
    return app.acquire_token_for_client(scopes=[cfg.scope])

class Decision:
    def __init__(self, payload, fail_mode):
        self.block = bool(payload.get("blockAction"))
        self.reason = payload.get("reason") or ""
        self.fail_mode = fail_mode

    @property
    def fail_closed(self):
        return self.fail_mode == "closed"

    def block_message(self, subject):
        return f"{subject} was blocked by Microsoft Defender for AI. Reason: {self.reason}"
`;

const AGENT_WIRED = `# A365 Security — added by instrument-security skill
from .security.adapters import secure_agent_callbacks

root_agent = Agent(
    **secure_agent_callbacks(
        before_agent_callback=before_agent_hook,
        after_agent_callback=after_agent_hook,
        before_tool_callback=before_tool_hook,
        after_tool_callback=after_tool_hook,
    ),
)
`;

const DEPLOY_FORWARDING = `DEFENDER_ENV_KEYS = ("DEFENDER_PREVENTION_ENABLED", "DEFENDER_FAIL_MODE")
for key in DEFENDER_ENV_KEYS:
    env_vars[key] = os.environ[key]
`;

function fullFixture(overrides = {}) {
  return createFixture({
    '.a365-workspace-detection.local.json': DETECTION_CACHE_STUB,
    '.env': ENV_FULL,
    'requirements.txt': 'google-adk==2.4.0\nmsal>=1.34.0\nhttpx>=0.27.0\n',
    'agent_pkg/agent.py': AGENT_WIRED,
    'agent_pkg/security/config.py': SECURITY_PACKAGE,
    'deploy.py': DEPLOY_FORWARDING,
    ...overrides,
  });
}

describe('validate-instrument-security — not run', () => {
  test('project with no prevention wiring at all → skipped, not failed', () => {
    const dir = createFixture({
      'requirements.txt': 'google-adk==2.4.0\n',
      'agent_pkg/agent.py': 'root_agent = Agent(name="x")\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true);
      assert.match(r.skipped, /did not run/);
    } finally { cleanup(dir); }
  });
});

describe('validate-instrument-security — happy path', () => {
  test('fully wired Python/ADK agent → ok with all four hooks', () => {
    const dir = fullFixture();
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
      assert.deepEqual(r.hooks, ['before_agent', 'after_agent', 'before_tool', 'after_tool']);
    } finally { cleanup(dir); }
  });

  test('only the hooks enabled in DEFENDER_HOOKS are required', () => {
    const dir = fullFixture({
      '.env': ENV_FULL.replace(
        'DEFENDER_HOOKS=before_agent,after_agent,before_tool,after_tool',
        'DEFENDER_HOOKS=before_tool'),
      'agent_pkg/agent.py': `from .security.adapters import secure_agent_callbacks
root_agent = Agent(**secure_agent_callbacks(before_tool_callback=before_tool_hook))
`,
      'agent_pkg/security/config.py': SECURITY_PACKAGE.replace('"agentRequest": {},', '')
        .replace('"agentResponse": {},', '')
        .replace('"toolResponse": {},', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, true, r.reason);
      assert.deepEqual(r.hooks, ['before_tool']);
    } finally { cleanup(dir); }
  });
});

describe('validate-instrument-security — detection cache', () => {
  test('missing detection cache → fails with the a365-setup instruction', () => {
    const dir = fullFixture();
    try {
      require('fs').rmSync(path.join(dir, '.a365-workspace-detection.local.json'), { force: true });
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /a365-workspace-detection\.local\.json was not written/);
    } finally { cleanup(dir); }
  });
});

describe('validate-instrument-security — enforcement', () => {
  test('verdict never read → fails', () => {
    const dir = fullFixture({
      'agent_pkg/security/config.py': SECURITY_PACKAGE.replace(
        'self.block = bool(payload.get("blockAction"))', 'self.block = False'),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /blockAction/);
    } finally { cleanup(dir); }
  });

  test('block message without a readable reason → fails', () => {
    const dir = fullFixture({
      'agent_pkg/security/config.py': SECURITY_PACKAGE
        .replace(/def block_message[\s\S]*$/, 'def blocked(self):\n        return True\n'),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /readable reason/);
    } finally { cleanup(dir); }
  });

  test('no fail-open/fail-closed policy → fails', () => {
    // Same package, but with no notion of what to do when no verdict arrives.
    const noFailPolicy = `# A365 Security — added by instrument-security skill
import msal
WEBHOOK = "https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze"
AUTHORITY = "https://login.microsoftonline.com/{tenant}"
AGENT_ID = os.environ.get("AGENT365_AGENT_ID", "")

def build(kind, cfg):
    return {
        "environment": {"agent": {"id": {"a365": {"id": cfg.agent_id}}}},
        "sessionContext": {"a365": {"id": "s"}},
        "activities": [{"agentRequest": {}, "agentResponse": {}, "toolRequest": {}, "toolResponse": {}}],
        "evaluationPolicy": {"type": "EVALUATION_POLICY_TYPE_BLOCKING"},
    }

def token(cfg):
    app = msal.ConfidentialClientApplication(client_id=cfg.agent_id)
    return app.acquire_token_for_client(scopes=[cfg.scope])

class Decision:
    def __init__(self, payload):
        self.block = bool(payload.get("blockAction"))
        self.reason = payload.get("reason") or ""

    def block_message(self, subject):
        return f"{subject} was blocked by Microsoft Defender for AI. Reason: {self.reason}"
`;
    const dir = fullFixture({
      '.env': ENV_FULL.replace('DEFENDER_FAIL_MODE=open', ''),
      'agent_pkg/security/config.py': noFailPolicy,
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /fail-open\/fail-closed/);
    } finally { cleanup(dir); }
  });
});

describe('validate-instrument-security — AISession correctness', () => {
  test('missing sessionContext → fails (rule engine would fail open)', () => {
    const dir = fullFixture({
      'agent_pkg/security/config.py': SECURITY_PACKAGE.replace(
        '"sessionContext": {"a365": {"id": "s"}},', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /sessionContext/);
    } finally { cleanup(dir); }
  });

  test('missing evaluationPolicy → fails', () => {
    const dir = fullFixture({
      'agent_pkg/security/config.py': SECURITY_PACKAGE.replace(
        '"evaluationPolicy": {"type": "EVALUATION_POLICY_TYPE_BLOCKING"},', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /evaluationPolicy/);
    } finally { cleanup(dir); }
  });

  test('after_tool enabled but no toolResponse activity → fails', () => {
    const dir = fullFixture({
      'agent_pkg/security/config.py': SECURITY_PACKAGE.replace('"toolResponse": {},', ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /toolResponse/);
    } finally { cleanup(dir); }
  });
});

describe('validate-instrument-security — identity and secrets', () => {
  test('hardcoded client secret → fails', () => {
    const dir = fullFixture({
      'agent_pkg/security/secrets.py': 'client_secret = "abcdefghijklmnop1234567890"\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /hardcoded/);
    } finally { cleanup(dir); }
  });

  test('no Entra token acquisition → fails', () => {
    const dir = fullFixture({
      'agent_pkg/security/config.py': SECURITY_PACKAGE
        .replace('import msal\n', '')
        .replace(/AUTHORITY = .*\n/, '')
        .replace(/def token[\s\S]*?return app\.acquire_token_for_client\(scopes=\[cfg\.scope\]\)\n/, ''),
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /Entra token acquisition/);
    } finally { cleanup(dir); }
  });
});

describe('validate-instrument-security — deployment configuration', () => {
  test('deploy script that does not forward DEFENDER_* → fails', () => {
    const dir = fullFixture({
      'deploy.py': 'env_vars = {"GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "true"}\n',
    });
    try {
      const r = runValidator(VALIDATOR, dir);
      assert.equal(r.ok, false);
      assert.match(r.reason, /does not forward any DEFENDER_\*/);
    } finally { cleanup(dir); }
  });
});
