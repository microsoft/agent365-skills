# Node.js — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Node.js agent. All samples mirror the official Microsoft Learn docs (updated 2026-04-22).

---

## npm Packages

| Package | Purpose |
|---------|---------|
| `@microsoft/agents-a365-observability` | `ObservabilityManager`, `BaggageBuilder`, `Agent365ExporterOptions`, `ObservabilityConfiguration`, all scope types |
| `@microsoft/agents-a365-observability-hosting` | `AgenticTokenCacheInstance`, `BaggageBuilderUtils`, `BaggageMiddleware`, `ObservabilityHostingManager`, `ScopeUtils` |
| `@microsoft/agents-a365-runtime` | `getObservabilityAuthenticationScope()`, `ClusterCategory` |

Install commands:
```bash
# Required for all agents
npm install @microsoft/agents-a365-observability
npm install @microsoft/agents-a365-runtime

# Required for AI Teammate agents (hosting path)
npm install @microsoft/agents-a365-observability-hosting

# Optional auto-instrumentation extensions
npm install @microsoft/agents-a365-observability-extensions-openai
npm install @microsoft/agents-a365-observability-extensions-langchain
```

Minimum Node.js: **18.x** (LTS). TypeScript: **5.x** recommended.

---

## Entry Point — Observability Init (before any LLM imports)

### Basic configuration (env-var driven)

```typescript
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';

// Call this at the top of main() or the entry file, before any LLM/agent imports.
const builder = ObservabilityManager.configure(builder =>
  builder
    .withService(process.env.SERVICE_NAME ?? 'my-agent', '1.0.0')
    .withTokenResolver((agentId, tenantId) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    )
);

builder.start();
// ENABLE_A365_OBSERVABILITY_EXPORTER env var controls whether spans go to console or A365.
```

### Programmatic configuration provider

```typescript
import { ObservabilityManager, ObservabilityConfiguration } from '@microsoft/agents-a365-observability';

const configProvider = new ObservabilityConfiguration({
  isObservabilityExporterEnabled: () => true,
  // Set log levels as pipe-separated values
  observabilityLogLevel: () => 'info|warn|error',
});

const builder = ObservabilityManager.configure(builder =>
  builder
    .withService('my-agent-service', '1.0.0')
    .withConfigurationProvider(configProvider)
    .withTokenResolver((agentId, tenantId) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    )
);

builder.start();
// Individual builder methods (withExporterOptions, withClusterCategory) take precedence over provider.
```

### Advanced configuration with exporter options

```typescript
import {
  ObservabilityManager,
  Agent365ExporterOptions,
} from '@microsoft/agents-a365-observability';
import { ClusterCategory } from '@microsoft/agents-a365-runtime';

const exporterOptions = new Agent365ExporterOptions();
exporterOptions.maxQueueSize = 10;

const builder = ObservabilityManager.configure(builder =>
  builder
    .withService('my-agent-service', '1.0.0')
    .withClusterCategory(ClusterCategory.prod)
    .withExporterOptions(exporterOptions)
    .withTokenResolver(tokenResolver)
);

builder.start();
```

### S2S configuration (`authMode: S2S`)

> **S2S path for Node.js is not yet officially documented.** The `useS2SEndpoint` flag exists on `Agent365ExporterOptions` but there is no official Node.js sample covering the FMI token chain equivalent (the background 3-hop acquisition that `.NET ObservabilityTokenService` provides). Treat the pattern below as provisional — verify the FMI hop requirement against MS Learn before shipping.
>
> Reference: [Agent observability — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/observability)

```typescript
// authMode: S2S — service principal, no user OBO.
// Token must be acquired via MSAL client credentials, NOT AgenticTokenCacheInstance.
import { ObservabilityManager, Agent365ExporterOptions } from '@microsoft/agents-a365-observability';
import { ConfidentialClientApplication } from '@azure/msal-node';

const msalApp = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.BLUEPRINT_CLIENT_ID!,
    clientSecret: process.env.BLUEPRINT_CLIENT_SECRET!,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
  },
});

const exporterOptions = new Agent365ExporterOptions();
exporterOptions.useS2SEndpoint = true;   // S2S-specific: different API endpoint

ObservabilityManager.configure(builder =>
  builder
    .withService(process.env.SERVICE_NAME ?? 'my-agent', '1.0.0')
    .withExporterOptions(exporterOptions)
    .withTokenResolver(async (_agentId, _tenantId) => {
      // Client credentials — no FMI hop yet confirmed for Node.js.
      // Verify against official sample once published.
      const result = await msalApp.acquireTokenByClientCredential({
        scopes: ['https://api.powerplatform.com/.default'],
      });
      return result?.accessToken ?? '';
    })
).start();
```

