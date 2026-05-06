# validate-observability skill — design

**Status:** approved (brainstorming session, 2026-05-06)
**Owner:** juliome@microsoft.com
**Branch:** `validate-observability-skill`

---

## 1. Problem

Multiple A365 agent developers ship agents that successfully *send* observability data
to the A365 service but the data they send is incorrect or incomplete — fields missing,
wrong types, unredacted CustomerContent, S2S agents missing `CallerDetails`, etc. The
errors are silent at runtime (the SDK returns 200 OK, agent runs fine) but cause
data-compliance issues downstream and make traces unusable in the MAC portal.

Today the only feedback loop is "ship → look at production telemetry → file a bug".

## 2. Goal

Give agent developers a local, offline-capable workflow that:

1. captures the OTLP traffic their A365 SDK actually emits, and
2. tells them, in plain language, what's wrong with it and how to fix it,

before they hit production.

## 3. Non-goals (v1)

- **Live-service validation.** v1 is offline. A pass-through proxy mode (validate AND
  forward to real A365) is a v2 addition.
- **Authoring a full rule engine.** v1 ships ~10 hand-authored rules plus mechanical
  schema-driven checks. The engineering team will hand over a richer upstream rule pack
  later; the rule output shape is designed for that drop-in.
- **Modifying production config.** The skill never touches `.env` or `appsettings.json`
  — only dev-only override files (`.env.local`, `appsettings.Development.json`).

## 4. Decisions captured during brainstorming

| Q | Decision | Why |
|---|---|---|
| Workflow | Live-mode (steady-state iteration) **and** one-shot (quick verdict) | A matches dev iteration loop; C matches "give me a quick verdict" |
| Capture mechanism | Endpoint replacement — daemon terminates OTLP, returns 200 | Offline; no auth setup; deterministic |
| Daemon runtime | Node.js + `protobufjs` (single dep) | Language-agnostic for consumers; clean OTLP parsing |
| Wire format | Sniff `Content-Type`; handle protobuf and JSON | A365 SDK doesn't always use protobuf |
| Validation rules in v1 | Schema-driven (from `maven-schema.json`) + ~10 common-mistakes + forward-compat output shape | Cheap together; (b) gives high-signal feedback; (c) costs nothing |
| Languages | .NET, Node.js, Python (same trio as the rest of the marketplace) | Daemon is language-agnostic; only config flip is per-language |
| Schema sync | Commit `maven-schema.json` into the plugin, refresh via PR when upstream bumps | Runtime fetch is brittle (closed networks, auth) |

## 5. Architecture

### 5.1 Two artifacts

1. **`a365-observability-capture` daemon** — Node.js OTLP/HTTP receiver on
   `http://localhost:4318` (or user-chosen port). Sniffs `Content-Type`, decodes
   `application/x-protobuf` or `application/json` `ExportTraceServiceRequest`, persists
   to JSONL, returns 200 OK.

2. **`validate-observability` skill** — user-invocable skill with two flows:
   - **Live mode**: daemon already running; skill reads recent JSONL captures, runs
     validators, prints report.
   - **One-shot mode**: skill starts daemon, mutates dev-only config, prompts dev to
     run one turn, captures, validates, prints, optionally tears down.

### 5.2 File layout

```
plugins/agent365/
├── .claude-plugin/plugin.json                  # add validate-observability declaration
└── skills/
    └── validate-observability/
        ├── SKILL.md
        ├── daemon/
        │   ├── package.json                    # single dep: protobufjs
        │   ├── server.js                       # HTTP receiver, content-type sniffing
        │   ├── otlp-decoder.js                 # decode protobuf OR JSON → uniform shape
        │   └── capture-store.js                # JSONL append + cursor + rotation
        ├── validators/
        │   ├── schema-driven.js                # presence / type / privacy
        │   ├── common-mistakes.js              # ~5–10 hand-authored rules
        │   ├── rule-result.js                  # SpanEvalResult-shape emitter
        │   └── report.js                       # markdown report builder
        ├── references/
        │   ├── maven-schema.json               # snapshot from upstream
        │   ├── common-mistakes.json            # rule pack data
        │   └── schema-sync.md                  # how to refresh maven-schema.json
        └── tests/
            ├── fixtures/
            ├── otlp-decoder.test.js
            ├── capture-store.test.js
            ├── schema-driven.test.js
            ├── common-mistakes.test.js
            └── report.test.js
plugins/agent365/hooks/stop/
└── validate-validate-observability.js          # stop hook
evals/agent365/validate-observability/
└── evals.json
```

