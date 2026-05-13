# validate-observability skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `validate-observability` skill plus a Node.js OTLP capture daemon that lets A365 agent developers locally validate the observability data their SDK actually emits, with rule-based feedback derived from the upstream `maven-schema.json` and a hand-authored common-mistakes pack.

**Architecture:** Two coordinated artifacts: (a) a `protobufjs`-based OTLP/HTTP receiver that sniffs `Content-Type`, decodes both protobuf and JSON, and persists each span to a JSONL file; (b) a phase-numbered `SKILL.md` with two flows (live + one-shot) that point an agent's dev-only config at the daemon, capture a turn, and run schema-driven + common-mistakes validators producing `SpanEvalResult`-shaped findings.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`, `node:http`, `node:fs`), `protobufjs` (sole dep), upstream `maven-schema.json` from `D:\mvn-mavenservice\docs\maven-schema.json`.

**Spec:** `docs/superpowers/specs/2026-05-06-validate-observability-skill-design.md`

**Branch:** `validate-observability-skill` (already created)

**Conventions inherited from this repo:**
- Tests at repo-root `tests/` with `vo-` prefix to disambiguate from the existing `validate-observability.test.js` (which tests the `instrument-observability` validator).
- Stop hooks at `plugins/agent365/hooks/stop/` are plain Node.js, no deps, run in 15 seconds.
- Skill auto-discovery via `"skills": "./skills/"` in `plugins/agent365/.claude-plugin/plugin.json` — no manifest edit needed.
- Atomic commits, TDD red→green→commit cycles per the user's workflow constraints.

---

## File Structure

```
plugins/agent365/skills/validate-observability/
├── SKILL.md                                    # Task 11
├── daemon/
│   ├── package.json                            # Task 2
│   ├── server.js                               # Task 5
│   ├── otlp-decoder.js                         # Task 3
│   └── capture-store.js                        # Task 4
├── validators/
│   ├── rule-result.js                          # Task 6
│   ├── schema-driven.js                        # Task 7
│   ├── common-mistakes.js                      # Task 8
│   └── report.js                               # Task 9
└── references/
    ├── maven-schema.json                       # Task 1 (snapshot)
    ├── schema-sync.md                          # Task 1 (sync runbook)
    ├── endpoint-override.md                    # Task 0 (spike output)
    └── common-mistakes.json                    # Task 8 (rule data)

plugins/agent365/hooks/stop/
└── validate-validate-observability.js          # Task 10

evals/agent365/validate-observability/
└── evals.json                                  # Task 12

tests/
├── vo-otlp-decoder.test.js                     # Task 3
├── vo-capture-store.test.js                    # Task 4
├── vo-server.test.js                           # Task 5
├── vo-rule-result.test.js                      # Task 6
├── vo-schema-driven.test.js                    # Task 7
├── vo-common-mistakes.test.js                  # Task 8
├── vo-report.test.js                           # Task 9
├── vo-stop-hook.test.js                        # Task 10
└── fixtures/
    └── vo/
        ├── build-fixtures.js                   # Task 3
        ├── otlp-protobuf-clean.bin             # generated
        ├── otlp-json-clean.json                # generated
        ├── span-good-invoke.json               # Task 7/8
        ├── span-bad-missing-field.json         # Task 7
        ├── span-bad-wrong-type.json            # Task 7
        ├── trace-bad-no-caller.json            # Task 8
        ├── trace-bad-scope-order.json          # Task 8
        └── expected-report.md                  # Task 9
```

---

## Task 0: Endpoint-override spike (no code yet)

**Why first:** Spec §12 open question 1. Until we know how to flip a real A365 SDK at localhost, the one-shot flow can't be implemented honestly.

**Files:**
- Create: `plugins/agent365/skills/validate-observability/references/endpoint-override.md`

**This task is a spike, not TDD.** No test code. Output is a written document recording experimental results.

- [ ] **Step 1: Stand up a localhost HTTP listener for capturing probes**

Open a terminal and run a one-line listener (any platform, no deps):

```bash
node -e "require('http').createServer((req,res)=>{let b=[];req.on('data',c=>b.push(c));req.on('end',()=>{console.log('--',req.method,req.url,'CT:',req.headers['content-type'],'len:',Buffer.concat(b).length);res.writeHead(200);res.end()})}).listen(14318,()=>console.log('probe listening on 14318'))"
```

Leave running. Every step below points an A365 SDK at this listener and watches for hits.

- [ ] **Step 2: Probe .NET — try standard OTel env vars first**

Use the user's existing .NET agent project (or any A365-instrumented .NET agent). In the terminal where the agent runs:

```bash
set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:14318
set OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:14318/v1/traces
dotnet run
```

Send one turn through AgentsPlayground. Watch the listener.

Record in `references/endpoint-override.md`:
- Did the listener receive a hit? (yes/no)
- If yes: what `Content-Type`, what URL path, was it the only POST or were there parallel hits to the real A365 endpoint?

- [ ] **Step 3: Probe .NET — A365 SDK options on `Microsoft.OpenTelemetry`**

Inspect `Microsoft.OpenTelemetry` (the unified distro the .NET path uses) for an exporter-endpoint setter. Search the installed package for properties like `Agent365.Exporter.Endpoint`, `Agent365.Exporter.OtlpEndpoint`, etc.:

```bash
grep -ri "endpoint" $(dotnet nuget locals global-packages -l | sed 's/.* //')/microsoft.opentelemetry/*/lib/net*/
```

For any candidate option, set it in `Program.cs`:

```csharp
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Agent365.Exporter.Endpoint = new Uri("http://localhost:14318");  // or whatever the field turns out to be
});
```

Run, send a turn, check listener. Record findings.

- [ ] **Step 4: Probe .NET — code-level fallback**

If steps 2–3 didn't route to localhost: write a dev-only initializer that disables the A365 exporter and adds a vanilla OTLP-HTTP exporter pointed at localhost. Skeleton:

```csharp
#if DEBUG
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t.AddOtlpExporter(o =>
    {
        o.Endpoint = new Uri("http://localhost:14318/v1/traces");
        o.Protocol = OtlpExportProtocol.HttpProtobuf;
    }));
// do NOT call builder.UseMicrosoftOpenTelemetry(...) in this branch
#else
builder.UseMicrosoftOpenTelemetry(o => { ... });
#endif
```

Verify a turn produces hits. Record the snippet.

- [ ] **Step 5: Repeat steps 2–4 for Node.js**

Standard env vars (Node):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:14318 \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:14318/v1/traces \
npm start
```

A365-specific env vars to try (grep the installed `@microsoft/opentelemetry` and `@microsoft/agents-a365-observability` for `endpoint` or `Endpoint`):

```bash
grep -r "endpoint\|Endpoint" node_modules/@microsoft/opentelemetry/dist/
grep -r "endpoint\|Endpoint" node_modules/@microsoft/agents-a365-observability/dist/
```

Code-level fallback for Node.js:

```ts
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

if (process.env.NODE_ENV === 'development') {
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({
    url: 'http://localhost:14318/v1/traces',
  })));
  provider.register();
  // do NOT call useMicrosoftOpenTelemetry(...) in this branch
}
```

Record findings.

- [ ] **Step 6: Repeat steps 2–4 for Python**

Standard env vars:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:14318 \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:14318/v1/traces \
python app.py
```

A365 SDK config: grep installed `microsoft.opentelemetry` package for endpoint setters.

Code-level fallback (Python):

```python
import os
if os.getenv('A365_DEV_LOCAL_CAPTURE'):
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    provider = TracerProvider()
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
        endpoint='http://localhost:14318/v1/traces')))
    trace.set_tracer_provider(provider)
    # do NOT call use_microsoft_opentelemetry(...) in this branch
else:
    from microsoft.opentelemetry.a365.core import use_microsoft_opentelemetry
    use_microsoft_opentelemetry(...)
```

Record findings.

- [ ] **Step 7: Write `endpoint-override.md`**

Create `plugins/agent365/skills/validate-observability/references/endpoint-override.md` with this structure:

```markdown
# Endpoint override mechanism per language

This document records, for each supported A365 SDK target, the verified mechanism
the `validate-observability` skill uses to redirect OTLP traffic from the real
A365 endpoint to a localhost listener during testing.

Verified against:
- A365 .NET SDK: <package versions you tested>
- A365 Node.js SDK: <versions>
- A365 Python SDK: <versions>

## .NET

**Mechanism:** <env var | config key | code patch — pick the verified one>

**Implementation in the skill:**

<exact mutation the skill makes — the file and the line — based on what worked in steps 2–4>

**Reversibility:** <how the skill restores the agent's config on teardown>

## Node.js

(same structure)

## Python

(same structure)

## Rejected mechanisms

(record what didn't work, so a future engineer doesn't try it again)
```

- [ ] **Step 8: Commit**

```bash
git add plugins/agent365/skills/validate-observability/references/endpoint-override.md
git commit -m "Spike: document endpoint-override mechanism per A365 SDK language

Records the verified mechanism the validate-observability skill uses to
redirect OTLP traffic to a localhost listener for each of .NET, Node.js,
and Python. Resolves spec section 12 open question 1.
"
```

---

## Task 1: Snapshot upstream `maven-schema.json` + write sync runbook

**Files:**
- Create: `plugins/agent365/skills/validate-observability/references/maven-schema.json`
- Create: `plugins/agent365/skills/validate-observability/references/schema-sync.md`

No tests — this is data + documentation.

- [ ] **Step 1: Copy `maven-schema.json` from upstream**

```bash
cp 'D:/mvn-mavenservice/docs/maven-schema.json' \
   plugins/agent365/skills/validate-observability/references/maven-schema.json
```

- [ ] **Step 2: Verify it parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('plugins/agent365/skills/validate-observability/references/maven-schema.json','utf8')); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Write the sync runbook**

Create `plugins/agent365/skills/validate-observability/references/schema-sync.md`:

