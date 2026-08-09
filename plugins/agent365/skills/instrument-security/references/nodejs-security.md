# Node.js — Defender prevention implementation

Implementation of the `security/` layer for a Node.js / TypeScript Agent 365
agent. Read [defender-webhook.md](defender-webhook.md) first for the endpoint
contract, identity model, and AISession rules.

> ⚠️ **Status: best-effort.** The protocol and auth layers below are direct ports
> of a flow verified end-to-end against the live dev endpoint, and the wire
> contract is language-agnostic — those parts are high confidence. The
> **hook wiring in §5 has not been verified against a running Node.js agent.**
> Mark generated adapter code with
> `// A365 Security — best-effort wiring (verify against SDK source before production)`
> and smoke-test before relying on it to block anything.

The code splits into two layers:

| Layer | Files | Framework-specific? |
|---|---|---|
| Core | `config.ts`, `entra-auth.ts`, `ai-session.ts`, `defender-client.ts` | No |
| Adapter | `adapters/<framework>.ts` | Yes |

---

## 1. npm packages

```bash
npm install @azure/msal-node
```

`fetch` is built in on Node 18+. No A365-specific package is required —
prevention talks plain HTTPS + Entra.

---

## 2. `security/config.ts`

```typescript
// A365 Security — added by instrument-security skill

// Defender third-party prevention endpoint. Override with DEFENDER_WEBHOOK_URL.
export const DEFENDER_ENDPOINT =
  "https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze";

// The prevention resource the access token is issued FOR — the first-party
// "Defender for AI Prevention Webhook" application.
//
// Note the identifier URI is an https:// form, NOT api:// — requesting
// api://86a21212-.../.default fails with AADSTS500011 even when the service
// principal is present, because that URI is not one of the SP's names.
export const PREVENTION_RESOURCE_APP_ID = "86a21212-634e-4553-b3d6-e477e4c9d9ec";
export const PREVENTION_SCOPE = "https://rtp-a365.ai.defender.microsoft.com/.default";

// Application role the agent identity must hold to call the prevention endpoint.
// Granted to the Agent Identity service principal, not the blueprint.
export const PREVENTION_APP_ROLE = "AIAgentsRTP.ToolInvocation";

// The four inspection points supported. Platform adapters map their native
// hooks onto these names.
export const ALL_HOOKS = ["before_agent", "after_agent", "before_tool", "after_tool"] as const;
export type Hook = (typeof ALL_HOOKS)[number];

export interface SecurityConfig {
  enabled: boolean;
  url: string;
  scope: string;
  failClosed: boolean;
  timeoutMs: number;
  maxContentChars: number;
  hooks: Set<Hook>;
  tenantId: string;
  agentId: string;
  blueprintId: string;
  clientId: string;
  clientSecret: string;
  useManagedIdentity: boolean;
  agentObjectId: string;
  platformAgentId: string;
  platformType: string;
}

const truthy = (v: string | undefined, dflt = false): boolean =>
  v === undefined ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export function getConfig(): SecurityConfig {
  const hooksRaw = process.env.DEFENDER_HOOKS;

  return {
    enabled: truthy(process.env.DEFENDER_PREVENTION_ENABLED, true),
    url: process.env.DEFENDER_WEBHOOK_URL || DEFENDER_ENDPOINT,
    // Override only — falls back to the shipped constant. Deriving
    // api://<appId>/.default here would break with AADSTS500011.
    scope: process.env.DEFENDER_WEBHOOK_SCOPE || PREVENTION_SCOPE,
    failClosed: (process.env.DEFENDER_FAIL_MODE ?? "open").toLowerCase() === "closed",
    timeoutMs: Number(process.env.DEFENDER_TIMEOUT_SECONDS ?? 10) * 1000,
    maxContentChars: Number(process.env.DEFENDER_MAX_CONTENT_CHARS ?? 20000),
    hooks: new Set(
      (hooksRaw ? hooksRaw.split(",").map((h) => h.trim()) : [...ALL_HOOKS]) as Hook[],
    ),
    tenantId: process.env.AGENT365_TENANT_ID ?? "",
    agentId: process.env.AGENT365_AGENT_ID ?? "",
    blueprintId: process.env.AGENT365_BLUEPRINT_ID ?? "",
    clientId: process.env.AGENT365_CLIENT_ID ?? "",
    clientSecret: process.env.AGENT365_CLIENT_SECRET ?? "",
    useManagedIdentity: truthy(process.env.AGENT365_USE_MANAGED_IDENTITY),
    agentObjectId: process.env.AGENT365_AGENT_OBJECT_ID ?? "",
    platformAgentId: process.env.AGENT365_PLATFORM_AGENT_ID ?? "",
    platformType: process.env.AGENT365_PLATFORM_TYPE ?? "",
  };
}
```

