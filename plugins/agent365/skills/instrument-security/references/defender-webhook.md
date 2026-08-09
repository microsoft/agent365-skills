# Defender prevention webhook — contract, identity, and AISession mapping

Authoritative reference for the `instrument-security` skill. Endpoint behavior,
authentication, and payload shape live here; the platform adapters live in the
per-platform reference docs.

---

## 1. Endpoint

`POST {base}/tp/v1/protection/analyze`

| Environment | Base URL |
|---|---|
| Dev | `https://prevention.thirdparty.dev.ai.defender.microsoft.com` |
| Staging | `https://prevention.thirdparty.stg.ai.defender.microsoft.com` |
| Prod | `https://prevention.thirdparty.ai.defender.microsoft.com` |

### Request

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <Entra access token>` |
| `x-ms-correlation-id` | Correlation id echoed back on the response. Use the agent's invocation/session id so one id joins agent traces and Defender telemetry. |

Body: a Security4AI **`AISession`** in protobuf-JSON form. The third-party
endpoint performs **no normalization** — the session is validated and handed
straight to the prevention engine. Unknown fields are ignored, so a newer client
does not break on an older deployment.

### Response — `200 OK`

```json
{
  "blockAction": true,
  "reasonCode": 403,
  "reason": "An AI agent attempted, during tool invocation, to communicate with domains matching known threat indicators.",
  "diagnostics": "Detected threat types: MaliciousContentPropagation; MaliciousUrl: https://test.security.dfai.microsoft.com"
}
```

| Field | Meaning |
|---|---|
| `blockAction` | **The verdict.** `true` = the caller must block the inspected action. |
| `reasonCode` | Numeric decision code (e.g. `200` allow, `403` block). |
| `reason` | Human-readable explanation — surface this to the model/user. |
| `diagnostics` | Optional detail (threat types, matched indicator). |

Other statuses: `400` malformed/invalid AISession, `401`/`403` authentication or
authorization failure, `500` evaluation error. **None of these are a verdict** —
treat them as "no verdict obtained" and apply the configured fail mode.

---

## 2. Authentication — the agent's own Entra identity

The agent authenticates as **itself**, using an FMI 3-hop chain. The blueprint
credential only starts the chain; the token that reaches the webhook carries the
Agent Identity, so every verdict is attributable to the specific agent that asked
for it. There is no gateway, no delegation, and no app allow-list — authorization
is by app role.

| | Value |
|---|---|
| Resource | `86a21212-634e-4553-b3d6-e477e4c9d9ec` (`Defender for AI Prevention Webhook`) |
| Scope | `https://rtp-a365.ai.defender.microsoft.com/.default` |
| App role | `AIAgentsRTP.ToolInvocation` |
| Role grant | manual today — see the grant phase |

> ⚠️ **The prevention scope is the `https://` form, not `api://`.** Most A365
> scopes follow the `api://<app-id>/.default` convention, so deriving it from the
> app id is the natural guess — and it fails with `AADSTS500011` *even when the
> service principal exists*, because that URI is not in the resource's
> `servicePrincipalNames`. The error reads like a missing SP and will send you
> down the wrong path.

`make-a365-agent` / `a365 setup all` provisions two Entra objects:

| Object | Value in `a365.generated.config.json` | Role |
|---|---|---|
| Blueprint app | `agentBlueprintId` | Holds the credential (secret or MSI) |
| Agent Identity | `agenticAppId` | The agent's own identity — what Defender should see |

Prevention authenticates as the **Agent Identity** using an FMI 3-hop chain:

```
Blueprint (client secret or managed identity)
  └─ Hop 1+2: POST /oauth2/v2.0/token
             grant_type=client_credentials
             client_id=<blueprint app id>
             scope=api://AzureADTokenExchange/.default
             fmi_path=<agenticAppId>            ← MSAL does not serialize this;
                                                   post the token endpoint directly
     └─ Agent Identity
        └─ Hop 3: MSAL ConfidentialClientApplication(
                      client_id=<agenticAppId>,
                      client_credential={"client_assertion": <hop-1+2 token>})
                  .acquire_token_for_client(scopes=["api://<resource>/.default"])
```

The resulting token carries the agent's identity:

```
aud   86a21212-634e-4553-b3d6-e477e4c9d9ec   ← WHAT is being called (raw app id)
azp   <agenticAppId>       ← WHO is calling — the agent (v2 token: azp, not appid)
oid   <agent identity object id>
tid   <tenant>
roles ["AIAgentsRTP.ToolInvocation"]         ← authorization
```

