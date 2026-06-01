# .NET AgentFramework — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a .NET AgentFramework agent. All samples mirror the official Microsoft Learn docs
(updated 2026-04-30).

---

## NuGet Packages

| Package | Purpose |
|---------|---------|
| `Microsoft.Agents.A365.Observability.Runtime` | `AddA365Tracing()`, `BaggageBuilder`, `EnvironmentUtils` — required for all agents |
| `Microsoft.Agents.A365.Observability.Hosting` | `AddAgenticTracingExporter()` — OBO token caching (obo / agentic-user); `AddServiceTracingExporter()` — S2S token cache (`IExporterTokenCache<string>`) |
| `Microsoft.Agents.A365.Observability.Hosting.Caching` | `IExporterTokenCache<T>`, `AgenticTokenStruct` |
| `Microsoft.Agents.A365.Observability.Hosting.Extensions` | `FromTurnContext()` extension on `BaggageBuilder` |
| `Microsoft.Agents.A365.Observability.Hosting.Middleware` | `BaggageTurnMiddleware`, `UseObservabilityRequestContext` |
| `Microsoft.Agents.A365.Observability.Runtime.Common` | `BaggageBuilder`, `EnvironmentUtils` |
| `Microsoft.Agents.A365.Observability.Runtime.Tracing.Exporters` | `Agent365ExporterOptions`, `Agent365ExporterType` |
| `Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts` | `AgentDetails`, `InvokeAgentScopeDetails`, `ToolCallDetails`, `InferenceCallDetails`, `Request`, `Channel`, `UserDetails`, `CallerDetails`, `Response`, `SpanDetails` |
| `Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes` | `InvokeAgentScope`, `ExecuteToolScope`, `InferenceScope`, `OutputScope` |
| `Microsoft.Agents.A365.Observability.Extensions.SemanticKernel` | **Legacy** — superseded by `o.Instrumentation.EnableSemanticKernelInstrumentation` in the unified distro |
| `Microsoft.Agents.A365.Observability.Extensions.OpenAI` | **Legacy** — superseded by `o.Instrumentation.EnableOpenAIInstrumentation` in the unified distro |
| `Microsoft.Agents.A365.Observability.Extensions.AgentFramework` | **Legacy** — superseded by `o.Instrumentation.EnableAgentFrameworkInstrumentation` in the unified distro |

Unified Distro (preferred — single package, GA as of 2026-05-01):

| Package | Purpose |
|---------|---------|
| `Microsoft.OpenTelemetry` (1.0.3 GA — latest stable) | All-in-one: includes A365 observability types (`BaggageBuilder`, `InvokeAgentScope`, `InferenceScope`, `ExecuteToolScope`, `IExporterTokenCache`, `ServiceTokenCache`, `AgentDetails`, etc.) plus OTel pipeline configuration. Targets `net8.0` and `netstandard2.0`. Auto-instrumentation toggles for SemanticKernel / OpenAI / AgentFramework / AspNetCore / HttpClient / SqlClient / AzureSdk are first-class options on `o.Instrumentation` (all default `true`). |
| `Azure.Identity` | `ManagedIdentityCredential` for MSI-based token acquisition |
| `Microsoft.Identity.Client` | MSAL `ConfidentialClientApplicationBuilder` with `.WithFmiPath()` for the FMI token chain |

Install commands (preferred for **all** paths — OBO / agentic-user / S2S / AI Teammate):
```bash
# Single unified distro — includes all observability types (BaggageBuilder, InvokeAgentScope,
# IExporterTokenCache<AgenticTokenStruct>, AgentDetails, CallerDetails, etc.) and
# auto-instrumentation toggles for SemanticKernel / OpenAI / AgentFramework / AspNetCore /
# HttpClient / SqlClient / AzureSdk.
dotnet add package Microsoft.OpenTelemetry

# S2S path only (FMI token chain for ObservabilityTokenService):
dotnet add package Azure.Identity
dotnet add package Microsoft.Identity.Client
```

> **Do NOT also add `Microsoft.Agents.A365.Observability.Runtime` or
> `Microsoft.Agents.A365.Observability.Hosting` as direct `<PackageReference>` entries
> alongside `Microsoft.OpenTelemetry`.** The distro re-exports their types internally;
> adding them directly creates **CS0433** duplicate-type errors for `AgentDetails`,
> `CallerDetails`, `IExporterTokenCache<T>`, etc. The distro pulls them in transitively —
> that's all you need.

> **Don't install the legacy `Microsoft.Agents.A365.Observability.Extensions.*` packages**
> either — the distro's auto-instrumentation toggles (`o.Instrumentation.Enable*`) replace
> them. Mixing the two produces duplicate spans.

Legacy two-package install (pre-distro, kept only for existing agents migrating off the
individual packages — pick one style per project):
```bash
# Legacy — do NOT combine with Microsoft.OpenTelemetry
dotnet add package Microsoft.Agents.A365.Observability.Runtime
dotnet add package Microsoft.Agents.A365.Observability.Hosting   # OBO/agentic-user only
```

---

## Program.cs — S2S Path (`authMode: s2s`)

Use this pattern for Agent (Non AI Teammate) agents that run without a signed-in user (`s2s` — Service Principal).
Requires two scaffold files in `Observability/` — create these before wiring Program.cs.

> **⚠️ Expected configuration (1.0.x GA):**
> - **UseS2SEndpoint:** The distro does NOT set `UseS2SEndpoint = true` on the internal `Agent365Exporter`. You MUST set `o.Agent365.Exporter.UseS2SEndpoint = true` in the `UseMicrosoftOpenTelemetry` options callback, or the exporter posts to `/observability/` (OBO path) instead of `/observabilityService/` (S2S path), causing HTTP 401.
> - **InferenceCallDetails:** The `providerName` parameter is required (not optional). Constructor: `(InferenceOperationType operationName, string model, string providerName, ...)`.
> - **ExecuteToolScope.RecordResponse:** Takes `string`, not `Response` object.
> - **UseManagedIdentity:** Set `false` for local dev. MSI only works on Azure infrastructure.

### Scaffold: `Observability/ObservabilityServiceExtensions.cs`

