# .NET AI Teammate Reference Patterns

Authoritative code patterns for the `make-ai-teammate` skill — .NET AgentFramework variant.
Source: [Agent365-Samples/dotnet/agent-framework/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent)

---

## Required NuGet Packages

Add to the `.csproj` file:

```xml
<!-- A365 SDK Packages -->
<PackageReference Include="Microsoft.Agents.A365.Notifications" Version="*-beta.*" />
<PackageReference Include="Microsoft.Agents.A365.Tooling.Extensions.AgentFramework" Version="*-beta.*" />
<PackageReference Include="Microsoft.Agents.A365.Observability.Extensions.AgentFramework" Version="*-beta.*" />

<!-- Agent Framework Packages -->
<PackageReference Include="Microsoft.Agents.AI" Version="1.0.0-preview.*" />
<PackageReference Include="Microsoft.Agents.Authentication.Msal" Version="1.3.*-*" />
<PackageReference Include="Microsoft.Agents.Hosting.AspNetCore" Version="1.3.*-*" />
<PackageReference Include="Microsoft.Extensions.AI.OpenAI" Version="9.10.0-preview.*" />
<PackageReference Include="Azure.AI.OpenAI" Version="2.5.0-beta.*" />
<PackageReference Include="Azure.Identity" Version="1.17.0" />

<!-- OpenTelemetry -->
<PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.12.0" />
<PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.12.0" />
<PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.12.0" />
<PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.12.0" />
<PackageReference Include="OpenTelemetry.Instrumentation.Runtime" Version="1.12.0" />
```

Install via dotnet CLI (example):
```bash
dotnet add package Microsoft.Agents.A365.Notifications --prerelease
dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease
dotnet add package Microsoft.Agents.A365.Observability.Extensions.AgentFramework --prerelease
dotnet add package Microsoft.Agents.AI --prerelease
dotnet add package Microsoft.Agents.Authentication.Msal
dotnet add package Microsoft.Agents.Hosting.AspNetCore
dotnet add package Microsoft.Extensions.AI.OpenAI --prerelease
dotnet add package Azure.AI.OpenAI --prerelease
dotnet add package Azure.Identity
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
dotnet add package OpenTelemetry.Instrumentation.Runtime
```

---

## Program.cs — Startup / Service Registration

```csharp
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using YourNamespace;
using YourNamespace.Agent;
using Microsoft.Agents.A365.Observability;
using Microsoft.Agents.A365.Observability.Extensions.AgentFramework;
using Microsoft.Agents.A365.Tooling.Extensions.AgentFramework.Services;
using Microsoft.Agents.A365.Tooling.Services;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Hosting.AspNetCore;
using Microsoft.Agents.Storage;
using Microsoft.Extensions.AI;
using Azure;
using Azure.AI.OpenAI;

var builder = WebApplication.CreateBuilder(args);

// OpenTelemetry (Aspire service defaults or manual setup)
builder.ConfigureOpenTelemetry();

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();
builder.Logging.AddConsole();

// ────── A365 Services ──────────────────────────────────────────────────────

// A365 agentic tracing exporter (sends spans to Microsoft Defender)
builder.Services.AddAgenticTracingExporter(clusterCategory: "production");

// A365 tracing with Agent Framework integration
builder.AddA365Tracing(config =>
{
    config.WithAgentFramework();
});

// WorkIQ MCP tooling service (loaded per-turn from ToolingManifest.json)
builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>();

// ────── Auth & Storage ─────────────────────────────────────────────────────

builder.Services.AddAgentAspNetAuthentication(builder.Configuration);
builder.Services.AddSingleton<IStorage, MemoryStorage>();

// ────── Agent ─────────────────────────────────────────────────────────────

builder.AddAgentApplicationOptions();
builder.AddAgent<MyAgent>();  // Replace MyAgent with your agent class name

// ────── IChatClient (Azure OpenAI) ────────────────────────────────────────

builder.Services.AddSingleton<IChatClient>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var endpoint  = config["AIServices:AzureOpenAI:Endpoint"] ?? string.Empty;
    var apiKey    = config["AIServices:AzureOpenAI:ApiKey"] ?? string.Empty;
    var deployment = config["AIServices:AzureOpenAI:DeploymentName"] ?? string.Empty;

    return new AzureOpenAIClient(new Uri(endpoint), new AzureKeyCredential(apiKey))
        .GetChatClient(deployment)
        .AsIChatClient()
        .AsBuilder()
        .UseFunctionInvocation()
        .UseOpenTelemetry(sourceName: "agent.inference",
            configure: cfg => cfg.EnableSensitiveData = true)
        .Build();
});

// ──────────────────────────────────────────────────────────────────────────

var app = builder.Build();

if (app.Environment.IsDevelopment())
    app.UseDeveloperExceptionPage();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// /api/messages — main Teams / A365 message endpoint
app.MapPost("/api/messages", async (HttpRequest request, HttpResponse response,
    IAgentHttpAdapter adapter, IAgent agent, CancellationToken cancellationToken) =>
{
    await adapter.ProcessAsync(request, response, agent, cancellationToken);
});

// /api/health — health check (no auth required)
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", timestamp = DateTime.UtcNow }));

if (app.Environment.IsDevelopment() || app.Environment.EnvironmentName == "Playground")
{
    app.MapGet("/", () => "Agent Framework Sample Agent");
    app.UseDeveloperExceptionPage();
    app.MapControllers().AllowAnonymous();
    app.Urls.Add("http://localhost:3978");
}
else
{
    app.MapControllers();
}

app.Run();
```