`aud` and `azp` answer different questions and must not be conflated. The scope only
sets `aud`; the caller identity always comes from the FMI chain above.

> ⚠️ **A 403 with a valid `roles` claim is not your bug.** This is an AAD v2 token, so
> the caller appears in `azp` and `appid` is absent. Webhook-side code that reads only
> `appid` leaves every legitimate caller unidentified and 403s it. Nothing in the agent
> can fix that; check the token has `roles`, then hand it to whoever owns the webhook.

> ⚠️ **Not granted by `a365 setup all` yet.** The CLI has no step for the prevention
> role, so `make-a365-agent` Phase 2.4 performs three operations: (1)
> `az ad sp create --id 86a21212-…` so the resource exists in the tenant (else
> `AADSTS500011`), (2)
> `a365 setup permissions custom --resource-app-id 86a21212-… --scopes AIAgentsRTP.ToolInvocation`
> for inheritable permissions, and (3) an app role assignment on the **blueprint** service
> principal. Verified: with only (1)+(2) the token has **no `roles` claim** — inheritable
> permissions are not a grant. Granting on the blueprint (not the agent identity) makes
> every agent minted from it inherit the role. The durable fix is for the A365 CLI to
> perform this grant at provisioning time; the CLI ships as an external NuGet tool, so
> it cannot be changed from these repositories.

Cache the token in-process until shortly before `exp`; every hook otherwise pays
a token round trip.

### Authorization

The token must carry the app role `AIAgentsRTP.ToolInvocation` in its `roles` claim. The
server checks it with OR semantics over a configured list.

**One caller shape only.** An agent calls with its own Entra identity and is authorized by
the role. There is no gateway/delegation path and no app allow-list: the server binds
`environment.agent.id.entra.objectId` to the token's `oid` and rejects a body that names a
different agent principal, so an application can only report activity for itself.

> `AIAgentsRTP.ToolInvocation` is an existing role adopted so the path works today. A
> dedicated role for the A365 SDK prevention flow should replace it, letting prevention
> access be granted and revoked independently of tool invocation. Grants bind by role *id*,
> so run both values during the migration.

### Alternative modes

| Mode | When | Trade-off |
|---|---|---|
| `agent-identity` (default) | Agent Identity exists and has the prevention resource granted | Verdicts bind to a real agent |
| `blueprint` | Per-agent identity not yet granted the resource | Calls attribute to the Blueprint app, not the individual agent |
| `federated` | Host cannot hold a secret (e.g. GCP/AWS workload identity) | Certificate-free; requires a federated credential on the app trusting the platform OIDC issuer + subject |

For `federated` on Google Cloud, the runtime service account's Google-signed ID
token (audience `api://AzureADTokenExchange`, from the metadata server) is used
directly as the Entra `client_assertion` — Google is already a public OIDC issuer,
so no KMS key or self-hosted JWKS is required.

### Permissions

The Agent Identity must be granted the prevention resource, and the webhook must
list that audience as authorized. Grants require a **Global Administrator**;
`a365 setup all` prints the consent script when the developer is not a GA. A skill
must never attempt to grant permissions itself.

Diagnosing failures:

| Symptom | Cause |
|---|---|
| `AADSTS500011` (resource principal not found) | The prevention resource has no service principal in the tenant, or the scope app id is wrong |
| `AADSTS65001` / no consent | The blueprint has not been granted the resource |
| `401` from the webhook | Token audience is not in the webhook's authorized applications |
| `403` from the webhook | Tenant not registered / consent not granted for the calling tenant |

---

## 3. AISession payload

Schema: `Security4AI.Schema` (`session.proto`, `activity.proto`,
`environment.proto`, `common.proto`, `message.proto`).

### Skeleton

