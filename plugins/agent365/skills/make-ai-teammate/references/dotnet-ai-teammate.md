# .NET AI Teammate Reference Patterns

Authoritative code patterns for the `make-ai-teammate` skill — .NET AgentFramework variant.
Source: [Agent365-Samples/dotnet/agent-framework/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent)

---

## Required NuGet Packages

Add to the `.csproj` file:

```xml
<!-- A365 SDK Packages (Notifications is GA as of 2026-05-01) -->
<PackageReference Include="Microsoft.Agents.A365.Notifications" Version="1.0.0" />

<!-- Agent Framework Packages -->
<PackageReference Include="Microsoft.Agents.AI" Version="1.1.0" />
<PackageReference Include="Microsoft.Agents.Authentication.Msal" Version="1.4.83" />
<PackageReference Include="Microsoft.Agents.Hosting.AspNetCore" Version="1.4.83" />
<PackageReference Include="Microsoft.Extensions.AI.OpenAI" Version="10.0.1-preview.*" />
<PackageReference Include="Azure.AI.OpenAI" Version="2.7.0-beta.*" />
<PackageReference Include="Azure.Identity" Version="1.17.1" />
```

Install via dotnet CLI (example — `Microsoft.Agents.A365.Notifications`):
```bash
dotnet add package Microsoft.Agents.A365.Notifications
dotnet add package Microsoft.Agents.AI
dotnet add package Microsoft.Agents.Authentication.Msal
dotnet add package Microsoft.Agents.Hosting.AspNetCore
dotnet add package Microsoft.Extensions.AI.OpenAI --prerelease
dotnet add package Azure.AI.OpenAI --prerelease
dotnet add package Azure.Identity
```

---

## Program.cs — Startup / Service Registration