### 5.3 Component boundaries

- `daemon/server.js` knows HTTP and `Content-Type`. No OTLP knowledge.
- `otlp-decoder.js` knows the OTLP wire format. No validation knowledge.
- `capture-store.js` knows JSONL persistence. No span semantics.
- `validators/*` know span semantics. Pure functions; take a span object, return
  `RuleResult[]`.
- `report.js` formats `RuleResult[]` → markdown. Pure function.

A new validator drops into `validators/` and registers itself. Adding a rule never
requires touching the daemon or the report formatter.

## 6. Data flow

```
agent process               daemon                          skill (on dev request)
─────────────               ──────                          ─────────────────────
A365 SDK exporter
  POST /v1/traces  ──►   server.js
  Content-Type:            sniffs Content-Type
  application/x-protobuf   │
  body = OTLP                ▼
  ExportTraceService       otlp-decoder.js
  Request                    │  protobuf path: protobufjs decode
                             │  json path:     JSON.parse
                             ▼
                           uniform internal shape:
                             { resource, spans, receivedAt }
                             │
                             ▼
                           capture-store.js
                             append one JSONL line per span to
                             .a365-observability-capture/traces.jsonl
                             increment file cursor
                             │
                             ▼
                           respond 200 OK                    (skill is invoked)
                                                               │
                                                               ▼
                                                            read trailing N spans from JSONL
                                                            (or all-since-cursor in live mode)
                                                               │
                                                               ▼
                                                            for each span:
                                                              schema-driven.js  → RuleResult[]
                                                              common-mistakes.js → RuleResult[]
                                                               │
                                                               ▼
                                                            report.js → markdown → terminal
```

### 6.1 JSONL line shape

```jsonc
{
  "receivedAt": "2026-05-06T18:42:01.123Z",
  "wireFormat": "protobuf" | "json" | "unknown",
  "remoteAddr": "127.0.0.1:54321",
  "urlPath":    "/v1/traces",
  "resource":   { "service.name": "my-agent", ... },
  "scope":      { "name": "Microsoft.Agents.A365.Observability", "version": "..." },
  "span":       { /* fully decoded OTLP Span as a plain JS object */ }
}
```

One JSONL line = one span. A POST batching N spans produces N lines.

### 6.2 Cursor + rotation

- `.a365-observability-capture/cursor.json` tracks `{ lastReadOffset, lastReadAt }`.
  Live-mode reads only spans the dev hasn't seen since the previous skill invocation.
- JSONL rotates at 50 MB (configurable). Previous file suffixed `.1`, `.2`, etc.
- Daemon never blocks on disk I/O. Failed writes log to stderr; always returns 200.

## 7. Validation engine

Three layers. Pure functions over a captured span. No I/O inside validators.

### 7.1 Layer 1 — Schema-driven

Loads `references/maven-schema.json` once. Three rule kinds:

| ruleId | Trigger | Severity |
|---|---|---|
| `rule-presence_check` | Field's `required[][]` predicate evaluates true given the span's other fields and `request.ingestionSource`, but the field is missing | `error` if any required-clause is satisfied; `warning` if a per-source default would have required it but the dev's source is exempted |
| `rule-type_conformance` | Field present, runtime type doesn't match declared `type` | `error` |
| `rule-privacy_classification` | `CustomerContent` / `EUII` field carries an unredacted-looking value when the auth mode shouldn't allow it | `warning` (best-effort heuristic) |