---

## 3. `security/entra-auth.ts` — FMI 3-hop chain

The agent authenticates as **itself**. The blueprint credential is only the start
of the chain; the token that reaches Defender carries the Agent Identity in
`azp`/`oid`.

```
Blueprint (client secret or managed identity)
  └─ Hop 1+2: client_credentials + fmi_path=<agentId> → FMI assertion
     └─ Agent Identity
        └─ Hop 3: client_assertion → prevention token
```

> ⚠️ **MSAL Node does not serialize `fmiPath`.** Hops 1+2 must POST the token
> endpoint directly with an `fmi_path` form parameter. Only hop 3 uses MSAL.
> This is a client-library gap, not a service one — the same request succeeds
> when the parameter is sent by hand.

```typescript
// A365 Security — added by instrument-security skill
import { ConfidentialClientApplication } from "@azure/msal-node";
import { getConfig, type SecurityConfig } from "./config.js";

const FMI_SCOPE = "api://AzureADTokenExchange/.default";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

let cachedToken = "";
let cachedExpiry = 0;
let inFlight: Promise<string> | null = null;

/** Hops 1+2 — direct POST because MSAL Node drops fmi_path. */
async function acquireFmiAssertion(cfg: SecurityConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId || cfg.blueprintId,
    client_secret: cfg.clientSecret,
    scope: FMI_SCOPE,
    fmi_path: cfg.agentId,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  if (!res.ok) {
    throw new Error(`FMI token request failed: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/**
 * Returns a bearer token for the prevention endpoint, or "" on any failure.
 * NEVER throws — an auth outage must not take the agent down; the caller
 * applies the configured fail mode instead.
 */
