# .NET AgentFramework — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a .NET AgentFramework agent. All samples mirror the official Microsoft Learn docs
(updated 2026-04-22).

---

## NuGet Packages

| Package | Purpose |
|---------|---------|
| `Microsoft.Agents.A365.Observability.Runtime` | `AddA365Tracing()`, `BaggageBuilder`, `EnvironmentUtils` — required for all agents |
| `Microsoft.Agents.A365.Observability.Hosting` | `AddAgenticTracingExporter()` — OBO token caching (user-delegated / agentic-identity); `AddServiceTracingExporter()` — S2S token cache (`IExporterTokenCache<string>`) |
| `Microsoft.Agents.A365.Observability.Hosting.Caching` | `IExporterTokenCache<T>`, `AgenticTokenStruct` |
| `Microsoft.Agents.A365.Observability.Hosting.Extensions` | `FromTurnContext()` extension on `BaggageBuilder` |
| `Microsoft.Agents.A365.Observability.Hosting.Middleware` | `BaggageTurnMiddleware`, `UseObservabilityRequestContext` |
| `Microsoft.Agents.A365.Observability.Runtime.Common` | `BaggageBuilder`, `EnvironmentUtils` |
| `Microsoft.Agents.A365.Observability.Runtime.Tracing.Exporters` | `Agent365ExporterOptions`, `Agent365ExporterType` |
| `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | `AgentDetails`, `InvokeAgentScopeDetails`, `ToolCallDetails`, `InferenceCallDetails`, `Request`, `Channel`, `UserDetails`, `CallerDetails`, `Response`, `SpanDetails` |
| `Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes` | `InvokeAgentScope`, `ExecuteToolScope`, `InferenceScope`, `OutputScope` |
| `Microsoft.Agents.A365.Observability.Extensions.SemanticKernel` | SK auto-instrumentation (optional) |
| `Microsoft.Agents.A365.Observability.Extensions.OpenAI` | OpenAI auto-instrumentation (optional) |
| `Microsoft.Agents.A365.Observability.Extensions.AgentFramework` | AgentFramework auto-instrumentation (optional) |

Install commands:
```bash
# Required for all agents
dotnet add package Microsoft.Agents.A365.Observability.Runtime

# Required for OBO agents (authMode: user-delegated or agentic-identity)
dotnet add package Microsoft.Agents.A365.Observability.Hosting

# Required for S2S agents (authMode: S2S) — FMI token chain
dotnet add package Azure.Identity
dotnet add package Microsoft.Identity.Client

# Optional auto-instrumentation extensions
dotnet add package Microsoft.Agents.A365.Observability.Extensions.SemanticKernel
dotnet add package Microsoft.Agents.A365.Observability.Extensions.OpenAI
dotnet add package Microsoft.Agents.A365.Observability.Extensions.AgentFramework
```

---

## Program.cs — S2S Path (`authMode: S2S`)

Use this pattern for System Agents that run without a signed-in user (autonomous / S2S).
Requires two scaffold files in `Observability/` — create these before wiring Program.cs.

### Scaffold: `Observability/ObservabilityServiceExtensions.cs`

```csharp
using Microsoft.Agents.A365.Observability.Hosting;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace <ProjectNamespace>;

// Injectable singleton wrapping AgentDetails for S2S agents.
// Pass ctx.AgentDetails to InvokeAgentScope.Start() — no per-turn RegisterObservability needed.
public sealed class Agent365ObservabilityContext
{
    public AgentDetails AgentDetails { get; }
    internal Agent365ObservabilityContext(AgentDetails d) => AgentDetails = d;
}