```markdown
# Syncing `maven-schema.json` from upstream

`maven-schema.json` is the canonical contract for A365 observability data shape.
It is generated from `[MavenAttributes]` annotations in the upstream
`mvn-mavenservice` repo by the `MavenSchemaGenerator` Roslyn source generator
(see `D:\mvn-mavenservice\src\MVN\MavenService.Analyzers\MavenSchemaGenerator.cs`).

## When to sync

- After upstream rebases that touch `[MavenAttributes]`-annotated constants in
  `Microsoft.Maven.Otel.Contracts.Models.SpanAttributeKeys` or a sibling.
- Before a release of this plugin.

## How to sync

1. From a fresh clone of `mvn-mavenservice` on its main branch, copy:

       cp <mvn-mavenservice>/docs/maven-schema.json \
          plugins/agent365/skills/validate-observability/references/maven-schema.json

2. Run the validator tests:

       npm test -- tests/vo-schema-driven.test.js

   If any test fails, the upstream schema added or renamed a field. Update
   the validator's table-driven cases or fixtures, never the schema itself.

3. Commit with a message that names the upstream commit hash you synced from:

       git commit -m "Sync maven-schema.json from mvn-mavenservice@<sha>"

## Schema shape (cheat sheet for validators)

Each entry in `fields[]`:

- `key`              — attribute name (e.g. `gen_ai.operation.name`)
- `type`             — `String | Int | StringArray | Bytes | UInt64 | Object`
- `description`      — human-readable
- `examples`         — array of strings
- `privacy`          — `EUII | EUPI | OII | CustomerContent` (absent = None)
- `structural`       — true for OTLP structural fields (`traceId`, `spanId`, etc.)
- `required`         — `Predicate[][]`: outer = OR, inner = AND
                       Each predicate: `{ field, condition: "in" | "not_in",
                                          values: [...], legacy_names?: [...] }`

Empty `required` (`[[]]` or absent) means "always required" / "never required"
respectively — see `schema-driven.js` predicate evaluator for exact semantics.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/agent365/skills/validate-observability/references/maven-schema.json \
        plugins/agent365/skills/validate-observability/references/schema-sync.md
git commit -m "Snapshot maven-schema.json from upstream + sync runbook

Adds the upstream maven-schema.json (the contract for A365 observability data
shape, generated by the MavenSchemaGenerator source generator) and a runbook
describing when and how to refresh this snapshot.
"
```

---

## Task 2: Daemon `package.json` + install `protobufjs`

**Files:**
- Create: `plugins/agent365/skills/validate-observability/daemon/package.json`

No tests — config only.

- [ ] **Step 1: Create the daemon's `package.json`**

```json
{
  "name": "@agent365-skills/validate-observability-daemon",
  "version": "0.1.0",
  "private": true,
  "description": "OTLP/HTTP capture daemon for the validate-observability skill.",
  "main": "server.js",
  "license": "MIT",
  "engines": { "node": ">=18" },
  "dependencies": {
    "protobufjs": "^7.4.0"
  }
}
```

- [ ] **Step 2: Install the dep**

```bash
cd plugins/agent365/skills/validate-observability/daemon
npm install
```

Expected: creates `package-lock.json` and `node_modules/`. The repo's existing `.gitignore` should already cover `node_modules/`. Verify:

```bash
git check-ignore plugins/agent365/skills/validate-observability/daemon/node_modules
```

Expected: prints the path (= ignored). If not ignored, add `**/node_modules/` to root `.gitignore`.

- [ ] **Step 3: Commit**

```bash
git add plugins/agent365/skills/validate-observability/daemon/package.json \
        plugins/agent365/skills/validate-observability/daemon/package-lock.json
git commit -m "Add daemon package.json with protobufjs dep

The validate-observability capture daemon needs protobufjs to decode
OTLP-protobuf payloads. This is the only runtime dep the skill introduces.
"
```

---

## Task 3: `otlp-decoder.js` — decode protobuf + JSON `ExportTraceServiceRequest`

**Files:**
- Create: `plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js`
- Create: `tests/vo-otlp-decoder.test.js`
- Create: `tests/fixtures/vo/build-fixtures.js`
- Generate: `tests/fixtures/vo/otlp-protobuf-clean.bin`, `tests/fixtures/vo/otlp-json-clean.json`

- [ ] **Step 1: Write the fixture-builder**

Create `tests/fixtures/vo/build-fixtures.js`:

```javascript
'use strict';
// Generates OTLP test fixtures (.bin protobuf + .json) from a single in-memory
// span. Run once: `node tests/fixtures/vo/build-fixtures.js`. Commit outputs.

const fs   = require('fs');
const path = require('path');
const { join } = path;
const protobuf = require('protobufjs');

const OTLP_PROTO = join(
  __dirname, '..', '..', '..', 'plugins', 'agent365', 'skills',
  'validate-observability', 'daemon', 'opentelemetry-proto'
);

const REQ = {
  resourceSpans: [{
    resource: {
      attributes: [
        { key: 'service.name',      value: { stringValue: 'demo-agent' } },
        { key: 'service.namespace', value: { stringValue: 'demo' } },
      ],
    },
    scopeSpans: [{
      scope: { name: 'Microsoft.Agents.A365.Observability', version: '1.0.0' },
      spans: [{
        traceId:  Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
        spanId:   Buffer.from('0123456789abcdef', 'hex'),
        name:     'invoke_agent',
        kind:     1,
        startTimeUnixNano: '1714932000000000000',
        endTimeUnixNano:   '1714932001000000000',
        attributes: [
          { key: 'gen_ai.operation.name', value: { stringValue: 'invoke_agent' } },
          { key: 'gen_ai.agent.id',       value: { stringValue: '30ed5699-b157-4e87-bb45-9b0cfb13b8e5' } },
          { key: 'gen_ai.conversation.id', value: { stringValue: '19:thread@demo' } },
        ],
        status: { code: 1 },
      }],
    }],
  }],
};

async function main() {
  // Vendored proto descriptors live in daemon/opentelemetry-proto/. Task 3
  // bundles a minimal subset (trace.proto + dependencies). For now, generate
  // the .bin from a runtime-loaded descriptor:
  const root = await protobuf.load(join(OTLP_PROTO, 'trace_service.proto'));
  const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
  const err  = Req.verify(REQ);
  if (err) throw new Error(err);
  const buf  = Req.encode(Req.fromObject(REQ)).finish();
  fs.writeFileSync(join(__dirname, 'otlp-protobuf-clean.bin'), buf);
  fs.writeFileSync(join(__dirname, 'otlp-json-clean.json'),    JSON.stringify(REQ, (k, v) => Buffer.isBuffer(v) ? v.toString('base64') : v, 2));
  console.log('wrote otlp-protobuf-clean.bin (', buf.length, 'bytes) and otlp-json-clean.json');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Vendor the OTLP proto descriptors into the daemon**

```bash
mkdir -p plugins/agent365/skills/validate-observability/daemon/opentelemetry-proto/opentelemetry/proto/{collector/trace/v1,trace/v1,common/v1,resource/v1}

curl -L https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.3.0/opentelemetry/proto/collector/trace/v1/trace_service.proto \
  -o plugins/agent365/skills/validate-observability/daemon/opentelemetry-proto/opentelemetry/proto/collector/trace/v1/trace_service.proto

curl -L https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.3.0/opentelemetry/proto/trace/v1/trace.proto \
  -o plugins/agent365/skills/validate-observability/daemon/opentelemetry-proto/opentelemetry/proto/trace/v1/trace.proto

curl -L https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.3.0/opentelemetry/proto/common/v1/common.proto \
  -o plugins/agent365/skills/validate-observability/daemon/opentelemetry-proto/opentelemetry/proto/common/v1/common.proto

curl -L https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.3.0/opentelemetry/proto/resource/v1/resource.proto \
  -o plugins/agent365/skills/validate-observability/daemon/opentelemetry-proto/opentelemetry/proto/resource/v1/resource.proto
```

Note: the daemon resolves proto imports from this directory; structure must match the proto `import` paths.

- [ ] **Step 3: Generate the binary fixtures**

```bash
node tests/fixtures/vo/build-fixtures.js
```

Expected: `wrote otlp-protobuf-clean.bin ( <N> bytes) and otlp-json-clean.json`

- [ ] **Step 4: Write failing test for protobuf decode**

Create `tests/vo-otlp-decoder.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const decoderPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js');
const fixturesDir = path.join(__dirname, 'fixtures', 'vo');

test('decode() — protobuf payload yields uniform shape with one span', async () => {
  const decoder = require(decoderPath);
  const body = fs.readFileSync(path.join(fixturesDir, 'otlp-protobuf-clean.bin'));
  const result = await decoder.decode(body, 'application/x-protobuf');
  assert.equal(result.spans.length, 1);
  assert.equal(result.spans[0].name, 'invoke_agent');
  assert.equal(result.resource['service.name'], 'demo-agent');
  assert.equal(result.scope.name, 'Microsoft.Agents.A365.Observability');
});
```

- [ ] **Step 5: Run test, see it fail**

```bash
node --test tests/vo-otlp-decoder.test.js
```

Expected: FAIL with `Cannot find module '...otlp-decoder.js'`.

- [ ] **Step 6: Implement `otlp-decoder.js` — protobuf path only**

Create `plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js`:

```javascript
'use strict';
const path = require('path');
const protobuf = require('protobufjs');

