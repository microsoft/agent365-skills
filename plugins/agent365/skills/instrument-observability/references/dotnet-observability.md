# .NET AgentFramework — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a .NET AgentFramework agent. All samples mirror the Agent365-Samples repository
patterns for `dotnet/agent-framework/sample-agent`.

---

## NuGet Packages

| Package | Purpose |
|---------|---------|
| `Microsoft.Agents.A365.Observability` | Core OTel tracer + BaggageBuilder + A365 exporter |
| `Microsoft.Agents.A365.Observability.Runtime` | AddA365Tracing() + AddAgenticTracingExporter() DI extensions |
| `Microsoft.Agents.A365.Observability.Extensions.SemanticKernel` | SK-specific auto-instrumentation (optional) |
| `Microsoft.Agents.A365.Observability.Extensions.AgentFramework` | AgentFramework auto-instrumentation (optional) |

Install commands:
```bash
dotnet add package Microsoft.Agents.A365.Observability
dotnet add package Microsoft.Agents.A365.Observability.Runtime
```

---

## Program.cs — Full Pattern (with agentic token resolver)

```csharp
using Microsoft.Agents.A365.Observability;
using Microsoft.Agents.A365.Observability.Runtime;
using Microsoft.Agents.A365.Observability.Caching;

var builder = WebApplication.CreateBuilder(args);

// ... existing service registrations ...

// ── A365 Observability ──────────────────────────────────────────────────────
// Registers the agentic token resolver. Tokens are acquired per-turn via
// TurnContext inside the agent class and cached automatically.
builder.Services.AddAgenticTracingExporter();

// Registers the OTel TracerProvider with the A365 exporter.
// Reads EnableAgent365Exporter from appsettings (false = console, true = A365 service).
builder.AddA365Tracing();
// ───────────────────────────────────────────────────────────────────────────

var app = builder.Build();
// ... rest of pipeline ...
```

---

## Program.cs — Standalone (manual token resolver, no TurnContext)

Use this pattern when the agent is not hosted via the AgentHosting framework.

```csharp
builder.Services.AddSingleton(sp => new Agent365ExporterOptions
{
    ClusterCategory = builder.Environment.IsProduction() ? "prod" : "dev",
    TokenResolver = async (agentId, tenantId) =>
    {
        // Implement caching here. Tokens expire ~60 min; cache for 55 min.
        return await myTokenProvider.GetObservabilityTokenAsync(agentId, tenantId);
    }
});

builder.AddA365Tracing();
```

---

## Agent Class — Message Handler

```csharp
using Microsoft.Agents.A365.Observability;
using Microsoft.Agents.A365.Observability.Caching;
using Microsoft.Agents.A365.Observability.Runtime;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Core.Models;
using Microsoft.Extensions.Logging;

public class SampleAgent : AgentApplication
{
    private readonly IExporterTokenCache<AgenticTokenStruct> _agentTokenCache;
    private readonly ILogger<SampleAgent> _logger;

    public SampleAgent(
        AgentApplicationOptions options,
        IExporterTokenCache<AgenticTokenStruct> agentTokenCache,
        ILogger<SampleAgent> logger) : base(options)
    {
        _agentTokenCache = agentTokenCache;
        _logger = logger;

        // Register message handler
        OnActivity(ActivityTypes.Message, MessageActivityAsync);
    }

    private async Task MessageActivityAsync(
        ITurnContext turnContext,
        ITurnState turnState,
        CancellationToken cancellationToken)
    {
        // ── A365 Observability: Baggage Context ─────────────────────────────
        using var baggageScope = new BaggageBuilder()
            .TenantId(turnContext.Activity.Recipient.TenantId)
            .AgentId(turnContext.Activity.Recipient.AgenticAppId)
            .CorrelationId(turnContext.Activity.Id)
            .Build();

        // Register the agentic token so the exporter can authenticate exports.
        try
        {
            _agentTokenCache.RegisterObservability(
                turnContext.Activity.Recipient.AgenticAppId,
                turnContext.Activity.Recipient.TenantId,
                new AgenticTokenStruct
                {
                    UserAuthorization = UserAuthorization,
                    TurnContext = turnContext
                },
                EnvironmentUtils.GetObservabilityAuthenticationScope()
            );
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Error registering observability token: {Message}", ex.Message);
        }
        // ────────────────────────────────────────────────────────────────────

        // ... existing agent message handling logic ...
    }
}
```

---

## appsettings.json — Complete Pattern

> **Note:** If you ran `a365 setup`, the following values are **already present** in your
> `appsettings.json`: `EnableAgent365Exporter: false`, `Agent365Observability.AgentBlueprintId`,
> and `Agent365Observability.TenantId`. Preserve these existing values when instrumenting.

```json
{
  "EnableAgent365Exporter": false,
  "Agent365Observability": {
    "AgentBlueprintId": "your-blueprint-id",
    "TenantId": "your-tenant-id",
    "AgentName": "My Agent",
    "AgentDescription": "Description of what this agent does"
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.Agents.A365.Observability": "Debug",
      "OpenTelemetry": "Debug"
    }
  }
}
```

> **Critical:** The `Logging.LogLevel` section is **required** for observability events to be
> captured in console output and forwarded to Microsoft Defender. Without this, the SDK is
> instrumented but logs are suppressed. The `a365 setup` command does **not** add logging
> configuration — you must add it manually or via this instrumentation skill.

## appsettings.Production.json

```json
{
  "EnableAgent365Exporter": true,
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Microsoft.Agents.A365.Observability": "Information",
      "OpenTelemetry": "Warning"
    }
  }
}
```

---

## Key Types Reference

| Type | Namespace | Purpose |
|------|-----------|---------|
| `BaggageBuilder` | `Microsoft.Agents.A365.Observability` | Propagates tenant/agent/correlation context through OTel spans |
| `Agent365ExporterOptions` | `Microsoft.Agents.A365.Observability` | Options for the A365 trace exporter (cluster category, token resolver) |
| `IExporterTokenCache<AgenticTokenStruct>` | `Microsoft.Agents.A365.Observability.Caching` | DI interface for caching and retrieving agentic tokens |
| `AgenticTokenStruct` | `Microsoft.Agents.A365.Observability.Caching` | Wraps TurnContext + UserAuthorization for token resolution |
| `EnvironmentUtils` | `Microsoft.Agents.A365.Observability.Runtime` | Helper to get the observability authentication scope |

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
| No traces in console | `EnableAgent365Exporter=true` but OTel not wired | Call `builder.AddA365Tracing()` |
| No logs in Defender | Missing `Logging.LogLevel` config | Add Microsoft.Agents.A365.Observability: Debug to appsettings.json |
| `AgenticAppId` is null | Missing `AGENTIC_APP_ID` env var | Set it in `.env` or App Service config |
| Token resolver returns null | `AddAgenticTracingExporter()` not called | Add to `Program.cs` DI |
| 401 from A365 exporter | OAuth consent not granted | Run `a365 setup permissions observability` |
| Build error: type not found | Missing `using` directive | Add `using Microsoft.Agents.A365.Observability;` |
