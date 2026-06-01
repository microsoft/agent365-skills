# Node.js — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Node.js agent. Aligned with `@microsoft/opentelemetry` **GA 1.0.x** (updated 2026-05-11).

> **Major shift from earlier 0.x:** the three legacy packages
> (`@microsoft/agents-a365-observability`, `@microsoft/agents-a365-observability-hosting`,
> `@microsoft/agents-a365-runtime`) are **deprecated**. Everything ships from a single
> package now: `@microsoft/opentelemetry`. See `MIGRATION_A365.md` in the distro repo
> for the authoritative migration guide.
>
> **Sample-lag note (2026-05):** `Agent365-Samples/nodejs/langchain/sample-agent` has migrated to `@microsoft/opentelemetry` and matches the patterns in this reference. `Agent365-Samples/nodejs/openai/sample-agent` still imports from the legacy `@microsoft/agents-a365-observability*` packages as of this writing — the skill direction (unified `@microsoft/opentelemetry`) is forward-looking. If a user's project already has the legacy imports from following the OpenAI sample literally, the skill should migrate them to `@microsoft/opentelemetry` during the wiring step rather than co-existing.

---

## npm Packages

| Package | Purpose |
|---------|---------|
| `@microsoft/opentelemetry` (1.0.x GA) | Sole entry point. Re-exports `useMicrosoftOpenTelemetry`, `shutdownMicrosoftOpenTelemetry`, `configureA365Hosting`, `BaggageBuilder`, `BaggageMiddleware`, `ObservabilityHostingManager`, `AgenticTokenCacheInstance`, `AgenticTokenCache`, `Agent365Exporter`, `A365SpanProcessor`, all scope types (`InvokeAgentScope`, `InferenceScope`, `ExecuteToolScope`, `OutputScope`), and all contract types (`AgentDetails`, `CallerDetails`, `UserDetails`, `InvokeAgentScopeDetails`, etc.) |
| `@azure/msal-node` (^3.6.0) | MSAL `ConfidentialClientApplication` with `fmiPath` for the FMI token chain (S2S only) |
| `@azure/identity` (^4.6.0) | `ManagedIdentityCredential` for MSI-based token acquisition (S2S only) |
| `@opentelemetry/resources` (^1.x) | `resourceFromAttributes({ "service.name": ... })` |

Install:
```bash
# Required for all agents
npm install @microsoft/opentelemetry @opentelemetry/resources

# Required for S2S only
npm install @azure/msal-node @azure/identity
```