const PROTO_ROOT = path.join(__dirname, 'opentelemetry-proto');
const PROTO_FILE = path.join(PROTO_ROOT, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');

let _root = null;
async function loadRoot() {
  if (_root) return _root;
  const r = new protobuf.Root();
  r.resolvePath = (origin, target) => {
    if (target.startsWith('opentelemetry/')) return path.join(PROTO_ROOT, target);
    return target;
  };
  await r.load(PROTO_FILE, { keepCase: true });
  _root = r;
  return r;
}

function flattenAttributes(attrs) {
  const out = {};
  for (const a of attrs || []) {
    const v = a.value || {};
    if (v.stringValue !== undefined) out[a.key] = v.stringValue;
    else if (v.intValue !== undefined) out[a.key] = Number(v.intValue);
    else if (v.boolValue !== undefined) out[a.key] = v.boolValue;
    else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    else if (v.bytesValue !== undefined) out[a.key] = Buffer.from(v.bytesValue).toString('hex');
    else if (v.arrayValue && v.arrayValue.values) out[a.key] = v.arrayValue.values.map(x => x.stringValue ?? x.intValue ?? x.boolValue ?? null);
    else out[a.key] = null;
  }
  return out;
}

function normalizeSpan(s) {
  return {
    traceId:           Buffer.isBuffer(s.traceId)  ? s.traceId.toString('hex')  : s.traceId,
    spanId:            Buffer.isBuffer(s.spanId)   ? s.spanId.toString('hex')   : s.spanId,
    parentSpanId:      Buffer.isBuffer(s.parentSpanId) ? s.parentSpanId.toString('hex') : (s.parentSpanId || ''),
    name:              s.name,
    kind:              s.kind,
    startTimeUnixNano: typeof s.startTimeUnixNano === 'bigint' ? s.startTimeUnixNano.toString() : String(s.startTimeUnixNano ?? ''),
    endTimeUnixNano:   typeof s.endTimeUnixNano   === 'bigint' ? s.endTimeUnixNano.toString()   : String(s.endTimeUnixNano   ?? ''),
    attributes:        flattenAttributes(s.attributes),
    status:            s.status || null,
  };
}

async function decode(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/x-protobuf') || ct.includes('application/protobuf')) {
    const root = await loadRoot();
    const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
    const msg  = Req.decode(body);
    const obj  = Req.toObject(msg, { bytes: Buffer, longs: String, defaults: true });
    return shapeRequest(obj, 'protobuf');
  }
  throw new Error(`Unsupported content-type: ${contentType}`);
}

function shapeRequest(req, wireFormat) {
  const out = { resource: {}, scope: {}, spans: [], wireFormat };
  for (const rs of req.resourceSpans || []) {
    Object.assign(out.resource, flattenAttributes(rs.resource && rs.resource.attributes));
    for (const ss of rs.scopeSpans || []) {
      out.scope = { name: ss.scope?.name || '', version: ss.scope?.version || '' };
      for (const sp of ss.spans || []) out.spans.push(normalizeSpan(sp));
    }
  }
  return out;
}

module.exports = { decode, shapeRequest, flattenAttributes, normalizeSpan };
```

- [ ] **Step 7: Run test, see it pass**

```bash
node --test tests/vo-otlp-decoder.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit (red→green for protobuf path)**

```bash
git add plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js \
        plugins/agent365/skills/validate-observability/daemon/opentelemetry-proto \
        tests/fixtures/vo/build-fixtures.js \
        tests/fixtures/vo/otlp-protobuf-clean.bin \
        tests/fixtures/vo/otlp-json-clean.json \
        tests/vo-otlp-decoder.test.js
git commit -m "Add OTLP protobuf decoder with vendored proto descriptors

The decoder accepts an ExportTraceServiceRequest payload, flattens
resource/scope/span attribute lists into plain JS objects, and yields
a uniform { resource, scope, spans, wireFormat } shape. Tests cover the
happy path against a generated fixture.
"
```

- [ ] **Step 9: Add failing test for JSON path**

Append to `tests/vo-otlp-decoder.test.js`:

```javascript
test('decode() — JSON payload yields uniform shape with one span', async () => {
  const decoder = require(decoderPath);
  const body = fs.readFileSync(path.join(fixturesDir, 'otlp-json-clean.json'), 'utf8');
  const result = await decoder.decode(body, 'application/json');
  assert.equal(result.spans.length, 1);
  assert.equal(result.wireFormat, 'json');
});
```

- [ ] **Step 10: Run, see it fail**

```bash
node --test tests/vo-otlp-decoder.test.js
```

Expected: the new test fails with `Unsupported content-type`.

- [ ] **Step 11: Add JSON branch + bytes-decoder normalization**

In `otlp-decoder.js`, edit `decode()` to handle JSON (the fixture stored binary fields as base64 strings; rehydrate them):

```javascript
async function decode(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/x-protobuf') || ct.includes('application/protobuf')) {
    const root = await loadRoot();
    const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
    const msg  = Req.decode(body);
    const obj  = Req.toObject(msg, { bytes: Buffer, longs: String, defaults: true });
    return shapeRequest(obj, 'protobuf');
  }
  if (ct.includes('application/json')) {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    const obj  = JSON.parse(text);
    // OTLP/HTTP-JSON encodes traceId/spanId as base64 strings or hex strings depending on emitter
    rehydrateBinaryStrings(obj);
    return shapeRequest(obj, 'json');
  }
  throw new Error(`Unsupported content-type: ${contentType}`);
}

function rehydrateBinaryStrings(req) {
  for (const rs of req.resourceSpans || []) {
    for (const ss of rs.scopeSpans || []) {
      for (const sp of ss.spans || []) {
        if (typeof sp.traceId === 'string')      sp.traceId      = decodeIdString(sp.traceId);
        if (typeof sp.spanId === 'string')       sp.spanId       = decodeIdString(sp.spanId);
        if (typeof sp.parentSpanId === 'string') sp.parentSpanId = decodeIdString(sp.parentSpanId);
      }
    }
  }
}

function decodeIdString(s) {
  // hex (16 or 32 chars) → Buffer; otherwise treat as base64
  if (/^[0-9a-f]+$/i.test(s) && (s.length === 16 || s.length === 32)) return Buffer.from(s, 'hex');
  return Buffer.from(s, 'base64');
}
```

- [ ] **Step 12: Run test, see it pass**

```bash
node --test tests/vo-otlp-decoder.test.js
```

Expected: both tests PASS.

- [ ] **Step 13: Commit (JSON path)**

```bash
git add plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js \
        tests/vo-otlp-decoder.test.js
git commit -m "Decoder: accept OTLP/JSON in addition to OTLP/protobuf

A365 SDKs do not always emit protobuf — content-type sniffing is required.
The JSON branch rehydrates traceId/spanId from hex or base64 (both forms
appear in the wild) so downstream code sees the same Buffer shape regardless
of wire format.
"
```

- [ ] **Step 14: Add failing test for malformed body**

Append to `tests/vo-otlp-decoder.test.js`:

```javascript
test('decode() — malformed protobuf body throws DecoderError', async () => {
  const decoder = require(decoderPath);
  await assert.rejects(
    () => decoder.decode(Buffer.from('not a real protobuf payload'), 'application/x-protobuf'),
    err => err.name === 'DecoderError' && /failed to decode/i.test(err.message),
  );
});

test('decode() — malformed JSON body throws DecoderError', async () => {
  const decoder = require(decoderPath);
  await assert.rejects(
    () => decoder.decode('this is not json {', 'application/json'),
    err => err.name === 'DecoderError',
  );
});

test('decode() — unknown content-type throws DecoderError', async () => {
  const decoder = require(decoderPath);
  await assert.rejects(
    () => decoder.decode(Buffer.from('whatever'), 'text/plain'),
    err => err.name === 'DecoderError' && /unsupported content-type/i.test(err.message),
  );
});
```

- [ ] **Step 15: Run, see them fail**

```bash
node --test tests/vo-otlp-decoder.test.js
```

Expected: the three new tests fail (raw `Error`, not `DecoderError`).

- [ ] **Step 16: Wrap throws in `DecoderError`**

In `otlp-decoder.js`, add the error class and use it:

```javascript
class DecoderError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DecoderError';
    if (cause) this.cause = cause;
  }
}

async function decode(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  try {
    if (ct.includes('application/x-protobuf') || ct.includes('application/protobuf')) {
      const root = await loadRoot();
      const Req  = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
      const msg  = Req.decode(body);
      const obj  = Req.toObject(msg, { bytes: Buffer, longs: String, defaults: true });
      return shapeRequest(obj, 'protobuf');
    }
    if (ct.includes('application/json')) {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      const obj  = JSON.parse(text);
      rehydrateBinaryStrings(obj);
      return shapeRequest(obj, 'json');
    }
  } catch (e) {
    throw new DecoderError(`failed to decode (${ct || 'no content-type'}): ${e.message}`, e);
  }
  throw new DecoderError(`unsupported content-type: ${contentType}`);
}

module.exports = { decode, shapeRequest, flattenAttributes, normalizeSpan, DecoderError };
```

- [ ] **Step 17: Run, see all tests pass**

```bash
node --test tests/vo-otlp-decoder.test.js
```

Expected: all 5 tests PASS.

- [ ] **Step 18: Commit (error handling)**

```bash
git add plugins/agent365/skills/validate-observability/daemon/otlp-decoder.js \
        tests/vo-otlp-decoder.test.js
git commit -m "Decoder: wrap parse failures in DecoderError for boundary handling

Both decode paths now throw a typed DecoderError so the daemon's HTTP layer
can distinguish 'malformed body' from 'unexpected runtime fault' and persist
a decode_failure JSONL line per spec section 9.1.
"
```

---

## Task 4: `capture-store.js` — JSONL append + cursor + rotation

**Files:**
- Create: `plugins/agent365/skills/validate-observability/daemon/capture-store.js`
- Create: `tests/vo-capture-store.test.js`

- [ ] **Step 1: Write failing test — append + readAll**

Create `tests/vo-capture-store.test.js`:

```javascript
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const storePath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/daemon/capture-store.js');

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vo-store-'));
}

test('append() then readAll() returns the appended entry', () => {
  const { CaptureStore } = require(storePath);
  const dir   = freshDir();
  const store = CaptureStore({ captureDir: dir });
  store.append({ receivedAt: 't0', span: { spanId: 'aa' } });
  const all = store.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].span.spanId, 'aa');
  store.close();
});
```