public static class ObservabilityServiceExtensions
{
    // Registers IExporterTokenCache<string> (S2S variant), ObservabilityTokenService,
    // and Agent365ObservabilityContext. Config is written by `a365 setup all` under
    // the Agent365Observability section.
    public static IServiceCollection AddAgent365Observability(
        this IServiceCollection services,
        string? clusterCategory = "production")
    {
        services.AddServiceTracingExporter(clusterCategory);
        services.AddHostedService<ObservabilityTokenService>();
        services.AddSingleton<Agent365ObservabilityContext>(sp =>
        {
            var obs = sp.GetRequiredService<IConfiguration>().GetSection("Agent365Observability");
            var agentDetails = new AgentDetails(
                agentId:          obs["AgentId"],
                agentName:        obs["AgentName"],
                agentDescription: obs["AgentDescription"],
                agentBlueprintId: obs["AgentBlueprintId"],
                tenantId:         obs["TenantId"]
                    ?? throw new InvalidOperationException("Agent365Observability:TenantId is required."));
            return new Agent365ObservabilityContext(agentDetails);
        });
        return services;
    }
}
```

### Scaffold: `Observability/ObservabilityTokenService.cs`

```csharp
using Azure.Core;
using Azure.Identity;
using Microsoft.Agents.A365.Observability.Hosting.Caching;
using Microsoft.Identity.Client;

namespace <ProjectNamespace>;

// Background service that acquires a Power Platform export token via a 3-hop FMI chain
// and refreshes it every 50 minutes (tokens typically last 60–75 min).
//
// Hop 1+2: Blueprint → Agent identity token (T1) via WithFmiPath(agentId)
//   MSI in prod (ManagedIdentityCredential), client secret locally (fallback).
// Hop 3:   Agent identity uses T1 as assertion → Power Platform token.
internal sealed class ObservabilityTokenService : BackgroundService
{
    private static readonly string[] FmiScopes = ["api://AzureADTokenExchange/.default"];
    private static readonly string[] PowerPlatformScopes = ["https://api.powerplatform.com/.default"];
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(50);

    private readonly IExporterTokenCache<string> _tokenCache;
    private readonly ILogger<ObservabilityTokenService> _logger;
    private readonly string _blueprintClientId, _blueprintClientSecret, _tenantId, _agentId;