```csharp
using Microsoft.Agents.A365.Observability.Hosting.Caching;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace <ProjectNamespace>;

// Injectable singleton wrapping AgentDetails for single-tenant agents.
// Pass ctx.AgentDetails to InvokeAgentScope.Start() for span attributes.
public sealed class Agent365ObservabilityContext
{
    public AgentDetails AgentDetails { get; }
    internal Agent365ObservabilityContext(AgentDetails d) => AgentDetails = d;
}

public static class ObservabilityServiceExtensions
{
    // Registers S2S token cache, ObservabilityTokenService (if credentials are present),
    // and Agent365ObservabilityContext.
    // Config is written by `a365 setup all` under the Agent365Observability section.
    // When Agent365Observability credentials are missing, the agent still runs — spans are
    // emitted to the console exporter but not exported to the A365 service.
    public static IServiceCollection AddAgent365Observability(this IServiceCollection services)
    {
        services.AddSingleton<IExporterTokenCache<string>, ServiceTokenCache>();

        services.AddSingleton<Agent365ObservabilityContext>(sp =>
        {
            var obs = sp.GetRequiredService<IConfiguration>().GetSection("Agent365Observability");
            var agentDetails = new AgentDetails(
                agentId:          obs["AgentId"]          ?? "local-dev",
                agentName:        obs["AgentName"]        ?? "my-agent",
                agentDescription: obs["AgentDescription"] ?? "",
                agentBlueprintId: obs["AgentBlueprintId"] ?? "",
                tenantId:         obs["TenantId"]         ?? "local-dev");
            return new Agent365ObservabilityContext(agentDetails);
        });

        // Only start the background token service when the required credentials are configured.
        // Without these, the agent runs fine — observability spans go to the console exporter only.
        services.AddSingleton<ObservabilityTokenService>();
        services.AddHostedService(sp =>
        {
            var obs = sp.GetRequiredService<IConfiguration>().GetSection("Agent365Observability");
            var useManagedIdentity = !bool.TryParse(obs["UseManagedIdentity"], out var parsedUseManagedIdentity)
                || parsedUseManagedIdentity; // default true

            var hasCommonCredentials = !string.IsNullOrEmpty(obs["TenantId"])
                                    && !string.IsNullOrEmpty(obs["AgentId"])
                                    && !string.IsNullOrEmpty(obs["ClientId"])
                                    && !obs["TenantId"]!.StartsWith("<<");

            var hasClientSecret = !string.IsNullOrEmpty(obs["ClientSecret"])
                               && !obs["ClientSecret"]!.StartsWith("<<");

            var hasCredentials = hasCommonCredentials
                              && (useManagedIdentity || hasClientSecret);

            return new OptionalHostedService(
                hasCredentials ? sp.GetRequiredService<ObservabilityTokenService>() : null,
                sp.GetRequiredService<ILogger<ObservabilityTokenService>>(),
                hasCredentials ? null :
                    "Agent365Observability credentials not configured — skipping token service. " +
                    "Run 'a365 setup all' to enable A365 observability export.");
        });

        return services;
    }

    // Wrapper that conditionally starts a hosted service, allowing graceful skip.
    private sealed class OptionalHostedService(IHostedService? inner, ILogger logger, string? skipWarning = null) : IHostedService
    {
        public Task StartAsync(CancellationToken ct)
        {
            if (inner != null)
                return inner.StartAsync(ct);

            if (skipWarning != null)
                logger.LogWarning("{Warning}", skipWarning);

            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken ct) => inner?.StopAsync(ct) ?? Task.CompletedTask;
    }
}
```

### Scaffold: `Observability/ObservabilityTokenService.cs`

> **Important:** The recommended approach is the **3-hop FMI chain** using MSAL with `.WithFmiPath()`:
>
> ```
> Blueprint (client_credentials / MSI)
>   → Hop 1+2: FMI token (api://AzureADTokenExchange/.default with WithFmiPath(agentId))
>     → Agent Identity token
>       → Hop 3: Observability API token (scope=api://9b975845-388f-4429-889e-eab1ef63949c/.default)
> ```
>
> **Auth strategy** is controlled by `Agent365Observability:UseManagedIdentity`:
>   - `true` (production) — MSI → Blueprint FIC → Agent Identity → API
>   - `false` (local dev) — Client Secret → Blueprint FIC → Agent Identity → API
>
> **Note:** As of CLI 1.1, `a365 setup all` automatically grants `Agent365.Observability.OtelWrite` to the Agent Identity SP (both delegated and application). No manual role assignment is needed for newly provisioned agents.

```csharp
using Azure.Core;
using Azure.Identity;
using Microsoft.Agents.A365.Observability.Hosting.Caching;
using Microsoft.Identity.Client;

namespace <ProjectNamespace>;

// Acquires an Observability API token for A365 observability via a 3-hop FMI chain.
//   Hop 1+2: Blueprint authenticates (MSI in prod, client secret locally) →
//            gets T1 via .WithFmiPath(agentId) to Agent Identity.
//   Hop 3:   Agent Identity uses T1 as assertion → Observability API token.
//            (ServiceIdentity type — AADSTS82001 does not apply.)
//
// Auth strategy is controlled by Agent365Observability:UseManagedIdentity:
//   true  (production)  — MSI → Blueprint FIC → Agent Identity → API
//   false (local dev)   — Client Secret → Blueprint FIC → Agent Identity → API
internal sealed class ObservabilityTokenService : BackgroundService
{
    private static readonly string[] FmiScopes = ["api://AzureADTokenExchange/.default"];
    private static readonly string[] ObservabilityScopes = ["api://9b975845-388f-4429-889e-eab1ef63949c/.default"];
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(50);

    private readonly IExporterTokenCache<string> _tokenCache;
    private readonly ILogger<ObservabilityTokenService> _logger;
    private readonly string _blueprintClientId, _blueprintClientSecret, _tenantId, _agentId;
    private readonly bool _useManagedIdentity;

    public ObservabilityTokenService(
        IExporterTokenCache<string> tokenCache,
        ILogger<ObservabilityTokenService> logger,
        IConfiguration configuration)
    {
        _tokenCache = tokenCache;
        _logger = logger;
        var obs = configuration.GetSection("Agent365Observability");
        _tenantId              = obs["TenantId"]     ?? "";
        _agentId               = obs["AgentId"]      ?? "";
        _blueprintClientId     = obs["ClientId"]     ?? "";
        _blueprintClientSecret = obs["ClientSecret"] ?? "";
        _useManagedIdentity    = obs.GetValue<bool>("UseManagedIdentity", true);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ObservabilityTokenService started (UseManagedIdentity={UseMsi}).", _useManagedIdentity);
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
        string authority = $"https://login.microsoftonline.com/{_tenantId}";

        // Hop 1+2: Blueprint → T1 via FMI path
        // When UseManagedIdentity is true, try MSI first and fall back to client secret
        // on AuthenticationFailedException (e.g. when running locally without MSI).
        string t1Token;
        if (_useManagedIdentity)
        {
            try
            {
                t1Token = await AcquireT1ViaMsiAsync(authority, ct);
            }
            catch (AuthenticationFailedException ex)
            {
                _logger.LogWarning(ex, "MSI authentication failed; falling back to client secret.");
                t1Token = await AcquireT1ViaClientSecretAsync(authority, ct);
            }
        }
        else
        {
            t1Token = await AcquireT1ViaClientSecretAsync(authority, ct);
        }

        // Hop 3: Agent Identity uses T1 → Observability API token
        var obsResult = await ConfidentialClientApplicationBuilder
            .Create(_agentId)
            .WithClientAssertion((AssertionRequestOptions _) => Task.FromResult(t1Token))
            .WithAuthority(new Uri(authority)).Build()
            .AcquireTokenForClient(ObservabilityScopes)
            .ExecuteAsync(ct);

        _tokenCache.RegisterObservability(_agentId, _tenantId, obsResult.AccessToken, ObservabilityScopes);
        _logger.LogInformation("Observability token registered for agent {AgentId}.", _agentId);
    }

    private async Task<string> AcquireT1ViaMsiAsync(string authority, CancellationToken ct)
    {
        var assertion = await new ManagedIdentityCredential()
            .GetTokenAsync(new TokenRequestContext(["api://AzureADTokenExchange"]), ct);
        return (await ConfidentialClientApplicationBuilder
            .Create(_blueprintClientId)
            .WithClientAssertion((AssertionRequestOptions _) => Task.FromResult(assertion.Token))
            .WithAuthority(new Uri(authority)).Build()
            .AcquireTokenForClient(FmiScopes).WithFmiPath(_agentId)
            .ExecuteAsync(ct)).AccessToken;
    }

    private async Task<string> AcquireT1ViaClientSecretAsync(string authority, CancellationToken ct)
    {
        return (await ConfidentialClientApplicationBuilder
            .Create(_blueprintClientId)
            .WithClientSecret(_blueprintClientSecret)
            .WithAuthority(new Uri(authority)).Build()
            .AcquireTokenForClient(FmiScopes).WithFmiPath(_agentId)
            .ExecuteAsync(ct)).AccessToken;
    }
}
```

