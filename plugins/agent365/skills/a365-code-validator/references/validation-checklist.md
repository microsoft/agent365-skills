# A365 Code Validator — Reference Checklist

Use this checklist when validating whether an agent can emit telemetry that appears in
Microsoft Admin Center (MAC) Activity.

---

## 1. Exporter Activation

### Python

Required code:

```python
use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
)
```

`enable_a365=True` alone registers A365 processors/enrichment. The exporter is activated by
`a365_enable_observability_exporter=True` or the environment variable:

```text
ENABLE_A365_OBSERVABILITY_EXPORTER=true
```

### Node.js

Required code:

```ts
useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
    tokenResolver,
  },
});
```

### .NET

Required production configuration:

```json
{
  "EnableAgent365Exporter": true
}
```

---

## 2. Identity Binding

The backend enforces three-way binding:

```text
token principal == /agents/{agentId} == gen_ai.agent.id
```

For S2S, the token should be for the runtime Agent Identity / Source Agent ID. Do not use
the Blueprint ID in `/agents/{agentId}` or `gen_ai.agent.id`.

Correct:

```text
gen_ai.agent.id = <runtime Agent Identity / Source Agent ID>
microsoft.a365.agent.blueprint.id = <Blueprint ID>
```

Incorrect:

```text
gen_ai.agent.id = <Blueprint ID>
```

Symptoms:

| Symptom | Likely cause |
|---|---|
| Export rejected for Blueprint ID | Blueprint ID used where the runtime Agent Identity is required |
| Backend accepts export but Activity is empty | Missing semantic spans, unindexed data, or wrong ObservabilityId |
| No backend export record | Exporter disabled or no eligible identity groups |

---

## 3. Supported Semantic Operations

MAC Activity expects A365 semantic operations:

```text
invoke_agent
chat
execute_tool
output_messages
```

Generic HTTP spans are not enough for Activity. They may be useful in raw OTel/App Insights,
but the Activity reporting path can filter them before user-facing reporting.

Look for:

| Stack | Positive signals |
|---|---|
| Python | `InvokeAgentScope`, `InferenceScope`, `ExecuteToolScope`, `gen_ai.operation.name` |
| Node.js | `InvokeAgentScope.start`, `InferenceScope.start`, `ExecuteToolScope.start` |
| .NET | `InvokeAgentScope.Start`, `.UseOpenTelemetry()` on `IChatClient` |

---

## 4. Endpoint Selection

| Auth mode | Structural transport expectation |
|---|---|
| S2S / application | Service-to-service export mode; token principal is the runtime Agent Identity |
| OBO / delegated / agentic-user | Delegated export mode; delegated token carries observability write scope |

S2S also requires an Observability API token with:

```text
roles contains Agent365.Observability.OtelWrite
```

OBO / agentic-user uses:

```text
scp contains Agent365.Observability.OtelWrite
```

---

## 5. Runtime Verification

SDK logs should show:

```text
identity groups >= 1
Obtained token for agent <agentId>
Sending export batch for agent <agentId>
HTTP 200 exporting spans
```

Bad signs:

```text
0 identity groups
No eligible genAI spans
No token returned
401 / 403
```

Backend telemetry should show accepted exports for the runtime Agent Identity and delivered
downstream reporting. Use the service team's approved dashboard or telemetry playbook; do not
paste internal cluster, database, endpoint, or correlation details into the validator report.

---

## 6. Common Incident Patterns

| Pattern | Fix |
---|---|
| Python only passes `enable_a365=True` | Also pass `a365_enable_observability_exporter=True` or set exporter env true |
| Queue/background job calls baggage helper with only `blueprint_id` | Pass the runtime `agent_id` explicitly |
| Testbench works but app does not | Testbench manually emits supported spans; app may only emit generic spans |
| `a365 publish` expected for blueprint observability | Do not use publish; blueprint-based observability is setup + exporter + backend ingest |
| MAC shows agent but Activity empty | Agent registration exists, but telemetry may not have reached reporting under the agent's ObservabilityId |

---

## 7. Report Style

Default report should be short and action-oriented:

```markdown
**Status:** BLOCKED

**Blockers**
1. **Exporter not enabled** — spans may be enriched but not exported.
   Fix: enable the explicit exporter flag or runtime env.
2. **Wrong agent identity** — runtime spans may use Blueprint ID instead of Agent Identity.
   Fix: pass the runtime Agent Identity as `agent_id`; keep Blueprint ID only as metadata.
3. **Semantic spans missing** — generic HTTP spans may not populate Activity.
   Fix: add/confirm `invoke_agent`, `chat`, `execute_tool`, `output_messages`.

**Fix order:** token/identity → exporter flag → S2S/OBO mode → semantic spans → backend verification.
```

Only add detailed evidence when needed. Keep concrete file/function names; avoid internal
infrastructure details, real tenant IDs, real agent IDs, correlation IDs, or backend route paths.

After the concise report, always offer:

```text
Do you want me to apply safe fixes, make a fix plan, or stop here?
```

Do not edit until the user chooses a fix option. Safe fixes are limited to deterministic changes
such as enabling the exporter flag, adding non-secret config placeholders, and wiring an existing
runtime agent identity config value into baggage. Token-service implementation and semantic span
wrapping require a second explicit confirmation because they are design changes.