```csharp
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using YourNamespace;
using YourNamespace.Agent;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Hosting.AspNetCore;
using Microsoft.Agents.Storage;
using Microsoft.Agents.Storage.Transcript;
using Microsoft.Agents.A365.Tooling.Services;
using Microsoft.Agents.A365.Tooling.Extensions.AgentFramework.Services;
using Microsoft.Extensions.AI;
using Azure;
using Azure.AI.OpenAI;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();
builder.Logging.AddConsole();

// ────── Auth & Storage ─────────────────────────────────────────────────────

builder.Services.AddAgentAspNetAuthentication(builder.Configuration);
builder.Services.AddSingleton<IStorage, MemoryStorage>();

// ────── MCP Tool Services (WorkIQ tools) ──────────────────────────────────
// These DI registrations are required for the agent class to inject
// IMcpToolRegistrationService and load MCP tools per turn. They are added
// up-front here (not in add-workiq-tools) so the agent compiles even
// before any servers are configured in ToolingManifest.json.

builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>();

// ────── Transcript Logging Middleware (DEV ONLY) ──────────────────────────
// Logs every turn (incoming + outgoing activities, including user content) to
// disk. Persisting full transcripts can leak PII / secrets — gate on
// Development environment, or remove entirely for production. For redacted
// logging in production, write a custom ITranscriptLogger that filters.

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddSingleton<Microsoft.Agents.Builder.IMiddleware[]>(
        [new TranscriptLoggerMiddleware(new FileTranscriptLogger())]);
}

// ────── Agent ─────────────────────────────────────────────────────────────

builder.AddAgentApplicationOptions();
builder.AddAgent<MyAgent>();  // Replace MyAgent with your agent class name

// NOTE: A365 observability (UseMicrosoftOpenTelemetry) is wired by the
// instrument-observability skill — do not add it here.

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

using System.Collections.Concurrent;
using Microsoft.Agents.AI;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Builder.App;
using Microsoft.Agents.Builder.State;
using Microsoft.Agents.Core.Models;
using Microsoft.Agents.A365.Runtime.Utils;
using Microsoft.Agents.A365.Tooling.Extensions.AgentFramework.Services;
using Microsoft.Extensions.AI;

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
        private readonly IMcpToolRegistrationService _toolService;
        private readonly IConfiguration? _configuration;
        private readonly ILogger<MyAgent>? _logger;
        private readonly string? AgenticAuthHandlerName;
        private readonly string? OboAuthHandlerName;

        // Per-conversation tool cache — MCP tools are resolved on first message
        // and reused for subsequent turns in the same conversation.
        private readonly ConcurrentDictionary<string, IList<AITool>> _agentToolCache = new();

        public MyAgent(
            AgentApplicationOptions options,
            IChatClient chatClient,
            IMcpToolRegistrationService toolService,
            IConfiguration configuration,
            ILogger<MyAgent> logger) : base(options)
        {
            _chatClient = chatClient;
            _toolService = toolService;
            _configuration = configuration;
            _logger = logger;

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
                var instructions = GetAgentInstructions(turnContext.Activity.From?.Name);
                var clientAgent = await GetClientAgentAsync(turnContext, instructions, cancellationToken);

                // Per-conversation session persistence — replaces ad-hoc history tracking.
                // Restores prior turns from turnState, or creates a new session on first message.
                var threadInfo = turnState.Conversation.GetValue<string?>("conversation.threadInfo", () => null);
                var session = threadInfo is not null
                    ? clientAgent.DeserializeSession(threadInfo)
                    : await clientAgent.CreateSessionAsync(cancellationToken);

                // Streaming response
                var streamingResponse = turnContext.GetStreamingResponse();
                await foreach (var update in clientAgent.RunStreamingAsync(
                    turnContext.Activity.Text, session, null, cancellationToken))
                {
                    if (update is TextContent textContent)
                        streamingResponse.QueueTextChunk(textContent.Text);
                }
                await streamingResponse.EndStreamAsync();

                // Persist session for the next turn
                turnState.Conversation.SetValue("conversation.threadInfo", session.Serialize());
            }
            finally
            {
                await typingCts.CancelAsync();
                await typingTask.IgnoreCancellationExceptionAsync();
            }
        }

        // Loads MCP tools for this conversation (cached after first call) and returns
        // a ChatClientAgent configured with those tools. The WorkIQ skill (add-workiq-tools)
        // writes the MCP server list to ToolingManifest.json; this method resolves them
        // at runtime via IMcpToolRegistrationService.
        private async Task<ChatClientAgent> GetClientAgentAsync(
            ITurnContext turnContext, string instructions, CancellationToken cancellationToken)
        {
            var conversationId = turnContext.Activity.Conversation?.Id ?? string.Empty;

            if (!_agentToolCache.TryGetValue(conversationId, out var tools))
            {
                // Surface a status update while tools load (can take a few seconds).
                await turnContext.QueueInformativeUpdateAsync("Loading tools…", cancellationToken);

                var agentId = turnContext.Activity.GetAgenticInstanceId();
                var handlerForMcp = AgenticAuthHandlerName ?? string.Empty;
                tools = await _toolService.GetMcpToolsAsync(
                    agentId, UserAuthorization, handlerForMcp, turnContext, tokenOverride: null);
                _agentToolCache[conversationId] = tools;
            }

            var options = new ChatClientAgentOptions
            {
                ChatOptions = new ChatOptions { Tools = tools.ToList() },
                Instructions = instructions,
            };
            return new ChatClientAgent(_chatClient!, options);
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
            ],
            "AlternateBlueprintConnectionName": "ServiceConnection"
          }
        }
      }
    }
  },
  "TokenValidation": {
    "Audiences": [
      "{{BOT_ID}}"
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
        "ClientId": "{{BLUEPRINT_ID}}",
        "AgentId": "{{BOT_ID}}",
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
  "Agent365Observability": {
    "AgentId": "{{BOT_ID}}",
    "AgentName": "",
    "AgentDescription": "",
    "TenantId": "{{BOT_TENANT_ID}}",
    "AgentBlueprintId": "{{BLUEPRINT_ID}}",
    "ClientId": "{{BLUEPRINT_ID}}",
    "ClientSecret": ""
  },
  "AIServices": {
    "AzureOpenAI": {
      "DeploymentName": "",
      "Endpoint": "",
      "ApiKey": ""
    }
  }
}
```