```jsonc
{
  "environment":  { "agent": { "id": {...}, "identity": {...}, "tools": [...] } },
  "callerIdentity": { "tenantId": "...", "appId": "...", "userAgent": "..." },
  "sessionContext": { "a365": { "id": "<session or invocation id>" } },
  "activities":  [ { /* exactly one activity — see §3.2 */ } ],
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### 3.1 Agent identity — the three-part `environment.agent.id`

```jsonc
"id": {
  // REQUIRED. Agent identity is still resolved from this deprecated oneof;
  // a session without foundry/copilot_studio/a365 set is rejected.
  "a365": {
    "id": "<agenticAppId>",
    "name": "<agent name>",
    "tenantId": "<tenant>",
    "blueprintId": "<agentBlueprintId>"
  },
  // OPTIONAL — include ONLY with a non-empty objectId. An empty objectId is
  // invalid. When omitted, the webhook stamps it from the token's `oid`.
  "entra": {
    "tenantId": "<tenant>",
    "objectId": "<agent identity object id>",
    "blueprintId": "<agentBlueprintId>"
  },
  // Modern platform identity.
  "platform": {
    "type": "CUSTOM_BUILT_AGENTS_USING_SDK",
    "id": "<id the host knows the agent by>",
    "name": "<agent name>"
  }
}
```

`AgentPlatformType` values: `DECLARATIVE_AGENT`, `COPILOT_STUDIO`,
`CUSTOM_BUILT_AGENTS_USING_SDK`, `AZURE_AI_FOUNDRY`, `TIPS`.

### 3.2 One activity per inspection point

`AIActivity` is a oneof. Send exactly the activity being inspected.

| Inspection point | Activity | Key fields |
|---|---|---|
| Before agent | `agentRequest` | `messages[]` with `role: MESSAGE_ROLE_USER` |
| After agent | `agentResponse` | `messages[]` with `role: MESSAGE_ROLE_ASSISTANT` |
| Before tool | `toolRequest` | `toolName`, `toolCallId`, `toolType`, `structuredArguments` |
| After tool | `toolResponse` | `toolName`, `toolCallId`, and **one of** `text` \| `structuredData` |

Every activity requires `context` (use `{"a365": {}}`) and `timestamp`.

Message shape:

```jsonc
{ "role": "MESSAGE_ROLE_USER", "content": [ { "text": "..." } ] }
```

Roles: `MESSAGE_ROLE_SYSTEM`, `MESSAGE_ROLE_DEVELOPER`, `MESSAGE_ROLE_USER`,
`MESSAGE_ROLE_ASSISTANT`, `MESSAGE_ROLE_TOOL`.

### 3.3 Rules that cause silent failure when broken

| Rule | Consequence if broken |
|---|---|
| `sessionContext` must be non-null | Engine logs "SessionContext cannot be null" and **fails open** — everything is allowed while appearing wired |
| `environment.agent.id` must set the `a365`/`foundry`/`copilot_studio` oneof | Session rejected: "Expected valid $AgentIdentifier case, but received: None" |
| `entra.objectId` must be non-empty when `entra` is present | Session rejected |
| At least one activity, with its oneof set | `400` |
| `evaluationPolicy.type` must be `EVALUATION_POLICY_TYPE_BLOCKING` | Detections may be recorded without producing an enforceable verdict |

Truncate large content before sending, and recursively clamp long strings inside
structured tool results — one oversized tool response should not fail the whole
evaluation.

---

## 4. Enforcement and failure policy

Two distinct outcomes must never be conflated:

1. **A verdict was obtained** (`200` + `blockAction`). Honor it.
2. **No verdict** (auth failure, timeout, `4xx`/`5xx`, non-JSON). Apply the fail
   mode:
   - **fail open** — allow. A prevention outage cannot take the agent down.
   - **fail closed** — block, with a message that says validation was
     *unavailable*, not that content was malicious.

Log both cases with the correlation id, HTTP status, latency, and an `evaluated`
flag. Without `evaluated`, a masked auth failure under fail-open is
indistinguishable from a genuine allow — the single most misleading state this
integration can be in.

Blocking must produce a **readable** message that includes `reason` (and
`diagnostics` when present), so the user learns why. A bare boolean or silent
drop leaves the model to invent an explanation.

---

## 5. Server-side expectations

The prevention webhook binds the call to the authenticated token rather than
trusting the body:

- Tenant is taken from the token's `tid`; a conflicting tenant anywhere in the body
  is rejected (`403`) rather than honored.
- `callerIdentity.appId` / `entraObjectId` are stamped from `appid`/`azp` and `oid`.
- `environment.agent.id.entra.objectId` is set from the token's `oid` — always. The caller
  *is* the agent, so a body naming a different agent principal is rejected (`403`).
- Authorization is the `AIAgentsRTP.ToolInvocation` app role. There is no app allow-list
  and no gateway delegation path.

Consequently, identity fields sent by the agent are correlation hints — never a
trust boundary. Send the agent id you know (`a365` / `platform`) and leave
`entra.objectId` to the webhook.