> **No version pin needed.** `@microsoft/opentelemetry` is GA — install latest. `@opentelemetry/resources` is pulled in transitively by `@microsoft/opentelemetry`, but is listed here explicitly because the entry-point examples below import `resourceFromAttributes` from it (TS/module resolution can fail if it's not declared as a direct dep).

Minimum Node.js: **20.6.0** (required for ESM `--import` flow). TypeScript: **5.x** recommended.

---

## Auth Mode Mapping

The agent's `authMode` (read from `.a365-workspace-detection.local.json`) determines which path to wire. The code shape is **identical** for `obo` and `agentic-user` — only the identity the token exchange returns differs. `s2s` uses a completely separate token-service scaffold.

| `authMode` | Used by | Token mechanism | Identity in traces | Wiring | Per-turn token refresh |
|---|---|---|---|---|---|
| `agentic-user` | AI Teammate (always) | OBO exchange | Agent's own M365 identity (Agentic User — UPN, mailbox) | `AgenticTokenCacheInstance` | ✅ Call `refreshObservabilityToken` (camelCase in GA 1.0+) |
| `obo` | Non-AI Teammate | OBO exchange | Whatever the configured auth handler resolves — typically the signed-in user, but can also be the agent's own identity | `AgenticTokenCacheInstance` | ✅ Call `refreshObservabilityToken` |
| `s2s` | Non-AI Teammate | Service principal client credentials (no token exchange) | Agent Identity SP — no user context | Custom `tokenResolver` + background FMI token service | ❌ Do NOT call `refreshObservabilityToken` |

> AI Teammate is **always** `agentic-user` — no question is asked. Non-AI Teammate agents are asked at setup whether they want `obo` or `s2s`.
>
> Note: "OBO" describes the **token exchange mechanism**, not who the agent acts as. Both `obo` and `agentic-user` use OBO under the hood — they differ only in which identity the configured Azure AD auth handler returns. `s2s` does not use OBO at all.

---

## Entry Point — Observability Init (before any LLM imports)

Initialize the unified distro **before** importing the rest of your app so OpenAI Agents
and LangChain auto-instrumentation can patch their target libraries.

### OBO / agentic-user (same code; identity decided by the auth handler)

```typescript
// A365 Observability — best-effort instrumentation (verify against official sample)
// index.ts — must be called BEFORE importing other modules
import { configDotenv } from 'dotenv';
configDotenv();

import {
  useMicrosoftOpenTelemetry,
  AgenticTokenCacheInstance,
} from '@microsoft/opentelemetry';
import { resourceFromAttributes } from '@opentelemetry/resources';

useMicrosoftOpenTelemetry({
  // Console exporter floods prod logs — gate on NODE_ENV and Azure App Service's
  // WEBSITE_SITE_NAME (the canonical "running on Azure" signal). True in local dev,
  // false in any deployed environment.
  enableConsoleExporters: process.env.NODE_ENV !== 'production' && !process.env.WEBSITE_SITE_NAME,
  resource: resourceFromAttributes({
    'service.name': process.env.SERVICE_NAME ?? 'my-agent',
  }),
  a365: {
    // BOTH flags are required for spans to reach the A365 backend in GA 1.0+:
    //   - enabled: true                       → registers A365SpanProcessor (enrichment only)
    //   - enableObservabilityExporter: true   → registers Agent365Exporter (actually sends spans)
    // Setting only `enabled: true` means spans get baggage enrichment but are NEVER exported.
    // (You can equivalently set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env instead of
    // the code flag — but at least one of the two must be true or no spans reach MAC.)
    enabled: true,
    enableObservabilityExporter: true,
    tokenResolver: (agentId, tenantId) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId) ?? '',
  },
  // Framework-specific opt-ins. Include for agents that use LangChain.
  instrumentationOptions: { langchain: {} },
});
```

> **Exporter activation (GA 1.0+):** TWO toggles are involved and BOTH must resolve to true:
> - `a365.enabled: true` (code) → registers the `A365SpanProcessor` for baggage/attribute enrichment. **Without export.**
> - `a365.enableObservabilityExporter: true` (code) **OR** `ENABLE_A365_OBSERVABILITY_EXPORTER=true` (env, auto-stamped by `a365 setup all`) → registers the `Agent365Exporter`. **This is what actually sends spans to MAC.**
>
> Setting only `enabled: true` is the #1 silent-failure mode: spans get processed but never exported. Always emit BOTH flags in generated code (or rely on the env var stamp). Source: [A365ConfigurationOptions.ts](https://github.com/microsoft/opentelemetry-distro-javascript/blob/main/src/a365/configuration/A365ConfigurationOptions.ts).

> **OpenAI Agents / LangChain auto-instrumentation is now ON by default.**
> Do NOT call `OpenAIAgentsTraceInstrumentor.enable()` or
> `LangChainTraceInstrumentor.instrument()` — manual calls now produce **duplicate spans**.
> To opt out: `instrumentationOptions: { openaiAgents: { enabled: false }, langchain: { enabled: false } }`.

> **Non-GenAI instrumentations** (HTTP, DB, etc.) are **disabled by default** when
> `a365.enabled: true`. Opt them back in via
> `instrumentationOptions: { http: { enabled: true } }` etc.

### S2S (`authMode: s2s`)

S2S uses the **3-hop FMI (Federated Managed Identity) token chain**:

```
Blueprint (client_credentials / MSI)
  → Hop 1+2: FMI token (api://AzureADTokenExchange/.default with fmiPath=agentId)
    → Agent Identity token
      → Hop 3: Observability API token (scope=api://9b975845-388f-4429-889e-eab1ef63949c/.default)
```

> **`useS2SEndpoint` is now a first-class option** (fixed in 1.0). The old workaround
> (hand-rolling `Agent365Exporter` via `spanProcessors` and forcing
> `ENABLE_A365_OBSERVABILITY_EXPORTER=false`) is **no longer required and should be removed**.

```typescript
// authMode: s2s — service principal, no user OBO.
import { configDotenv } from 'dotenv';
configDotenv();

import {
  useMicrosoftOpenTelemetry,
  shutdownMicrosoftOpenTelemetry,
} from '@microsoft/opentelemetry';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { AgentDetails, CallerDetails, UserDetails } from '@microsoft/opentelemetry';

import { tokenResolver } from './observability/token-cache';
import { startTokenService } from './observability/observability-token-service';

// ── Configuration ────────────────────────────────────────────────────────────
const TENANT_ID = process.env.AGENT365_TENANT_ID || '';
const AGENT_ID = process.env.AGENT365_AGENT_ID || '';
const BLUEPRINT_ID = process.env.AGENT365_BLUEPRINT_ID || '';
const CLIENT_ID = process.env.AGENT365_CLIENT_ID || '';
const CLIENT_SECRET = process.env.AGENT365_CLIENT_SECRET || '';
const AGENT_NAME = process.env.AGENT365_AGENT_NAME || 'my-agent';
const AGENT_DESCRIPTION = process.env.AGENT365_AGENT_DESCRIPTION || '';
const SPONSOR_USER_ID = process.env.agent365Observability__sponsorUserId || CLIENT_ID || '';
const SPONSOR_USER_NAME = process.env.agent365Observability__sponsorUserName || AGENT_NAME;
const SPONSOR_USER_EMAIL = process.env.agent365Observability__sponsorUserEmail || '';
const USE_MANAGED_IDENTITY = (process.env.AGENT365_USE_MANAGED_IDENTITY || 'true').toLowerCase() === 'true';

function hasA365Credentials(): boolean {
  const requiredValues = [TENANT_ID, AGENT_ID, CLIENT_ID];
  const hasRequired = requiredValues.every(v => v && !v.startsWith('<<'));
  if (!hasRequired) return false;
  if (USE_MANAGED_IDENTITY) return true;
  return !!CLIENT_SECRET && !CLIENT_SECRET.startsWith('<<');
}

const A365_ENABLED = hasA365Credentials();

// ── Agent Details (shared across all scopes) ─────────────────────────────────
export const agentDetails: AgentDetails = {
  agentId: AGENT_ID || 'local-dev',
  agentName: AGENT_NAME,
  agentDescription: AGENT_DESCRIPTION,
  agentBlueprintId: BLUEPRINT_ID,
  tenantId: TENANT_ID || 'local-dev',
};

export const userDetails: UserDetails = {
  userId: SPONSOR_USER_ID || 'unknown',
  userName: SPONSOR_USER_NAME || 'Blueprint Sponsor',
  userEmail: SPONSOR_USER_EMAIL,
};

export const callerDetails: CallerDetails = { userDetails };

// ── Observability — clean S2S config (1.0+) ──────────────────────────────────
const a365TokenResolver = (agentId: string, tenantId: string) =>
  tokenResolver(agentId, tenantId) ?? '';

useMicrosoftOpenTelemetry({
  resource: resourceFromAttributes({ 'service.name': AGENT_NAME }),
  a365: A365_ENABLED
    ? {
        enabled: true,
        enableObservabilityExporter: true,
        useS2SEndpoint: true,         // ← first-class option, no workaround needed
        tokenResolver: a365TokenResolver,
      }
    : undefined,
});

// ... import app modules AFTER observability init ...

// Start background token service after server is listening
if (A365_ENABLED) {
  startTokenService({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    blueprintClientId: CLIENT_ID,
    blueprintClientSecret: CLIENT_SECRET,
    useManagedIdentity: USE_MANAGED_IDENTITY,
  });
}

// Graceful shutdown — REQUIRED in 1.0+ to flush pending spans
function shutdown(signal: string) {
  console.log(`${signal} received — shutting down`);
  shutdownMicrosoftOpenTelemetry().finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## S2S Token Service Scaffold

#### Step 1 — `observability/token-cache.ts`

Simple in-memory token cache shared by the token service and the OTel exporter:

```typescript
// observability/token-cache.ts
// A365 Observability — best-effort instrumentation (verify against official sample)

interface CacheEntry {
  token: string;
  expiresAt: number; // Unix ms
}

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

export function cacheToken(agentId: string, tenantId: string, token: string, expiresInMs: number = 60 * 60 * 1000): void {
  const key = `${agentId}:${tenantId}`;
  cache.set(key, { token, expiresAt: Date.now() + expiresInMs });
}

export function getCachedToken(agentId: string, tenantId: string): string | null {
  const key = `${agentId}:${tenantId}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() + EXPIRY_BUFFER_MS >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.token;
}

export const tokenResolver = (agentId: string, tenantId: string): string | null =>
  getCachedToken(agentId, tenantId);
```

#### Step 2 — `observability/observability-token-service.ts`

Background token acquisition via MSAL 3-hop FMI chain:

```typescript
// observability/observability-token-service.ts
// A365 Observability — best-effort instrumentation (verify against official sample)
// A365 auth mode: S2S — 3-hop FMI token chain (MSAL)
//   Hop 1+2: Blueprint (MSI or client secret) → T1 via FMI path → Agent Identity
//   Hop 3:   Agent Identity uses T1 as assertion → Observability API token

import { ConfidentialClientApplication } from '@azure/msal-node';
import { ManagedIdentityCredential } from '@azure/identity';
import { cacheToken } from './token-cache';

const FMI_SCOPES = ['api://AzureADTokenExchange/.default'];
const OBSERVABILITY_SCOPES = ['api://9b975845-388f-4429-889e-eab1ef63949c/.default'];
const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes

export interface TokenServiceConfig {
  tenantId: string;
  agentId: string;
  blueprintClientId: string;
  blueprintClientSecret: string;
  useManagedIdentity: boolean;
}

export function startTokenService(config: TokenServiceConfig): ReturnType<typeof setInterval> {
  console.log(`[A365 Observability] Token service started (useManagedIdentity=${config.useManagedIdentity}).`);
  const run = async () => {
    try { await acquireAndRegisterToken(config); }
    catch (error) { console.warn(`[A365 Observability] Token acquisition failed; will retry in ${REFRESH_INTERVAL_MS / 1000}s.`, error); }
  };
  run();
  return setInterval(run, REFRESH_INTERVAL_MS);
}

async function acquireAndRegisterToken(config: TokenServiceConfig): Promise<void> {
  const authority = `https://login.microsoftonline.com/${config.tenantId}`;

  // Hop 1+2: Blueprint → T1 via FMI path
  const t1Token = config.useManagedIdentity
    ? await acquireT1ViaMsi(authority, config.blueprintClientId, config.agentId)
    : await acquireT1ViaClientSecret(authority, config.blueprintClientId, config.blueprintClientSecret, config.agentId);

  // Hop 3: Agent Identity uses T1 → Observability API token
  const identityApp = new ConfidentialClientApplication({
    auth: { clientId: config.agentId, authority, clientAssertion: t1Token },
  });
  const obsResult = await identityApp.acquireTokenByClientCredential({ scopes: OBSERVABILITY_SCOPES });
  if (!obsResult?.accessToken) throw new Error('Failed to acquire observability token');

  const expiresInMs = obsResult.expiresOn
    ? obsResult.expiresOn.getTime() - Date.now()
    : 55 * 60 * 1000;
  cacheToken(config.agentId, config.tenantId, obsResult.accessToken, expiresInMs);
  console.log(`[A365 Observability] Token registered for agent ${config.agentId}.`);
}

async function acquireT1ViaMsi(authority: string, blueprintClientId: string, agentId: string): Promise<string> {
  const credential = new ManagedIdentityCredential();
  const msiToken = await credential.getToken('api://AzureADTokenExchange');

  const blueprintApp = new ConfidentialClientApplication({
    auth: { clientId: blueprintClientId, authority, clientAssertion: msiToken.token },
  });

  const result = await blueprintApp.acquireTokenByClientCredential({
    scopes: FMI_SCOPES,
    azureRegion: undefined,
    fmiPath: agentId,
  } as any);
  if (!result?.accessToken) throw new Error('FMI T1 via MSI failed');
  return result.accessToken;
}

async function acquireT1ViaClientSecret(authority: string, blueprintClientId: string, blueprintClientSecret: string, agentId: string): Promise<string> {
  // MSAL limitation: @azure/msal-node v3.x does not serialize `fmiPath` to the token endpoint.
  // Workaround: direct HTTP POST with `fmi_path` form parameter until MSAL ships native support.
  const tokenUrl = `${authority}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: blueprintClientId,
    client_secret: blueprintClientSecret,
    scope: FMI_SCOPES[0],
    grant_type: 'client_credentials',
    fmi_path: agentId,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) throw new Error(`FMI T1 via client secret failed (${response.status}): ${await response.text()}`);

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error('FMI T1 via client secret failed: no access_token');
  return data.access_token;
}
```

#### S2S environment variables

```dotenv
# Agent 365 Observability — S2S
AGENT365_TENANT_ID=
AGENT365_AGENT_ID=
AGENT365_BLUEPRINT_ID=
AGENT365_CLIENT_ID=
AGENT365_CLIENT_SECRET=
AGENT365_AGENT_NAME=my-agent
AGENT365_AGENT_DESCRIPTION=
agent365Observability__sponsorUserId=<<Blueprint ID>>
agent365Observability__sponsorUserName=<<Blueprint Name>>
agent365Observability__sponsorUserEmail=<<Blueprint Sponsor Email>>
AGENT365_USE_MANAGED_IDENTITY=true
ENABLE_A365_OBSERVABILITY_EXPORTER=true
# Note: AGENT365_USE_S2S_ENDPOINT env var is no longer needed —
# `useS2SEndpoint: true` is set in code via the a365 options.
```

Message handler baggage setup is **identical** to OBO — only the token resolver and credential
source differ. Do **not** call `AgenticTokenCacheInstance.getObservabilityToken` for S2S; the
token comes from your custom `tokenResolver` wired in `useMicrosoftOpenTelemetry`.

---

## Adapter — `configureA365Hosting` (replaces manual middleware)

The one-liner `configureA365Hosting()` registers `BaggageMiddleware` (and optional output
logging) automatically. Use this instead of the old manual
`adapter.use(new BaggageMiddleware())` / `ObservabilityHostingManager` patterns.

```typescript
import { configureA365Hosting } from '@microsoft/opentelemetry';

configureA365Hosting(adapter, {
  enableBaggage: true,        // auto-populates baggage from TurnContext for every request
  enableOutputLogging: true,  // optional: log agent output to console
});
```

> The middleware skips async replies (`ContinueConversation`) to avoid overwriting baggage.

---

## Message Handler

**Per-stack patterns — they differ.** Verified against `Agent365-Samples/nodejs/{langchain,openai,claude}/sample-agent`:

| Stack | Pattern | Where the scope lives |
|---|---|---|
| **LangChain** | Canonical wrapping: `preloadObservabilityToken` → outer `baggageScope.run` → `InvokeAgentScope.start` + `InferenceScope.start` INSIDE | `src/agent.ts` message handler |
| **OpenAI Agents SDK** | Same as LangChain — canonical wrapping | `src/agent.ts` message handler |
| **Claude SDK** | **`InferenceScope.start` only** — no outer baggageScope, no `InvokeAgentScope`. The Claude sample wraps each LLM call individually inside `src/client.ts`; the handler does not open scopes. | `src/client.ts` query wrapper |

Use the matching pattern for the user's stack. Mixing them produces either silent span drops (LangChain pattern on Claude won't work — Claude sample architecture doesn't reach the handler scopes the same way) or double-instrumentation. The rest of this section describes the **LangChain / OpenAI canonical pattern** — see `Agent365-Samples/nodejs/claude/sample-agent/src/client.ts` for the Claude-specific InferenceScope-only wrapping.

> **`configureA365Hosting({ enableBaggage: true })` middleware (Phase 3) is a fallback** — it auto-populates baggage on the incoming request span, but the spans you'll create later in `InvokeAgentScope.start(...)` are not automatically wrapped by the middleware unless they happen inside the request's async context. In practice this is fragile and leads to the silent `Partitioned into 0 identity groups (N spans skipped)` failure mode. **Prefer the manual outer wrapping below.**
>
> The `as any` cast on `turnContext` is needed because the GA `TurnContextLike` shape declares `activity.getAgenticTenantId()` as `string` while `@microsoft/agents-hosting`'s `TurnContext` returns `string | undefined`.

### OBO and agentic-user — refresh exporter token per turn

The handler shape is identical for both `obo` and `agentic-user`. The Azure AD auth handler
configured in your `AgentApplication` decides which identity the token exchange returns:

- **`agentic-user`** (AI Teammate) — `agentApplication.authorization` exchanges to the
  agent's own Azure AD user identity (Agentic User). Traces attribute to the agent.
- **`obo`** (non-AI Teammate) — `agentApplication.authorization` exchanges to whatever
  the configured Azure AD auth handler resolves. Typically this is the signed-in user
  (traces attribute to that user), but it can also be the agent's own identity if the
  handler is configured that way.

```typescript
// A365 Observability — best-effort instrumentation (verify against official sample)
// A365 auth mode: agentic-user  (or: obo)
import { AgenticTokenCacheInstance, BaggageBuilder, BaggageBuilderUtils } from '@microsoft/opentelemetry';

async function handleMessage(turnContext: TurnContext, state: ApplicationTurnState) {
  // STEP 1 — refresh the exporter token BEFORE entering the baggage scope. Skipping this on
  // a cold turn means the first export attempt sees an empty token, retries until timeout,
  // and the span is silently dropped. The token cache is in-memory and lives for the
  // process lifetime, so this is a no-op on warm turns.
  await preloadObservabilityToken(turnContext);

  // STEP 2 — build outer baggage scope from TurnContext. This populates microsoft.tenant.id
  // and gen_ai.agent.id baggage on every span created inside the run() callback. Without
  // this wrapping, the exporter filters spans as "Partitioned into 0 identity groups
  // (N spans skipped)" and they are silently dropped — the #1 first-run failure mode.
  const baggageScope = BaggageBuilderUtils
    .fromTurnContext(new BaggageBuilder(), turnContext as any)
    .sessionDescription('agent-turn')
    .build();

  await baggageScope.run(async () => {
    // STEP 3 — your InvokeAgentScope + InferenceScope + agent invocation go here.
    // Nested scopes inherit the outer baggage automatically.
    // ... LangChain / OpenAI / agent invocation ...
  });
}

async function preloadObservabilityToken(turnContext: TurnContext): Promise<void> {
  const agentId = turnContext.activity?.recipient?.agenticAppId ?? '';
  const tenantId = turnContext.activity?.recipient?.tenantId ?? '';

  // The cache instance handles the OBO token exchange internally.
  // Identity returned = whatever the configured auth handler resolves to
  // (Agentic User for agentic-user mode; signed-in user for obo mode).
  // `as any` casts are required: the GA `TurnContextLike` / `AuthorizationLike`
  // interfaces are stricter than the @microsoft/agents-hosting types they were modeled on.
  await AgenticTokenCacheInstance.refreshObservabilityToken(
    agentId,
    tenantId,
    turnContext as any,
    agentApplication.authorization as any,
  );
}
```

### S2S — no per-turn refresh

For `s2s`, the background token service started in the entry point (see [S2S Token Service Scaffold](#s2s-token-service-scaffold)) populates the in-memory cache every 50 minutes. The custom `tokenResolver` wired in `useMicrosoftOpenTelemetry()` reads from that cache on each export. The handler does NOT touch tokens.

```typescript
// A365 Observability — best-effort instrumentation (verify against official sample)
// A365 auth mode: s2s

async function handleMessage(turnContext: TurnContext, state: ApplicationTurnState) {
  // BaggageMiddleware (from configureA365Hosting) already populated baggage from TurnContext.
  // No per-turn token refresh — background token service handles auth.
  // Do NOT call AgenticTokenCacheInstance.refreshObservabilityToken for S2S.

  // ... your agent invocation goes here ...
}
```

> **No more `getObservabilityAuthenticationScope()` import.** The default scope
> (`api://9b975845-388f-4429-889e-eab1ef63949c/.default`) is applied automatically.
> Override via `a365.observabilityScopeOverride` or `a365.authScopes` if needed.

---

## Manual Instrumentation Scopes

> **Store publishing requirement:** `InvokeAgentScope`, `InferenceScope`, and `ExecuteToolScope`
> are **required** for store validation. Missing any one causes store validation failure.

> **All scope types import from `@microsoft/opentelemetry`** — no other packages needed.

> **`ScopeUtils.populate*FromTurnContext` is no longer in the public API.** Construct scopes
> directly with `.start(...)`. Use `recordInputMessages` / `recordOutputMessages` to capture
> content (always recorded — `isContentRecordingEnabled` was removed in beta.1).

```typescript
import {
  BaggageBuilder,
  InvokeAgentScope,
  InferenceScope,
  ExecuteToolScope,
  OutputScope,
  InferenceOperationType,
} from '@microsoft/opentelemetry';
import type {
  AgentDetails,
  InferenceDetails,
  InvokeAgentScopeDetails,
  A365Request,
  ToolCallDetails,
  ServiceEndpoint,
} from '@microsoft/opentelemetry';

// Note: the GA distro renamed `Request` to `A365Request` to avoid clashing with the DOM `Request` type.
```

### InvokeAgentScope

```typescript
import {
  InvokeAgentScope,
  InvokeAgentScopeDetails,
  AgentDetails,
  CallerDetails,
  UserDetails,
  Channel,
  A365Request,
  ServiceEndpoint,
} from '@microsoft/opentelemetry';

// AI Teammate: write BOTH identity dimensions so MAC shows per-instance AND
// blueprint-rolled-up activity. The two are emitted as separate span tags:
//   agentId          → gen_ai.agent.id                   (this agentic INSTANCE)
//   agentBlueprintId → microsoft.a365.agent.blueprint.id (MAC roll-up to the blueprint)
// If EITHER is empty MAC loses that grouping dimension — blueprint empty ⇒ only
// per-instance rows; agentId empty ⇒ only blueprint-level. The exporter omits whichever
// is blank, so always set both. Resolve LIVE from the turn's recipient (verified fields:
// recipient.agenticAppId + recipient.agenticAppBlueprintId on @microsoft/agents-activity
// ChannelAccount); env is only a fallback.
const recipient = turnContext.activity?.recipient as any;
const agentDetails: AgentDetails = {
  agentId:          recipient?.agenticAppId ?? process.env.agent365Observability__agentId ?? '',
  agentName:        process.env.agent365Observability__agentName ?? 'Email Assistant',
  agentDescription: process.env.agent365Observability__agentDescription ?? '',
  agentAUID:        recipient?.agenticUserId ?? '',          // microsoft.agent.user.id (agentic user)
  agentEmail:       recipient?.agenticUserId ?? '',          // the agent's own identity
  agentBlueprintId: process.env.agent365Observability__agentBlueprintId
                    ?? recipient?.agenticAppBlueprintId ?? '',  // ← MAC blueprint roll-up
  tenantId:         recipient?.tenantId ?? process.env.agent365Observability__tenantId ?? '',
};

const scopeDetails: InvokeAgentScopeDetails = {
  endpoint: { host: 'myagent.contoso.com', port: 443 } as ServiceEndpoint,
};

const request: A365Request = {
  content: 'Please help me organize my emails',
  sessionId: 'session-42',
  conversationId: 'conv-xyz',
  channel: { name: 'msteams' } as Channel,
};

const callerDetails: CallerDetails = {
  userDetails: {
    userId: 'user-123',
    userEmail: 'jane.doe@contoso.com',
    userName: 'Jane Doe',
  } as UserDetails,
};

// CANONICAL PATTERN: outer baggage scope MUST wrap InvokeAgentScope + InferenceScope.
// Without this, the exporter sees spans with no `microsoft.tenant.id` / `gen_ai.agent.id`
// baggage attached and filters them out as "Partitioned into 0 identity groups (N spans skipped)" —
// the spans are silently dropped. The working Agent365-Samples LangChain sample uses this exact wrapping.
import { BaggageBuilder, BaggageBuilderUtils } from '@microsoft/opentelemetry';

const baggageScope = BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), turnContext as any)
  .sessionDescription('email-assistant-turn')
  .build();

await baggageScope.run(async () => {
  const scope = InvokeAgentScope.start(request, scopeDetails, agentDetails, callerDetails);
  try {
    await scope.withActiveSpanAsync(async () => {
      scope.recordInputMessages(['Please help me organize my emails']);
      // Nested InferenceScope / ExecuteToolScope go HERE — they inherit the baggage
      // from the outer scope, so the exporter sees them as part of the same identity group.
      const response = await invokeAgent(request.content);
      scope.recordOutputMessages(['I found 15 urgent emails', 'Here is your organized inbox']);
    });
  } catch (error) {
    scope.recordError(error as Error);
    throw error;
  } finally {
    scope.dispose();
  }
});
```

> **Why the outer `baggageScope.run` matters:** the A365 exporter groups spans by `(tenantId, agentId)` from baggage before exporting. Spans created outside an active baggage scope have no identity → exporter logs `Partitioned into 0 identity groups (N spans skipped)` → silent drop. This is the #1 first-run failure mode reported by Node.js LangChain users. The `as any` cast on `turnContext` is needed because the GA `TurnContextLike` is stricter than `@microsoft/agents-hosting`'s `TurnContext` type.

> **TIP:** For S2S agents, export `callerDetails` and `userDetails` from the entry
> point module so all scope files import them alongside `agentDetails`.
> Sponsor env vars: `agent365Observability__sponsorUserId` / `sponsorUserName` / `sponsorUserEmail`.

### Resolve caller UPN (AI Teammate / OBO — populates MAC "User principal name")

For AI Teammate (`agentic-user`) turns, don't hardcode `userEmail` like the `'jane.doe@contoso.com'` above — resolve it per turn. The observability SDK does **not** auto-populate it: `CallerDetails.userDetails.userEmail` is what MAC shows in its **"User principal name"** column, and it's blank on the most common turn (a direct Teams 1:1 chat), because `activity.from.id` is an MRI (`29:…` / `8:orgid:…`), not a UPN. Notification / `@mention` / email turns *do* carry the UPN in `from.id`.

Resolution order: (1) `from.id` contains `@` → it **is** the UPN; (3) otherwise look it up from the conversation roster via the connector client on `turnState` (verified working in the Agent365-Samples LangChain travel-agent). Cache per `conversation|member` — it's a network call.

```typescript
import { TurnContext } from '@microsoft/agents-hosting';

const upnCache = new Map<string, string>();

// Best-effort: returns the caller's UPN/email, or undefined if the roster is
// unavailable. NEVER throws — a blank UPN must not break the turn.
async function resolveCallerUpn(turnContext: TurnContext): Promise<string | undefined> {
  const from = turnContext.activity?.from as any;
  if (typeof from?.id === 'string' && from.id.includes('@')) return from.id;   // (1) already a UPN

  const convId = turnContext.activity?.conversation?.id;
  const memberId = from?.id;
  if (!convId || !memberId) return undefined;

  const cacheKey = `${convId}|${memberId}`;
  const hit = upnCache.get(cacheKey);
  if (hit) return hit;                                                          // (4) cache

  try {
    // ConnectorClientKey is a per-adapter-instance Symbol on the adapter (the way the
    // SDK's own teamsAttachmentDownloader reads it) — NOT a static on CloudAdapter.
    const key = (turnContext as any).adapter?.ConnectorClientKey;
    const connector: any = key ? (turnContext.turnState as any).get(key) : undefined;
    const member: any = await connector?.getConversationMember?.(memberId, convId);  // (3) roster
    const upn: string | undefined = member?.userPrincipalName ?? member?.email;
    if (upn) upnCache.set(cacheKey, upn);
    return upn;
  } catch {
    return undefined;  // connector not on turnState / permission gap — omit the tag
  }
}

// Then in the message handler, before InvokeAgentScope.start:
const callerUpn = await resolveCallerUpn(turnContext);
const callerDetails: CallerDetails = {
  userDetails: {
    userId:    from?.aadObjectId ?? from?.id ?? '',
    userName:  from?.name ?? '',
    userEmail: callerUpn ?? '',   // ← MAC "User principal name"
  } as UserDetails,
};
```

> **S2S agents skip this** — no signed-in user, so `userEmail` comes from the Blueprint sponsor env var (`agent365Observability__sponsorUserEmail`), not the roster.

### ExecuteToolScope

```typescript
import { ExecuteToolScope, ToolCallDetails } from '@microsoft/opentelemetry';

const toolDetails: ToolCallDetails = {
  toolName: 'email-search',
  arguments: JSON.stringify({ query: 'from:boss@company.com', limit: 10 }),
  toolCallId: 'tool-call-456',
  description: 'Search emails by criteria',
  toolType: 'function',
  endpoint: { host: 'tools.contoso.com', port: 8080, protocol: 'https' },
};

const scope = ExecuteToolScope.start(request, toolDetails, agentDetails, userDetails);

try {
  return await scope.withActiveSpanAsync(async () => {
    const result = await searchEmails(toolDetails.arguments);
    scope.recordResponse(result);
    return result;
  });
} catch (error) {
  scope.recordError(error as Error);
  throw error;
} finally {
  scope.dispose();
}
```

### InferenceScope

```typescript
// A365 Observability — best-effort instrumentation (verify against official sample)
import {
  InferenceScope,
  InferenceOperationType,
} from '@microsoft/opentelemetry';
import type {
  AgentDetails,
  InferenceDetails,
  A365Request,
  UserDetails,
} from '@microsoft/opentelemetry';

const inferenceDetails: InferenceDetails = {
  operationName: InferenceOperationType.CHAT,
  model: 'gpt-4o-mini',
  providerName: 'azure-openai',
};

const request: A365Request = {
  conversationId: context.activity?.conversation?.id || `conv-${Date.now()}`,
};

const agentDetails: AgentDetails = {
  agentId: context.activity?.recipient?.agenticAppId || agentName,
  agentName,
  tenantId: context.activity?.recipient?.tenantId || 'sample-tenant',
};

const userDetails: UserDetails = {
  userId: process.env.agent365Observability__sponsorUserId || context.activity?.from?.id || 'blueprint-app-id',
  userName: process.env.agent365Observability__sponsorUserName || context.activity?.from?.name || agentName,
  userEmail: process.env.agent365Observability__sponsorUserEmail || '',
};

// userDetails is optional — `InferenceScope.start(request, inferenceDetails, agentDetails)`
// is also a valid 3-arg call (used by the langchain Agent365 sample). Add userDetails when
// you want caller context (UPN, name) on the span — useful in MAC traces.
let response = '';
const scope = InferenceScope.start(request, inferenceDetails, agentDetails, userDetails);
try {
  await scope.withActiveSpanAsync(async () => {
    response = await invokeAgent(prompt);
    scope.recordOutputMessages([response]);
    scope.recordInputMessages([prompt]);
    scope.recordInputTokens(45);
    scope.recordOutputTokens(78);
    scope.recordFinishReasons(['stop']);
  });
} catch (error) {
  scope.recordError(error as Error);
  throw error;
} finally {
  scope.dispose();
}
```

### OutputScope (async scenarios)

```typescript
import { OutputScope, OutputResponse, SpanDetails } from '@microsoft/opentelemetry';

const parentContext = invokeScope.getSpanContext();
const response: OutputResponse = {
  messages: ['Here is your organized inbox with 15 urgent emails.'],
};

const scope = OutputScope.start(
  request,
  response,
  agentDetails,
  userDetails,
  { parentContext } as SpanDetails
);

scope.dispose();
```

---

## Auto-Instrumentation (now ON by default)

OpenAI Agents SDK and LangChain are **auto-instrumented** when the distro initializes — no
manual `.enable()` or `.instrument()` calls needed.

```typescript
// Default behavior: both auto-enabled when their packages are installed
useMicrosoftOpenTelemetry({
  a365: { enabled: true, enableObservabilityExporter: true, tokenResolver: ... },
});

// Explicit opt-out:
useMicrosoftOpenTelemetry({
  a365: { ... },
  instrumentationOptions: {
    openaiAgents: { enabled: false },
    langchain: { enabled: false },
  },
});
```

> **Calling `OpenAIAgentsTraceInstrumentor.enable()` or `LangChainTraceInstrumentor.instrument()`
> explicitly will produce duplicate spans.** Remove these calls if migrating from beta.

---

## Logger (replaces `setLogger` from removed `@microsoft/agents-a365-observability`)

```typescript
import { useMicrosoftOpenTelemetry } from '@microsoft/opentelemetry';

useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
    tokenResolver: ...,
    // `logLevel` is the only logger-related option on A365Options — a pipe-separated
    // list of levels to emit. There is NO `logger: { info, warn, error }` callback hook
    // on A365Options in 1.0.x; routing exporter logs through your own logger requires
    // setting OTEL's diag logger via @opentelemetry/api, not a per-A365 logger option.
    logLevel: 'info|warn|error',
  },
});
```

> **Want exporter logs to flow through your app logger?** A365Options has no `logger` callback. Use `diag.setLogger(...)` from `@opentelemetry/api` before `useMicrosoftOpenTelemetry()` — that pipes the entire OTel SDK (including the A365 exporter) through your custom diag logger.

---

## .env Variables

```dotenv
# ── A365 Observability ────────────────────────────────────────────────────────
# REQUIRED for spans to actually export to MAC (auto-stamped by `a365 setup all`).
# Equivalent to setting `a365.enableObservabilityExporter: true` in code — at least
# ONE of the two must be true or no spans reach the A365 backend. Setting only
# `a365.enabled: true` in code without this env var (or the code flag) is the #1
# silent-export-failure mode.
ENABLE_A365_OBSERVABILITY_EXPORTER=true

# OpenTelemetry resource service.name (alternative: use OTEL_RESOURCE_ATTRIBUTES)
SERVICE_NAME=my-agent
# OTEL_RESOURCE_ATTRIBUTES=service.name=my-agent,service.version=1.0.0

# ── Observability verbose logging ───────────────────────────────────────────
# These are COMMENTED OUT by default — uncomment both to debug exporter activity.
# Without them, the A365 exporter logs through a wrapped getA365Logger() that
# defaults to 'none' — you see nothing in stdout, even with OTEL_LOG_LEVEL=INFO.
# Both vars are required together to see [Agent365Exporter] activity:
#   - OTEL_LOG_LEVEL=INFO          → OTel SDK internal logger
#   - A365_OBSERVABILITY_LOG_LEVEL → A365 exporter's own logger
# After enabling, grep for "exported successfully" to confirm spans are flowing.
# OTEL_LOG_LEVEL=INFO
# A365_OBSERVABILITY_LOG_LEVEL=info|warn|error

# ── Runtime agent identity vs blueprint id ──────────────────────────────────
# The `a365 setup all` CLI writes `agent365Observability__agentId=<blueprint-id>` into
# .env, but that value is the BLUEPRINT id, NOT the runtime AUID. The exporter
# resolves the runtime AUID from `turnContext.activity.recipient.agenticAppId`
# on each turn — that's what shows up in MAC Advanced Hunting (`CloudAppEvents`,
# `AgentId` column). If you write a KQL filter using the blueprint id, you'll get
# empty results. Filter by AUID, not blueprint id.

# Sponsor / CallerDetails for MAC portal trace visibility (S2S agents — no signed-in user).
agent365Observability__sponsorUserId=<<Blueprint ID>>
agent365Observability__sponsorUserName=<<Blueprint Name>>
agent365Observability__sponsorUserEmail=<<Blueprint Sponsor Email>>
# ─────────────────────────────────────────────────────────────────────────────
```

| Variable | Local dev | Production |
|---|---|---|
| `ENABLE_A365_OBSERVABILITY_EXPORTER` | `false` (console only) | `true` |
| `agent365Observability__sponsorUserId` | `<<Blueprint ID>>` | `<<Blueprint ID>>` |
| `agent365Observability__sponsorUserName` | `<<Blueprint Name>>` | `<<Blueprint Name>>` |
| `agent365Observability__sponsorUserEmail` | `<<Sponsor Email>>` | `<<Sponsor Email>>` |
| `NODE_ENV` | `development` | `production` |

> **Removed:** `AGENT365_USE_S2S_ENDPOINT` env var (use `useS2SEndpoint: true` in code instead).
>
> **Sample-only switch:** `Use_Custom_Resolver` is a *sample-level* toggle in the
> langchain/openai/claude Agent365 samples that demonstrates swapping between a
> custom in-process token cache and the built-in `AgenticTokenCacheInstance`. It is
> not an SDK contract — you always pass *some* `tokenResolver` to `useMicrosoftOpenTelemetry`.

---

## Validate Locally

Set `ENABLE_A365_OBSERVABILITY_EXPORTER=false` — spans go to the console only.

For richer local debug, opt into `enableConsoleExporters: true`:
```typescript
useMicrosoftOpenTelemetry({
  a365: { enabled: true, enableConsoleExporters: true, tokenResolver: ... },
});
```

To investigate export failures, enable verbose logging:
```bash
ENABLE_A365_OBSERVABILITY_EXPORTER=true
OTEL_LOG_LEVEL=INFO
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
```

Key console messages:
```text
[INFO]  [Agent365Exporter] Exporting 245 spans
[INFO]  [Agent365Exporter] Token resolved successfully via tokenResolver
[EVENT] export-group succeeded in 98ms {"tenantId":"...","agentId":"...","correlationId":"abc-123"}
[ERROR] [Agent365Exporter] Failed with status 401, correlation ID: abc-123
```

---

## Key API Surface (all from `@microsoft/opentelemetry`)

| Symbol | Purpose |
|--------|---------|
| `useMicrosoftOpenTelemetry(options)` | Configure the OTel pipeline with the A365 exporter |
| `shutdownMicrosoftOpenTelemetry()` | Graceful shutdown (required to flush pending spans) |
| `configureA365Hosting(adapter, opts)` | One-liner: registers `BaggageMiddleware` + optional output logging |
| `BaggageBuilder` | Fluent builder for tenant/agent/correlation baggage (rarely needed manually) |
| `BaggageMiddleware` | Adapter middleware — auto-populates baggage (registered by `configureA365Hosting`) |
| `ObservabilityHostingManager` | Lower-level alternative to `configureA365Hosting` |
| `AgenticTokenCacheInstance` | Singleton: `getObservabilityToken`, `refreshObservabilityToken` |
| `AgenticTokenCache` | Class form (advanced; usually the singleton above is enough) |
| `Agent365Exporter` / `A365SpanProcessor` | Re-exported for advanced custom pipeline scenarios |
| `InvokeAgentScope.start(request, scopeDetails, agentDetails, callerDetails)` | Agent invocation scope |
| `ExecuteToolScope.start(request, toolDetails, agentDetails, userDetails)` | Tool execution scope |
| `InferenceScope.start(request, inferenceDetails, agentDetails, userDetails)` | LLM inference scope |
| `OutputScope.start(request, response, agentDetails, userDetails, spanDetails)` | Async output scope |
| `scope.withActiveSpanAsync(fn)` | Execute async work within the active OTel span |
| `scope.recordInputMessages` / `recordOutputMessages` | Record prompts and completions |
| `scope.recordInputTokens` / `recordOutputTokens` | Record token counts |
| `scope.recordFinishReasons(reasons)` | Record finish reasons (e.g. `['stop']`) |
| `scope.recordError(error)` | Record an error on the span |
| `scope.dispose()` | End and export the span (call in `finally`) |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `useMicrosoftOpenTelemetry()` not initialized early enough | Call it in the entry point before importing LLM or agent modules |
| Traces not in Admin Center | Four common causes, in order of likelihood: (1) `a365.enableObservabilityExporter: true` (or env `ENABLE_A365_OBSERVABILITY_EXPORTER=true`) missing — spans enriched but never exported; (2) missing outer `BaggageBuilderUtils.fromTurnContext(...).build()` wrapping `InvokeAgentScope` — spans have no identity baggage and get filtered; (3) instance not yet approved at admin.cloud.microsoft (no `AgentInstance.UPN` to attribute to); (4) MAC indexing lag (15–90 min after first export). | (1) Add the exporter flag (code) or env var; (2) verify the canonical wrapping pattern in your handler (see Manual Instrumentation Scopes above); (3) confirm instance approval + Agentic User UPN issued; (4) filter your MAC KQL by AUID (`recipient.agenticAppId`), not blueprint id — wait for indexing. |
| `Partitioned into 0 identity groups (N spans skipped)` in exporter logs | **Expected for spans outside an active baggage scope** — framework / middleware spans created during startup, devtunnel health pings, etc. carry no `microsoft.tenant.id` / `gen_ai.agent.id` baggage and are filtered. NOT an error. | Only worry if the count is non-zero on actual turn spans. The log line you actually want to see for turn spans is `export-group succeeded ... 1 chunk(s) exported successfully` — that confirms a real identity-group reached the backend. |
| Duplicate spans for OpenAI/LangChain calls | Manual `.enable()` / `.instrument()` call after migration | Remove manual instrumentor calls; auto-instrumentation is ON by default |
| Spans missing baggage | `configureA365Hosting()` not called | Add `configureA365Hosting(adapter, { enableBaggage: true })` once at startup |
| Token resolver always returns `''` | `refreshObservabilityToken` not called per turn (OBO) | Call `AgenticTokenCacheInstance.refreshObservabilityToken(...)` at the start of each handler turn |
| `Cannot find module '@microsoft/opentelemetry'` | Package not installed | `npm install @microsoft/opentelemetry` |
| 401 on export | Missing `Agent365.Observability.OtelWrite` permission | CLI 1.1+ grants this automatically via `a365 setup all`. For pre-1.1 agents, GA must grant it manually |
| Spans dropped silently | Missing tenant/agent ID | Ensure `configureA365Hosting({ enableBaggage: true })` is registered before creating spans |
| Spans only when `ENABLE_A365_OBSERVABILITY_EXPORTER=true` env, but not via code | The env var is a secondary toggle | Set `enableObservabilityExporter: true` in `a365` options (code is preferred over env var) |
| Pending spans lost on shutdown | `shutdownMicrosoftOpenTelemetry()` not called | Add SIGTERM/SIGINT handlers calling `await shutdownMicrosoftOpenTelemetry()` |
| TypeScript error on `agentAuid` | Interface field is `agentAUID` (uppercase UID) | Change to `agentAUID: '...'` |
| S2S: AADSTS82001 / AADSTS1002012 | Direct MSAL client credentials not supported for the agent | Use the 3-hop FMI chain: Blueprint → FMI path → Agent Identity → Observability API token |
| S2S: 401 on `observabilityService/` | Token scope mismatch | Ensure Hop 3 scope is `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. Ensure Agent Identity SP has OtelWrite role assigned |
| S2S: 403 on `observabilityService/` | Missing app role on Agent Identity SP | Assign `Agent365.Observability.OtelWrite` to the **Agent Identity** SP (not just the Blueprint) via Graph API |
| S2S: MSI fails locally | No Managed Identity in dev | Set `AGENT365_USE_MANAGED_IDENTITY=false` and provide `AGENT365_CLIENT_SECRET` |
| MSAL `AADSTS82008: fmipath parameter required` | `@azure/msal-node` v3.x does not serialize `fmiPath` to the token endpoint | Use the direct HTTP POST workaround in `acquireT1ViaClientSecret` (MSAL-side limitation; remove once MSAL ships native support) |