    public ObservabilityTokenService(
        IExporterTokenCache<string> tokenCache,
        ILogger<ObservabilityTokenService> logger,
        IConfiguration configuration)
    {
        _tokenCache = tokenCache;
        _logger = logger;
        var obs = configuration.GetSection("Agent365Observability");
        _tenantId              = obs["TenantId"]     ?? throw new InvalidOperationException("Agent365Observability:TenantId is required.");
        _agentId               = obs["AgentId"]      ?? throw new InvalidOperationException("Agent365Observability:AgentId is required.");
        _blueprintClientId     = obs["ClientId"]     ?? throw new InvalidOperationException("Agent365Observability:ClientId is required.");
        // ClientSecret is required even in production: MSI is tried first; secret is local-dev fallback.
        _blueprintClientSecret = obs["ClientSecret"] ?? throw new InvalidOperationException("Agent365Observability:ClientSecret is required.");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ObservabilityTokenService started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await AcquireAndRegisterTokenAsync(stoppingToken); }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            { _logger.LogWarning(ex, "Failed to acquire observability token; will retry in {Interval}.", RefreshInterval); }
            try { await Task.Delay(RefreshInterval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
        _logger.LogInformation("ObservabilityTokenService stopped.");
    }

    private async Task AcquireAndRegisterTokenAsync(CancellationToken ct)
    {
        string t1Token;
        string authority = $"https://login.microsoftonline.com/{_tenantId}";

        // Hop 1+2: Blueprint → T1 (MSI in prod, client secret locally)
        // ManagedIdentityCredential uses resource URI (no /.default); FmiScopes uses /.default — intentional.
        try
        {
            var assertion = await new ManagedIdentityCredential()
                .GetTokenAsync(new TokenRequestContext(["api://AzureADTokenExchange"]), ct);
            t1Token = (await ConfidentialClientApplicationBuilder
                .Create(_blueprintClientId)
                .WithClientAssertion((AssertionRequestOptions _) => Task.FromResult(assertion.Token))
                .WithAuthority(new Uri(authority)).Build()
                .AcquireTokenForClient(FmiScopes).WithFmiPath(_agentId)
                .ExecuteAsync(ct)).AccessToken;
        }
        catch (AuthenticationFailedException)
        {
            // MSI unavailable — fall back to client secret (local dev)
            t1Token = (await ConfidentialClientApplicationBuilder
                .Create(_blueprintClientId)
                .WithClientSecret(_blueprintClientSecret)
                .WithAuthority(new Uri(authority)).Build()
                .AcquireTokenForClient(FmiScopes).WithFmiPath(_agentId)
                .ExecuteAsync(ct)).AccessToken;
        }

        // Hop 3: Agent identity uses T1 → Power Platform token
        var ppResult = await ConfidentialClientApplicationBuilder
            .Create(_agentId)
            .WithClientAssertion((AssertionRequestOptions _) => Task.FromResult(t1Token))
            .WithAuthority(new Uri(authority)).Build()
            .AcquireTokenForClient(PowerPlatformScopes)
            .ExecuteAsync(ct);

        _tokenCache.RegisterObservability(_agentId, _tenantId, ppResult.AccessToken, PowerPlatformScopes);
        _logger.LogInformation("Observability token registered for agent {AgentId}.", _agentId);
    }
}
```

### Program.cs wiring

```csharp
using Microsoft.Agents.A365.Observability.Runtime;

var builder = WebApplication.CreateBuilder(args);

// Registers IExporterTokenCache<string>, ObservabilityTokenService, Agent365ObservabilityContext.
builder.Services.AddAgent365Observability(clusterCategory: "production");

// Registers the OTel TracerProvider with the A365 exporter.
builder.AddA365Tracing();

// Optional: with auto-instrumentation extensions
builder.AddA365Tracing(configure: tracingBuilder =>
{
    // tracingBuilder.WithSemanticKernel();
    // tracingBuilder.WithOpenAI();
    // tracingBuilder.WithAgentFramework();
});
```

---

## Program.cs — Hosting Path (AI Teammate, auto token caching)

Use this pattern when the agent uses the AI Teammate hosting framework.

```csharp
using Microsoft.Agents.A365.Observability.Runtime;
using Microsoft.Agents.A365.Observability.Hosting;

var builder = WebApplication.CreateBuilder(args);

// Registers IExporterTokenCache<AgenticTokenStruct> in DI — handles token caching automatically.
builder.Services.AddAgenticTracingExporter();

// Registers the OTel TracerProvider with the A365 exporter.
builder.AddA365Tracing();

var app = builder.Build();

// Optional: register HTTP-level baggage middleware (before the Bot Framework pipeline)
// app.UseObservabilityRequestContext((httpContext) =>
// {
//     var tenantId = GetTenantIdFromContext(httpContext);
//     var agentId = GetAgentIdFromContext(httpContext);
//     return (tenantId, agentId);
// });
```

---

## Adapter — BaggageTurnMiddleware

Register `BaggageTurnMiddleware` to auto-populate baggage from every incoming `ITurnContext`.
This removes the need to call `BaggageBuilder` manually in each activity handler.

```csharp
using Microsoft.Agents.A365.Observability.Hosting.Middleware;

adapter.Use(new BaggageTurnMiddleware());
// The middleware skips async replies (ContinueConversation) to avoid overwriting baggage.
```

For HTTP-level baggage (before the Bot Framework pipeline), register via `UseObservabilityRequestContext`:

```csharp
using Microsoft.Agents.A365.Observability.Hosting.Middleware;

app.UseObservabilityRequestContext((httpContext) =>
{
    var tenantId = GetTenantIdFromContext(httpContext);
    var agentId = GetAgentIdFromContext(httpContext);
    return (tenantId, agentId);
});
```

---

## Agent Class — Message Handler (OBO Path, `authMode: user-delegated` or `agentic-identity`)

```csharp
using Microsoft.Agents.Builder;
using Microsoft.Agents.Builder.App.UserAuth;
using Microsoft.Extensions.Logging;
using Microsoft.Agents.A365.Observability.Hosting.Caching;
using Microsoft.Agents.A365.Observability.Runtime.Common;
using System;
using System.Threading.Tasks;

public class MyAgent : AgentApplication
{
    private readonly IExporterTokenCache<AgenticTokenStruct> _agentTokenCache;
    private readonly ILogger<MyAgent> _logger;