**Schema notes (CLI 1.1+):**
- `Connections.ServiceConnection.Settings.ClientId` is the **Blueprint** app ID, NOT the bot ID. The bot/agent ID is now a separate `AgentId` field.
- `TokenValidation.Audiences` uses the bot/agent ID (`{{BOT_ID}}`), not the legacy `{{ClientId}}`.
- `UserAuthorization.Handlers.agentic.Settings.AlternateBlueprintConnectionName` links the auth handler back to a named `Connections` entry.
- `Agent365Observability` is required for the observability skill to wire up. Leave `ClientSecret` empty when using Managed Identity; populate from a secret store / `appsettings.Development.json` for local dev.
- `AgenticAuthHandlerName: "agentic"` at the top of `AgentApplication` was removed in the latest AF sample (the handler key under `UserAuthorization.Handlers.agentic` is sufficient). The SK sample omits this key entirely. It's still written above as a defensive default — some setups may still read it from config.

---

## ToolingManifest.json (pre-populated with Calendar + Mail WorkIQ servers)

```json
{
  "mcpServers": [
    {
      "mcpServerName": "mcp_CalendarTools",
      "mcpServerUniqueName": "mcp_CalendarTools",
      "url": "https://agent365.svc.cloud.microsoft/agents/servers/mcp_CalendarTools",
      "scope": "Tools.ListInvoke.All",
      "audience": "910333d2-47e9-43ca-981f-6df2f4531ef4",
      "publisher": "Microsoft"
    },
    {
      "mcpServerName": "mcp_MailTools",
      "mcpServerUniqueName": "mcp_MailTools",
      "url": "https://agent365.svc.cloud.microsoft/agents/servers/mcp_MailTools",
      "scope": "Tools.ListInvoke.All",
      "audience": "16b1878d-62c7-4009-aa25-68989d63bbad",
      "publisher": "Microsoft"
    }
  ]
}
```

---

## Key Invariants

| Rule | Why |
|------|-----|
| `AgenticAuthHandlerName` from config, not hardcoded | Allows Playground (no auth) and production (agentic) to share the same binary |
| `GetAgentInstructions()` sanitizes `Activity.From.Name` | Prevents prompt injection via user display names |
| `/api/health` has no auth middleware | Health checks must pass without a valid JWT (used by ALB/ingress) |
| Typing indicator loop at 4 s | Prevents Teams from timing out the typing indicator (5 s TTL) |
| Dual `OnActivity` registrations for `isAgenticOnly: true/false` | A365 production uses agentic auth; AgentsPlayground uses OBO or no auth |
| `ToolingManifest.json` created with Calendar + Mail servers | Add more servers with the `add-workiq-tools` skill |

---

# .NET Semantic Kernel Variant

Source: [Agent365-Samples/dotnet/semantic-kernel/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/semantic-kernel/sample-agent)

## Required NuGet Packages (Semantic Kernel)

```xml
<!-- A365 SDK Packages (Notifications is GA as of 2026-05-01) -->
<PackageReference Include="Microsoft.Agents.A365.Notifications" Version="1.0.0" />

<!-- Agent Framework Packages -->
<PackageReference Include="Microsoft.Agents.Authentication.Msal" Version="1.4.83" />
<PackageReference Include="Microsoft.Agents.Hosting.AspNetCore" Version="1.4.83" />
<PackageReference Include="Azure.Identity" Version="1.17.1" />

<!-- Semantic Kernel Packages — pin to 1.71.0 (latest sample tested) -->
<PackageReference Include="Microsoft.SemanticKernel.Connectors.AzureOpenAI" Version="1.71.0-preview" />
<PackageReference Include="Microsoft.SemanticKernel.Connectors.OpenAI" Version="1.71.0" />
<PackageReference Include="Microsoft.SemanticKernel.Agents.Core" Version="1.71.0" />
```