Message handler baggage setup is **identical** to `user-delegated` / `agentic-identity` — only the token resolver and `useS2SEndpoint` flag differ. Do **not** call `AgenticTokenCacheInstance.RefreshObservabilityToken` for S2S agents.

---

## Adapter — BaggageMiddleware

Register `BaggageMiddleware` to auto-populate baggage from every incoming `TurnContext`.
This removes the need to call `BaggageBuilder` manually in each activity handler.

```typescript
import { BaggageMiddleware } from '@microsoft/agents-a365-observability-hosting';

// Option 1: Register middleware directly on the adapter
adapter.use(new BaggageMiddleware());
// The middleware skips async replies (ContinueConversation) to avoid overwriting baggage.
```

```typescript
import { ObservabilityHostingManager } from '@microsoft/agents-a365-observability-hosting';

// Option 2: Use ObservabilityHostingManager for composite configuration
const manager = new ObservabilityHostingManager();
manager.configure(adapter, { enableBaggage: true });
```

---

## Message Handler — Token Refresh + BaggageBuilder

The built-in `AgenticTokenCacheInstance` handles caching. Call `RefreshObservabilityToken`
once per turn so the exporter always has a valid token.

```typescript
import { BaggageBuilder } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance, BaggageBuilderUtils } from '@microsoft/agents-a365-observability-hosting';
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';

// Inside your AgentApplication message handler / onActivity:
async function handleMessage(context: TurnContext, state: ApplicationTurnState) {
  const agentId  = context.activity.recipient?.agenticAppId ?? '';
  const tenantId = context.activity.recipient?.tenantId ?? '';

  // Refresh the observability token for this turn (non-fatal if it fails).
  try {
    await AgenticTokenCacheInstance.RefreshObservabilityToken(
      agentId,
      tenantId,
      context,
      agentApplication.authorization,
      getObservabilityAuthenticationScope()
    );
  } catch (e) {
    console.warn('[A365 Observability] Token refresh failed (non-fatal):', e);
  }

  // Build baggage from TurnContext and run agent logic inside the scope.
  // Skip if BaggageMiddleware is already registered on the adapter.
  const baggageScope = BaggageBuilderUtils
    .fromTurnContext(new BaggageBuilder(), context)
    .invokeAgentServer(context.activity.serviceUrl, 3978)
    .build();

  await baggageScope.run(async () => {
    // ... your LangChain invocation, tool calls, streaming, etc. ...
  });
}
```

---

## Manual Instrumentation Scopes

> **Store publishing requirement:** `InvokeAgentScope`, `InferenceScope`, and `ExecuteToolScope`
> are **required** for store validation. Missing any one causes store validation failure.

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
} from '@microsoft/agents-a365-observability';