export async function getDefenderToken(cfg: SecurityConfig = getConfig()): Promise<string> {
  if (cachedToken && Date.now() < cachedExpiry - EXPIRY_BUFFER_MS) return cachedToken;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (!cfg.tenantId || !cfg.agentId) {
        console.warn("[defender] prevention identity not configured; token unavailable");
        return "";
      }

      const assertion = await acquireFmiAssertion(cfg);

      // Hop 3 — agent identity presents the assertion for the prevention token.
      const agentApp = new ConfidentialClientApplication({
        auth: {
          clientId: cfg.agentId,
          authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
          clientAssertion: assertion,
        },
      });

      const result = await agentApp.acquireTokenByClientCredential({
        scopes: [cfg.scope],
      });

      if (!result?.accessToken) return "";

      cachedToken = result.accessToken;
      cachedExpiry = result.expiresOn?.getTime() ?? Date.now() + 55 * 60 * 1000;
      console.info(`[defender] prevention token acquired for agent ${cfg.agentId}`);
      return cachedToken;
    } catch (err) {
      console.warn("[defender] prevention token acquisition failed:", err);
      return "";
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function resetCache(): void {
  cachedToken = "";
  cachedExpiry = 0;
}
```

A token without a `roles` claim containing `AIAgentsRTP.ToolInvocation` means the
app role was never granted — see the SKILL's grant phase. The call will still be
made and will fail authorization at the webhook.

---

## 4. `security/defender-client.ts`

The JSON contract is identical across languages — see
[defender-webhook.md](defender-webhook.md) §3 for the full schema and the rules
that are easy to get wrong (`sessionContext` must be non-null; `environment.agent.id`
must set the `a365` case; omit `entra` unless a non-empty `objectId` is configured).

```typescript
// A365 Security — added by instrument-security skill
import { getConfig, type SecurityConfig } from "./config.js";
import { getDefenderToken } from "./entra-auth.js";

export interface DefenderDecision {
  block: boolean;
  reason?: string;
  evaluated: boolean;
}

/**
 * Evaluates a session. NEVER throws — transport, auth, and protocol errors are
 * folded into a decision whose `block` value follows the fail mode.
 */
export async function evaluate(
  session: unknown,
  cfg: SecurityConfig = getConfig(),
): Promise<DefenderDecision> {
  if (!cfg.enabled) return { block: false, evaluated: false };

  try {
    const token = await getDefenderToken(cfg);
    if (!token) {
      return { block: cfg.failClosed, reason: "no prevention token", evaluated: false };
    }

    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(session),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) {
      // 401/403 here usually means the app role is missing or the webhook has
      // not allow-listed this resource yet.
      console.warn(`[defender] prevention returned ${res.status}`);
      return { block: cfg.failClosed, reason: `http ${res.status}`, evaluated: false };
    }

    return parseDecision(await res.json());
  } catch (err) {
    console.warn("[defender] prevention call failed:", err);
    return { block: cfg.failClosed, reason: String(err), evaluated: false };
  }
}
```

See [defender-webhook.md](defender-webhook.md) §4 for the verdict shape
`parseDecision` must handle, including the fail-open case where the response
carries no verdicts at all.

---

## 5. Wiring the hooks

> ⚠️ **Best-effort from here down.** Verify against the SDK before production.

Node.js A365 agents do not expose the same four-callback surface Google ADK does.
Map the inspection points onto whichever of these the agent actually uses:

| Inspection point | Likely seam |
|---|---|
| `before_agent` | Top of the `onMessage` / activity handler, before invoking the model |
| `after_agent` | Immediately before `sendActivity` — replace the outgoing text on block |
| `before_tool` | A wrapper around the tool/function executor, or LangChain `handleToolStart` |
| `after_tool` | The same wrapper, on the returned result |

Two rules that carry over from the verified implementation and are not optional:

1. **Compose, don't append.** If a hook already exists, wrap it rather than
   registering a second one — with any first-wins dispatch, appending after a
   handler that already returns a value silently disables prevention.
2. **Blocking must short-circuit before the side effect.** A `before_tool` check
   that runs after the tool has executed is not prevention, it is logging.

Preserve any existing observability anchors (`BaggageBuilder`, `InvokeAgentScope`)
when editing a shared handler — do not restructure them out.

---

## 6. `.env`

```bash
# ── Microsoft Defender prevention (Security for AI) ──
DEFENDER_PREVENTION_ENABLED=true
DEFENDER_FAIL_MODE=open
DEFENDER_HOOKS=before_agent,after_agent,before_tool,after_tool
DEFENDER_TIMEOUT_SECONDS=10
DEFENDER_MAX_CONTENT_CHARS=20000
```

Identity values are reused from the existing A365 setup and are not re-declared
here: `AGENT365_TENANT_ID`, `AGENT365_AGENT_ID`, `AGENT365_BLUEPRINT_ID`,
`AGENT365_CLIENT_ID`, `AGENT365_CLIENT_SECRET`, `AGENT365_USE_MANAGED_IDENTITY`.

---

## 7. Verifying

1. Confirm the token carries the role — decode it and check `roles` contains
   `AIAgentsRTP.ToolInvocation`. No role means the grant phase did not complete.
2. Send a benign turn; confirm the agent behaves exactly as before.
3. Send a turn that should trip a rule; confirm the block path replaces the
   response and the tool never runs.
4. Confirm a forced failure (bad URL) follows the configured fail mode rather
   than throwing.