Key difference from AgentFramework: use `Microsoft.SemanticKernel.*` packages instead of `Microsoft.Extensions.AI.OpenAI` and `Azure.AI.OpenAI`.

Install via dotnet CLI (example — `Microsoft.Agents.A365.Notifications`):
```bash
dotnet add package Microsoft.Agents.A365.Notifications
dotnet add package Microsoft.Agents.Hosting.AspNetCore
dotnet add package Microsoft.Agents.Authentication.Msal
dotnet add package Microsoft.SemanticKernel.Connectors.AzureOpenAI
dotnet add package Microsoft.SemanticKernel.Connectors.OpenAI
dotnet add package Microsoft.SemanticKernel.Agents.Core
dotnet add package Azure.Identity
```

## Program.cs — Startup / Service Registration (Semantic Kernel)

Key difference: `builder.Services.AddKernel()` + `AddAzureOpenAIChatCompletion` instead of `AddSingleton<IChatClient>`.

```csharp
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using YourNamespace.Agents;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Hosting.AspNetCore;
using Microsoft.Agents.Storage;
using Microsoft.Agents.Storage.Transcript;
using Microsoft.Agents.A365.Tooling.Services;
using Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel.Services;
using Microsoft.SemanticKernel;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();
builder.Logging.AddConsole();

// ────── Auth & Storage ─────────────────────────────────────────────────────

builder.Services.AddAgentAspNetAuthentication(builder.Configuration);
builder.Services.AddSingleton<IStorage, MemoryStorage>();

// ────── MCP Tool Services (WorkIQ tools — SK extension) ──────────────────

builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>();

// ────── Transcript Logging Middleware (DEV ONLY) ──────────────────────────
// Persists full conversation transcripts to disk — gate on Development env
// to avoid leaking PII / secrets in production. For production, use a
// redacting ITranscriptLogger instead.

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddSingleton<Microsoft.Agents.Builder.IMiddleware[]>(
        [new TranscriptLoggerMiddleware(new FileTranscriptLogger())]);
}

// ────── Semantic Kernel ───────────────────────────────────────────────────

builder.Services.AddKernel();

if (builder.Configuration.GetSection("AIServices").GetValue<bool>("UseAzureOpenAI"))
{
    builder.Services.AddAzureOpenAIChatCompletion(
        deploymentName: builder.Configuration["AIServices:AzureOpenAI:DeploymentName"]!,
        endpoint: builder.Configuration["AIServices:AzureOpenAI:Endpoint"]!,
        apiKey: builder.Configuration["AIServices:AzureOpenAI:ApiKey"]!);
}
else
{
    builder.Services.AddOpenAIChatCompletion(
        modelId: builder.Configuration["AIServices:OpenAI:ModelId"]!,
        apiKey: builder.Configuration["AIServices:OpenAI:ApiKey"]!);
}

// ────── Agent ─────────────────────────────────────────────────────────────

builder.AddAgentApplicationOptions();
builder.AddAgent<MyAgent>();  // Replace MyAgent with your agent class name

// NOTE: A365 observability (UseMicrosoftOpenTelemetry) is wired by the
// instrument-observability skill — do not add it here.

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
    app.MapGet("/", () => "Agent Framework Semantic Kernel Sample Agent");
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

## Agent/MyAgent.cs — AgentApplication Subclass (Semantic Kernel)

Key differences from AgentFramework: inject `Kernel` instead of `IChatClient`; use `IChatCompletionService` from the kernel for LLM calls.

```csharp
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using Microsoft.Agents.Builder;
using Microsoft.Agents.Builder.App;
using Microsoft.Agents.Builder.State;
using Microsoft.Agents.Core.Models;
using Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel.Services;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;

namespace YourNamespace.Agents
{
    public class MyAgent : AgentApplication
    {
        private const string AgentWelcomeMessage = "Hello! I can help you find information based on what I can access.";
        private const string AgentHireMessage = "Thank you for hiring me! Looking forward to assisting you!";
        private const string AgentFarewellMessage = "Thank you for your time, I enjoyed working with you.";