---

## Agent/MyAgent.cs — AgentApplication Subclass

```csharp
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using Microsoft.Agents.A365.Observability.Caching;
using Microsoft.Agents.A365.Runtime.Utils;
using Microsoft.Agents.A365.Tooling.Extensions.AgentFramework.Services;
using Microsoft.Agents.AI;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Builder.App;
using Microsoft.Agents.Builder.State;
using Microsoft.Agents.Core.Models;
using Microsoft.Extensions.AI;
using System.Collections.Concurrent;

namespace YourNamespace.Agent
{
    public class MyAgent : AgentApplication
    {
        private const string AgentWelcomeMessage = "Hello! I can help you find information based on what I can access.";
        private const string AgentHireMessage = "Thank you for hiring me! Looking forward to assisting you!";
        private const string AgentFarewellMessage = "Thank you for your time, I enjoyed working with you.";

        // Non-interpolated raw string — {{ToolName}} placeholders are literal.
        // {userName} is the ONLY dynamic token; injected via GetAgentInstructions().
        private static readonly string AgentInstructionsTemplate = """
        You will speak like a friendly and professional virtual assistant.

        The user's name is {userName}. Use their name naturally where appropriate.

        Use the tools available to you to help answer the user's questions.
        """;

        private static string GetAgentInstructions(string? userName)
        {
            string safe = string.IsNullOrWhiteSpace(userName) ? "unknown" : userName.Trim();
            // Strip control characters to prevent prompt injection
            safe = System.Text.RegularExpressions.Regex.Replace(safe, @"[\p{Cc}\p{Cf}]", " ").Trim();
            if (safe.Length > 64) safe = safe[..64].TrimEnd();
            if (string.IsNullOrWhiteSpace(safe)) safe = "unknown";
            return AgentInstructionsTemplate.Replace("{userName}", safe, StringComparison.Ordinal);
        }

        private readonly IChatClient? _chatClient;
        private readonly IConfiguration? _configuration;
        private readonly IExporterTokenCache<AgenticTokenStruct>? _agentTokenCache;
        private readonly ILogger<MyAgent>? _logger;
        private readonly IMcpToolRegistrationService? _toolService;
        private readonly string? AgenticAuthHandlerName;
        private readonly string? OboAuthHandlerName;
        private static readonly ConcurrentDictionary<string, List<AITool>> _agentToolCache = new();

        public static bool TryGetBearerTokenForDevelopment(out string? bearerToken)
        {
            bearerToken = Environment.GetEnvironmentVariable("BEARER_TOKEN");
            return !string.IsNullOrEmpty(bearerToken);
        }

        public MyAgent(
            AgentApplicationOptions options,
            IChatClient chatClient,
            IConfiguration configuration,
            IExporterTokenCache<AgenticTokenStruct> agentTokenCache,
            IMcpToolRegistrationService toolService,
            ILogger<MyAgent> logger) : base(options)
        {
            _chatClient = chatClient;
            _configuration = configuration;
            _agentTokenCache = agentTokenCache;
            _logger = logger;
            _toolService = toolService;

            AgenticAuthHandlerName = _configuration.GetValue<string>("AgentApplication:AgenticAuthHandlerName");
            OboAuthHandlerName = _configuration.GetValue<string>("AgentApplication:OboAuthHandlerName");

            var agenticHandlers = !string.IsNullOrEmpty(AgenticAuthHandlerName)
                ? [AgenticAuthHandlerName] : Array.Empty<string>();
            var oboHandlers = !string.IsNullOrEmpty(OboAuthHandlerName)
                ? [OboAuthHandlerName] : Array.Empty<string>();

            // Greet new members
            OnConversationUpdate(ConversationUpdateEvents.MembersAdded, WelcomeMessageAsync);

            // Install/uninstall lifecycle — dual registration for agentic and non-agentic
            OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync,
                isAgenticOnly: true, autoSignInHandlers: agenticHandlers);
            OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync,
                isAgenticOnly: false);

            // Message handlers — must come AFTER all other activity handlers
            OnActivity(ActivityTypes.Message, OnMessageAsync,
                isAgenticOnly: true, autoSignInHandlers: agenticHandlers);
            OnActivity(ActivityTypes.Message, OnMessageAsync,
                isAgenticOnly: false, autoSignInHandlers: oboHandlers);
        }

        protected async Task WelcomeMessageAsync(
            ITurnContext turnContext, ITurnState turnState, CancellationToken cancellationToken)
        {
            foreach (ChannelAccount member in turnContext.Activity.MembersAdded)
            {
                if (member.Id != turnContext.Activity.Recipient.Id)
                    await turnContext.SendActivityAsync(AgentWelcomeMessage);
            }
        }

        protected async Task OnInstallationUpdateAsync(
            ITurnContext turnContext, ITurnState turnState, CancellationToken cancellationToken)
        {
            _logger?.LogInformation(
                "InstallationUpdate — Action: {Action}, User: {Name}",
                turnContext.Activity.Action, turnContext.Activity.From?.Name);

            if (turnContext.Activity.Action == InstallationUpdateActionTypes.Add)
                await turnContext.SendActivityAsync(MessageFactory.Text(AgentHireMessage), cancellationToken);
            else if (turnContext.Activity.Action == InstallationUpdateActionTypes.Remove)
                await turnContext.SendActivityAsync(MessageFactory.Text(AgentFarewellMessage), cancellationToken);
        }

        protected async Task OnMessageAsync(
            ITurnContext turnContext, ITurnState turnState, CancellationToken cancellationToken)
        {
            // Immediate acknowledgement
            await turnContext.SendActivityAsync("Got it — working on it…");

            // Typing indicator loop (4 second interval)
            using var typingCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var typingTask = Task.Run(async () =>
            {
                while (!typingCts.Token.IsCancellationRequested)
                {
                    await Task.Delay(4000, typingCts.Token);
                    if (!typingCts.Token.IsCancellationRequested)
                        await turnContext.SendActivityAsync(new Activity { Type = "typing" });
                }
            }, typingCts.Token);

            try
            {
                // Resolve auth handler for this turn
                var authHandlerName = turnContext.Activity.IsAgenticActivity()
                    ? AgenticAuthHandlerName : OboAuthHandlerName;

                // Preload observability token for Defender tracing
                if (_agentTokenCache != null)
                {
                    var agentId = Utility.ResolveAgentIdentity(turnContext);
                    var tenantId = turnContext.Activity.Conversation?.TenantId;
                    // Token preload — fire and forget; failure is non-fatal
                    _ = RefreshObservabilityToken(agentId, tenantId, _agentTokenCache);
                }

                // Build the LLM agent with MCP tools and run
                var clientAgent = await GetClientAgent(
                    turnContext, turnState, _toolService, authHandlerName);
                var instructions = GetAgentInstructions(turnContext.Activity.From?.Name);
                var thread = GetConversationThread(clientAgent, turnState);

                // Streaming response
                var streamingResponse = turnContext.GetStreamingResponse();
                await foreach (var update in clientAgent!.RunStreamingAsync(
                    turnContext.Activity.Text, instructions, thread, cancellationToken))
                {
                    if (update is TextContent textContent)
                        streamingResponse.QueueTextChunk(textContent.Text);
                }
                await streamingResponse.EndStreamAsync();
            }
            finally
            {
                await typingCts.CancelAsync();
                await typingTask.IgnoreCancellationExceptionAsync();
            }
        }

        private async Task<AIAgent?> GetClientAgent(
            ITurnContext context, ITurnState turnState,
            IMcpToolRegistrationService? toolService, string? authHandlerName)
        {
            string? accessToken = null;

            // Try agentic auth first, fall back to BEARER_TOKEN for dev
            if (!string.IsNullOrEmpty(authHandlerName))
            {
                var tokenResult = await context.GetTokenOrDefaultAsync(authHandlerName);
                accessToken = tokenResult?.Token;
            }
            if (string.IsNullOrEmpty(accessToken))
                TryGetBearerTokenForDevelopment(out accessToken);

            var agentId = Utility.ResolveAgentIdentity(context);

            // Load MCP tools from ToolingManifest.json
            List<AITool> tools = [];
            if (toolService != null && !string.IsNullOrEmpty(accessToken))
            {
                var toolCacheKey = GetToolCacheKey(turnState);
                if (!_agentToolCache.TryGetValue(toolCacheKey, out var cachedTools))
                {
                    cachedTools = (await toolService.GetMcpToolsAsync(
                        agentId, accessToken, context.Activity)).ToList();
                    _agentToolCache[toolCacheKey] = cachedTools;
                }
                tools = cachedTools;
            }

            return new ChatClientAgent(_chatClient!, tools: tools)
                .UseOpenTelemetry("agent.inference");
        }

        private static AgentThread GetConversationThread(AIAgent? agent, ITurnState turnState)
        {
            const string key = "conversation.threadInfo";
            var serialized = turnState.Conversation.Get<string>(key);
            var thread = serialized != null
                ? JsonSerializer.Deserialize<AgentThread>(serialized) ?? new AgentThread()
                : new AgentThread();
            return thread;
        }

        private string GetToolCacheKey(ITurnState turnState) =>
            turnState.User.Get<string>("user.toolCacheKey") ?? string.Empty;

        private static async Task RefreshObservabilityToken(
            string? agentId, string? tenantId,
            IExporterTokenCache<AgenticTokenStruct> cache)
        {
            // Fire-and-forget token refresh for Defender observability
            try
            {
                // Implementation delegates to the A365 observability runtime
                await cache.RefreshAsync(agentId, tenantId);
            }
            catch (Exception)
            {
                // Non-fatal — observability tracing degrades gracefully
            }
        }
    }
}
```