### Program.cs wiring

```csharp
using Microsoft.Agents.A365.Observability.Hosting.Caching;
using Microsoft.OpenTelemetry;

var builder = WebApplication.CreateBuilder(args);

// A365 Observability — S2S token cache + background token service + AgentDetails context.
// ObservabilityTokenService acquires tokens via a 3-hop FMI chain (Blueprint → Agent Identity → API)
// and registers them with the ServiceTokenCache every 50 minutes.
builder.Services.AddAgent365Observability();

// Microsoft OpenTelemetry distro — configures OTel tracing pipeline + A365 exporter.
// The token resolver reads from the ServiceTokenCache populated by ObservabilityTokenService.
// Note: tokenCache is resolved lazily after Build() via the closure over the local variable.
IExporterTokenCache<string>? tokenCache = null;
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Exporters = builder.Environment.IsDevelopment()
        ? ExportTarget.Agent365 | ExportTarget.Console
        : ExportTarget.Agent365;

    // ⚠️ Required for S2S: distro does NOT set this automatically (still manual opt-in in 1.0.x GA — defaults to false)
    o.Agent365.Exporter.UseS2SEndpoint = true;

    // Auto-instrumentation toggles (all default `true` in 1.0.x — uncomment to opt out)
    // o.Instrumentation.EnableSemanticKernelInstrumentation = false;
    // o.Instrumentation.EnableOpenAIInstrumentation = false;
    // o.Instrumentation.EnableAgentFrameworkInstrumentation = false;
    // o.Instrumentation.EnableAspNetCoreInstrumentation = false;
    // o.Instrumentation.EnableHttpClientInstrumentation = false;
    // o.Instrumentation.EnableSqlClientInstrumentation = false;
    // o.Instrumentation.EnableAzureSdkInstrumentation = false;

    o.Agent365.Exporter.TokenResolver = async (agentId, tenantId) =>
    {
        return tokenCache != null
            ? await tokenCache.GetObservabilityToken(agentId, tenantId)
            : null;
    };
});

// ... rest of service configuration ...

var app = builder.Build();
tokenCache = app.Services.GetService<IExporterTokenCache<string>>();

// ... rest of app configuration ...
```

---

## Program.cs — Hosting Path (AI Teammate / OBO, Microsoft.OpenTelemetry distro)

**Applies to:** AI Teammate agents and Standard .NET agents using OBO or agentic-user auth.
This is the **preferred** Program.cs wiring — a single distro package (`Microsoft.OpenTelemetry`)
handles everything. Do NOT also install `Microsoft.Agents.A365.Observability.Runtime` or
`Microsoft.Agents.A365.Observability.Hosting` as direct `<PackageReference>` entries — the
distro re-exports those types internally, and adding them directly causes **CS0433** duplicate-type
errors for `AgentDetails`, `CallerDetails`, `IExporterTokenCache<T>`, etc. Let them flow
transitively through `Microsoft.OpenTelemetry`.

```csharp
using Microsoft.OpenTelemetry;

var builder = WebApplication.CreateBuilder(args);

// Microsoft OpenTelemetry distro — configures OTel pipeline + A365 exporter in one call.
// For the OBO / agentic-user path the distro AUTO-REGISTERS
// IExporterTokenCache<AgenticTokenStruct> in DI, so MyAgent can inject it without any
// explicit AddAgenticTracingExporter() / AddA365Tracing() calls.
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Exporters = builder.Environment.IsDevelopment()
        ? ExportTarget.Agent365 | ExportTarget.Console
        : ExportTarget.Agent365;

    // Agent365-only export suppresses infrastructure instrumentation by default.
    // Re-enable explicitly so HTTP calls (Azure OpenAI, auth, Teams) appear in traces.
    o.Instrumentation.EnableAspNetCoreInstrumentation = true;
    o.Instrumentation.EnableHttpClientInstrumentation = true;
    o.Instrumentation.EnableAzureSdkInstrumentation = true;

    // Auto-instrumentation toggles (all default `true` in 1.0.x — uncomment to opt out)
    // o.Instrumentation.EnableSemanticKernelInstrumentation = false;
    // o.Instrumentation.EnableOpenAIInstrumentation = false;
    // o.Instrumentation.EnableAgentFrameworkInstrumentation = false;
    // o.Instrumentation.EnableSqlClientInstrumentation = false;

    // For OBO / agentic-user, leave UseS2SEndpoint at its default (false) — the exporter
    // will POST to `/observability/` which the OBO token cache authenticates. Only flip
    // this to true on the S2S Path.
});

// Required: IChatClient registration with `.UseOpenTelemetry(...)` — this is what makes
// the AI SDK emit `gen_ai.inference` / `gen_ai.tool` spans for every LLM call. Without it,
// no LLM spans exist for the InvokeAgentScope below to anchor as children.
//
// .UseFunctionInvocation()         → adds tool-call interception so ExecuteToolBySDK spans appear
// .UseOpenTelemetry(...)           → emits gen_ai.inference and gen_ai.tool spans
// EnableSensitiveData = true       → includes prompts/completions in span attributes (PII!)
//                                     Set to false in production or when handling regulated data.
builder.Services.AddSingleton<IChatClient>(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var endpoint   = cfg["AIServices:AzureOpenAI:Endpoint"] ?? throw new InvalidOperationException("Endpoint missing");
    var apiKey     = cfg["AIServices:AzureOpenAI:ApiKey"]   ?? throw new InvalidOperationException("ApiKey missing");
    var deployment = cfg["AIServices:AzureOpenAI:DeploymentName"] ?? throw new InvalidOperationException("DeploymentName missing");

    return new AzureOpenAIClient(new Uri(endpoint), new AzureKeyCredential(apiKey))
        .GetChatClient(deployment)
        .AsIChatClient()
        .AsBuilder()
        .UseFunctionInvocation()
        .UseOpenTelemetry(sourceName: null, (cfg) => cfg.EnableSensitiveData = true)
        .Build();
});

var app = builder.Build();

// Token caching is automatic — MyAgent calls `_agentTokenCache.RegisterObservability(...)`
// per turn (see "Agent Class — Message Handler (OBO Path)" section below).
```