        private static readonly string AgentInstructionsTemplate = """
        You will speak like a friendly and professional virtual assistant.

        The user's name is {userName}. Use their name naturally where appropriate.

        Use the tools available to you to help answer the user's questions.
        """;

        private static string GetAgentInstructions(string? userName)
        {
            string safe = string.IsNullOrWhiteSpace(userName) ? "unknown" : userName.Trim();
            safe = System.Text.RegularExpressions.Regex.Replace(safe, @"[\p{Cc}\p{Cf}]", " ").Trim();
            if (safe.Length > 64) safe = safe[..64].TrimEnd();
            if (string.IsNullOrWhiteSpace(safe)) safe = "unknown";
            return AgentInstructionsTemplate.Replace("{userName}", safe, StringComparison.Ordinal);
        }

        private readonly Kernel _kernel;
        private readonly IMcpToolRegistrationService _toolService;
        private readonly IConfiguration? _configuration;
        private readonly ILogger<MyAgent>? _logger;
        private readonly string? AgenticAuthHandlerName;
        private readonly string? OboAuthHandlerName;

        public MyAgent(
            AgentApplicationOptions options,
            Kernel kernel,
            IMcpToolRegistrationService toolService,
            IConfiguration configuration,
            ILogger<MyAgent> logger) : base(options)
        {
            _kernel = kernel;
            _toolService = toolService;
            _configuration = configuration;
            _logger = logger;

            AgenticAuthHandlerName = _configuration.GetValue<string>("AgentApplication:AgenticAuthHandlerName");
            OboAuthHandlerName = _configuration.GetValue<string>("AgentApplication:OboAuthHandlerName");

            var agenticHandlers = !string.IsNullOrEmpty(AgenticAuthHandlerName)
                ? [AgenticAuthHandlerName] : Array.Empty<string>();
            var oboHandlers = !string.IsNullOrEmpty(OboAuthHandlerName)
                ? [OboAuthHandlerName] : Array.Empty<string>();

            OnConversationUpdate(ConversationUpdateEvents.MembersAdded, WelcomeMessageAsync);

            OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync,
                isAgenticOnly: true, autoSignInHandlers: agenticHandlers);
            OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync,
                isAgenticOnly: false);

            // Inbound A365 notifications (e.g. EmailNotification, WpxComment).
            // Wildcard pattern matches any notification name.
            OnAgentNotification("*", OnAgentNotificationAsync);

