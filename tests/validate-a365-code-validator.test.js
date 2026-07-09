// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '../plugins/agent365/hooks/stop/validate-a365-code-validator.js');

function findingIds(result) {
  return (result.findings || []).map(f => f.id);
}

describe('validate-a365-code-validator', () => {
  test('Python enable_a365 without exporter flag reports critical exporter finding', () => {
    const dir = createFixture({
      'pyproject.toml': `
[project]
dependencies = ["microsoft-opentelemetry>=1.3.4"]
      `.trim(),
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True)
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-exporter-not-enabled'));
      assert.equal(
        result.findings.find(f => f.id === 'python-exporter-not-enabled').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python queue poller scope with blueprint_id only reports identity binding finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'observability.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)
      `.trim(),
      'queue_poller.py': `
from observability import a365_request_scope

def run_cycle(settings):
    with a365_request_scope(
        tenant_id=settings.agent_tenant_id,
        blueprint_id=settings.agent_blueprint_app_id,
    ):
        return "ok"
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-blueprint-as-agent-id'));
      assert.equal(
        result.findings.find(f => f.id === 'python-blueprint-as-agent-id').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python explicit exporter false reports disabled exporter finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=False)
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-exporter-explicitly-disabled'));
      assert.equal(
        result.findings.find(f => f.id === 'python-exporter-explicitly-disabled').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('Python explicit exporter and agent_id scope does not report critical Python findings', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)

def run(settings):
    with a365_request_scope(
        tenant_id=settings.agent_tenant_id,
        agent_id=settings.agent_identity_app_id,
        blueprint_id=settings.agent_blueprint_app_id,
    ):
        return "ok"
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(!findingIds(result).includes('python-exporter-not-enabled'));
      assert.ok(!findingIds(result).includes('python-blueprint-as-agent-id'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python S2S env-only endpoint reports env-dependent finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      '.env.example': 'A365_USE_S2S_ENDPOINT=true\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
    a365_contextual_token_resolver=lambda ctx: "token",
)
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-s2s-endpoint-env-dependent'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python missing activity context reports activity field findings', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)

def run():
    with tracer.start_as_current_span("invoke_agent") as span:
        span.set_attribute("gen_ai.operation.name", "invoke_agent")
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      const ids = findingIds(result);
      assert.ok(ids.includes('python-missing-agent-name'));
      assert.ok(ids.includes('python-missing-conversation-id'));
      assert.ok(ids.includes('python-missing-channel-name'));
      assert.ok(ids.includes('python-missing-input-messages'));
      assert.ok(ids.includes('python-missing-output-messages'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python contextual resolver with only user.id reports OBO agent user gap', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
    a365_use_s2s_endpoint=True,
    a365_contextual_token_resolver=lambda ctx: "token",
)

def run():
    span.set_attribute("gen_ai.operation.name", "invoke_agent")
    span.set_attribute("gen_ai.agent.name", "Agent")
    span.set_attribute("gen_ai.conversation.id", "conv")
    span.set_attribute("microsoft.channel.name", "msteams")
    span.set_attribute("gen_ai.input.messages", "[]")
    span.set_attribute("gen_ai.output.messages", "[]")
    span.set_attribute("user.id", "agent-user")
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-obo-agent-user-attribute-missing'));
    } finally {
      cleanup(dir);
    }
  });

  test('Python direct inference operation reports unsupported operation finding', () => {
    const dir = createFixture({
      'requirements.txt': 'microsoft-opentelemetry>=1.3.4\n',
      'app.py': `
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True)
OPERATIONS = ["invoke_agent", "chat", "execute_tool", "output_messages", "inference"]
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('python-direct-inference-operation-name'));
    } finally {
      cleanup(dir);
    }
  });

  test('Node baggage-only project reports missing semantic spans', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'node-agent',
        dependencies: { '@microsoft/opentelemetry': '^1.0.0' },
      }, null, 2),
      'index.ts': `
import { useMicrosoftOpenTelemetry, BaggageBuilder } from '@microsoft/opentelemetry';

useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
    tokenResolver: () => '',
  },
});

new BaggageBuilder().build();
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('node-no-explicit-a365-semantic-spans'));
    } finally {
      cleanup(dir);
    }
  });

  test('Node explicit exporter false reports disabled exporter finding', () => {
    const dir = createFixture({
      'package.json': JSON.stringify({
        name: 'node-agent',
        dependencies: { '@microsoft/opentelemetry': '^1.0.0' },
      }, null, 2),
      'index.ts': `
import { useMicrosoftOpenTelemetry } from '@microsoft/opentelemetry';

useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: false,
    tokenResolver: () => '',
  },
});
      `.trim(),
    });

    try {
      const result = runValidator(VALIDATOR, dir);
      assert.equal(result.ok, true);
      assert.ok(findingIds(result).includes('node-exporter-explicitly-disabled'));
      assert.equal(
        result.findings.find(f => f.id === 'node-exporter-explicitly-disabled').severity,
        'critical'
      );
    } finally {
      cleanup(dir);
    }
  });
});
