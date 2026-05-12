# Node.js — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Node.js agent. Aligned with `@microsoft/opentelemetry` **GA 1.0.x** (updated 2026-05-11).

> **Major shift from earlier 0.x:** the three legacy packages
> (`@microsoft/agents-a365-observability`, `@microsoft/agents-a365-observability-hosting`,
> `@microsoft/agents-a365-runtime`) are **deprecated**. Everything ships from a single
> package now: `@microsoft/opentelemetry`. See `MIGRATION_A365.md` in the distro repo
> for the authoritative migration guide.

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
npm install @microsoft/opentelemetry

# Required for S2S only
npm install @azure/msal-node @azure/identity
```

> **No version pin needed.** `@microsoft/opentelemetry` is GA — install latest.

Minimum Node.js: **20.6.0** (required for ESM `--import` flow). TypeScript: **5.x** recommended.

---

## Entry Point — Observability Init (before any LLM imports)

Initialize the unified distro **before** importing the rest of your app so OpenAI Agents
and LangChain auto-instrumentation can patch their target libraries.

### OBO / agentic-user (default)

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
  resource: resourceFromAttributes({
    'service.name': process.env.SERVICE_NAME ?? 'my-agent',
  }),
  a365: {
    enabled: true,
    enableObservabilityExporter: true,  // REQUIRED in 1.0+ to actually export spans
    tokenResolver: (agentId, tenantId) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId) ?? '',
  },
});
```

> **Two flags required (1.0 breaking change):** `enabled: true` only registers
> `A365SpanProcessor`. You must **also** set `enableObservabilityExporter: true`
> (or env `ENABLE_A365_OBSERVABILITY_EXPORTER=true`) to send spans to A365.

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

## Message Handler — Token Refresh

With `configureA365Hosting({ enableBaggage: true })` registered, you do **not** need to build
baggage manually in the handler. You DO still need to refresh the exporter token per turn for
OBO / agentic-user flows.

> **`BaggageBuilderUtils.fromTurnContext` is no longer in the public API.** If you previously
> called it manually, remove it — the middleware now handles baggage.

```typescript
// A365 Observability — best-effort instrumentation (verify against official sample)
import { AgenticTokenCacheInstance } from '@microsoft/opentelemetry';

// Inside your AgentApplication subclass / message handler:
async function handleMessage(turnContext: TurnContext, state: ApplicationTurnState) {
  // BaggageMiddleware (registered via configureA365Hosting) already populated baggage from TurnContext.
  // We only need to refresh the per-turn exporter token for OBO / agentic-user.
  await preloadObservabilityToken(turnContext);

  // ... your LangChain / OpenAI / agent invocation goes here ...
}

async function preloadObservabilityToken(turnContext: TurnContext): Promise<void> {
  const agentId = turnContext.activity?.recipient?.agenticAppId ?? '';
  const tenantId = turnContext.activity?.recipient?.tenantId ?? '';

  // OBO / agentic-user: refresh the exporter token using the AgentApplication's authorization.
  // The cache instance handles the OBO token exchange internally.
  await AgenticTokenCacheInstance.RefreshObservabilityToken(
    agentId,
    tenantId,
    turnContext,
    agentApplication.authorization,  // the AgentApplication auth object
  );
}
```

> **No more `getObservabilityAuthenticationScope()` import.** The default scope
> (`api://9b975845-388f-4429-889e-eab1ef63949c/.default`) is applied automatically.
> Override via `a365.observabilityScopeOverride` or `a365.authScopes` if needed.

> **S2S path:** do **not** call `RefreshObservabilityToken` — the background token service
> handles authentication. The `tokenResolver` you wired in the entry point will pick up the
> cached token automatically.

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
  Request,
  ToolCallDetails,
  ServiceEndpoint,
} from '@microsoft/opentelemetry';
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
  Request,
  ServiceEndpoint,
} from '@microsoft/opentelemetry';