            // Message handlers — rank Last so they fall through after more specific routes.
            OnActivity(ActivityTypes.Message, OnMessageAsync,
                isAgenticOnly: true, autoSignInHandlers: agenticHandlers, rank: RouteRank.Last);
            OnActivity(ActivityTypes.Message, OnMessageAsync,
                isAgenticOnly: false, autoSignInHandlers: oboHandlers, rank: RouteRank.Last);
        }

        protected async Task OnAgentNotificationAsync(
            ITurnContext turnContext, ITurnState turnState, CancellationToken cancellationToken)
        {
            // Handle inbound A365 notifications. The notification payload is in
            // turnContext.Activity.Value — cast to the specific notification type
            // (EmailNotification, WpxComment, etc.) from Microsoft.Agents.A365.Notifications.Models.
            _logger?.LogInformation("Received agent notification: {Name}", turnContext.Activity.Name);
            await Task.CompletedTask;
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
            if (turnContext.Activity.Action == InstallationUpdateActionTypes.Add)
                await turnContext.SendActivityAsync(MessageFactory.Text(AgentHireMessage), cancellationToken);
            else if (turnContext.Activity.Action == InstallationUpdateActionTypes.Remove)
                await turnContext.SendActivityAsync(MessageFactory.Text(AgentFarewellMessage), cancellationToken);
        }

        protected async Task OnMessageAsync(
            ITurnContext turnContext, ITurnState turnState, CancellationToken cancellationToken)
        {
            await turnContext.SendActivityAsync("Got it — working on it…");

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
                var instructions = GetAgentInstructions(turnContext.Activity.From?.Name);
                var chatService = _kernel.GetRequiredService<IChatCompletionService>();
                var history = new ChatHistory(instructions);
                history.AddUserMessage(turnContext.Activity.Text ?? string.Empty);

                var streamingResponse = turnContext.GetStreamingResponse();
                await foreach (var update in chatService.GetStreamingChatMessageContentsAsync(
                    history, cancellationToken: cancellationToken))
                {
                    if (!string.IsNullOrEmpty(update.Content))
                        streamingResponse.QueueTextChunk(update.Content);
                }
                await streamingResponse.EndStreamAsync();
            }
            finally
            {
                await typingCts.CancelAsync();
                await typingTask.IgnoreCancellationExceptionAsync();
            }
        }
        // Note: WorkIQ MCP tool loading is added by the add-workiq-tools skill.
    }
}
```

## appsettings.json (Semantic Kernel)

Same shape as AgentFramework. The SK sample omits `AgenticAuthHandlerName` from the top of `AgentApplication` (handler is identified by its key under `UserAuthorization.Handlers`). `TokenValidation.Enabled: false` and `TenantId` are SK-specific additions.

```json
{
  "AgentApplication": {
    "StartTypingTimer": false,
    "RemoveRecipientMention": false,
    "NormalizeMentions": false,
    "UserAuthorization": {
      "AutoSignin": false,
      "Handlers": {
        "agentic": {
          "Type": "AgenticUserAuthorization",
          "Settings": {
            "Scopes": [ "https://graph.microsoft.com/.default" ],
            "AlternateBlueprintConnectionName": "ServiceConnection"
          }
        }
      }
    }
  },
  "TokenValidation": {
    "Enabled": false,
    "TenantId": "{{BOT_TENANT_ID}}",
    "Audiences": [ "{{BOT_ID}}" ]
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.Agents": "Warning"
    }
  },
  "AllowedHosts": "*",
  "Connections": {
    "ServiceConnection": {
      "Settings": {
        "AuthType": "UserManagedIdentity",
        "AuthorityEndpoint": "https://login.microsoftonline.com/{{BOT_TENANT_ID}}",
        "ClientId": "{{BLUEPRINT_ID}}",
        "AgentId": "{{BOT_ID}}",
        "Scopes": [ "5a807f24-c9de-44ee-a3a7-329e88a00ffc/.default" ]
      }
    }
  },
  "ConnectionsMap": [{ "ServiceUrl": "*", "Connection": "ServiceConnection" }],
  "Agent365Observability": {
    "AgentId": "{{BOT_ID}}",
    "AgentName": "",
    "AgentDescription": "",
    "TenantId": "{{BOT_TENANT_ID}}",
    "AgentBlueprintId": "{{BLUEPRINT_ID}}",
    "ClientId": "{{BLUEPRINT_ID}}",
    "ClientSecret": ""
  },
  "AIServices": {
    "UseAzureOpenAI": true,
    "AzureOpenAI": {
      "DeploymentName": "",
      "Endpoint": "",
      "ApiKey": ""
    },
    "OpenAI": {
      "ModelId": "gpt-4o",
      "ApiKey": ""
    }
  }
}
```

## Key Invariants (Semantic Kernel)

| Rule | Why |
|------|-----|
| `builder.Services.AddKernel()` before `AddAzureOpenAIChatCompletion` | Kernel must be registered before AI services for DI to work |
| `IChatCompletionService` resolved from `_kernel` | Lets Semantic Kernel manage model selection and retries |
| `GetAgentInstructions()` sanitizes `Activity.From.Name` | Prevents prompt injection via user display names |
| `/api/health` has no auth middleware | Health checks must pass without a valid JWT |
| Dual `OnActivity` registrations for `isAgenticOnly: true/false` | A365 production uses agentic auth; AgentsPlayground uses OBO or no auth |