    public MyAgent(
        AgentApplicationOptions options,
        IExporterTokenCache<AgenticTokenStruct> agentTokenCache,
        ILogger<MyAgent> logger) : base(options)
    {
        _agentTokenCache = agentTokenCache ?? throw new ArgumentNullException(nameof(agentTokenCache));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    protected async Task MessageActivityAsync(
        ITurnContext turnContext,
        ITurnState turnState,
        CancellationToken cancellationToken)
    {
        // Option A: Manual BaggageBuilder (use if BaggageTurnMiddleware is NOT registered)
        // Build() returns IDisposable — use `using var` to scope the baggage context.
        using var baggageScope = new BaggageBuilder()
            .TenantId(turnContext.Activity.Recipient.TenantId)
            .AgentId(turnContext.Activity.Recipient.AgenticAppId)
            .Build();

        // Option B: FromTurnContext helper (preferred — auto-populates from activity)
        // Requires: using Microsoft.Agents.A365.Observability.Hosting.Extensions;
        // using var baggageScope = new BaggageBuilder()
        //     .FromTurnContext(turnContext)
        //     .Build();

        // Register the agentic token so the exporter can authenticate exports.
        try
        {
            _agentTokenCache.RegisterObservability(
                turnContext.Activity.Recipient.AgenticAppId,
                turnContext.Activity.Recipient.TenantId,
                new AgenticTokenStruct(
                    userAuthorization: UserAuthorization,
                    turnContext: turnContext,
                    authHandlerName: "AGENTIC"
                ),
                EnvironmentUtils.GetObservabilityAuthenticationScope()
            );
        }
        catch (Exception ex)
        {
            _logger.LogWarning($"Error registering for observability: {ex.Message}");
        }

        // ... existing agent message handling logic ...
    }
}
```

---

## Agent Class — Message Handler (S2S Path, `authMode: S2S`)

Inject `Agent365ObservabilityContext` instead of `IExporterTokenCache<AgenticTokenStruct>`.
`ObservabilityTokenService` holds the token in the background — no per-turn `RegisterObservability` call.

```csharp
using Microsoft.Agents.Builder;
using Microsoft.Agents.A365.Observability.Runtime.Common;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

public class MyAgent : AgentApplication
{
    private readonly Agent365ObservabilityContext _obs;

    public MyAgent(AgentApplicationOptions options, Agent365ObservabilityContext obs)
        : base(options)
    {
        _obs = obs;
    }