> **Two `UseOpenTelemetry()` calls are required** to get a complete trace:
> 1. **On the `IChatClient`** (shown above) — emits `gen_ai.inference` and `gen_ai.tool` spans for each LLM call
> 2. **On the `ChatClientAgent`** (shown in "Set `ChatClientAgent.Id` to match" further down) — emits agent invocation spans
>
> Skipping the `IChatClient` call means no LLM spans appear in MAC, even though the agent
> wrapper itself emits spans. The `InvokeAgentScope` parent becomes a hollow span with no
> `InferenceCall` children.

### Required appsettings.json keys (OBO / AI Teammate)

`EnableAgent365Exporter` must be `true` — the SDK defaults it to `false` when absent, so
without it the exporter is wired but inert:

```json
{
  "EnableAgent365Exporter": true,
  "Agent365Observability": {
    "AgentId": "{{BOT_ID}}",
    "AgentName": "My Agent",
    "AgentDescription": "My agent description",
    "TenantId": "{{BOT_TENANT_ID}}",
    "AgentBlueprintId": "{{BLUEPRINT_ID}}",
    "ClientId": "{{BLUEPRINT_ID}}",
    "ClientSecret": "<<PLACEHOLDER>>"
  }
}
```

### Legacy two-package wiring (kept for reference, do not use with the distro)

The pre-distro wiring used two separate calls:

```csharp
// Legacy — use only if NOT using Microsoft.OpenTelemetry distro
builder.Services.AddAgenticTracingExporter();   // from Microsoft.Agents.A365.Observability.Hosting
builder.AddA365Tracing();                        // from Microsoft.Agents.A365.Observability.Runtime
```

These are subsumed by `UseMicrosoftOpenTelemetry()` and the distro package — mixing the
two causes CS0433 duplicate-type errors. Pick one wiring style per project.

---

## Graceful Shutdown

The OTel SDK must stay alive for the lifetime of the app. Disposing the SDK flushes pending telemetry and shuts down all providers. ASP.NET Core handles this automatically when `app.Run()` is used and the host receives `SIGTERM`/`SIGINT`:

```csharp
// In a standard WebApplication / Generic Host, the registered TracerProvider
// is disposed via the DI container on shutdown — no extra code needed.
// The Microsoft.OpenTelemetry distro plugs into IHostApplicationLifetime and
// flushes pending spans during the host's StopAsync.
app.Run();
```

For non-host scenarios (console apps, custom hosts), explicitly dispose the OTel SDK on shutdown:

```csharp
// Resolve the SDK / TracerProvider from DI and dispose at exit to flush pending spans.
using var scope = app.Services.CreateScope();
var sdk = scope.ServiceProvider.GetRequiredService<TracerProvider>();
// ... run work ...
sdk.Dispose();  // flushes export queues
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

## Agent Class — Message Handler (OBO Path, `authMode: obo` or `agentic-user`)

**Applies to:** any .NET agent that uses OBO or agentic-user authentication — including
both **AI Teammate** agents (`aiTeammate: true`, agentic identity from Teams) and **Standard
.NET agents** (non-AI-Teammate, OBO auth via `MsalUserAuthorization`). The single message
handler pattern below covers both Teams agentic turns AND Playground / WebChat OBO turns,
branching on `turnContext.IsAgenticRequest()`. For non-AI-Teammate S2S agents, use the S2S
Path section further down instead — autonomous agents can run on either OBO or S2S, so
the S2S Path applies specifically to the S2S auth mode, not to "autonomous" as a whole.

The message handler needs five things:

1. **Robust agent id resolution** — `Activity.GetAgenticInstanceId()` for agentic requests, `Utility.ResolveAgentIdentity(turnContext, oboToken)` for OBO requests.
2. **Baggage propagation** (`BaggageBuilder`) so the distro's `ActivityProcessor` copies tenant/agent id onto every child `gen_ai` span. Without this, the exporter logs `"spans skipped due to missing tenant or agent ID"`.
3. **Per-turn token registration** (`IExporterTokenCache<AgenticTokenStruct>.RegisterObservability`) so the exporter can OBO-exchange a token to POST traces.
4. **An `InvokeAgentScope` wrapping the LLM call** with `CallerDetails`. This emits the **`InvokeAgent`** event the MAC portal needs as the parent record for the trace UI — without it, Advanced Hunting shows only orphan `InferenceCall` / `ExecuteToolBySDK` rows and the agent-turn view never renders.
5. **A graceful skip when no real (agent, tenant) tuple is available**. Falling back to `Guid.Empty` creates a synthetic identity the exporter cannot authenticate, polluting traces with orphan groups and producing `"No token obtained. Skipping export for this identity."` warnings.

> **All `Microsoft.Agents.A365.Observability.*` types referenced below flow transitively
> through the `Microsoft.OpenTelemetry` distro package.** Do NOT add direct
> `<PackageReference>` entries for `Microsoft.Agents.A365.Observability.Hosting` or
> `.Runtime` — see the install-commands callout earlier in this doc.

```csharp
using Microsoft.Agents.Builder;
using Microsoft.Agents.Builder.App.UserAuth;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
// The four observability namespaces below are re-exported by Microsoft.OpenTelemetry;
// no separate package install required.
using Microsoft.Agents.A365.Observability.Hosting.Caching;
using Microsoft.Agents.A365.Observability.Runtime.Common;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;
using Microsoft.Agents.A365.Runtime.Utils;     // Utility.ResolveAgentIdentity
using System;
using System.Threading;
using System.Threading.Tasks;
// Alias to avoid clash with Bot Framework's Activity-flavored Request types
using ObsRequest = Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts.Request;