const agentDetails: AgentDetails = {
  agentId: 'agent-456',
  agentName: 'Email Assistant',
  agentDescription: 'An AI agent powered by Azure OpenAI',
  agentAUID: 'auid-123',
  agentEmail: 'agent@contoso.com',  // interface field is agentAUID (uppercase UID)
  agentBlueprintId: 'blueprint-789',
  tenantId: 'tenant-123',
};

const scopeDetails: InvokeAgentScopeDetails = {
  endpoint: { host: 'myagent.contoso.com', port: 443 } as ServiceEndpoint,
};

const request: Request = {
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

const scope = InvokeAgentScope.start(request, scopeDetails, agentDetails, callerDetails);

try {
  await scope.withActiveSpanAsync(async () => {
    scope.recordInputMessages(['Please help me organize my emails']);
    const response = await invokeAgent(request.content);
    scope.recordOutputMessages(['I found 15 urgent emails', 'Here is your organized inbox']);
  });
} catch (error) {
  scope.recordError(error as Error);
  throw error;
} finally {
  scope.dispose();
}
```

> **TIP:** For S2S autonomous agents, export `callerDetails` and `userDetails` from the entry
> point module so all scope files import them alongside `agentDetails`.
> Sponsor env vars: `agent365Observability__sponsorUserId` / `sponsorUserName` / `sponsorUserEmail`.

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
  Request,
  UserDetails,
} from '@microsoft/opentelemetry';

const inferenceDetails: InferenceDetails = {
  operationName: InferenceOperationType.CHAT,
  model: 'gpt-4o-mini',
  providerName: 'azure-openai',
};

const request: Request = {
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
    logger: {
      info: (msg, ...args) => myLogger.info(msg, ...args),
      warn: (msg, ...args) => myLogger.warn(msg, ...args),
      error: (msg, ...args) => myLogger.error(msg, ...args),
    },
    logLevel: 'info|warn|error',
  },
});
```

---

## .env Variables

```dotenv
# ── A365 Observability ────────────────────────────────────────────────────────
# Turns on the A365 exporter. In 1.0+ this works only when a365 options are
# configured programmatically — it cannot activate A365 on its own.
ENABLE_A365_OBSERVABILITY_EXPORTER=true

# OpenTelemetry resource service.name (alternative: use OTEL_RESOURCE_ATTRIBUTES)
SERVICE_NAME=my-agent
# OTEL_RESOURCE_ATTRIBUTES=service.name=my-agent,service.version=1.0.0

# Log level: pipe-separated list of levels to emit.
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error

# Sponsor / CallerDetails for MAC portal trace visibility (S2S / autonomous agents).
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

> **Removed:** `AGENT365_USE_S2S_ENDPOINT` env var (use `useS2SEndpoint: true` in code instead),
> `Use_Custom_Resolver` (no longer needed — always pass your own `tokenResolver`).

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
| `AgenticTokenCacheInstance` | Singleton: `getObservabilityToken`, `RefreshObservabilityToken` |
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

### Removed / migrated symbols

| Old (pre-1.0) | Replacement |
|---|---|
| `@microsoft/agents-a365-observability` | `@microsoft/opentelemetry` |
| `@microsoft/agents-a365-observability-hosting` | `@microsoft/opentelemetry` |
| `@microsoft/agents-a365-runtime` (observability parts) | `@microsoft/opentelemetry` |
| `BaggageBuilderUtils.fromTurnContext(...)` | `configureA365Hosting(adapter, { enableBaggage: true })` |
| `ScopeUtils.populateInvokeAgentScopeFromTurnContext` | Construct scope directly with `.start(...)` |
| `ScopeUtils.populateExecuteToolScopeFromTurnContext` | Construct scope directly with `.start(...)` |
| `ScopeUtils.populateInferenceScopeFromTurnContext` | Construct scope directly with `.start(...)` |
| `getObservabilityAuthenticationScope()` | Default scope auto-applied; override via `a365.observabilityScopeOverride` |
| `setLogger(...)` | Pass `a365.logger` to `useMicrosoftOpenTelemetry` |
| `ExporterEventNames` enum | Removed; events surface through the `logger` callbacks |
| `isContentRecordingEnabled` | Removed — content is always recorded |
| `AGENT365_USE_S2S_ENDPOINT` env var | `useS2SEndpoint: true` in code |
| `Use_Custom_Resolver` env var | Always pass your own `tokenResolver` |
| Manual `OpenAIAgentsTraceInstrumentor.enable()` | Auto-enabled (or `instrumentationOptions.openaiAgents.enabled: false` to opt out) |
| Manual `LangChainTraceInstrumentor.instrument()` | Auto-enabled (or `instrumentationOptions.langchain.enabled: false` to opt out) |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `useMicrosoftOpenTelemetry()` not initialized early enough | Call it in the entry point before importing LLM or agent modules |
| Traces not in Admin Center | Missing `enableObservabilityExporter: true` (1.0 breaking change) | Set `enableObservabilityExporter: true` in `a365` options, or `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in env |
| Duplicate spans for OpenAI/LangChain calls | Manual `.enable()` / `.instrument()` call after migration | Remove manual instrumentor calls; auto-instrumentation is ON by default |
| Spans missing baggage | `configureA365Hosting()` not called | Add `configureA365Hosting(adapter, { enableBaggage: true })` once at startup |
| Token resolver always returns `''` | `RefreshObservabilityToken` not called per turn (OBO) | Call `AgenticTokenCacheInstance.RefreshObservabilityToken(...)` at the start of each handler turn |
| `Cannot find module '@microsoft/opentelemetry'` | Package not installed | `npm install @microsoft/opentelemetry` |
| 401 on export | Missing `Agent365.Observability.OtelWrite` permission | CLI 1.1+ grants this automatically via `a365 setup all`. For pre-1.1 agents, GA must grant it manually |
| Spans dropped silently | Missing tenant/agent ID | Ensure `configureA365Hosting({ enableBaggage: true })` is registered (or build baggage manually) before creating spans |
| Build error on `BaggageBuilderUtils` import | Symbol removed in 1.0 | Delete the import; use `configureA365Hosting()` instead |
| Build error on `ScopeUtils.populate*` import | Symbols removed in 1.0 | Construct scopes directly with `.start(...)` |
| Spans only when `ENABLE_A365_OBSERVABILITY_EXPORTER=true` env, but not via code | In 1.0+ the env var is a secondary toggle | Either set `enableObservabilityExporter: true` in code OR the env var — both work, code is preferred |
| Pending spans lost on shutdown | `shutdownMicrosoftOpenTelemetry()` not called | Add SIGTERM/SIGINT handlers calling `await shutdownMicrosoftOpenTelemetry()` |
| TypeScript error on `agentAuid` | Interface field is `agentAUID` (uppercase UID) | Change to `agentAUID: '...'` |
| S2S: AADSTS82001 / AADSTS1002012 | Direct MSAL client credentials not supported for the agent | Use the 3-hop FMI chain: Blueprint → FMI path → Agent Identity → Observability API token |
| S2S: 401 on `observabilityService/` | Token scope mismatch | Ensure Hop 3 scope is `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. Ensure Agent Identity SP has OtelWrite role assigned |
| S2S: 403 on `observabilityService/` | Missing app role on Agent Identity SP | Assign `Agent365.Observability.OtelWrite` to the **Agent Identity** SP (not just the Blueprint) via Graph API |
| S2S: MSI fails locally | No Managed Identity in dev | Set `AGENT365_USE_MANAGED_IDENTITY=false` and provide `AGENT365_CLIENT_SECRET` |
| MSAL `AADSTS82008: fmipath parameter required` | `@azure/msal-node` v3.x does not serialize `fmiPath` to the token endpoint | Use the direct HTTP POST workaround in `acquireT1ViaClientSecret` (MSAL-side limitation; remove once MSAL ships native support) |
