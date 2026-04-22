# Node.js LangChain — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Node.js LangChain agent. All samples mirror the Agent365-Samples repository
patterns for `nodejs/langchain`.

---

## npm Packages

| Package | Purpose |
|---------|---------|
| `@microsoft/agents-a365-observability` | OTel tracer + ObservabilityManager + Agent365ExporterOptions + BaggageBuilder + A365 exporter |
| `@microsoft/agents-a365-observability-hosting` | AgenticTokenCacheInstance + BaggageBuilderUtils |
| `@microsoft/agents-a365-runtime` | getObservabilityAuthenticationScope() |

Install commands:
```bash
npm install @microsoft/agents-a365-observability
npm install @microsoft/agents-a365-observability-hosting
npm install @microsoft/agents-a365-runtime
```

Minimum Node.js: **18.x** (LTS). TypeScript: **5.x** recommended.

---

## client.ts — Observability Init Pattern (call before any agent logic)

```typescript
import { ObservabilityManager, Agent365ExporterOptions } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';

export const a365Observability = ObservabilityManager.configure((builder) => {
  const exporterOptions = new Agent365ExporterOptions();
  exporterOptions.maxQueueSize = 10;

  builder
    .withService(
      process.env.SERVICE_NAME ?? 'my-langchain-agent',
      process.env.npm_package_version ?? '1.0.0'
    )
    .withExporterOptions(exporterOptions)
    .withTokenResolver((agentId: string, tenantId: string) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    );
});

a365Observability.start();
```

**Important:** Call `a365Observability.start()` before any code that creates OTel spans
(before importing LangChain models, tools, etc.).

---

## agent.ts — Token Refresh in Message Handler

The built-in `AgenticTokenCacheInstance` handles caching. Call `RefreshObservabilityToken`
once per turn so the exporter always has a valid token.

```typescript
import { BaggageBuilder } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance, BaggageBuilderUtils } from '@microsoft/agents-a365-observability-hosting';
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';

// Inside your AgentApplication message handler / onActivity:
async function handleMessage(turnContext: TurnContext, state: TurnState) {
  const agentId  = turnContext.activity.recipient?.agenticAppId ?? '';
  const tenantId = turnContext.activity.recipient?.tenantId ?? '';

  // Refresh the observability token for this turn (non-fatal if it fails).
  try {
    await AgenticTokenCacheInstance.RefreshObservabilityToken(
      agentId,
      tenantId,
      turnContext,
      this.authorization,
      getObservabilityAuthenticationScope()
    );
  } catch (e) {
    console.warn('[A365 Observability] Token refresh failed (non-fatal):', e);
  }

  // Build baggage from the turn context and run agent logic inside the scope.
  const baggageScope = BaggageBuilderUtils
    .fromTurnContext(new BaggageBuilder(), turnContext)
    .sessionDescription('user turn')
    .build();

  await baggageScope.run(async () => {
    // ... your LangChain invocation, tool calls, streaming, etc. ...
  });
}
```

---

## Advanced: Custom Token Resolver

Use `Use_Custom_Resolver=true` to swap in a custom resolver instead of
`AgenticTokenCacheInstance`. Useful for local testing or non-standard auth flows.
When using a custom resolver, also store the token in your own cache and use
`createAgenticTokenCacheKey(agentId, tenantId)` as the key.

```typescript
import { ObservabilityManager, Agent365ExporterOptions } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';
import { tokenResolver } from './token-cache'; // your custom resolver

export const a365Observability = ObservabilityManager.configure((builder) => {
  const exporterOptions = new Agent365ExporterOptions();
  exporterOptions.maxQueueSize = 10;

  builder
    .withService('my-langchain-agent', '1.0.0')
    .withExporterOptions(exporterOptions)
    .withTokenResolver(
      process.env.Use_Custom_Resolver === 'true'
        ? tokenResolver
        : (agentId, tenantId) => AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    );
});

a365Observability.start();
```

When `Use_Custom_Resolver=true`, the message handler must exchange and cache the token manually:

```typescript
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';
import tokenCache, { createAgenticTokenCacheKey } from './token-cache';

// Inside handleMessage, before baggageScope.run():
const aauToken = await this.authorization.exchangeToken(turnContext, 'agentic', {
  scopes: getObservabilityAuthenticationScope()
});
tokenCache.set(createAgenticTokenCacheKey(agentId, tenantId), aauToken?.token ?? '');
```

---

## Advanced: InferenceScope — wrapping LLM calls with token telemetry

Use `InferenceScope` to record per-call token counts, finish reasons, and errors.
This is the pattern used in `client.ts` around each LangChain agent invocation.

```typescript
import {
  InferenceScope, InferenceOperationType,
  AgentDetails, InferenceDetails, Request,
} from '@microsoft/agents-a365-observability';

async invokeInferenceScope(prompt: string, turnContext: TurnContext): Promise<string> {
  const inferenceDetails: InferenceDetails = {
    operationName: InferenceOperationType.CHAT,
    model: 'gpt-4o-mini',
  };
  const request: Request = {
    conversationId: turnContext.activity.conversation?.id ?? `conv-${Date.now()}`,
  };
  const agentDetails: AgentDetails = {
    agentId:   turnContext.activity.recipient?.agenticAppId ?? 'unknown',
    agentName: 'MyAgent',
    tenantId:  turnContext.activity.recipient?.tenantId ?? 'unknown',
  };

  let response = '';
  const scope = InferenceScope.start(request, inferenceDetails, agentDetails);
  try {
    await scope.withActiveSpanAsync(async () => {
      response = await this.invokeAgent(prompt);
      scope.recordInputMessages([prompt]);
      scope.recordOutputMessages([response]);
      scope.recordInputTokens(/* actual count */ 45);
      scope.recordOutputTokens(/* actual count */ 78);
      scope.recordFinishReasons(['stop']);
    });
  } catch (error) {
    scope.recordError(error as Error);
    throw error;
  } finally {
    scope.dispose();
  }
  return response;
}
```