The `required` predicate is `string[][]` (outer = OR, inner objects = AND), each
`{ field, condition: "in" / "not_in", values: [...] }`. The evaluator is ~30 lines,
table-driven.

### 7.2 Layer 2 — Common-mistakes pack

Authored as data in `references/common-mistakes.json`. Seed pack (≤10):

1. `rule-store_publishing_scopes_present` — InvokeAgent present but Inference and ExecuteTool absent in same trace.
2. `rule-s2s_caller_details_required` — `auth_mode=S2S` but no caller attributes on the InvokeAgent span. Accepts either prefix: `microsoft.a365.caller.*` or its `gen_ai.caller.*` alias (per `maven-schema.json` `legacy_names`). Silent MAC-portal-invisibility bug.
3. `rule-s2s_endpoint_path` — `urlPath` indicates `/observability/...` for an S2S agent (should be `/observabilityService/...`).
4. `rule-resource_service_name_present` — `service.name` resource attribute missing or empty.
5. `rule-parent_span_resolution` — non-root span has `parentSpanId` but no matching span in the same trace's prior captures.
6. `rule-conversation_id_consistency` — `gen_ai.conversation.id` differs across spans in the same trace.
7. `rule-baggage_propagation` — required baggage keys (`microsoft.a365.agent.id`, `microsoft.a365.tenant.id`) absent on a span beneath a properly-baggage'd InvokeAgent.
8. `rule-otlp_path_canonical` — `urlPath` includes `/otlp/` segment (Node.js / .NET SDK bug).
9. `rule-fmi_token_audience` — resource attribute `microsoft.a365.exporter.token_aud`, if present, doesn't match `api://9b975845-388f-4429-889e-eab1ef63949c/.default`.
10. `rule-scope_ordering` — InferenceScope or ExecuteToolScope start time precedes its parent InvokeAgent's start time.

Each rule is a tiny `check` function in `common-mistakes.js`, keyed by the `check`
string in the JSON (table-driven, easy to extend).

### 7.3 Layer 3 — RuleResult shape

```ts
{
  ruleId:     string;        // upstream-aligned where possible
  value:      string;        // the failing value (or "absent" / "type_mismatch")
  valueType:  "float" | "string" | "bool" | "json";
  confidence: number;        // 0..1; deterministic = 1.0; heuristic < 1.0
  metadata:   object | null; // rule-specific extras
  // skill-only (engineering's upstream rule pack will leave these empty):
  severity:   "error" | "warning" | "info";
  fixHint:    string;        // one-paragraph pointer to the fix
  // identity:
  spanId:     string;
  traceId:    string;
}
```

Serializer in `rule-result.js` strips skill-only fields when emitting upstream-shape
JSON (for the `--export <file>` flag).

### 7.4 Reporting

Group findings by trace, then severity. Errors first, warnings second, info last.
Each finding shows: rule id, span name, fixHint, one-line excerpt of the offending
data so the dev sees context.

## 8. Skill UX

`SKILL.md` follows the same phase-numbered structure as `instrument-observability`
and `test-local`.

### 8.1 Trigger phrases

- "validate my agent's observability data"
- "check what observability data my agent is sending"
- "is my a365 telemetry correct"
- "analyze my last trace"
- "run an observability data check"

### 8.2 Phase 0 — Mode detection

Read `.a365-observability-capture/state.json`. If present and the daemon's PID is
alive → live mode. If absent → one-shot mode.

### 8.3 Phase 1A — Live mode

Tail the JSONL since the cursor. If zero new spans, ask the dev to send a turn
through their agent and offer to wait. Otherwise validate, print report, advance
cursor.

### 8.4 Phase 1B — One-shot mode