// Use the same agentDetails and request instances across all scopes in a request.
const agentDetails: AgentDetails = {
  agentId: 'agent-456',
  agentName: 'Email Assistant',
  agentDescription: 'An AI agent powered by Azure OpenAI',
  agentAUID: 'auid-123',
  agentEmail: 'agent@contoso.com',  // note: interface field is agentAUID (uppercase UID)
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

#### InvokeAgentScope with ScopeUtils (hosting path — auto-populates from TurnContext)

```typescript
import { InvokeAgentScopeDetails, AgentDetails, ServiceEndpoint } from '@microsoft/agents-a365-observability';
import { ScopeUtils } from '@microsoft/agents-a365-observability-hosting';

const agentDetails: AgentDetails = { agentId: 'agent-456' };
const scopeDetails: InvokeAgentScopeDetails = {
  endpoint: { host: 'myagent.contoso.com', port: 443 } as ServiceEndpoint,
};

const scope = ScopeUtils.populateInvokeAgentScopeFromTurnContext(
  agentDetails,
  scopeDetails,
  context,     // TurnContext
  authToken    // authentication token string
);

try {
  await scope.withActiveSpanAsync(async () => {
    const response = await invokeAgent(context.activity.text);
    scope.recordOutputMessages([response]);
  });
} finally {
  scope.dispose();
}
```

### ExecuteToolScope

```typescript
import { ExecuteToolScope, ToolCallDetails } from '@microsoft/agents-a365-observability';

// Use the same agentDetails and request instances from InvokeAgentScope above.

const toolDetails: ToolCallDetails = {
  toolName: 'email-search',
  arguments: JSON.stringify({ query: 'from:boss@company.com', limit: 10 }),
  toolCallId: 'tool-call-456',
  description: 'Search emails by criteria',
  toolType: 'function',
  endpoint: {
    host: 'tools.contoso.com',
    port: 8080,
    protocol: 'https'
  },
};

const scope = ExecuteToolScope.start(request, toolDetails, agentDetails);

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

#### ExecuteToolScope with ScopeUtils

```typescript
import { ToolCallDetails } from '@microsoft/agents-a365-observability';
import { ScopeUtils } from '@microsoft/agents-a365-observability-hosting';

const toolDetails: ToolCallDetails = {
  toolName: 'email-search',
  arguments: JSON.stringify({ query: 'from:boss@company.com' }),
  toolCallId: 'tool-call-456',
  toolType: 'function',
};

const scope = ScopeUtils.populateExecuteToolScopeFromTurnContext(
  toolDetails,
  context,     // TurnContext
  authToken    // authentication token string
);

try {
  await scope.withActiveSpanAsync(async () => {
    const result = await searchEmails(toolDetails.arguments);
    scope.recordResponse(JSON.stringify(result));
  });
} finally {
  scope.dispose();
}
```

### InferenceScope

```typescript
import { InferenceScope, InferenceDetails, InferenceOperationType } from '@microsoft/agents-a365-observability';

// Use the same agentDetails and request instances from InvokeAgentScope above.

const inferenceDetails: InferenceDetails = {
  operationName: InferenceOperationType.CHAT,
  model: 'gpt-4o-mini',
  providerName: 'azure-openai',
};

const scope = InferenceScope.start(request, inferenceDetails, agentDetails);

try {
  return await scope.withActiveSpanAsync(async () => {
    scope.recordInputMessages(['Summarize the following emails for me...']);

    const response = await callLLM();

    scope.recordOutputMessages(['Here is your email summary...']);
    scope.recordInputTokens(145);
    scope.recordOutputTokens(82);
    scope.recordFinishReasons(['stop']);

    return response.text;
  });
} catch (error) {
  scope.recordError(error as Error);
  throw error;
} finally {
  scope.dispose();
}
```

#### InferenceScope with ScopeUtils

```typescript
import { InferenceDetails, InferenceOperationType } from '@microsoft/agents-a365-observability';
import { ScopeUtils } from '@microsoft/agents-a365-observability-hosting';

const inferenceDetails: InferenceDetails = {
  operationName: InferenceOperationType.CHAT,
  model: 'gpt-4o-mini',
  providerName: 'azure-openai',
};

const scope = ScopeUtils.populateInferenceScopeFromTurnContext(
  inferenceDetails,
  context,     // TurnContext
  authToken    // authentication token string
);

try {
  await scope.withActiveSpanAsync(async () => {
    const response = await callLLM();
    scope.recordOutputMessages([response.text]);
    scope.recordInputTokens(response.usage.inputTokens);
    scope.recordOutputTokens(response.usage.outputTokens);
  });
} finally {
  scope.dispose();
}
```

### OutputScope (async scenarios)

```typescript
import { OutputScope, OutputResponse, SpanDetails } from '@microsoft/agents-a365-observability';

// Use the same agentDetails and request instances from InvokeAgentScope above.

// Get the parent context from the originating scope
const parentContext = invokeScope.getSpanContext();

const response: OutputResponse = {
  messages: ['Here is your organized inbox with 15 urgent emails.'],
};

const scope = OutputScope.start(
  request,
  response,
  agentDetails,
  undefined, // userDetails
  { parentContext } as SpanDetails
);

// Output messages are recorded automatically from the response
scope.dispose();
```

---

## Advanced: Custom Token Resolver

```typescript
import { ObservabilityManager, Agent365ExporterOptions } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';
import { tokenResolver } from './token-cache'; // your custom resolver

const builder = ObservabilityManager.configure(builder =>
  builder
    .withService('my-langchain-agent', '1.0.0')
    .withExporterOptions(new Agent365ExporterOptions())
    .withTokenResolver(
      process.env.Use_Custom_Resolver === 'true'
        ? tokenResolver
        : (agentId, tenantId) => AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    )
);

builder.start();
```

---

## Auto-Instrumentation Extensions

### OpenAI Agents SDK

> **Peer dependency:** `@microsoft/agents-a365-observability-extensions-openai` requires
> `@openai/agents ^0.7.0` (the **OpenAI Agents SDK**) — this is NOT the `openai` npm package
> and NOT `@azure/openai`. Install the peer dep first:
> ```bash
> npm install @openai/agents@^0.7.0
> npm install @microsoft/agents-a365-observability-extensions-openai
> ```

```typescript
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { OpenAIAgentsTraceInstrumentor } from '@microsoft/agents-a365-observability-extensions-openai';

const sdk = ObservabilityManager.configure(builder =>
  builder.withService('My Agent Service', '1.0.0')
);

const instrumentor = new OpenAIAgentsTraceInstrumentor({
  enabled: true,
  tracerName: 'openai-agents-tracer',
  tracerVersion: '1.0.0'
});

sdk.start();
instrumentor.enable();
```

### LangChain

```typescript
import { ObservabilityManager } from '@microsoft/agents-a365-observability';
import { LangChainTraceInstrumentor } from '@microsoft/agents-a365-observability-extensions-langchain';
import * as LangChainCallbacks from '@langchain/core/callbacks/manager';

const sdk = ObservabilityManager.configure(builder =>
  builder.withService('My Agent Service', '1.0.0')
);

sdk.start();

// Enable LangChain auto-instrumentation
LangChainTraceInstrumentor.instrument(LangChainCallbacks);
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
SERVICE_NAME=my-agent

# Log level: pipe-separated list of levels to emit.
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error

# Set to true to use a custom token resolver instead of AgenticTokenCacheInstance.
# Default: false (use built-in cache). Set to true for local testing with custom auth.
Use_Custom_Resolver=false
# ─────────────────────────────────────────────────────────────────────────────
```

| Variable | Local | Production |
|---|---|---|
| `ENABLE_A365_OBSERVABILITY_EXPORTER` | `false` | `true` |
| `Use_Custom_Resolver` | `true` (optional) | `false` |
| `NODE_ENV` | `development` | `production` |

---

## Validate Locally

Set `ENABLE_A365_OBSERVABILITY_EXPORTER=false` — spans export to the console.

To investigate export failures, enable verbose logging:

```bash
ENABLE_A365_OBSERVABILITY_EXPORTER=true
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
```

Key console messages:

```text
[INFO]  [Agent365Exporter] Exporting 245 spans
[INFO]  [Agent365Exporter] Partitioned into 3 identity groups (2 spans skipped)
[INFO]  [Agent365Exporter] Token resolved successfully via tokenResolver
[EVENT] export-group succeeded in 98ms {"tenantId":"...","agentId":"...","correlationId":"abc-123"}
[ERROR] [Agent365Exporter] Failed with status 401, correlation ID: abc-123
[WARN]  export-partition-span-missing-identity: 5 spans skipped due to missing tenant or agent ID
```

Custom logger for capturing export events to a file:

```typescript
import { setLogger, ExporterEventNames } from '@microsoft/agents-a365-observability';

setLogger({
  info: (msg, ...args) => myLogger.info(msg, ...args),
  warn: (msg, ...args) => myLogger.warn(msg, ...args),
  error: (msg, ...args) => myLogger.error(msg, ...args),
  event: (eventType: ExporterEventNames, isSuccess: boolean, durationMs: number,
          message?: string, details?: Record<string, string>) => {
    myLogger.info({ eventType, isSuccess, durationMs, message, ...details });
  }
});
```

---

## Key API Surface

| Symbol | Module | Purpose |
|--------|--------|---------|
| `ObservabilityManager.configure(fn)` | `@microsoft/agents-a365-observability` | Builder to configure service name, exporter options, token resolver, logger |
| `ObservabilityConfiguration` | `@microsoft/agents-a365-observability` | Programmatic config provider (alternative to env vars) |
| `new Agent365ExporterOptions()` | `@microsoft/agents-a365-observability` | Exporter settings (`maxQueueSize`, `scheduledDelayMilliseconds`, etc.) |
| `builder.withConfigurationProvider(provider)` | — | Attach programmatic config provider |
| `builder.withClusterCategory(ClusterCategory.prod)` | — | Set cluster category |
| `builder.start()` | — | Starts the OTel provider. Must be called before first span. |
| `BaggageBuilder` | `@microsoft/agents-a365-observability` | Fluent builder for tenant/agent/correlation baggage |
| `BaggageBuilderUtils.fromTurnContext(builder, ctx)` | `@microsoft/agents-a365-observability-hosting` | Populates baggage from a TurnContext automatically |
| `BaggageMiddleware` | `@microsoft/agents-a365-observability-hosting` | Adapter middleware — auto-populates baggage for every request |
| `ObservabilityHostingManager` | `@microsoft/agents-a365-observability-hosting` | Composite hosting configuration |
| `ScopeUtils.populateInvokeAgentScopeFromTurnContext` | `@microsoft/agents-a365-observability-hosting` | Creates `InvokeAgentScope` from `TurnContext` |
| `ScopeUtils.populateExecuteToolScopeFromTurnContext` | `@microsoft/agents-a365-observability-hosting` | Creates `ExecuteToolScope` from `TurnContext` |
| `ScopeUtils.populateInferenceScopeFromTurnContext` | `@microsoft/agents-a365-observability-hosting` | Creates `InferenceScope` from `TurnContext` |
| `AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)` | `@microsoft/agents-a365-observability-hosting` | Retrieve cached observability token |
| `AgenticTokenCacheInstance.RefreshObservabilityToken(...)` | `@microsoft/agents-a365-observability-hosting` | Refresh and cache token for the current turn |
| `getObservabilityAuthenticationScope()` | `@microsoft/agents-a365-runtime` | Returns the OAuth2 scope string for the observability API. **Deprecated** in v0.2.0-preview.5 — still functional; modern replacement is `defaultObservabilityConfigurationProvider.getConfiguration().observabilityAuthenticationScopes` |
| `InvokeAgentScope.start(request, scopeDetails, agentDetails, callerDetails)` | `@microsoft/agents-a365-observability` | Start agent invocation telemetry scope |
| `ExecuteToolScope.start(request, toolDetails, agentDetails)` | `@microsoft/agents-a365-observability` | Start tool execution telemetry scope |
| `InferenceScope.start(request, inferenceDetails, agentDetails)` | `@microsoft/agents-a365-observability` | Start LLM inference telemetry scope |
| `OutputScope.start(request, response, agentDetails, userDetails, spanDetails)` | `@microsoft/agents-a365-observability` | Start output telemetry scope (async scenarios) |
| `scope.withActiveSpanAsync(fn)` | — | Execute async work within the active OTel span |
| `scope.recordInputMessages(msgs)` / `scope.recordOutputMessages(msgs)` | — | Record prompts and completions |
| `scope.recordInputTokens(n)` / `scope.recordOutputTokens(n)` | — | Record token counts |
| `scope.recordFinishReasons(reasons)` | — | Record finish reasons (e.g. `['stop']`) |
| `scope.recordError(error)` | — | Record an error on the span |
| `scope.dispose()` | — | End and export the span (call in `finally`) |

---

## Agent365ExporterOptions Properties

| Property | Description | Default |
|----------|-------------|---------|
| `useS2SEndpoint` | Use service-to-service endpoint path | `false` |
| `maxQueueSize` | Max queue size for batch processor | `2048` |
| `scheduledDelayMilliseconds` | Delay between export batches | `5000` |
| `exporterTimeoutMilliseconds` | Timeout for entire export operation | `90000` |
| `httpRequestTimeoutMilliseconds` | Timeout for each HTTP request | `30000` |
| `maxExportBatchSize` | Max batch size | `512` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `builder.start()` not called | Add `.start()` after `ObservabilityManager.configure()` |
| Spans missing baggage | Handler not wrapped in baggage scope | Register `BaggageMiddleware` or wrap handler body in `baggageScope.run()` |
| Token resolver always returns `''` | `RefreshObservabilityToken` not called per turn | Call it at the start of each message handler turn |
| `Cannot find module '@microsoft/agents-a365-observability'` | Package not installed | Run `npm install @microsoft/agents-a365-observability` |
| `Cannot find module '@microsoft/agents-a365-observability-hosting'` | Package not installed | Run `npm install @microsoft/agents-a365-observability-hosting` |
| Traces not in Admin Center | Exporter env var not set | Set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in production |
| 401 on export | Missing permission | Check if upgrading past `0.2.0-preview.1` (requires new `Agent365.Observability.OtelWrite` permission) |
| Spans dropped silently | Missing tenant/agent ID | Ensure `BaggageBuilder` (or `BaggageMiddleware`) populates tenant/agent ID before creating spans |
| TypeScript error on `agentAuid` in `AgentDetails` | Interface field is `agentAUID` (uppercase UID), not `agentAuid` | Change to `agentAUID: '...'` |
| `extensions-openai` install fails / peer dep error | Missing `@openai/agents` peer dep | Run `npm install @openai/agents@^0.7.0` first; this is the OpenAI Agents SDK, not the `openai` package |
| S2S: token resolver never called | `RefreshObservabilityToken` called for S2S | Remove `AgenticTokenCacheInstance.RefreshObservabilityToken` — not used in S2S; token comes from `withTokenResolver` in `ObservabilityManager.configure()` |
| `fromTurnContext` not found on `BaggageBuilder` | Static method is on `BaggageBuilderUtils`, not `BaggageBuilder` | Use `BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), context)` |
