# Node.js LangChain — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Node.js LangChain agent. All samples mirror the Agent365-Samples repository
patterns for `nodejs/langchain`.

---

## npm Packages

| Package | Purpose |
|---------|---------|
| `@microsoft/agents-a365-observability` | OTel tracer + BaggageBuilder + ObservabilityManager + A365 exporter |
| `@microsoft/agents-a365-runtime` | getObservabilityAuthenticationScope() + runtime utilities |

Install commands:
```bash
npm install @microsoft/agents-a365-observability
npm install @microsoft/agents-a365-runtime
```

Minimum Node.js: **18.x** (LTS). TypeScript: **5.x** recommended.

---

## index.ts — Entry Point Pattern (must be first, before any agent init)

```typescript
// ── A365 Observability — initialize BEFORE any other imports that create spans ──
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';
import { observabilityTokenResolver } from './observabilityCache';

const observabilityBuilder = ObservabilityManager.configure(b =>
  b
    .withService(
      process.env.SERVICE_NAME ?? 'my-langchain-agent',
      process.env.npm_package_version ?? '1.0.0'
    )
    .withTokenResolver(observabilityTokenResolver)
);

observabilityBuilder.start();
// ─────────────────────────────────────────────────────────────────────────────

// ... rest of app setup and agent registration ...
```

---

## observabilityCache.ts — Token Resolver + Cache

Create this as a separate file to keep concerns separated.

```typescript
/**
 * observabilityCache.ts
 *
 * Simple per-tenant token cache for the A365 observability exporter.
 * In production, replace with Redis or an in-memory LRU cache.
 */

interface CachedToken {
  token: string;
  expiresAt: number;
}

const _cache = new Map<string, CachedToken>();

/**
 * Token resolver provided to ObservabilityManager.
 * Called by the A365 exporter before each export batch.
 */
export const observabilityTokenResolver = (agentId: string, tenantId: string): string => {
  const key = `${agentId}::${tenantId}`;
  const entry = _cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.token;
  }
  // Return empty — the message handler will populate via exchangeToken().
  // The exporter retries on next export interval (~30 s).
  return '';
};

/**
 * Called from the message handler after a successful agentic token exchange.
 * @param ttlSeconds Token lifetime in seconds (default 3300 = 55 min)
 */
export const cacheObservabilityToken = (
  agentId: string,
  tenantId: string,
  token: string,
  ttlSeconds = 3300
): void => {
  _cache.set(`${agentId}::${tenantId}`, {
    token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};
```

---

## Message Handler — Full Pattern

```typescript
import { TurnContext, TurnState, AgentApplication } from '@microsoft/agents-hosting';
import { ActivityTypes } from '@microsoft/agents-activity';
import { BaggageBuilder } from '@microsoft/agents-a365-observability';
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';
import { cacheObservabilityToken } from './observabilityCache';

export const agentApplication = new AgentApplication<TurnState>({
  authorization: { agentic: {} },
  storage,
});

agentApplication.onActivity(
  ActivityTypes.Message,
  async (context: TurnContext, state: TurnState) => {

    // ── A365 Observability: Baggage + Token ──────────────────────────────────
    const baggageScope = new BaggageBuilder()
      .tenantId(context.activity.recipient?.tenantId ?? '')
      .agentId(context.activity.recipient?.id ?? '')
      .correlationId(context.activity.id ?? '')
      .build();

    await baggageScope.runAsync(async () => {
      // Acquire and cache the observability token (best-effort — catch errors).
      try {
        const aauToken = await agentApplication.authorization.exchangeToken(
          context,
          'agentic',
          { scopes: getObservabilityAuthenticationScope() }
        );
        cacheObservabilityToken(
          context.activity.recipient?.id ?? '',
          context.activity.recipient?.tenantId ?? '',
          aauToken
        );
      } catch (e) {
        console.warn('[A365 Observability] Token exchange failed (non-fatal):', e);
      }
      // ────────────────────────────────────────────────────────────────────────

      // ── Existing LangChain agent logic ──────────────────────────────────────
      // ... your LangChain invocation, tool calls, streaming, etc. ...
      // ────────────────────────────────────────────────────────────────────────
    });
  }
);
```

---

## Advanced: Custom Logger

```typescript
const observabilityBuilder = ObservabilityManager.configure(b =>
  b
    .withService('my-agent-service', '1.0.0')
    .withCustomLogger({
      info:  (msg, ...args) => console.log(`[OBS INFO]  ${msg}`, ...args),
      warn:  (msg, ...args) => console.warn(`[OBS WARN]  ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[OBS ERROR] ${msg}`, ...args),
      event: (name, success, durationMs, msg, details) =>
        console.log(`[OBS EVENT] ${name} success=${success} duration=${durationMs}ms`, details),
    })
    .withTokenResolver(observabilityTokenResolver)
);
```

---

## .env Variables

> **Note:** If you ran `a365 setup`, `ENABLE_A365_OBSERVABILITY_EXPORTER=false` is **already
> present** in your `.env` file. Preserve this value when instrumenting.

```dotenv
# ── A365 Observability ────────────────────────────────────────────
# Set to true to export to Microsoft Admin Center (production only).
# a365 setup automatically adds this with value "false".
ENABLE_A365_OBSERVABILITY_EXPORTER=false

# Shown in Microsoft Admin Center observability dashboard.
SERVICE_NAME=my-langchain-agent

# Log level: pipe-separated list of levels to emit.
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
# ──────────────────────────────────────────────────────────────────────────
```

---

## Key API Surface

| Symbol | Module | Purpose |
|--------|--------|---------|
| `ObservabilityManager.configure(fn)` | `@microsoft/agents-a365-observability` | Builder to configure service name, token resolver, logger |
| `builder.start()` | — | Starts the OTel provider. Must be called before first span. |
| `BaggageBuilder` | `@microsoft/agents-a365-observability` | Fluent builder for tenant/agent/correlation baggage |
| `baggageScope.run(fn)` | — | Synchronous context scope |
| `baggageScope.runAsync(fn)` | — | Async context scope (use for async handlers) |
| `getObservabilityAuthenticationScope()` | `@microsoft/agents-a365-runtime` | Returns the OAuth2 scope for the observability API |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `ObservabilityManager.start()` not called | Add `observabilityBuilder.start()` at top of entry point |
| Spans missing baggage | Handler not wrapped in `baggageScope.runAsync` | Wrap existing handler body in the scope |
| Token resolver always returns `''` | Token exchange failing silently | Check auth config; inspect `console.warn` output |
| `Cannot find module '@microsoft/agents-a365-observability'` | Package not installed | Run `npm install @microsoft/agents-a365-observability` |
| Traces not in Admin Center | Exporter env var not set | Set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in production |
| LangChain spans not captured | Need auto-instrumentation | Add LangChain OTel callbacks (community package) |