    protected async Task MessageActivityAsync(
        ITurnContext turnContext,
        ITurnState turnState,
        CancellationToken cancellationToken)
    {
        // No RegisterObservability() call — ObservabilityTokenService holds the token.
        // Chain .FromTurnContext() on the scope (not on BaggageBuilder) to propagate baggage.
        // authMode: S2S
        using var scope = InvokeAgentScope.Start(
            new Request(turnContext.Activity.Text),
            new InvokeAgentScopeDetails(),
            _obs.AgentDetails)
            .FromTurnContext(turnContext);

        // ... existing agent message handling logic ...
    }
}
```

---

## Manual Instrumentation Scopes

> **Store publishing requirement:** `InvokeAgentScope`, `InferenceScope`, and `ExecuteToolScope`
> are **required** for store validation. Missing any one causes store validation failure.

### InvokeAgentScope

```csharp
using System;
using System.Threading.Tasks;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

var agentDetails = new AgentDetails(
    agentId: "agent-456",
    agentName: "MyAgent",
    agentDescription: "Handles user requests.",
    agenticUserId: "auid-123",
    agenticUserEmail: "agent@contoso.com",
    agentBlueprintId: "blueprint-789",
    tenantId: "tenant-123"
);

var scopeDetails = new InvokeAgentScopeDetails(
    endpoint: new Uri("https://myagent.contoso.com")
);

var request = new Request(
    content: userInput,
    sessionId: "session-abc",
    channel: new Channel("msteams"),
    conversationId: "conv-xyz"
);

var callerDetails = new CallerDetails(
    userDetails: new UserDetails(
        userId: "user-123",
        userEmail: "jane.doe@contoso.com",
        userName: "Jane Doe"
    )
);

// Start the scope — dispose automatically ends the span
using var scope = InvokeAgentScope.Start(
    request: request,
    scopeDetails: scopeDetails,
    agentDetails: agentDetails,
    callerDetails: callerDetails
);

scope.RecordInputMessages(new[] { userInput });

// ... your agent logic here ...

scope.RecordOutputMessages(new[] { output });
```

### ExecuteToolScope

```csharp
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

// Use the same agentDetails and request instances from InvokeAgentScope above

var toolCallDetails = new ToolCallDetails(
    toolName: "summarize",
    arguments: "{\"text\": \"...\"}",
    toolCallId: "tc-001",
    description: "Summarize provided text",
    toolType: "function",
    endpoint: new Uri("https://tools.contoso.com:8080")
);

using var scope = ExecuteToolScope.Start(
    request: request,
    details: toolCallDetails,
    agentDetails: agentDetails
);

// ... your tool logic here ...

scope.RecordResponse("{\"summary\": \"The text was summarized.\"}");
```

### InferenceScope

```csharp
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

// Use the same agentDetails and request instances from InvokeAgentScope above

var inferenceDetails = new InferenceCallDetails(
    operationName: InferenceOperationType.Chat,
    model: "gpt-4o-mini",
    providerName: "Azure OpenAI",
    inputTokens: 123,
    outputTokens: 456,
    finishReasons: new[] { "stop" }
);

using var scope = InferenceScope.Start(
    request: request,
    details: inferenceDetails,
    agentDetails: agentDetails
);

// ... your inference logic here ...

scope.RecordOutputMessages(new[] { "AI response message" });
scope.RecordInputTokens(123);
scope.RecordOutputTokens(456);
```

### OutputScope (async scenarios)

```csharp
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

// Use the same agentDetails and request instances from InvokeAgentScope above

// Get the parent context from the originating scope
var parentContext = invokeScope.GetActivityContext();

var response = new Response(new[] { "Here is your organized inbox with 15 urgent emails." });

using var scope = OutputScope.Start(
    request: request,
    response: response,
    agentDetails: agentDetails,
    spanDetails: new SpanDetails(parentContext: parentContext)
);
// Output messages are recorded automatically from the response
```

---

## appsettings.json — Complete Pattern

> **Note:** If you ran `a365 setup`, the following values are **already present** in your
> `appsettings.json`: `EnableAgent365Exporter: false`, `Agent365Observability.AgentBlueprintId`,
> and `Agent365Observability.TenantId`. Preserve these existing values when instrumenting.

```json
{
  "EnableAgent365Exporter": true,
  "Agent365Observability": {
    "AgentBlueprintId": "your-blueprint-id",
    "TenantId": "your-tenant-id",
    "AgentName": "My Agent",
    "AgentDescription": "Description of what this agent does"
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.Agents.A365.Observability": "Information",
      "OpenTelemetry": "Warning"
    }
  }
}
```

> **Critical:** The `Logging.LogLevel` section is **required** for observability events to be
> captured in console output and forwarded to Microsoft Defender. Without this, the SDK is
> instrumented but logs are suppressed. The `a365 setup` command does **not** add logging
> configuration — you must add it manually or via this instrumentation skill.

> **Local dev convention:** Set `EnableAgent365Exporter: false` in `appsettings.Development.json`
> to keep local runs console-only. The main `appsettings.json` should have it **enabled** so
> deployed environments export by default without requiring an env override.

## appsettings.Development.json

```json
{
  "EnableAgent365Exporter": false,
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.Agents.A365.Observability": "Debug",
      "OpenTelemetry": "Debug"
    }
  }
}
```

## Validate Locally

Set `EnableAgent365Exporter` to `false` in `appsettings.Development.json` — spans export to the console.

To investigate export failures, enable verbose logging:

```json
{
  "EnableAgent365Exporter": "True",
  "Logging": {
    "LogLevel": {
      "Microsoft.Agents.A365.Observability": "Debug"
    }
  }
}
```

Or set environment variables:

```bash
EnableAgent365Exporter=True
A365_OBSERVABILITY_DOMAIN_OVERRIDE=https://your-test-endpoint.example.com
A365_OBSERVABILITY_SCOPE_OVERRIDE=https://api.powerplatform.com/.default
```

Key log messages:

```text
info: Agent365ExporterCore: Obtained token for agent {agentId} tenant {tenantId}.
info: Agent365ExporterCore: Sending {count} spans to {requestUri} for agent {agentId} tenant {tenantId}.
info: Agent365ExporterCore: HTTP {statusCode} exporting spans. 'x-ms-correlation-id': '{correlationId}'.
error: Agent365Exporter: Exception exporting spans: {exception}
warn: Agent365ExporterCore: No token obtained for agent {agentId} tenant {tenantId}. Skipping export.
```

> If you don't register an `ILoggerFactory` in DI, the exporter automatically falls back to a console logger.

---

## Key Types Reference

| Type | Namespace | Purpose |
|------|-----------|---------|
| `BaggageBuilder` | `Microsoft.Agents.A365.Observability.Runtime.Common` | Propagates context across spans; `Build()` returns `IDisposable` — use `using var` |
| `EnvironmentUtils` | `Microsoft.Agents.A365.Observability.Runtime.Common` | `GetObservabilityAuthenticationScope()` helper |
| `IExporterTokenCache<T>` | `Microsoft.Agents.A365.Observability.Hosting.Caching` | DI interface for caching and retrieving agentic tokens |
| `AgenticTokenStruct` | `Microsoft.Agents.A365.Observability.Hosting.Caching` | Wraps `TurnContext` + `UserAuthorization` + `AuthHandlerName` for token resolution. Uses **constructor** syntax: `new AgenticTokenStruct(userAuthorization: ..., turnContext: ..., authHandlerName: "AGENTIC")` |
| `Agent365ExporterOptions` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Exporters` | Exporter config (`TokenResolver`, `MaxQueueSize`, `ScheduledDelayMilliseconds`, etc.) |
| `Agent365ExporterType` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Exporters` | Enum for `AddA365Tracing()` exporter type param |
| `AddAgenticTracingExporter()` | `Microsoft.Agents.A365.Observability.Hosting` | DI extension for OBO token caching (`IExporterTokenCache<AgenticTokenStruct>`) — user-delegated / agentic-identity |
| `AddServiceTracingExporter()` | `Microsoft.Agents.A365.Observability.Hosting` | DI extension for S2S token cache (`IExporterTokenCache<string>`) — used by `AddAgent365Observability()` |
| `Agent365ObservabilityContext` | Scaffold (`Observability/`) | Singleton wrapping `AgentDetails` for S2S agents — inject instead of per-turn `RegisterObservability` |
| `ObservabilityTokenService` | Scaffold (`Observability/`) | `BackgroundService` — 3-hop FMI token acquisition; refreshes every 50 min |
| `AddAgent365Observability()` | Scaffold (`Observability/`) | Registers `AddServiceTracingExporter`, `ObservabilityTokenService`, and `Agent365ObservabilityContext` in one call |
| `AddA365Tracing()` | `Microsoft.Agents.A365.Observability.Runtime` | Registers OTel TracerProvider with A365 exporter |
| `BaggageTurnMiddleware` | `Microsoft.Agents.A365.Observability.Hosting.Middleware` | Adapter middleware — auto-populates baggage from every `ITurnContext` |
| `FromTurnContext()` | `Microsoft.Agents.A365.Observability.Hosting.Extensions` | Extension on `BaggageBuilder` — auto-populates from activity |
| `InvokeAgentScope` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes` | Required for store publishing — wrap top-level message handler |
| `ExecuteToolScope` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes` | Required for store publishing — wrap each tool call |
| `InferenceScope` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes` | Required for store publishing — wrap each LLM call |
| `OutputScope` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes` | For async scenarios where parent scope can't capture output synchronously |
| `AgentDetails` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | Agent identity for scope telemetry |
| `InvokeAgentScopeDetails` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | Endpoint details for `InvokeAgentScope` |
| `ToolCallDetails` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | Tool info for `ExecuteToolScope` |
| `InferenceCallDetails` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | Model/token info for `InferenceScope` |
| `CallerDetails` / `UserDetails` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | Caller identity |

---

## Agent365ExporterOptions Properties

| Property | Description | Default |
|----------|-------------|---------|
| `UseS2SEndpoint` | Use service-to-service endpoint path | `false` |
| `MaxQueueSize` | Max queue size for batch processor | `2048` |
| `ScheduledDelayMilliseconds` | Delay between export batches | `5000` |
| `ExporterTimeoutMilliseconds` | Timeout for export operation | `30000` |
| `MaxExportBatchSize` | Max batch size | `512` |

---

## Configuration Sources

The `a365 setup` command (as of April 2026) automatically writes the following to `appsettings.json`:

```json
{
  "EnableAgent365Exporter": false,
  "Agent365Observability": {
    "AgentBlueprintId": "<from-setup>",
    "TenantId": "<from-setup>",
    "AgentName": "",
    "AgentDescription": ""
  }
}
```

**What `a365 setup` does NOT add:**
- `Logging.LogLevel` configuration (required for Defender visibility)

**When instrumenting observability:**
1. Preserve existing `EnableAgent365Exporter`, `AgentBlueprintId`, `TenantId` values
2. Add `Logging.LogLevel` section if missing
3. Populate `AgentName` and `AgentDescription` if empty

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No traces in console | OTel not wired | Call `builder.AddA365Tracing()` |
| No logs in Defender | Missing `Logging.LogLevel` config | Add `Microsoft.Agents.A365.Observability: Debug` to appsettings.json |
| `AgenticAppId` is null | Missing `AGENTIC_APP_ID` env var | Set it in `.env` or App Service config |
| Token resolver returns null | `AddAgenticTracingExporter()` not called | Add to `Program.cs` DI |
| 401 from A365 exporter | OAuth consent not granted | Run `a365 setup permissions observability`; also check if upgrading past `0.3-beta` (requires new `Agent365.Observability.OtelWrite` permission) |
| Build error on `BaggageBuilder` | Wrong namespace | Use `Microsoft.Agents.A365.Observability.Runtime.Common` |
| Build error on `AgenticTokenStruct` | Object initializer syntax used | Use constructor: `new AgenticTokenStruct(userAuthorization: ..., turnContext: ..., authHandlerName: "AGENTIC")` |
| Build error on `IExporterTokenCache` | Wrong namespace | Use `Microsoft.Agents.A365.Observability.Hosting.Caching` |
| Build error on `AddAgenticTracingExporter` | Wrong namespace | Use `Microsoft.Agents.A365.Observability.Hosting` |
| Build error on `AddA365Tracing` | Wrong namespace | Use `Microsoft.Agents.A365.Observability.Runtime` |
| Spans dropped silently | Missing tenant/agent ID in baggage | Ensure `BaggageBuilder` is set up before creating spans, or register `BaggageTurnMiddleware` |
| S2S: `InvalidOperationException` on startup | Missing `Agent365Observability:ClientId` or `TenantId` | Add `ClientId`, `ClientSecret`, `TenantId`, `AgentId` to `Agent365Observability` section in appsettings |
| S2S: Token never registered | MSI and client secret both failed | Check `ObservabilityTokenService` logs; ensure MSI is assigned in prod or `ClientSecret` is set for local dev |
| S2S: 401 on export | FMI chain not completing | Verify `AgentId` in appsettings matches the agent's Entra app ID; check `WithFmiPath` is supported in current MSAL version |
| S2S: `AddServiceTracingExporter` not found | Hosting package not installed | Run `dotnet add package Microsoft.Agents.A365.Observability.Hosting` |