---

## appsettings.json

```json
{
  "AgentApplication": {
    "StartTypingTimer": false,
    "RemoveRecipientMention": false,
    "NormalizeMentions": false,
    "AgenticAuthHandlerName": "agentic",
    "UserAuthorization": {
      "AutoSignin": false,
      "Handlers": {
        "agentic": {
          "Type": "AgenticUserAuthorization",
          "Settings": {
            "Scopes": [
              "https://graph.microsoft.com/.default"
            ]
          }
        }
      }
    }
  },
  "TokenValidation": {
    "Audiences": [
      "{{ClientId}}"
    ]
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.Agents": "Warning",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  },
  "AllowedHosts": "*",
  "Connections": {
    "ServiceConnection": {
      "Settings": {
        "AuthType": "UserManagedIdentity",
        "AuthorityEndpoint": "https://login.microsoftonline.com/{{BOT_TENANT_ID}}",
        "ClientId": "{{BOT_ID}}",
        "Scopes": [
          "5a807f24-c9de-44ee-a3a7-329e88a00ffc/.default"
        ]
      }
    }
  },
  "ConnectionsMap": [
    {
      "ServiceUrl": "*",
      "Connection": "ServiceConnection"
    }
  ],
  "AIServices": {
    "AzureOpenAI": {
      "DeploymentName": "",
      "Endpoint": "",
      "ApiKey": ""
    }
  }
}
```

---

## ToolingManifest.json (empty — populated by add-workiq-tools skill)

```json
{
  "mcpServers": []
}
```

---

## Key Invariants

| Rule | Why |
|------|-----|
| `AddAgenticTracingExporter` before `AddA365Tracing` | Exporter must be registered before the tracer provider builds |
| `IMcpToolRegistrationService` as Singleton | Service caches tool metadata; transient would re-fetch on every turn |
| `AgenticAuthHandlerName` from config, not hardcoded | Allows Playground (no auth) and production (agentic) to share the same binary |
| `GetAgentInstructions()` sanitizes `Activity.From.Name` | Prevents prompt injection via user display names |
| `/api/health` has no auth middleware | Health checks must pass without a valid JWT (used by ALB/ingress) |
| Typing indicator loop at 4 s | Prevents Teams from timing out the typing indicator (5 s TTL) |
| Dual `OnActivity` registrations for `isAgenticOnly: true/false` | A365 production uses agentic auth; AgentsPlayground uses OBO or no auth |
| `IMcpToolServerConfigurationService` alongside `IMcpToolRegistrationService` | Configuration service reads `ToolingManifest.json`; registration service uses it |
