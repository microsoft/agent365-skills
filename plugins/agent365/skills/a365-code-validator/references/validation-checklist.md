# A365 Code Validator — Reference Checklist

Use this checklist when validating whether an agent can emit telemetry that appears in
Microsoft Admin Center (MAC) Activity.

> **Provenance (verified 2026-07-06):** the resource GUID `9b975845-…`, the `AADSTS*` codes,
> the `Agent365.Observability.OtelWrite` scope, and the license SKU names in §5 and §8 are
> preview-era Agent 365 facts and will change. Re-verify against current onboarding docs before
> quoting them to a customer.

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

## 4. Activity / Run Context

Exporter success alone does not prove a run is eligible for MAC Activity. Validate the
documented Agent 365 activity attributes when the developer expects user-facing activity or
run reporting.

| Attribute | Expectation |
|---|---|
| `gen_ai.agent.name` | Human-readable name for display |
| `gen_ai.conversation.id` | Required; for non-chat/event agents, generate a logical run/job/incident ID |
| `microsoft.channel.name` | Required; use `msteams` for Teams, or a product/source value such as `icm`, `web`, `scheduler` |
| `microsoft.session.id` | Optional but recommended for grouping |
| `user.id` | Human caller OID for `HumanToAgent` |
| `microsoft.agent.user.id` | Agent's own Agent User OID for AI teammate / Agent-User / OBO |
| `gen_ai.input.messages` | Required for `invoke_agent` and `chat` |
| `gen_ai.output.messages` | Required for `invoke_agent`, `chat`, and `output_messages` |
| `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` | Required for `execute_tool` |
| `gen_ai.request.model`, `gen_ai.provider.name` | Required for `chat` |

Run shape should be one root `invoke_agent` span with child `chat`, `execute_tool`, and
`output_messages` spans sharing the same trace ID and using parent span IDs. Autonomous
agents do not need to pretend to be Teams chat, but they still need equivalent logical run
context if Activity/reporting is expected.

Caller identity caveat: for `HumanToAgent`, `user.id` is the caller ID used for "who ran
this agent" reporting. If `user.id` is missing or contains the agent identity / agent user
instead of the human caller object ID, export can still succeed while caller/user Activity is
blank or incomplete.

---

## 5. Endpoint Selection

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

For Python S2S, prefer setting `a365_use_s2s_endpoint=True` in code. Depending on
`A365_USE_S2S_ENDPOINT=true` in environment is more fragile and should be called out.

### How the S2S token is minted (the right shape)

A plain client-credentials call for the observability scope fails with `AADSTS82001`
("agentic application … not permitted to request app-only tokens") — the blueprint can't mint
it directly. The token must come from the **3-hop FMI exchange**, so its principal equals the
runtime Agent Identity:

```text
leg 1: blueprint creds (secret, or MI assertion on Azure) + fmi_path=<agentIdentityAppId>
        -> assertion T1   (scope api://AzureADTokenExchange/.default)
leg 3: authenticate AS the agent identity using T1 as the client assertion
        -> Observability API token (scope api://9b975845-.../.default), azp == agent id, roles:[OtelWrite]
```

Flag S2S code that mints the obs token with a bare `ClientSecretCredential` /
`DefaultAzureCredential` against the observability resource: it yields a token whose principal
is the app/MI, not the agent identity, which the backend rejects (403 — or a 400
`TenantIdInvalid` when no valid token is bound). `AADSTS500011` here instead means the
observability resource SP isn't in the tenant (an onboarding gap, not a code fix).

---

## 6. Permission Inheritance

Current public Entra Agent ID docs describe both `inheritableScopes` and
`inheritableRoles` for Blueprint permissions. Do not state that application roles can never
inherit from Blueprints.

Effective inheritance requires **both**:

1. the resource app is configured in the Blueprint's `inheritablePermissions` collection, and
2. the corresponding delegated scope or application role is actually granted on the Blueprint
   service principal.

The policy alone grants nothing. A `kind=allAllowed` entry with no service-principal grant has
nothing to inherit.

### Read-only live checks

Prefer the a365 CLI over hand-written Graph requests because the CLI resolves the local Blueprint
application/client ID to the Graph application object ID and checks policy plus actual grants:

```bash
a365 query-entra blueprint-scopes
a365 query-entra inheritance
```

| Command | What it proves |
|---|---|
| `blueprint-scopes` | Delegated scopes and application roles actually granted on the Blueprint service principal |
| `inheritance` | `kind=allAllowed` policy plus an effective grant for every configured resource; exits non-zero for `NONE` or `BROKEN` |

If local configuration may be stale or copied, resolve the live Blueprint by name:

```bash
a365 query-entra blueprint-scopes --agent-name "<agent-name>" --tenant-id "<tenant-id>"
a365 query-entra inheritance --agent-name "<agent-name>" --tenant-id "<tenant-id>"
```

Compare the live ID printed by the command with the local `agentBlueprintId`. A different live
Blueprint or a local ID that no longer resolves is a configuration blocker; do not rewrite the
ID automatically.

For observability, verify the grant that matches the auth mode:

- `obo` / `agentic-user`: delegated `Agent365.Observability.OtelWrite`
- `s2s`: application role `Agent365.Observability.OtelWrite`

If Graph returns 401/403, report the check as unavailable due to caller authorization rather
than claiming the Blueprint has no permissions. The list API's least-privileged Graph permission
is `AgentIdentityBlueprint.Read.All`; nonowners also need a supported Entra role such as Agent ID
Administrator.

Inherited permissions aren't listed directly on child agent identities in Entra or Graph. The
platform merges inherited and direct permissions at token issuance, so runtime `scp` / `roles`
claims are the final effective check.

References:

- [List inheritablePermission objects](https://learn.microsoft.com/en-us/graph/api/agentidentityblueprint-list-inheritablepermissions?view=graph-rest-1.0)
- [Configure inheritable permissions for Blueprints](https://learn.microsoft.com/en-us/entra/agent-id/configure-inheritable-permissions-blueprints)
- [Inheritable permissions and required resource access](https://learn.microsoft.com/en-us/entra/agent-id/concept-inheritable-permissions)

---

## 7. Runtime Verification

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

Customer-accessible validation uses SDK/exporter logs, direct OTel `partialSuccess` where
available, and Microsoft Defender Advanced Hunting `CloudAppEvents`. Internal service teams
may additionally use their approved dashboard/playbook, but do not paste internal cluster,
database, endpoint, or correlation details into the validator report.

---

## 8. Common Incident Patterns

| Pattern | Fix |
|---|---|
| Export accepted (200/`sent`) but nothing in MAC | Confirm a user has an M365 E7 / Agent 365 license **assigned** (not just present), and the tenant is Frontier-enrolled |
| Token fails `AADSTS500011` (resource principal not found) | Observability resource SP isn't in the tenant — Frontier/observability onboarding, not a code fix |
| S2S token via bare `ClientSecretCredential` → 403 / `AADSTS82001` | Mint via the 3-hop FMI exchange so the principal == runtime Agent Identity (see §5) |
| Python only passes `enable_a365=True` | Also pass `a365_enable_observability_exporter=True` or set exporter env true |
| Queue/background job calls baggage helper with only `blueprint_id` | Pass the runtime `agent_id` explicitly |
| Testbench works but app does not | Testbench manually emits supported spans; app may only emit generic spans |
| `a365 publish` expected for blueprint observability | Do not use publish; blueprint-based observability is setup + exporter + backend ingest |
| MAC shows agent but Activity empty | Agent registration exists, but telemetry may not have reached reporting under the agent's ObservabilityId |
| Export succeeds but Activity remains empty | Check run context: `conversation.id`, `channel.name`, root `invoke_agent`, message payloads, and span parent/child shape |
| Caller/user activity blank | Check `user.id`; for `HumanToAgent` it must be the human caller's Microsoft Entra object ID |

---

## 9. Report Style

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

Only add detailed evidence when needed. Keep concrete file/function names and redact per the
skill's **Output is support-safe** rule.

The concise report, the "apply safe fixes / make a fix plan / stop" prompt, and the safe-fix
boundaries are owned by `SKILL.md` Phases 5–6 — follow those. This section is only the example shape.