- [ ] **Step 2: Run, see it fail**

```bash
node --test tests/vo-capture-store.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal `CaptureStore`**

Create `plugins/agent365/skills/validate-observability/daemon/capture-store.js`:

```javascript
'use strict';
const fs   = require('fs');
const path = require('path');

function CaptureStore({ captureDir, rotationBytes = 50 * 1024 * 1024 }) {
  fs.mkdirSync(captureDir, { recursive: true });
  const tracesPath = path.join(captureDir, 'traces.jsonl');
  const cursorPath = path.join(captureDir, 'cursor.json');

  function append(entry) {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(tracesPath, line, 'utf8');
    maybeRotate();
  }

  function maybeRotate() {
    let stat;
    try { stat = fs.statSync(tracesPath); } catch { return; }
    if (stat.size < rotationBytes) return;
    let n = 1;
    while (fs.existsSync(`${tracesPath}.${n}`)) n++;
    fs.renameSync(tracesPath, `${tracesPath}.${n}`);
  }

  function readAll() {
    if (!fs.existsSync(tracesPath)) return [];
    const text  = fs.readFileSync(tracesPath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  function readSinceCursor() {
    const cursor = getCursor();
    return readAll().slice(cursor.lastReadCount || 0);
  }

  function getCursor() {
    try { return JSON.parse(fs.readFileSync(cursorPath, 'utf8')); }
    catch { return { lastReadCount: 0, lastReadAt: null }; }
  }

  function setCursor(c) {
    fs.writeFileSync(cursorPath, JSON.stringify(c, null, 2));
  }

  function advanceCursor() {
    const all = readAll();
    setCursor({ lastReadCount: all.length, lastReadAt: new Date().toISOString() });
  }

  function close() { /* sync writes; nothing to flush */ }

  return { append, readAll, readSinceCursor, getCursor, setCursor, advanceCursor, close };
}

module.exports = { CaptureStore };
```

- [ ] **Step 4: Run, see test pass**

```bash
node --test tests/vo-capture-store.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit (basic append/read)**

```bash
git add plugins/agent365/skills/validate-observability/daemon/capture-store.js \
        tests/vo-capture-store.test.js
git commit -m "Add capture-store with JSONL append and readAll

Sync writes; one JSONL line per span. Future steps add cursor management,
rotation at size boundary, and corrupted-state recovery.
"
```

- [ ] **Step 6: Add failing tests for cursor + rotation + corruption**

Append to `tests/vo-capture-store.test.js`:

```javascript
test('readSinceCursor() returns only entries after the last advanceCursor()', () => {
  const { CaptureStore } = require(storePath);
  const dir   = freshDir();
  const store = CaptureStore({ captureDir: dir });
  store.append({ span: { spanId: 'a' } });
  store.append({ span: { spanId: 'b' } });
  store.advanceCursor();
  store.append({ span: { spanId: 'c' } });
  const since = store.readSinceCursor();
  assert.equal(since.length, 1);
  assert.equal(since[0].span.spanId, 'c');
  store.close();
});

test('rotation: when traces.jsonl exceeds rotationBytes it is renamed to .1', () => {
  const { CaptureStore } = require(storePath);
  const dir   = freshDir();
  const store = CaptureStore({ captureDir: dir, rotationBytes: 50 });
  store.append({ pad: 'x'.repeat(40) });   // small line
  store.append({ pad: 'x'.repeat(40) });   // pushes file past 50 bytes -> rotates AFTER append
  assert.ok(fs.existsSync(path.join(dir, 'traces.jsonl.1')), 'expected traces.jsonl.1 to exist');
  store.close();
});

test('getCursor() returns zeroed cursor when cursor.json is corrupt', () => {
  const { CaptureStore } = require(storePath);
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'cursor.json'), '{ this is not json');
  const store = CaptureStore({ captureDir: dir });
  const c = store.getCursor();
  assert.equal(c.lastReadCount, 0);
  store.close();
});
```

- [ ] **Step 7: Run, see all three pass already**

```bash
node --test tests/vo-capture-store.test.js
```

Expected: all four PASS (the implementation in step 3 already covers these). If any fail, fix the implementation before continuing.

- [ ] **Step 8: Commit (cursor + rotation + corruption)**

```bash
git add tests/vo-capture-store.test.js
git commit -m "Test: cursor advance, rotation at size boundary, corrupt cursor recovery

These behaviors are already implemented in capture-store.js — committing the
tests that lock them in.
"
```

---

## Task 5: `server.js` — OTLP/HTTP receiver

**Files:**
- Create: `plugins/agent365/skills/validate-observability/daemon/server.js`
- Create: `tests/vo-server.test.js`

- [ ] **Step 1: Write failing test — POST returns 200, body is captured**

Create `tests/vo-server.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const http     = require('http');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

const serverPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/daemon/server.js');
const fixtures   = path.join(__dirname, 'fixtures', 'vo');

function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vo-server-')); }

function postBinary({ port, contentType, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/traces', headers: { 'content-type': contentType, 'content-length': body.length } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('server: protobuf POST is decoded and persisted, returns 200', async () => {
  const { startServer } = require(serverPath);
  const dir    = freshDir();
  const server = await startServer({ port: 0, captureDir: dir });
  try {
    const body = fs.readFileSync(path.join(fixtures, 'otlp-protobuf-clean.bin'));
    const r = await postBinary({ port: server.port, contentType: 'application/x-protobuf', body });
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(path.join(dir, 'traces.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.span.name, 'invoke_agent');
    assert.equal(entry.wireFormat, 'protobuf');
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run, see it fail**

```bash
node --test tests/vo-server.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal `server.js`**

Create `plugins/agent365/skills/validate-observability/daemon/server.js`:

```javascript
'use strict';
const http = require('http');
const path = require('path');
const decoder = require('./otlp-decoder');
const { CaptureStore } = require('./capture-store');

async function startServer({ port = 4318, captureDir = process.cwd(), rotationBytes }) {
  const store = CaptureStore({ captureDir, rotationBytes });

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const ct   = req.headers['content-type'] || '';
      let decoded, wireFormat = 'unknown', decodeError = null;
      try { decoded = await decoder.decode(body, ct); wireFormat = decoded.wireFormat; }
      catch (e) { decodeError = e.message; }

      const remoteAddr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      const baseEntry  = { receivedAt: new Date().toISOString(), wireFormat, remoteAddr, urlPath: req.url };

      if (decodeError) {
        store.append({ ...baseEntry, decodeError, rawBodyB64: body.toString('base64').slice(0, 4096) });
      } else {
        for (const span of decoded.spans) {
          store.append({ ...baseEntry, resource: decoded.resource, scope: decoded.scope, span });
        }
      }

      res.writeHead(200, { 'content-type': 'application/x-protobuf' });
      res.end();   // empty ExportTraceServiceResponse body is wire-compatible
    });
    req.on('error', () => { try { res.writeHead(400); res.end(); } catch {} });
  });

  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).on('error', reject));
  const actualPort = server.address().port;
  return {
    port: actualPort,
    close: () => new Promise(r => server.close(() => { store.close(); r(); })),
  };
}

if (require.main === module) {
  const argv = require('minimist-lite')(process.argv.slice(2)) || parseArgs(process.argv.slice(2));
  startServer({
    port: Number(argv.port) || 4318,
    captureDir: argv['capture-dir'] || path.join(process.cwd(), '.a365-observability-capture'),
  }).then(s => {
    process.stdout.write(JSON.stringify({ ready: true, port: s.port, pid: process.pid }) + '\n');
    process.on('SIGTERM', () => s.close().then(() => process.exit(0)));
    process.on('SIGINT',  () => s.close().then(() => process.exit(0)));
  }).catch(e => { console.error(e.message); process.exit(2); });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

module.exports = { startServer };
```

Note: replace the `minimist-lite` require with the inlined `parseArgs` — that line was a leftover; the inline function is what's actually used. Final form of the CLI block:

```javascript
if (require.main === module) {
  const argv = parseArgs(process.argv.slice(2));
  // ...rest unchanged
}
```

- [ ] **Step 4: Run, see test pass**

```bash
node --test tests/vo-server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit (basic server)**

```bash
git add plugins/agent365/skills/validate-observability/daemon/server.js \
        tests/vo-server.test.js
git commit -m "Add OTLP/HTTP receiver server.js

Receives POSTs on /v1/traces, decodes via otlp-decoder, persists each span
via capture-store, always returns 200. Decoder errors persist a decode_failure
JSONL line so devs can post-mortem failed captures.
"
```

- [ ] **Step 6: Add failing test for JSON path through HTTP**

Append to `tests/vo-server.test.js`:

```javascript
test('server: JSON POST is also captured', async () => {
  const { startServer } = require(serverPath);
  const dir    = freshDir();
  const server = await startServer({ port: 0, captureDir: dir });
  try {
    const body = fs.readFileSync(path.join(fixtures, 'otlp-json-clean.json'));
    const r = await postBinary({ port: server.port, contentType: 'application/json', body });
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(path.join(dir, 'traces.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).wireFormat, 'json');
  } finally {
    await server.close();
  }
});

test('server: malformed body persists a decode_failure entry, still returns 200', async () => {
  const { startServer } = require(serverPath);
  const dir    = freshDir();
  const server = await startServer({ port: 0, captureDir: dir });
  try {
    const r = await postBinary({ port: server.port, contentType: 'application/x-protobuf', body: Buffer.from('garbage') });
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(path.join(dir, 'traces.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.ok(JSON.parse(lines[0]).decodeError);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 7: Run, see them pass**

```bash
node --test tests/vo-server.test.js
```

Expected: all server tests PASS.

- [ ] **Step 8: Commit (json + decode-failure)**

```bash
git add tests/vo-server.test.js
git commit -m "Test: server handles JSON body and persists decode_failure entries

Locks in the spec section 9.1 daemon-side error policy: never block the agent;
always 200; persist what we can.
"
```

---

## Task 6: `rule-result.js` — finding shape + upstream-shape stripper

**Files:**
- Create: `plugins/agent365/skills/validate-observability/validators/rule-result.js`
- Create: `tests/vo-rule-result.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/vo-rule-result.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');

const rrPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/validators/rule-result.js');

test('RuleResult() returns object with all required fields and defaults', () => {
  const { RuleResult } = require(rrPath);
  const rr = RuleResult({ ruleId: 'rule-x', value: 'absent', valueType: 'string', spanId: 'aa', traceId: 'bb' });
  assert.equal(rr.ruleId,    'rule-x');
  assert.equal(rr.confidence, 1.0);
  assert.equal(rr.severity,  'error');
  assert.equal(rr.metadata,  null);
});

test('toUpstreamShape() strips skill-only fields (severity, fixHint)', () => {
  const { RuleResult, toUpstreamShape } = require(rrPath);
  const rr = RuleResult({ ruleId: 'rule-x', value: 'v', valueType: 'string', spanId: 'a', traceId: 'b', severity: 'warning', fixHint: 'do x' });
  const u  = toUpstreamShape(rr);
  assert.equal(u.severity, undefined);
  assert.equal(u.fixHint,  undefined);
  assert.equal(u.ruleId,   'rule-x');
});
```

- [ ] **Step 2: Run, see fail**

```bash
node --test tests/vo-rule-result.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `plugins/agent365/skills/validate-observability/validators/rule-result.js`:

```javascript
'use strict';

function RuleResult({
  ruleId, value, valueType,
  confidence = 1.0,
  metadata   = null,
  severity   = 'error',
  fixHint    = '',
  spanId     = '',
  traceId    = '',
}) {
  return { ruleId, value, valueType, confidence, metadata, severity, fixHint, spanId, traceId };
}

const SKILL_ONLY_KEYS = ['severity', 'fixHint'];

function toUpstreamShape(rr) {
  const out = { ...rr };
  for (const k of SKILL_ONLY_KEYS) delete out[k];
  return out;
}

module.exports = { RuleResult, toUpstreamShape, SKILL_ONLY_KEYS };
```

- [ ] **Step 4: Run, see pass**

```bash
node --test tests/vo-rule-result.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/agent365/skills/validate-observability/validators/rule-result.js \
        tests/vo-rule-result.test.js
git commit -m "Add RuleResult shape + toUpstreamShape stripper

Validators emit findings via RuleResult(). Engineering's upstream rule pack
will land in this same shape minus the skill-only severity/fixHint fields;
toUpstreamShape() is the export adapter.
"
```

---

## Task 7: `schema-driven.js` — presence + type + privacy validators

**Files:**
- Create: `plugins/agent365/skills/validate-observability/validators/schema-driven.js`
- Create: `tests/vo-schema-driven.test.js`
- Create: `tests/fixtures/vo/span-good-invoke.json`
- Create: `tests/fixtures/vo/span-bad-missing-field.json`
- Create: `tests/fixtures/vo/span-bad-wrong-type.json`

- [ ] **Step 1: Author the three span fixtures**

`tests/fixtures/vo/span-good-invoke.json`:

```json
{
  "traceId": "0123456789abcdef0123456789abcdef",
  "spanId":  "0123456789abcdef",
  "parentSpanId": "",
  "name": "invoke_agent",
  "kind": 1,
  "startTimeUnixNano": "1714932000000000000",
  "endTimeUnixNano":   "1714932001000000000",
  "attributes": {
    "gen_ai.operation.name":  "invoke_agent",
    "gen_ai.agent.id":        "30ed5699-b157-4e87-bb45-9b0cfb13b8e5",
    "gen_ai.agent.name":      "DemoAgent",
    "gen_ai.conversation.id": "19:thread@demo",
    "gen_ai.input.messages":  "{\"role\":\"user\",\"content\":\"hello\"}",
    "gen_ai.output.messages": "{\"role\":\"assistant\",\"content\":\"hi\"}",
    "request.ingestionSource": "Foundry"
  },
  "status": { "code": 1 }
}
```

`tests/fixtures/vo/span-bad-missing-field.json` — same as above but with `gen_ai.conversation.id` removed (it's required for all sources).

`tests/fixtures/vo/span-bad-wrong-type.json` — same as `span-good-invoke.json` but with `gen_ai.agent.id` set to `12345` (an int, schema declares `String`).

- [ ] **Step 2: Write failing test for predicate evaluator**

Create `tests/vo-schema-driven.test.js`:

```javascript
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
```

- [ ] **Step 3: Run, see all three fail**

```bash
node --test tests/vo-schema-driven.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement predicate evaluator**

Create `plugins/agent365/skills/validate-observability/validators/schema-driven.js`:

```javascript
'use strict';
const fs   = require('fs');
const path = require('path');
const { RuleResult } = require('./rule-result');

function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function readField(span, field) {
  if (field === 'gen_ai.operation.name')   return span.attributes?.['gen_ai.operation.name'];
  if (field === 'request.ingestionSource') return span.attributes?.['request.ingestionSource'];
  if (field in (span.attributes || {}))    return span.attributes[field];
  return span[field];
}

function evalPredicate(p, span) {
  const v = readField(span, p.field);
  const inValues = p.values.includes(v) || p.values.includes('*') && v != null;
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
    const present = readField(span, f.key) !== undefined;
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
      const v = readField(span, f.key);
      const checker = TYPE_CHECKERS[f.type];
      if (checker && !checker(v)) {
        findings.push(RuleResult({
          ruleId: 'rule-type_conformance',
          value: 'type_mismatch',
          valueType: 'json',
          confidence: 1.0,
          metadata: { field: f.key, expected: f.type, actual: typeof v },
          severity: 'error',
          fixHint: `Field "${f.key}" must be of type ${f.type}.`,
          spanId: span.spanId,
          traceId: span.traceId,
        }));
      }
    }
  }
  return findings;
}

module.exports = { loadSchema, evalPredicate, evalRequiredPredicate, validateSpan };
```

- [ ] **Step 5: Run, see predicate tests pass**

```bash
node --test tests/vo-schema-driven.test.js
```

Expected: 3 PASS.

- [ ] **Step 6: Commit (predicate evaluator)**

```bash
git add plugins/agent365/skills/validate-observability/validators/schema-driven.js \
        tests/fixtures/vo/span-good-invoke.json \
        tests/vo-schema-driven.test.js
git commit -m "Add schema-driven predicate evaluator

Implements the AND-of-OR semantics from maven-schema.json's required[][]
encoding. The evaluator is data-driven; adding a new ingestion source
requires only a schema update.
"
```

- [ ] **Step 7: Add failing tests for full validateSpan**

Append to `tests/vo-schema-driven.test.js`:

```javascript
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
```

- [ ] **Step 8: Author the bad fixtures**

Save the two fixtures from step 1 to `tests/fixtures/vo/span-bad-missing-field.json` and `tests/fixtures/vo/span-bad-wrong-type.json`.

- [ ] **Step 9: Run, see them pass**

```bash
node --test tests/vo-schema-driven.test.js
```

Expected: all 6 PASS. If `validateSpan: clean invoke_agent` fails because the schema declares additional required fields the fixture omits, update the fixture to include them — never weaken the schema or the validator.

- [ ] **Step 10: Commit (full validateSpan)**

```bash
git add plugins/agent365/skills/validate-observability/validators/schema-driven.js \
        tests/fixtures/vo/span-bad-missing-field.json \
        tests/fixtures/vo/span-bad-wrong-type.json \
        tests/vo-schema-driven.test.js
git commit -m "Schema-driven: emit presence and type-conformance findings

A clean span produces zero findings against the upstream schema; missing
required fields and type mismatches each surface a typed RuleResult with
a fixHint pointing the dev at the field's role.
"
```

---

## Task 8: `common-mistakes.js` + rule pack

**Files:**
- Create: `plugins/agent365/skills/validate-observability/validators/common-mistakes.js`
- Create: `plugins/agent365/skills/validate-observability/references/common-mistakes.json`
- Create: `tests/vo-common-mistakes.test.js`
- Create: `tests/fixtures/vo/trace-bad-no-caller.json`, `tests/fixtures/vo/trace-bad-scope-order.json`

- [ ] **Step 1: Author the rule pack**

Create `plugins/agent365/skills/validate-observability/references/common-mistakes.json`:

```json
{
  "rules": [
    {
      "ruleId": "rule-store_publishing_scopes_present",
      "appliesTo": { "operationName": "invoke_agent" },
      "check": "trace_must_contain_operation_names",
      "args":  { "names": ["execute_tool", "inference"] },
      "severity": "error",
      "fixHint": "InvokeAgentScope is present but no InferenceScope or ExecuteToolScope was found in the same trace. Both are required for store publishing — see instrument-observability Phase 5.5."
    },
    {
      "ruleId": "rule-s2s_caller_details_required",
      "appliesTo": { "operationName": "invoke_agent" },
      "check": "any_attribute_present",
      "args":  { "prefixes": ["microsoft.a365.caller.", "gen_ai.caller."] },
      "negate": true,
      "severity": "error",
      "fixHint": "S2S agents must populate CallerDetails on InvokeAgentScope.Start(); without it, traces reach the API (200) but stay invisible in the MAC portal."
    },
    {
      "ruleId": "rule-s2s_endpoint_path",
      "appliesTo": { "operationName": "invoke_agent" },
      "check": "url_path_pattern",
      "args":  { "deny": "/observability/", "allow": "/observabilityService/" },
      "severity": "error",
      "fixHint": "S2S agent posted to /observability/ instead of /observabilityService/ — set Agent365.Exporter.UseS2SEndpoint=true (.NET) or AGENT365_USE_S2S_ENDPOINT=true (Node.js)."
    },
    {
      "ruleId": "rule-resource_service_name_present",
      "appliesTo": { "operationName": "*" },
      "check": "resource_attribute_present",
      "args":  { "key": "service.name" },
      "severity": "warning",
      "fixHint": "service.name resource attribute is missing — set SERVICE_NAME (Node.js/Python) or use_microsoft_opentelemetry(service_name=...)."
    },
    {
      "ruleId": "rule-parent_span_resolution",
      "appliesTo": { "operationName": "*" },
      "check": "parent_span_resolves_in_trace",
      "severity": "warning",
      "fixHint": "Span has parentSpanId but no matching parent in the same trace's captures — likely the parent emit was lost or the agent broke the parent context."
    },
    {
      "ruleId": "rule-conversation_id_consistency",
      "appliesTo": { "operationName": "*" },
      "check": "trace_attribute_consistent",
      "args":  { "key": "gen_ai.conversation.id" },
      "severity": "warning",
      "fixHint": "gen_ai.conversation.id differs across spans within one trace — baggage propagation likely broken; check BaggageBuilder usage in the message handler."
    },
    {
      "ruleId": "rule-baggage_propagation",
      "appliesTo": { "operationName": "*" },
      "check": "baggage_keys_present",
      "args":  { "keys": ["microsoft.a365.agent.id", "microsoft.a365.tenant.id"] },
      "severity": "warning",
      "fixHint": "Required baggage keys missing on a non-root span — baggage was set on the InvokeAgent but not propagated to children. Confirm BaggageBuilder.run() wraps the entire handler body."
    },
    {
      "ruleId": "rule-otlp_path_canonical",
      "appliesTo": { "operationName": "*" },
      "check": "url_path_does_not_contain",
      "args":  { "fragment": "/otlp/" },
      "severity": "warning",
      "fixHint": "URL contains /otlp/ — Node.js / .NET SDK bug. Status: pending SDK fix; no client-side workaround is correct."
    },
    {
      "ruleId": "rule-fmi_token_audience",
      "appliesTo": { "operationName": "*" },
      "check": "resource_attribute_equals_if_present",
      "args":  { "key": "microsoft.a365.exporter.token_aud", "expected": "api://9b975845-388f-4429-889e-eab1ef63949c/.default" },
      "severity": "warning",
      "fixHint": "FMI token audience does not match the Observability API scope — token may be rejected by the gateway."
    },
    {
      "ruleId": "rule-scope_ordering",
      "appliesTo": { "operationName": "inference" },
      "check": "child_within_parent_time_window",
      "severity": "warning",
      "fixHint": "Child scope start time precedes its parent InvokeAgent start — likely a clock skew or the scope was opened outside the parent's using-block."
    }
  ]
}
```

- [ ] **Step 2: Author trace fixtures**

`tests/fixtures/vo/trace-bad-no-caller.json` — array of two spans (an invoke_agent without `microsoft.a365.caller.*` and an inference child):

```json
[
  {
    "traceId": "aa00000000000000aa00000000000000",
    "spanId":  "aa00000000000001",
    "parentSpanId": "",
    "name": "invoke_agent",
    "attributes": {
      "gen_ai.operation.name":  "invoke_agent",
      "gen_ai.agent.id":        "30ed5699-b157-4e87-bb45-9b0cfb13b8e5",
      "gen_ai.agent.name":      "S2SAgent",
      "gen_ai.conversation.id": "conv-1",
      "gen_ai.input.messages":  "{}",
      "gen_ai.output.messages": "{}",
      "request.ingestionSource": "Foundry"
    },
    "status": { "code": 1 }
  },
  {
    "traceId": "aa00000000000000aa00000000000000",
    "spanId":  "aa00000000000002",
    "parentSpanId": "aa00000000000001",
    "name": "inference",
    "attributes": {
      "gen_ai.operation.name":  "inference",
      "gen_ai.conversation.id": "conv-1",
      "request.ingestionSource": "Foundry"
    },
    "status": { "code": 1 }
  }
]
```

`tests/fixtures/vo/trace-bad-scope-order.json` — inference span starting BEFORE its parent invoke_agent:

```json
[
  {
    "traceId": "bb00000000000000bb00000000000000",
    "spanId":  "bb00000000000001",
    "parentSpanId": "",
    "name": "invoke_agent",
    "startTimeUnixNano": "2000",
    "endTimeUnixNano":   "3000",
    "attributes": {
      "gen_ai.operation.name":  "invoke_agent",
      "microsoft.a365.caller.agent.id": "caller-x",
      "gen_ai.conversation.id": "conv-2",
      "request.ingestionSource": "Foundry"
    }
  },
  {
    "traceId": "bb00000000000000bb00000000000000",
    "spanId":  "bb00000000000002",
    "parentSpanId": "bb00000000000001",
    "name": "inference",
    "startTimeUnixNano": "1000",
    "endTimeUnixNano":   "1500",
    "attributes": {
      "gen_ai.operation.name":  "inference",
      "gen_ai.conversation.id": "conv-2",
      "request.ingestionSource": "Foundry"
    }
  }
]
```

- [ ] **Step 3: Write failing tests**

Create `tests/vo-common-mistakes.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');

const cmPath    = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/validators/common-mistakes.js');
const rulesPath = path.join(__dirname, '..', 'plugins/agent365/skills/validate-observability/references/common-mistakes.json');
const fixDir    = path.join(__dirname, 'fixtures', 'vo');

function loadTrace(file) { return JSON.parse(fs.readFileSync(path.join(fixDir, file), 'utf8')); }

test('common-mistakes: missing CallerDetails fires rule-s2s_caller_details_required', () => {
  const { loadRules, validateTrace } = require(cmPath);
  const rules    = loadRules(rulesPath);
  const trace    = loadTrace('trace-bad-no-caller.json');
  const findings = validateTrace(trace, rules);
  const f        = findings.find(x => x.ruleId === 'rule-s2s_caller_details_required');
  assert.ok(f, JSON.stringify(findings, null, 2));
});

test('common-mistakes: child scope before parent fires rule-scope_ordering', () => {
  const { loadRules, validateTrace } = require(cmPath);
  const rules    = loadRules(rulesPath);
  const trace    = loadTrace('trace-bad-scope-order.json');
  const findings = validateTrace(trace, rules);
  const f        = findings.find(x => x.ruleId === 'rule-scope_ordering');
  assert.ok(f, JSON.stringify(findings, null, 2));
});

test('common-mistakes: clean trace passes (zero common-mistakes findings)', () => {
  const { loadRules, validateTrace } = require(cmPath);
  const rules = loadRules(rulesPath);
  // Clean trace: invoke_agent + inference + execute_tool, all with caller and proper times
  const clean = [
    { traceId: 'cc00', spanId: '01', parentSpanId: '', name: 'invoke_agent',
      startTimeUnixNano: '1000', endTimeUnixNano: '5000',
      attributes: { 'gen_ai.operation.name': 'invoke_agent', 'microsoft.a365.caller.agent.id': 'cx', 'service.name': 'a' } },
    { traceId: 'cc00', spanId: '02', parentSpanId: '01', name: 'inference',
      startTimeUnixNano: '2000', endTimeUnixNano: '3000',
      attributes: { 'gen_ai.operation.name': 'inference', 'service.name': 'a' } },
    { traceId: 'cc00', spanId: '03', parentSpanId: '01', name: 'execute_tool',
      startTimeUnixNano: '3500', endTimeUnixNano: '4000',
      attributes: { 'gen_ai.operation.name': 'execute_tool', 'service.name': 'a' } },
  ];
  const findings = validateTrace(clean, rules);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});
```

- [ ] **Step 4: Run, see fail**

```bash
node --test tests/vo-common-mistakes.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement common-mistakes runner**

Create `plugins/agent365/skills/validate-observability/validators/common-mistakes.js`:

```javascript
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
    const url = span._urlPath || '';
    if (rule.args.deny  && url.includes(rule.args.deny))  return false;
    if (rule.args.allow && !url.includes(rule.args.allow)) return false;
    return true;
  },
  url_path_does_not_contain(span, _trace, rule) {
    return !(span._urlPath || '').includes(rule.args.fragment);
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
      let ok = check(span, trace, rule);
      if (rule.negate) ok = !ok;
      if (!ok) {
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
```

- [ ] **Step 6: Run, see all pass**

```bash
node --test tests/vo-common-mistakes.test.js
```

Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/agent365/skills/validate-observability/validators/common-mistakes.js \
        plugins/agent365/skills/validate-observability/references/common-mistakes.json \
        tests/fixtures/vo/trace-bad-no-caller.json \
        tests/fixtures/vo/trace-bad-scope-order.json \
        tests/vo-common-mistakes.test.js
git commit -m "Add common-mistakes rule pack and runner

10 hand-authored rules covering store-publishing scope completeness,
S2S CallerDetails, endpoint-path correctness, baggage propagation,
parent-span resolution, scope time-ordering, and FMI token audience.
Each rule is data; the runner is one function.
"
```

---

## Task 9: `report.js` — markdown formatter

**Files:**
- Create: `plugins/agent365/skills/validate-observability/validators/report.js`
- Create: `tests/fixtures/vo/expected-report.md`
- Create: `tests/vo-report.test.js`

- [ ] **Step 1: Author the expected report**

Create `tests/fixtures/vo/expected-report.md`:

```markdown
# Observability validation report

**Findings:** 1 error, 1 warning, 0 info across 1 trace.

## trace `aa00000000000000aa00000000000000`

### error · rule-s2s_caller_details_required
- **Span:** `invoke_agent` (`aa00000000000001`)
- **Fix:** S2S agents must populate CallerDetails on InvokeAgentScope.Start(); without it, traces reach the API (200) but stay invisible in the MAC portal.

### warning · rule-resource_service_name_present
- **Span:** `invoke_agent` (`aa00000000000001`)
- **Fix:** service.name resource attribute is missing — set SERVICE_NAME (Node.js/Python) or use_microsoft_opentelemetry(service_name=...).
```

- [ ] **Step 2: Write failing test**

Create `tests/vo-report.test.js`:

```javascript
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
```

- [ ] **Step 3: Run, see fail**

```bash
node --test tests/vo-report.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement formatter**

Create `plugins/agent365/skills/validate-observability/validators/report.js`:

```javascript
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
  lines.push(`**Findings:** ${counts.error} error, ${counts.warning} warning, ${counts.info} info across ${byTrace.size} trace.\n`);
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
```

- [ ] **Step 5: Run, see pass**

```bash
node --test tests/vo-report.test.js
```

Expected: PASS. If not, diff the actual output vs `expected-report.md` and fix the formatter, never the fixture (the fixture is the spec).

- [ ] **Step 6: Commit**

```bash
git add plugins/agent365/skills/validate-observability/validators/report.js \
        tests/fixtures/vo/expected-report.md \
        tests/vo-report.test.js
git commit -m "Add markdown report formatter for validator findings

Groups findings by trace, then severity. Errors first, warnings second,
info last. Snapshot-tested against a known-good fixture.
"
```

---

## Task 10: Stop hook `validate-validate-observability.js`

**Files:**
- Create: `plugins/agent365/hooks/stop/validate-validate-observability.js`
- Create: `tests/vo-stop-hook.test.js`

- [ ] **Step 1: Write failing test using the existing helpers**

Create `tests/vo-stop-hook.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const { createFixture, runValidator, cleanup } = require('./helpers');

const VALIDATOR = path.join(__dirname, '..', 'plugins/agent365/hooks/stop/validate-validate-observability.js');

test('no .a365-observability-capture dir → ok', () => {
  const dir = createFixture({});
  try { assert.deepEqual(runValidator(VALIDATOR, dir), { ok: true }); }
  finally { cleanup(dir); }
});

test('state.json present, claimed daemon PID alive → ok', () => {
  const dir = createFixture({
    '.a365-observability-capture/state.json': JSON.stringify({ pid: process.pid, port: 4318, mutations: [] }),
  });
  try { assert.deepEqual(runValidator(VALIDATOR, dir), { ok: true }); }
  finally { cleanup(dir); }
});

test('state.json present, daemon PID dead, mutations recorded → not ok', () => {
  const dir = createFixture({
    '.a365-observability-capture/state.json': JSON.stringify({ pid: 999999, port: 4318, mutations: [{ file: '.env.local', line: 'AGENT365_OBSERVABILITY_ENDPOINT=...' }] }),
  });
  try {
    const r = runValidator(VALIDATOR, dir);
    assert.equal(r.ok, false);
    assert.match(r.reason, /daemon dead/i);
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run, see fail**

```bash
node --test tests/vo-stop-hook.test.js
```

Expected: FAIL — validator not found.

- [ ] **Step 3: Implement the stop hook**

Create `plugins/agent365/hooks/stop/validate-validate-observability.js`:

```javascript
#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';
const fs   = require('fs');
const path = require('path');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function main() {
  const cwd       = process.cwd();
  const stateFile = path.join(cwd, '.a365-observability-capture', 'state.json');
  if (!fs.existsSync(stateFile)) {
    console.log(JSON.stringify({ ok: true }));
    return;
  }
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (e) {
    console.log(JSON.stringify({ ok: false, reason: `state.json parse error: ${e.message}` }));
    return;
  }
  const alive = state.pid && pidAlive(state.pid);
  const hasMutations = Array.isArray(state.mutations) && state.mutations.length > 0;
  if (!alive && hasMutations) {
    console.log(JSON.stringify({
      ok: false,
      reason: `daemon dead (pid ${state.pid}) but ${state.mutations.length} dev-config mutation(s) still recorded — run validate-observability --stop to clean up`,
    }));
    return;
  }
  console.log(JSON.stringify({ ok: true }));
}

main();
```

- [ ] **Step 4: Mark executable + run tests**

```bash
chmod +x plugins/agent365/hooks/stop/validate-validate-observability.js
node --test tests/vo-stop-hook.test.js
```

Expected: 3 PASS.

- [ ] **Step 5: Wire the validator into the npm `validate` script**

Edit `package.json`:

```json
"scripts": {
  "test":     "node --test tests/*.test.js",
  "validate": "node plugins/agent365/hooks/stop/validate-a365-setup.js && node plugins/agent365/hooks/stop/validate-instrument-observability.js && node plugins/agent365/hooks/stop/validate-add-workiq-tools.js && node plugins/agent365/hooks/stop/validate-validate-observability.js"
}
```

- [ ] **Step 6: Commit**

```bash
git add plugins/agent365/hooks/stop/validate-validate-observability.js \
        tests/vo-stop-hook.test.js \
        package.json
git commit -m "Add stop hook: refuse to end turn with orphan daemon mutations

Hook detects the pattern 'daemon was started, daemon died, but dev-config
mutations are still recorded' and refuses to mark the turn complete until
--stop runs cleanup.
"
```

---

## Task 11: `SKILL.md` — the skill itself

**Files:**
- Create: `plugins/agent365/skills/validate-observability/SKILL.md`

No tests — the skill is instructions, exercised end-to-end by the eval cases in Task 12.

- [ ] **Step 1: Write `SKILL.md`**

Use the same phase-numbered structure as `instrument-observability/SKILL.md` and `test-local/SKILL.md`. Create `plugins/agent365/skills/validate-observability/SKILL.md`:

```markdown
---
name: validate-observability
version: 0.1.0
description: >
  Validates the OpenTelemetry data an Agent 365 SDK actually emits. Spawns a
  local OTLP/HTTP capture daemon, points the agent's dev-only config at it,
  captures one or more turns, and reports schema violations and common-mistake
  findings (missing CallerDetails, broken baggage propagation, S2S endpoint
  path bugs, etc.) with concrete fix hints. Runs offline; no live A365 tokens
  required. Two flows — live (steady-state iteration) and one-shot (quick verdict).
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional flags: --reset-cursor | --export <file> | --rule <ruleId> | --stop"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-validate-observability.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Mode was correctly determined (live or one-shot) from .a365-observability-capture/state.json.
        2. If one-shot mode mutated any dev-only config files, the original values were recorded in state.json.
        3. Validation findings were actually printed to the user (or "no findings" was explicitly reported).
        4. If one-shot mode completed, the user was offered the keep-running-or-stop choice.
        If any item failed, return {"ok": false, "reason": "<specific item>"}. Otherwise {"ok": true}.
      timeout: 30000
---

> **Trigger phrases:**
> - "validate my agent's observability data"
> - "check what observability data my agent is sending"
> - "is my a365 telemetry correct"
> - "analyze my last trace"
> - "run an observability data check"

# Validate A365 Observability Data Locally

This skill captures the OTLP traffic your A365 SDK actually emits, runs schema-driven
and common-mistakes validators against it, and reports concrete findings with fix hints.

## Phase 0 — Determine mode

**TaskCreate** — "Determine mode (live vs one-shot)"

**Read** `.a365-observability-capture/state.json`. If absent → **one-shot** (Phase 1B).
If present and the recorded `pid` is alive → **live** (Phase 1A). If present but the
PID is dead, prompt the user: *"A previous capture session is recorded but the daemon
is gone. Reset and start a new session?"* — on yes, delete `state.json` and continue
to one-shot; on no, exit.

## Phase 1A — Live mode

**TaskCreate** — "Read captured spans since cursor; validate; report"

1. **Read** `.a365-observability-capture/cursor.json` for `lastReadCount`.
2. **Read** `.a365-observability-capture/traces.jsonl`. Take entries after `lastReadCount`.
   - If zero new entries: ask the user *"No new spans since last run. Send a turn through your agent now and reply 'go' when ready."* Loop until entries appear.
3. Group entries into traces by `span.traceId`.
4. For each span, run `validators/schema-driven.js → validateSpan`.
5. For each trace, run `validators/common-mistakes.js → validateTrace`.
6. Run `validators/report.js → format` on the merged findings; print the markdown.
7. Advance the cursor.

If `--reset-cursor`: skip step 1, treat all entries as new.
If `--rule <id>`: filter findings to that ruleId only.
If `--export <file>`: also write findings to `<file>` after stripping skill-only fields via `validators/rule-result.js → toUpstreamShape`.

## Phase 1B — One-shot mode

**TaskCreate** — "Detect agent + start daemon + capture one turn + validate + cleanup"

1. **Read** `.a365-workspace-detection.json`. If absent: refuse: *"Run `a365-setup` and `instrument-observability` first."*
2. **Read** `references/endpoint-override.md` to determine the verified per-language override mechanism.
3. Pick a port (default 4318; scan upward if busy via `node -e "require('net').createServer().listen(PORT, ()=>process.exit(0)).on('error',()=>process.exit(1))"`).
4. **Mutate dev-only override config** per `endpoint-override.md`. Record original values in state.json's `mutations` array. **Never modify** `.env`, `appsettings.json`, or `appsettings.Production.json`.
5. **Spawn daemon**: `node ${CLAUDE_PLUGIN_ROOT}/skills/validate-observability/daemon/server.js --port <port> --capture-dir <agent-cwd>/.a365-observability-capture`. Capture stdout's first JSON line `{ ready: true, port, pid }` within 5 seconds. Write `state.json` with `{ pid, port, mutations }`.
6. **Prompt**: *"Daemon listening on `http://localhost:<port>`. Run one turn through your agent now (start it normally, send a message in AgentsPlayground, etc.). Reply 'go' when the turn is done."*
7. **On 'go'**: read all entries from `traces.jsonl`. If zero, run the diagnostic checklist (agent restarted? exporter Enabled? `service.name` set? curl the daemon).
8. **Validate + report** (same engine as Phase 1A).
9. **Offer**: *"Keep daemon running for live-mode iteration? [yes / no]"*
   - **yes**: leave state.json + mutations in place; the next skill invocation will land in Phase 1A.
   - **no**: kill daemon (`process.kill(state.pid, 'SIGTERM')`), restore each mutation in `state.mutations` (reverse order), delete `state.json` and `cursor.json`. Keep `traces.jsonl` for post-mortem. Inform the user which files were restored.

## Phase 2 — Explicit teardown (`--stop`)

If invoked with `--stop`:
1. Read `state.json`.
2. If absent: report "no daemon was running" and exit ok.
3. If present: kill the recorded pid (best-effort; ignore ESRCH), restore each mutation, delete `state.json` and `cursor.json`. Print a one-line summary of what was restored.

## Output format

Every run prints the markdown report from `report.js`. With zero findings, print:

```
# Observability validation report

**Findings:** 0 errors, 0 warnings, 0 info. Trace shape matches the upstream schema.
```

## Open question — endpoint override mechanism

`references/endpoint-override.md` records the verified mechanism per language. If a new
SDK version breaks one of those mechanisms, update that file and the corresponding step
in Phase 1B.

## Idempotency

- Live-mode invocations are pure reads.
- One-shot invocation while a daemon is already up transitions silently to Phase 1A.
- `--stop` is a no-op when no daemon is running.
- Running this skill never modifies production config files.
```

- [ ] **Step 2: Sanity-check the YAML frontmatter**

```bash
node -e "const m=require('fs').readFileSync('plugins/agent365/skills/validate-observability/SKILL.md','utf8').match(/^---\n([\s\S]+?)\n---/); if(!m){console.error('no frontmatter');process.exit(1)} require('child_process').spawnSync('node',['-e',\"const yaml=require('js-yaml');console.log('frontmatter parses')\"]).status; console.log(m[1].split('\\n').length, 'frontmatter lines');"
```

(Or simpler: visually inspect against `instrument-observability/SKILL.md`.)

- [ ] **Step 3: Commit**

```bash
git add plugins/agent365/skills/validate-observability/SKILL.md
git commit -m "Add validate-observability SKILL.md

Two flows (live + one-shot) over the daemon and validator engine. Mutates only
dev-only override files; uses the per-language mechanism documented in
references/endpoint-override.md.
"
```

---

## Task 12: Eval cases

**Files:**
- Create: `evals/agent365/validate-observability/evals.json`

No tests — eval JSON is itself the test surface, exercised by whatever harness the existing eval suite uses.

- [ ] **Step 1: Author six eval scenarios per spec §10.2**

Create `evals/agent365/validate-observability/evals.json`:

```json
{
  "skill": "validate-observability",
  "cases": [
    {
      "name": "clean-trace-passes",
      "description": "A well-formed invoke_agent + inference + execute_tool trace produces zero findings.",
      "fixture": "tests/fixtures/vo/expected-report.md",
      "input": "validate my agent's observability data",
      "expectations": [
        { "kind": "report-counts", "errors": 0, "warnings": 0 }
      ]
    },
    {
      "name": "missing-required-field",
      "description": "Span without gen_ai.conversation.id surfaces rule-presence_check.",
      "input": "validate my agent's observability data",
      "expectations": [
        { "kind": "rule-fires", "ruleId": "rule-presence_check", "severity": "error" }
      ]
    },
    {
      "name": "wrong-type",
      "description": "Span with int gen_ai.agent.id surfaces rule-type_conformance.",
      "input": "validate my agent's observability data",
      "expectations": [
        { "kind": "rule-fires", "ruleId": "rule-type_conformance", "severity": "error" }
      ]
    },
    {
      "name": "s2s-caller-details-missing",
      "description": "Invoke span without microsoft.a365.caller.* surfaces rule-s2s_caller_details_required.",
      "input": "validate my agent's observability data",
      "expectations": [
        { "kind": "rule-fires", "ruleId": "rule-s2s_caller_details_required", "severity": "error" }
      ]
    },
    {
      "name": "scope-out-of-order",
      "description": "Inference span starting before its parent invoke_agent surfaces rule-scope_ordering.",
      "input": "validate my agent's observability data",
      "expectations": [
        { "kind": "rule-fires", "ruleId": "rule-scope_ordering", "severity": "warning" }
      ]
    },
    {
      "name": "json-wire-format-equivalent-to-protobuf",
      "description": "An OTLP/JSON POST and an equivalent OTLP/protobuf POST produce identical findings.",
      "input": "validate my agent's observability data",
      "expectations": [
        { "kind": "findings-equal-across", "left": "tests/fixtures/vo/otlp-protobuf-clean.bin", "right": "tests/fixtures/vo/otlp-json-clean.json" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Verify the JSON parses + lint against existing eval shape**

```bash
node -e "JSON.parse(require('fs').readFileSync('evals/agent365/validate-observability/evals.json','utf8')); console.log('ok')"
```

```bash
ls evals/agent365/instrument-observability/evals.json && diff <(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('evals/agent365/instrument-observability/evals.json','utf8'))).sort().join('\n'))") <(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('evals/agent365/validate-observability/evals.json','utf8'))).sort().join('\n'))")
```

If the top-level key shape differs from the existing skill's eval file, align with the existing shape.

- [ ] **Step 3: Commit**

```bash
git add evals/agent365/validate-observability/evals.json
git commit -m "Add eval cases for validate-observability skill

Six scenarios covering clean-trace, schema-driven failures (presence + type),
S2S CallerDetails missing, scope time-ordering, and JSON/protobuf wire-format
equivalence.
"
```

---

## Task 13: README + manual end-to-end runbook

**Files:**
- Modify: `README.md` (add the new skill to the skill list)
- Create: `tests/fixtures/vo/README.md` — manual end-to-end runbook per spec §10 step 6

- [ ] **Step 1: Update top-level `README.md`**

Open `README.md`, find the section listing skills (it lists `instrument-observability`, `a365-setup`, `test-local`, etc.), and add a new bullet:

```markdown
- **`validate-observability`** — captures the OTLP traffic your A365 SDK emits and reports schema violations and common-mistake findings (missing CallerDetails, broken baggage propagation, etc.) with concrete fix hints. Two flows: live (iterate while the daemon stays up) and one-shot (quick verdict).
```

- [ ] **Step 2: Write the manual runbook**

Create `tests/fixtures/vo/README.md`:

```markdown
# Manual end-to-end runbook for the validate-observability skill

The unit tests cover the daemon and validators in isolation. This runbook covers the
full pipeline against a real A365 SDK — too brittle for CI (network + dotnet/python
deps) but worth running before each release.

## Per-language: emit one good and one broken trace, confirm the skill catches the broken one

### .NET

1. From a checkout of any A365-instrumented .NET agent (e.g. the bug-bash demo agent):
       cd path/to/agent
       claude
2. Say: "validate my agent's observability data"
3. The skill should ask you to run a turn. Send a normal user message in AgentsPlayground.
4. Confirm the report shows zero findings.
5. Edit your agent's message handler: remove the InvokeAgentScope.Start() call, rebuild.
6. Run the skill again. Confirm rule-store_publishing_scopes_present fires.
7. Restore the scope; confirm clean again.

### Node.js

(same steps, against any Node.js A365 agent)

### Python

(same steps, against any Python A365 agent)

## What to check before release

- All three languages reach Phase 1B step 6 ("daemon listening on..." prompt) without errors.
- The daemon's PID is recorded in `state.json`.
- After `--stop`, no orphan node processes remain on the chosen port.
- The dev-only config files were restored (diff against the pre-skill `git status`).
- `traces.jsonl` is left intact for post-mortem.
```

- [ ] **Step 3: Run full test suite to confirm nothing regressed**

```bash
npm test
```

Expected: all `vo-*.test.js` PASS plus existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md tests/fixtures/vo/README.md
git commit -m "Document validate-observability skill in top-level README + manual runbook

Updates the marketplace README to advertise the new skill and adds a per-language
manual runbook for pre-release verification of the full pipeline against real
A365 SDKs (out of CI by design).
"
```

- [ ] **Step 5: Push the branch**

```bash
git push -u origin validate-observability-skill
```

Confirm with the user before opening a PR; PR creation is a separate, user-confirmed action.

---

## Self-review checklist (run before handing off to executing-plans)

- [ ] **Spec coverage**: §1 (problem) → all tasks; §3 non-goals respected (no proxy mode, no rule engine, no production config edits); §4 decisions all reflected; §5 file layout matches Tasks 1–11; §6 data flow matches Tasks 3–9; §7 validation engine = Tasks 6–9; §8 skill UX = Task 11; §9 error handling = Tasks 3, 5, 10; §10 testing = Tasks 3–10 + Task 13 runbook; §11 workflow constraints = TDD cycles in every Task; §12 open question 1 = Task 0; §13 out-of-scope items not introduced; §14 references intact.
- [ ] **Placeholder scan**: no "TBD", "implement later", "similar to Task N", or unspecific code blocks. Every step contains either complete code or an exact command.
- [ ] **Type consistency**: `RuleResult` shape used identically in Tasks 6, 7, 8, 9 (`{ ruleId, value, valueType, confidence, metadata, severity, fixHint, spanId, traceId }`). `CaptureStore` returns the same surface across Tasks 4 and 5. `decoder.decode(body, contentType)` signature consistent across Tasks 3 and 5. `validateSpan(span, schema)` and `validateTrace(trace, rules)` signatures match between definitions and call sites in the SKILL.md.
- [ ] **Commit cadence**: each task ends with a `git commit`. TDD cycles are split into separate commits where the red→green boundary is meaningful (Task 3: 4 commits; Task 4: 2; Task 5: 2; Task 7: 2). Atomic.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-validate-observability-skill.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Best for the spike (Task 0) since it's exploratory and benefits from independent reasoning.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints for review. Better if you want to interleave decisions (e.g., "I'd rather skip the spike and start with the daemon — we'll figure out the override mechanism later").

**Which approach?**