1. Detect agent type and auth mode from `.a365-workspace-detection.json`. If absent,
   refuse: *"run `a365-setup` and `instrument-observability` first."*
2. Pick a port — default 4318, scan upward if busy.
3. Mutate **dev-only override config** (the only files ever touched). **The exact
   override mechanism is an open question — see §14.** First implementation step is a
   spike per language to determine which of these works:
   - **Standard OTel env vars** (`OTEL_EXPORTER_OTLP_ENDPOINT` /
     `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) — works iff the A365 distro routes through
     them rather than posting to its own derived URL.
   - **A365-specific override key** — may exist but is not currently documented in
     the SDK references.
   - **Code-level patch** (a small dev-only initializer that swaps the A365 exporter
     for a plain OTLP-HTTP exporter pointed at localhost) — requires touching code,
     not just config; reversible by removing one block.
   Whichever wins per language is what gets written into `.env.local` /
   `appsettings.Development.json`. Original value (or "unset") recorded in
   `state.json` for rollback.
4. Spawn daemon. Health probe within 5 seconds.
5. Prompt dev: *"Daemon listening on `http://localhost:<port>`. Run one turn through
   your agent now. Reply 'go' when the turn is done."*
6. Capture — read all spans from JSONL once dev replies "go". Diagnose if zero spans.
7. Validate + report.
8. Offer to keep daemon running. Yes → transition to live mode. No → restore config,
   kill daemon, delete `cursor.json` (JSONL stays for post-mortem).

### 8.5 Flags

- `--reset-cursor` — re-validate everything in the JSONL.
- `--export <file>` — write findings as JSON in upstream-shape (skill-only fields stripped).
- `--rule <ruleId>` — only run the named rule (debug aid).
- `--stop` — explicit teardown: kill daemon, restore config, delete state file.

### 8.6 Hooks

- `preToolUse`: existing `path-guard.js` — refuse paths outside the agent project root.
- `stop`: new `validate-validate-observability.js` — refuses to end the turn if the
  daemon was started this turn but state is half-modified.
- `stop` prompt: verifies findings were printed and the keep-running choice was offered.

### 8.7 Allowed tools

`Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate,
TaskList`. Same set as `instrument-observability`.

## 9. Error handling

### 9.1 Daemon side

| Failure | Behavior |
|---|---|
| Body fails both protobuf and JSON decode | Log to stderr with first 256 bytes hex-dumped; write a `decode_failure` JSONL line with `wireFormat: "unknown"` and the raw body base64'd; respond 200 |
| Disk full / JSONL append fails | Log to stderr; respond 200; in-memory ring buffer of last 100 spans for `--flush` recovery |
| Port already bound | Exit code 2, stderr names the conflicting PID; skill catches the code and asks dev for an alternate port |
| Cursor file corrupt | Daemon ignores cursor; skill warns and treats every span as new on next read |

### 9.2 Skill side

| Failure | Behavior |
|---|---|
| Zero spans captured during one-shot wait | Diagnostic checklist: agent restarted? exporter `Enabled`? `service.name` set? `curl` the daemon |
| Config-mutation rollback fails | Print original value + file path; tell dev to restore manually; do not crash. State file kept for retry |
| `maven-schema.json` malformed | Refuse to run; name the failing line; link to `references/schema-sync.md` |
| Daemon dies mid-session | PID liveness check at start of every Live-mode invocation; offer restart |

### 9.3 Idempotency

- Live-mode re-runs are pure reads — always safe.
- One-shot re-run while daemon is up transitions to live mode.
- `--stop` is idempotent: no daemon → verifies clean state.
- JSONL accumulates across sessions until rotation; `--reset-capture` wipes it.

## 10. Testing strategy

TDD, atomic commits, in this order:

1. **`otlp-decoder.test.js`** — fixtures of real OTLP/protobuf and OTLP/JSON
   `ExportTraceServiceRequest` payloads. Round-trip identity for both wire formats;
   malformed body raises a decoder error caught at the boundary.
2. **`capture-store.test.js`** — JSONL append, cursor advance, rotation at size
   boundary, reset-cursor, recovery from corrupted cursor file.
3. **`schema-driven.test.js`** — for every `maven-schema.json` field, two fixtures
   (passing + violating). Predicate evaluator gets focused subset (table-driven test
   with the AND-of-OR clauses from the schema).
4. **`common-mistakes.test.js`** — one fixture per rule in the seed pack. Each has
   good + bad variant; assert which `ruleId` fires and which doesn't.
5. **`report.test.js`** — snapshot-style: feed the formatter known `RuleResult[]`,
   assert markdown matches `tests/fixtures/expected-report.md`.
6. **End-to-end script** (manual, documented in `tests/README.md`): a tiny .NET /
   Node.js / Python "fake agent" that emits one well-formed and one deliberately-
   broken trace via a real A365 SDK, pointed at `http://localhost:4318`. Not run in
   CI (network/dotnet deps); run before each release.

### 10.1 Stop hook

Plain Node.js, no deps, runs in 15s. Greps for `state.json`; if present, asserts
daemon PID is alive AND no production config files (`.env`, `appsettings.json`) were
mutated; if absent, asserts no orphan processes on the configured port.

### 10.2 Eval cases

`evals/agent365/validate-observability/evals.json` covers six scenarios:

1. Clean trace passes (no findings).
2. Missing required field caught.
3. Wrong type caught.
4. S2S CallerDetails missing caught.
5. Scopes-out-of-order caught.
6. JSON-wire-format trace handled identically to protobuf.

## 11. Workflow constraints

- **Branch**: `validate-observability-skill` (already created).
- **Atomic commits**: one logical change per commit. Don't bundle scaffolding +
  daemon + tests into one commit.
- **TDD**: failing test → implementation → commit triples. Applies to validators,
  decoder, capture store, report formatter.

## 12. Open questions (resolve in writing-plans)

1. **Endpoint override mechanism per language.** The A365 SDK is a custom OTel
   exporter; its acceptance of standard OTel env vars vs. an A365-specific override
   key vs. requiring a code-level patch is not documented. Required spike task:
   for each of .NET, Node.js, Python, instrument a minimal agent, set the candidate
   overrides one at a time, and confirm via a localhost listener which one routes
   the OTLP traffic. Document the answer in `references/schema-sync.md` (or a new
   `references/endpoint-override.md`) and update §8.4 step 3 with the verified
   mechanism before any production-shape implementation lands.
2. **Privacy heuristic.** §7.1 row 3 commits to a "best-effort" check on
   `CustomerContent` / `EUII` fields. Concrete heuristic (regex set, allowlists)
   to be picked during implementation. Acceptable level of false-positive needs
   to be calibrated against real captures.

## 13. Out of scope (explicit)

- Pass-through proxy mode.
- Live A365 service validation.
- A GUI / dashboard. Output is markdown to terminal + optional JSON export.
- Token / auth validation. The dev's tokens are unused in offline mode.
- Cross-trace analytics (latency percentiles, error-rate trends). v2 concern.

## 14. References

- Upstream schema: `D:\mvn-mavenservice\docs\maven-schema.json`
- Upstream attribute schema source:
  `D:\mvn-mavenservice\src\MVN\OpenTelemetryContract\Models\MavenAttributes.cs`
- Upstream rule contract:
  `D:\mvn-mavenservice\src\MVN\Kairo\Observability\TelemetryEvaluation\Models\SpanEvalResult.cs`
- Upstream telemetry-eval pipeline:
  `D:\mvn-mavenservice\src\MVN\Kairo\Observability\TelemetryEvaluation\TelemetryEvalCoordinator.cs`
- Sibling skill (config awareness):
  `plugins/agent365/skills/instrument-observability/SKILL.md`
- Sibling skill (local test loop):
  `plugins/agent365/skills/test-local/SKILL.md`