---

## Advanced: Custom Logger

```typescript
const a365Observability = ObservabilityManager.configure((builder) => {
  builder
    .withService('my-agent-service', '1.0.0')
    .withExporterOptions(exporterOptions)
    .withCustomLogger({
      info:  (msg, ...args) => console.log(`[OBS INFO]  ${msg}`, ...args),
      warn:  (msg, ...args) => console.warn(`[OBS WARN]  ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[OBS ERROR] ${msg}`, ...args),
      event: (name, success, durationMs, msg, details) =>
        console.log(`[OBS EVENT] ${name} success=${success} duration=${durationMs}ms`, details),
    })
    .withTokenResolver((agentId, tenantId) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    );
});
```

---

## .env Variables

> **Note:** If you ran `a365 setup`, `ENABLE_A365_OBSERVABILITY_EXPORTER=false` is **already
> present** in your `.env` file. Preserve this value when instrumenting.

```dotenv
# ── A365 Observability ────────────────────────────────────────────────────────
# Set to true to export to Microsoft Admin Center (production only).
# a365 setup automatically adds this with value "false".
ENABLE_A365_OBSERVABILITY_EXPORTER=false

# Shown in Microsoft Admin Center observability dashboard.
SERVICE_NAME=my-langchain-agent

# Log level: pipe-separated list of levels to emit.
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error

# Set to true to use a custom token resolver instead of AgenticTokenCacheInstance.
# Default: false (use built-in cache). Set to true for local testing with custom auth.
Use_Custom_Resolver=false
# ─────────────────────────────────────────────────────────────────────────────
```

### Local vs Production

| Variable | Local | Production |
|---|---|---|
| `ENABLE_A365_OBSERVABILITY_EXPORTER` | `false` | `true` |
| `Use_Custom_Resolver` | `true` (optional) | `false` |
| `NODE_ENV` | `development` | `production` (or set by `WEBSITE_SITE_NAME`) |
| JWT auth on `/api/messages` | skipped | enforced via `authorizeJWT(authConfig)` |

Production is detected via:
```typescript
const isProduction = Boolean(process.env.WEBSITE_SITE_NAME) || process.env.NODE_ENV === 'production';
```

---

## Key API Surface

| Symbol | Module | Purpose |
|--------|--------|---------|
| `ObservabilityManager.configure(fn)` | `@microsoft/agents-a365-observability` | Builder to configure service name, exporter options, token resolver, logger |
| `new Agent365ExporterOptions()` | `@microsoft/agents-a365-observability` | Exporter settings (e.g. `maxQueueSize`) |
| `builder.withExporterOptions(opts)` | — | Attach exporter options to the builder |
| `builder.start()` | — | Starts the OTel provider. Must be called before first span. |
| `BaggageBuilder` | `@microsoft/agents-a365-observability` | Fluent builder for tenant/agent/correlation baggage |
| `BaggageBuilderUtils.fromTurnContext(builder, ctx)` | `@microsoft/agents-a365-observability-hosting` | Populates baggage from a TurnContext automatically |
| `baggageScope.run(fn)` | — | Sync context scope |
| `baggageScope.runAsync(fn)` | — | Async context scope |
| `AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)` | `@microsoft/agents-a365-observability-hosting` | Retrieve cached observability token |
| `AgenticTokenCacheInstance.RefreshObservabilityToken(agentId, tenantId, turnContext, authorization, scopes)` | `@microsoft/agents-a365-observability-hosting` | Refresh and cache token for the current turn |
| `getObservabilityAuthenticationScope()` | `@microsoft/agents-a365-runtime` | Returns the OAuth2 scope string for the observability API |
| `InferenceScope.start(request, inferenceDetails, agentDetails)` | `@microsoft/agents-a365-observability` | Start an inference telemetry scope around an LLM call |
| `scope.withActiveSpanAsync(fn)` | — | Execute async work within the active OTel span |
| `scope.recordInputMessages(msgs)` / `scope.recordOutputMessages(msgs)` | — | Record prompts and completions |
| `scope.recordInputTokens(n)` / `scope.recordOutputTokens(n)` | — | Record token counts |
| `scope.recordFinishReasons(reasons)` | — | Record finish reasons (e.g. `['stop']`) |
| `scope.recordError(error)` | — | Record an error on the span |
| `scope.dispose()` | — | End and export the span (call in `finally`) |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `a365Observability.start()` not called | Add `.start()` call after `ObservabilityManager.configure()` |
| Spans missing baggage | Handler not wrapped in `baggageScope.runAsync` | Wrap existing handler body in the scope |
| Token resolver always returns `''` | `RefreshObservabilityToken` not called per turn | Call it at the start of each message handler turn |
| `Cannot find module '@microsoft/agents-a365-observability'` | Package not installed | Run `npm install @microsoft/agents-a365-observability` |
| `Cannot find module '@microsoft/agents-a365-observability-hosting'` | Package not installed | Run `npm install @microsoft/agents-a365-observability-hosting` |
| Traces not in Admin Center | Exporter env var not set | Set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in production |
| LangChain spans not captured | Need auto-instrumentation | Add LangChain OTel callbacks (community package) |