public class MyAgent : AgentApplication
{
    private readonly IExporterTokenCache<AgenticTokenStruct>? _agentTokenCache;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MyAgent> _logger;
    private readonly string? AgenticAuthHandlerName;
    private readonly string? OboAuthHandlerName;

    public MyAgent(
        AgentApplicationOptions options,
        IExporterTokenCache<AgenticTokenStruct> agentTokenCache,
        IConfiguration configuration,
        ILogger<MyAgent> logger) : base(options)
    {
        _agentTokenCache = agentTokenCache;
        _configuration = configuration;
        _logger = logger;
        AgenticAuthHandlerName = configuration["AgentApplication:AgenticAuthHandlerName"];
        OboAuthHandlerName     = configuration["AgentApplication:OboAuthHandlerName"];
    }

    protected async Task OnMessageAsync(
        ITurnContext turnContext,
        ITurnState turnState,
        CancellationToken cancellationToken)
    {
        // 1. Select auth handler for this turn (agentic vs OBO)
        var authHandlerName = turnContext.IsAgenticRequest()
            ? AgenticAuthHandlerName
            : OboAuthHandlerName;

        // 2. Resolve agent id — for agentic turns from Activity, for OBO turns from the user token
        string? resolvedAgentId = null;
        if (turnContext.Activity.IsAgenticRequest())
        {
            resolvedAgentId = turnContext.Activity.GetAgenticInstanceId();
        }
        else if (!string.IsNullOrEmpty(authHandlerName))
        {
            try
            {
                var oboToken = await UserAuthorization.GetTurnTokenAsync(
                    turnContext, authHandlerName, cancellationToken: cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(oboToken))
                {
                    resolvedAgentId = Utility.ResolveAgentIdentity(turnContext, oboToken);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not resolve agent id from OBO token; A365 observability skipped for this turn.");
            }
        }

        var resolvedTenantId = turnContext.Activity.Conversation?.TenantId
                            ?? turnContext.Activity.Recipient?.TenantId;

        var hasObservabilityIdentity = !string.IsNullOrEmpty(resolvedAgentId)
                                    && !string.IsNullOrEmpty(resolvedTenantId);

        // 3. Set baggage and register the token ONLY when we have a real identity.
        // Build() returns IDisposable; `using` accepts null and skips disposal.
        using IDisposable? baggageScope = hasObservabilityIdentity
            ? new BaggageBuilder()
                .TenantId(resolvedTenantId!)
                .AgentId(resolvedAgentId!)
                .Build()
            : null;

        if (hasObservabilityIdentity)
        {
            try
            {
                _agentTokenCache?.RegisterObservability(
                    resolvedAgentId!,
                    resolvedTenantId!,
                    new AgenticTokenStruct(
                        userAuthorization: UserAuthorization,
                        turnContext: turnContext,
                        authHandlerName: authHandlerName ?? string.Empty),
                    EnvironmentUtils.GetObservabilityAuthenticationScope());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to register observability token.");
            }
        }

        // 4. Open an InvokeAgentScope around the LLM call so an "InvokeAgent" event is emitted.
        // Required for MAC Advanced Hunting to render the agent turn UI and anchor children.
        InvokeAgentScope? invokeScope = null;
        if (hasObservabilityIdentity)
        {
            var obsConfig = _configuration.GetSection("Agent365Observability");

            // Write BOTH identity dimensions so MAC shows per-instance AND blueprint-rolled-up
            // activity. They become separate span tags:
            //   AgentId          → gen_ai.agent.id                   (this agentic INSTANCE)
            //   AgentBlueprintId → microsoft.a365.agent.blueprint.id (MAC roll-up to the blueprint)
            // If EITHER is empty MAC loses that grouping dimension. AgentId is resolved live
            // (GetAgenticInstanceId() = Recipient.AgenticAppId, or the OBO token); the .NET
            // recipient has NO blueprint field, so AgentBlueprintId MUST come from config
            // (stamped by `a365 setup all`) — guard against it being empty.
            var blueprintId = obsConfig["AgentBlueprintId"] ?? string.Empty;
            if (string.IsNullOrEmpty(blueprintId))
            {
                _logger.LogWarning(
                    "Agent365Observability:AgentBlueprintId is empty — MAC will only show per-instance " +
                    "activity, with no blueprint roll-up. Set it from a365.generated.config.json.");
            }
            var agentDetails = new AgentDetails(
                agentId:          resolvedAgentId!,
                agentName:        obsConfig["AgentName"]
                                  ?? _configuration["agentBlueprintDisplayName"]
                                  ?? "Agent Blueprint",
                agentDescription: obsConfig["AgentDescription"] ?? string.Empty,
                agentBlueprintId: blueprintId,
                tenantId:         resolvedTenantId!);

            var from = turnContext.Activity?.From;
            // Resolve the caller UPN so MAC's "User principal name" column is populated.
            // A direct Teams chat carries only an MRI + AadObjectId (no UPN) in From.Id, so
            // look it up from the Teams roster — see "Resolve caller UPN" below. Best-effort:
            // returns null on failure, in which case the UserEmail tag is simply omitted.
            var callerUpn = await ResolveCallerUpnAsync(turnContext, cancellationToken).ConfigureAwait(false);
            var callerDetails = new CallerDetails(
                userDetails: new UserDetails(
                    userId:    from?.AadObjectId ?? from?.Id ?? "unknown",
                    userName:  from?.Name ?? "unknown",
                    userEmail: callerUpn ?? string.Empty));

            var userText = turnContext.Activity?.Text ?? string.Empty;
            var scopeRequest = new ObsRequest(
                content:        userText,
                sessionId:      turnContext.Activity?.Conversation?.Id ?? "unknown",
                channel:        new Channel(turnContext.Activity?.ChannelId ?? "msteams"),
                conversationId: turnContext.Activity?.Conversation?.Id ?? "unknown");

            // Endpoint is metadata for the trace; build it from the Blueprint ID (a GUID — always
            // URI-safe) under the RFC 2606 reserved `.invalid` TLD. Avoids UriFormatException risk
            // from slugifying free-form display names that may contain hostname-invalid characters.
            var blueprintForUri = obsConfig["AgentBlueprintId"];
            var endpointUri = !string.IsNullOrEmpty(blueprintForUri)
                ? new Uri($"https://{blueprintForUri}.agent.invalid/")
                : new Uri("https://agent.invalid/");

            invokeScope = InvokeAgentScope.Start(
                request:       scopeRequest,
                scopeDetails:  new InvokeAgentScopeDetails(endpoint: endpointUri),
                agentDetails:  agentDetails,
                callerDetails: callerDetails);

            invokeScope.RecordInputMessages(new[] { userText });
        }

        try
        {
            // ... your existing message handling: GetClientAgent, RunStreamingAsync, etc.
            // Pass `resolvedAgentId` to your ChatClientAgent factory so its auto-instrumentation
            // tags gen_ai spans with the SAME agent.id as the baggage + invokeScope above
            // (see "Set ChatClientAgent.Id to match" below).
            //
            // var responseBuilder = new StringBuilder();
            // await foreach (var response in chatAgent.RunStreamingAsync(...)) {
            //     responseBuilder.Append(response.Text);
            // }
            // invokeScope?.RecordOutputMessages(new[] { responseBuilder.ToString() });
        }
        finally
        {
            invokeScope?.Dispose();
        }
    }
}
```

### Resolve caller UPN (AI Teammate / OBO — populates MAC "User principal name")

The observability SDK does **not** auto-populate the caller UPN — `CallerDetails.UserDetails.UserEmail` is the value MAC shows in its **"User principal name"** column, and you must set it. It's blank on the most common turn (a direct Teams 1:1 chat), because `Activity.From.Id` is an MRI (`29:…` / `8:orgid:…`), not a UPN. Notification / `@mention` / email turns *do* carry the UPN in `From.Id`.

Resolution order: (1) `From.Id` already contains `@` → it **is** the UPN; (3) otherwise look it up from the Teams roster via [`TeamsInfo.GetMemberAsync`](https://github.com/microsoft/Agents-for-net/blob/main/src/libraries/Extensions/Microsoft.Agents.Extensions.Teams/Connector/TeamsInfo.cs) (verified — returns `TeamsChannelAccount` with `.UserPrincipalName` / `.Email`). Cache per `conversation|member` (it's a network call). Requires `using Microsoft.Agents.Extensions.Teams.Connector;`.

```csharp
private static readonly ConcurrentDictionary<string, string> UpnCache = new();

// Best-effort: returns the caller's UPN/email, or null if the roster is unavailable.
// NEVER throws — a blank UPN must not break the turn (the tag is just omitted).
private static async Task<string?> ResolveCallerUpnAsync(ITurnContext turnContext, CancellationToken ct)
{
    var from = turnContext.Activity?.From;
    if (from?.Id is { } id && id.Contains('@')) return id;          // (1) already a UPN

    var convId = turnContext.Activity?.Conversation?.Id;
    var memberId = from?.AadObjectId ?? from?.Id;
    if (convId is null || memberId is null) return null;

    var cacheKey = $"{convId}|{memberId}";
    if (UpnCache.TryGetValue(cacheKey, out var hit)) return hit;     // (4) cache

    try
    {
        var member = await TeamsInfo.GetMemberAsync(turnContext, memberId, ct).ConfigureAwait(false);  // (3) roster
        var upn = member?.UserPrincipalName ?? member?.Email;
        if (upn is not null) UpnCache[cacheKey] = upn;
        return upn;
    }
    catch
    {
        return null;  // connector unavailable / permission gap — omit the tag, don't fail the turn
    }
}
```

> **S2S agents skip this entirely** — they have no signed-in user, so `UserEmail` comes from the Blueprint sponsor config (`Agent365Observability:Sponsor:UserEmail`), not the roster.

### Set `ChatClientAgent.Id` to match the resolved agent id

When you construct your `ChatClientAgent` for the turn, set `Id = resolvedAgentId` on `ChatClientAgentOptions`. This makes the AI SDK's auto-instrumentation tag `gen_ai` spans with the same `agent.id` baggage propagated above. Otherwise the SDK auto-generates a **fresh N-format GUID per turn**, producing orphan identity groups in the exporter that:

- Get logged as `"Obtained token for agent <random32hex> tenant ..."` followed by `"No token obtained. Skipping export for this identity."`
- Pollute the trace stream with spans the exporter cannot authenticate

```csharp
var chatClientOptions = new ChatClientAgentOptions
{
    Name        = obsConfig["AgentName"] ?? "Agent",
    ChatOptions = toolOptions,
    ChatHistoryProvider = new InMemoryChatHistoryProvider(...),
};
if (!string.IsNullOrEmpty(resolvedAgentId))
{
    chatClientOptions.Id = resolvedAgentId;
}
var chatAgent = new ChatClientAgent(chatClient, chatClientOptions)
    .AsBuilder()
    .UseOpenTelemetry(sourceName: null, (cfg) => cfg.EnableSensitiveData = true)
    .Build();
```

### Required `appsettings.json` keys for the OBO/AI Teammate path

`EnableAgent365Exporter` **must be `true`** — the SDK's `Microsoft.Agents.A365.Observability.Runtime.Builder` defaults it to `false` when absent, so without it the exporter is wired but inert.

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.Agents": "Warning",
      "Microsoft.Hosting.Lifetime": "Information",
      "OpenTelemetry": "Debug",
      "Microsoft.OpenTelemetry": "Debug",
      "Microsoft.Agents.A365.Observability": "Debug",
      "Microsoft.Agents.A365.Runtime": "Debug"
    }
  },
  "Agent365Observability": {
    "AgentId": "{{BOT_ID}}",
    "AgentName": "My Agent",
    "AgentDescription": "My agent description",
    "TenantId": "{{BOT_TENANT_ID}}",
    "AgentBlueprintId": "{{BLUEPRINT_ID}}",
    "ClientId": "{{BLUEPRINT_ID}}",
    "ClientSecret": "<<PLACEHOLDER>>"
  },
  "EnableAgent365Exporter": true
}
```

The `Microsoft.Agents.A365.Observability: Debug` log level is the key signal — it surfaces exporter activity (`Sending chunk ... to .../observability/tenants/.../traces`, `HTTP 200 exporting spans`, `Partitioned into N identity groups`, etc.). Drop it to `Warning` in production.

### Verifying end-to-end

After sending a turn, the agent log should show:

```
Agent365Exporter: Exporting batch of N spans.
[Agent365Exporter] M non-genAI spans filtered out
[Agent365Exporter] Partitioned into K identity groups (X spans skipped)
Agent365ExporterCore: Obtained token for agent <agentId> tenant <tenantId>.
Agent365ExporterCore: Sending chunk 1 of 1 (J spans, B bytes)
    to https://agent365.svc.cloud.microsoft/observability/tenants/<tenant>/otlp/agents/<agent>/traces?api-version=1.
Agent365ExporterCore: HTTP 200 exporting spans. 'x-ms-correlation-id': '<guid>'.
```

`HTTP 200 exporting spans` confirms the export reached the backend. In **MAC Advanced Hunting** (1–5 min ingestion lag):

```kql
CloudAppEvents
| where Timestamp > ago(15m)
| where ActionType == "InvokeAgent"
| where RawEventData contains "<your-agent-instance-id>"
| order by Timestamp desc
```

`InvokeAgent` rows confirm the parent event arrived; the Agent Detail view in MAC then renders the turn with `InferenceCall` / `ExecuteToolBySDK` children nested under it. Use the **agent instance id** (`Activity.GetAgenticInstanceId()`), NOT the blueprint id, for the `contains` filter — that's what `BaggageBuilder.AgentId(...)` puts on the spans.

---

## Agent Class — Message Handler (S2S Path, `authMode: s2s`)

Inject `Agent365ObservabilityContext` instead of `IExporterTokenCache<AgenticTokenStruct>`.
`ObservabilityTokenService` holds the token in the background — no per-turn `RegisterObservability` call.

```csharp
using Microsoft.Agents.Builder;
using Microsoft.Agents.A365.Observability.Hosting.Extensions;
using Microsoft.Agents.A365.Observability.Runtime.Common;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

public class MyAgent : AgentApplication
{
    // CallerDetails is read from Agent365Observability:Sponsor config — injected via
    // Agent365ObservabilityContext singleton (see ObservabilityServiceExtensions).
    // For S2S agents (no signed-in user), use the Blueprint sponsor's identity.
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
        // IMPORTANT: FromTurnContext() is an extension on BaggageBuilder only — it does NOT
        // exist on InvokeAgentScope. InvokeAgentScopeDetails has no parameterless constructor;
        // pass at least `endpoint`. Keep baggage and scope as two separate using statements.
        // authMode: s2s

        // Step 1: propagate baggage from the incoming turn.
        // Requires: using Microsoft.Agents.A365.Observability.Hosting.Extensions;
        using var baggageScope = new BaggageBuilder()
            .FromTurnContext(turnContext)
            .Build();

        // Step 2: start the invoke scope with CallerDetails (required for traces to show up).
        using var scope = InvokeAgentScope.Start(
            new Request(turnContext.Activity.Text),
            new InvokeAgentScopeDetails(endpoint: new Uri("https://your-agent-endpoint")),
            _obs.AgentDetails,
            _obs.CallerDetails);

        // ... existing agent message handling logic ...
    }
}
```

```csharp
// ObservabilityServiceExtensions.cs — DI registration with dynamic CallerDetails from config
public sealed class Agent365ObservabilityContext
{
    public AgentDetails AgentDetails { get; }
    public CallerDetails CallerDetails { get; }
    internal Agent365ObservabilityContext(AgentDetails d, CallerDetails c)
    {
        AgentDetails = d;
        CallerDetails = c;
    }
}

public static class ObservabilityServiceExtensions
{
    public static IServiceCollection AddAgent365Observability(this IServiceCollection services)
    {
        services.AddSingleton<Agent365ObservabilityContext>(sp =>
        {
            var obs = sp.GetRequiredService<IConfiguration>().GetSection("Agent365Observability");
            var agentDetails = new AgentDetails(
                agentId:          obs["AgentId"]          ?? "local-dev",
                agentName:        obs["AgentName"]        ?? "unknown",
                agentDescription: obs["AgentDescription"] ?? "",
                agentBlueprintId: obs["AgentBlueprintId"] ?? "",
                tenantId:         obs["TenantId"]         ?? "local-dev");

            // Read sponsor/caller details from config — enables trace visibility in MAC portal
            var sponsor = obs.GetSection("Sponsor");
            var callerDetails = new CallerDetails(
                userDetails: new UserDetails(
                    userId:    sponsor["UserId"]    ?? obs["ClientId"] ?? "unknown",
                    userName:  sponsor["UserName"]  ?? obs["AgentName"] ?? "Blueprint Sponsor",
                    userEmail: sponsor["UserEmail"] ?? ""));

            return new Agent365ObservabilityContext(agentDetails, callerDetails);
        });
        // ... rest of DI registration
        return services;
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
var userDetails = new UserDetails(
    userId: "user-123",
    userEmail: "jane.doe@contoso.com",
    userName: "Jane Doe"
);

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
    agentDetails: agentDetails,
    userDetails: userDetails
);

// ... your tool logic here ...

scope.RecordResponse("{\"summary\": \"The text was summarized.\"}");
```

### InferenceScope

```csharp
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Contracts;
using Microsoft.Agents.A365.Observability.Runtime.Tracing.Scopes;

// Use the same agentDetails and request instances from InvokeAgentScope above
var userDetails = new UserDetails(
    userId: "user-123",
    userEmail: "jane.doe@contoso.com",
    userName: "Jane Doe"
);

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
    agentDetails: agentDetails,
    userDetails: userDetails
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

**OBO path (`authMode: obo` or `agentic-user`):**

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

**S2S path (`authMode: s2s`):**

```json
{
  "Agent365Observability": {
    "AgentBlueprintId": "<<BLUEPRINT_APP_ID>>",
    "TenantId": "<<TENANT_ID>>",
    "AgentName": "<<AGENT_NAME>>",
    "AgentDescription": "<<AGENT_DESCRIPTION>>",
    "AgentId": "<<AGENT_IDENTITY_ID>>",
    "ClientId": "<<BLUEPRINT_APP_ID>>",
    "ClientSecret": "<<BLUEPRINT_CLIENT_SECRET>>",
    "UseManagedIdentity": true,
    "Sponsor": {
      "UserId": "<<BLUEPRINT_APP_ID>>",
      "UserName": "<<BLUEPRINT_NAME>>",
      "UserEmail": "<<BLUEPRINT_SPONSOR_EMAIL>>"
    }
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.Agents": "Warning",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  }
}
```

> **S2S auth note:** `UseManagedIdentity` defaults to `true`. In production (Azure), the service uses Managed Identity and the `ClientSecret` is only needed as a local-dev fallback. Set to `false` in `appsettings.Development.json` if you always want client-secret auth locally.
>
> **Sponsor note:** For S2S agents, the `Sponsor` section provides the `CallerDetails` required for MAC portal trace visibility. Use the Blueprint app ID as `UserId`, the Blueprint display name as `UserName`, and the agent sponsor's email as `UserEmail`.

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
  "EnableAgent365Exporter": true,
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
# For S2S exports, override to the Observability API scope used by FMI Hop 3.
A365_OBSERVABILITY_SCOPE_OVERRIDE=api://9b975845-388f-4429-889e-eab1ef63949c/.default

# ── Observability verbose logging ─────────────────────────────────────────
# OTEL_LOG_LEVEL controls the OpenTelemetry SDK's own internal logger
# (DEBUG / INFO / WARN / ERROR). A365_OBSERVABILITY_LOG_LEVEL is a
# pipe-separated list of levels emitted by the A365 exporter.
# Recommended: INFO + info|warn|error in prod; WARN + warn|error to reduce noise.
OTEL_LOG_LEVEL=INFO
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
```

The same `A365_OBSERVABILITY_LOG_LEVEL` value can be set under `Logging.LogLevel` in `appsettings.json` if you prefer config over env:

```jsonc
{
  "Logging": {
    "LogLevel": {
      "Microsoft.Agents.A365.Observability": "Information"
    }
  }
}
```

The env var takes a pipe-separated form (`info|warn|error`) matching the Node.js/Python convention; the appsettings form takes a single .NET `LogLevel` enum (`Information`, `Warning`, `Error`).

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
| `ServiceTokenCache` | `Microsoft.Agents.A365.Observability.Hosting.Caching` | S2S implementation of `IExporterTokenCache<string>` |
| `AgenticTokenStruct` | `Microsoft.Agents.A365.Observability.Hosting.Caching` | Wraps `TurnContext` + `UserAuthorization` + `AuthHandlerName` for token resolution. Uses **constructor** syntax: `new AgenticTokenStruct(userAuthorization: ..., turnContext: ..., authHandlerName: "AGENTIC")` |
| `Agent365ExporterOptions` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Exporters` | Exporter config (`TokenResolver`, `MaxQueueSize`, `ScheduledDelayMilliseconds`, etc.) |
| `Agent365ExporterType` | `Microsoft.Agents.A365.Observability.Runtime.Tracing.Exporters` | Enum for `AddA365Tracing()` exporter type param |
| `AddAgenticTracingExporter()` | `Microsoft.Agents.A365.Observability.Hosting` | DI extension for OBO token caching (`IExporterTokenCache<AgenticTokenStruct>`) — obo / agentic-user |
| `AddServiceTracingExporter()` | `Microsoft.Agents.A365.Observability.Hosting` | Legacy/manual DI extension for S2S token cache (`IExporterTokenCache<string>`) when not using the unified distro |
| `Agent365ObservabilityContext` | Scaffold (`Observability/`) | Singleton wrapping `AgentDetails` for S2S agents — inject instead of per-turn `RegisterObservability` |
| `ObservabilityTokenService` | Scaffold (`Observability/`) | `BackgroundService` — acquires the export token via the FMI 3-hop chain (`.WithFmiPath()` + agent assertion); refreshes every 50 min |
| `AddAgent365Observability()` | Scaffold (`Observability/`) | Registers `ServiceTokenCache`, `ObservabilityTokenService` (conditional), and `Agent365ObservabilityContext` |
| `UseMicrosoftOpenTelemetry()` | `Microsoft.OpenTelemetry` | Configures OTel pipeline with A365 exporter (preferred for S2S) |
| `ExportTarget` | `Microsoft.OpenTelemetry` | Enum: `Agent365`, `Console`, `AzureMonitor` |
| `AddA365Tracing()` | `Microsoft.Agents.A365.Observability.Runtime` | Registers OTel TracerProvider with A365 exporter |
| `BaggageTurnMiddleware` | `Microsoft.Agents.A365.Observability.Hosting.Middleware` | Adapter middleware — auto-populates baggage from every `ITurnContext` |
| `FromTurnContext()` | `Microsoft.Agents.A365.Observability.Hosting.Extensions` | Extension on **`BaggageBuilder` only** — auto-populates from activity. Does NOT exist on `InvokeAgentScope` or any scope type. |
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
- `Agent365Observability:Sponsor` values for `CallerDetails` (required for S2S agent trace visibility in MAC portal)

**When instrumenting observability:**
1. Preserve existing `EnableAgent365Exporter`, `AgentBlueprintId`, `TenantId` values
2. Add `Logging.LogLevel` section if missing
3. Populate `AgentName` and `AgentDescription` if empty

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No traces in console | OTel not wired | Call `builder.UseMicrosoftOpenTelemetry()` (or `builder.AddA365Tracing()` for OBO path) |
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
| S2S: token service skipped at startup | Placeholder or missing `Agent365Observability` credentials | Run `a365 setup all` or populate `TenantId`, `AgentId`, `ClientId`, and `ClientSecret` (when `UseManagedIdentity` is `false`) |
| S2S: 401 on export | Token acquired for wrong scope or app | Verify FMI Hop 3 scope is `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. For agents provisioned before CLI 1.1, verify Agent Identity SP has `Agent365.Observability.OtelWrite` app role via Entra portal |
| S2S: FMI Hop 1+2 fails | Blueprint credentials wrong or `.WithFmiPath(agentId)` target incorrect | Check `ClientId` (Blueprint app ID) and `ClientSecret` in appsettings; verify `AgentId` matches the Agent Identity app ID |
| S2S: FMI Hop 3 → 401 on export | Wrong scope or missing role | FMI Hop 3 scope is `api://9b975845-388f-4429-889e-eab1ef63949c/.default`; Agent Identity SP needs `OtelWrite` role assigned via Graph API |
| S2S: MSI fails locally | No Managed Identity available in dev | Set `UseManagedIdentity: false` in appsettings.Development.json, ensure `ClientSecret` is populated |
| S2S: `UseMicrosoftOpenTelemetry` not found | Unified distro not installed | Run `dotnet add package Microsoft.OpenTelemetry` (GA 1.0.2+) |
| Duplicate spans for SemanticKernel / OpenAI / AgentFramework | Both unified distro auto-instrumentation toggles and the legacy `Microsoft.Agents.A365.Observability.Extensions.*` packages are wired | Uninstall the `Extensions.*` packages — the distro's `o.Instrumentation.Enable*Instrumentation` toggles supersede them |
| S2S: HTTP 401 on span export (correct token) | `UseS2SEndpoint` not set — exporter posts to `/observability/` instead of `/observabilityService/` | Set `o.Agent365.Exporter.UseS2SEndpoint = true` in `UseMicrosoftOpenTelemetry` options |
| S2S: CS7036 on `InferenceCallDetails` — missing `providerName` | `providerName` is required (not optional) | Use: `new InferenceCallDetails(operationName: ..., model: ..., providerName: "Azure OpenAI")` |
| S2S: CS1503 on `ExecuteToolScope.RecordResponse` | Method takes `string`, not `Response` | Use: `toolScope.RecordResponse(resultString)` |
| S2S: `InvokeAgentScopeDetails` constructor error | No parameterless constructor exists | Pass at least `endpoint`: `new InvokeAgentScopeDetails(endpoint: new Uri("..."))` |
| S2S: `InvokeAgentScope` has no `FromTurnContext` | `FromTurnContext` is a `BaggageBuilder` extension only | Create `BaggageBuilder` separately: `new BaggageBuilder().FromTurnContext(tc).Build()` |
| Build error: `Azure.AI.OpenAI` version conflict with `Extensions.OpenAI` | Package requires `Azure.AI.OpenAI >= 2.7.0-beta.2` | Run `dotnet add package Azure.AI.OpenAI --version 2.7.0-beta.2` before adding the extension |
