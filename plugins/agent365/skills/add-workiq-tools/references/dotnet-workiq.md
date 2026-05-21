# .NET AgentFramework — WorkIQ MCP Tool Patterns

Reference for the `add-workiq-tools` skill. Workflow is CLI-driven:
`a365 develop list-available` → `a365 develop add-mcp-servers` → wire `GetMcpToolsAsync`.

Official sample:
`https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent`

---

## A365 CLI Commands (the source of truth for ToolingManifest.json)

```bash
# See all available MCP servers in the catalog
a365 develop list-available

# Add selected WorkIQ servers (updates ToolingManifest.json only — no permissions yet)
a365 develop add-mcp-servers "Work IQ Mail" "Work IQ Calendar" "Work IQ Teams"

# Verify what is now configured
a365 develop list-configured

# Get a dev bearer token for local testing
a365 develop get-token

# Get a raw token (pipe to clipboard or .env)
a365 develop get-token --resource mcp -o raw
```
Token variable naming: `BEARER_TOKEN_<UPPERCASE_SERVER_UNIQUE_NAME>` — e.g. `mcp_CalendarTools` → `BEARER_TOKEN_MCP_CALENDARTOOLS`.

---

## ToolingManifest.json — Written by CLI

`a365 develop add-mcp-servers` writes entries like this (V2 schema):

```json
{
  "mcpServers": [
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
**Never hand-edit `ToolingManifest.json`** — always use `a365 develop add-mcp-servers`.

---

## Available WorkIQ Servers (from a365 develop list-available)

| Display Name | Category |
|---|---|
| Work IQ Mail | Email |
| Work IQ Calendar | Calendar |
| Work IQ Teams | Teams chat |
| Work IQ SharePoint | Documents |
| Work IQ OneDrive | File storage |
| Work IQ Word | Documents |
| Work IQ User | Profile / presence |
| Work IQ Copilot | M365 Copilot |
| Dataverse and Dynamics 365 | Business data |

---

## NuGet Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `Microsoft.Agents.A365.Tooling` | Core MCP tooling runtime | `dotnet add package Microsoft.Agents.A365.Tooling` |
| `Microsoft.Agents.A365.Tooling.Extensions.AgentFramework` | Agent Framework adapter — `IMcpToolRegistrationService.GetMcpToolsAsync` returns `IList<AITool>` | `dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework` |
| `Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel` | Semantic Kernel adapter — `IMcpToolRegistrationService.AddToolServersToAgentAsync` mutates `Kernel`, returns `Task` (void). **Different API surface from AgentFramework.** | `dotnet add package Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel` |
| `Microsoft.Agents.A365.Tooling.Extensions.AzureAIFoundry` | Azure AI Foundry adapter | `dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AzureAIFoundry` |

> **AF vs SK API divergence.** Although both extensions ship an `IMcpToolRegistrationService` interface, they live in different namespaces and have different methods. AF has `GetMcpToolsAsync` (returns a tool list for the caller to attach to an `AIAgent`); SK has `AddToolServersToAgentAsync` (mutates the `Kernel` in place, returns `Task`). Calling `GetMcpToolsAsync` on the SK service does not compile. Sources:
> - AF: https://github.com/microsoft/Agent365-dotnet/blob/main/src/Tooling/Extensions/AgentFramework/Services/IMcpToolRegistrationService.cs
> - SK: https://github.com/microsoft/Agent365-dotnet/blob/main/src/Tooling/Extensions/SemanticKernel/Services/IMcpToolRegistrationService.cs

Install core + the adapter for your framework. Example for AgentFramework:
```bash
dotnet add package Microsoft.Agents.A365.Tooling
dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework
```

---

## Program.cs — Service Registration

Both AF and SK extensions ship an `AddMcpServices()` extension method that registers both interfaces as **Scoped** in one line. The official samples currently use the two-line `AddSingleton` form below (both work); the one-liner is the canonical option going forward.

**Recommended (one-liner):**
```csharp
// A365 WorkIQ — added by add-workiq-tools skill
using Microsoft.Agents.A365.Tooling;

// Registers IMcpToolServerConfigurationService + IMcpToolRegistrationService as Scoped.
// SK variant additionally registers an HttpClient.
builder.Services.AddMcpServices();
```

**Alternative (matches the official samples):**
```csharp
// A365 WorkIQ — added by add-workiq-tools skill
using Microsoft.Agents.A365.Tooling;

builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>();
```

> **Lifetime note:** `AddMcpServices()` uses `Scoped` registrations; the sample pattern uses `Singleton`. Both work for the standard request-scoped agent host. If you change to a long-lived background worker, prefer `Scoped` to keep the `IMcpToolServerConfigurationService` aligned with per-request lifetime.

---

## Agent Class — GetMcpToolsAsync (Agent Framework)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/dotnet/agent-framework/sample-agent/Agent/MyAgent.cs

The verified sample calls `GetMcpToolsAsync` inside **`OnMessageAsync`** (Agent Framework's newer base method) — **not** `OnMessageActivityAsync` (which earlier revisions of this reference claimed). The call sits inside the `GetClientAgent()` helper invoked per turn:

```csharp
// A365 WorkIQ — added by add-workiq-tools skill
using Microsoft.Agents.A365.Tooling.Extensions.AgentFramework.Services;

// Inside OnMessageAsync (Agent Framework's per-turn handler — sample uses OnMessageAsync,
// not OnMessageActivityAsync):

// A365 WorkIQ — added by add-workiq-tools skill
var a365Tools = await _toolService.GetMcpToolsAsync(
    agentId,            // resolved agent identity — from a365.generated.config.json
    UserAuthorization,  // AgentApplication.UserAuthorization (typed instance, NOT a string)
    handlerForMcp,      // string handler name — sample picks OboAuthHandlerName or
                        // AgenticAuthHandlerName based on turnContext.IsAgenticRequest()
    context             // ITurnContext
    // tokenOverride: optional 5th param — null in production; pass a bearer for local dev
).ConfigureAwait(false);

// A365 WorkIQ — added by add-workiq-tools skill
var chatOptions = new ChatOptions { Tools = [.. a365Tools] };
```

The SDK resolves tokens automatically:
- **Dev** (`IHostEnvironment.IsDevelopment()`): reads `BEARER_TOKEN_<SERVER_NAME>` env var (e.g. `BEARER_TOKEN_MCP_MAILTOOLS`), or uses the optional `tokenOverride` parameter.
- **Production**: performs per-audience OBO exchange using the user's access token.

---

## Agent Class — AddToolServersToAgentAsync (Semantic Kernel)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/dotnet/semantic-kernel/sample-agent/Agents/Agent365Agent.cs

> **SK API differs from AF.** SK has **no** `GetMcpToolsAsync` — instead it exposes `AddToolServersToAgentAsync` which **mutates the `Kernel` in place** (returns `Task`, not a tool list). Called during agent initialization (after `Kernel` is built), **not per-message**.

Verified signature (from `Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel.Services.IMcpToolRegistrationService`):
```csharp
Task AddToolServersToAgentAsync(
    Kernel kernel,
    UserAuthorization userAuthorization,
    string authHandlerName,
    ITurnContext turnContext,
    string? authToken = null);
```

Sample call (dev path with bearer; prod path omits the bearer):
```csharp
// A365 WorkIQ — added by add-workiq-tools skill
using Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel.Services;

if (TryGetBearerTokenForDevelopment(out var bearerToken))
    await _toolService.AddToolServersToAgentAsync(
        kernel, userAuthorization, authHandlerName, turnContext, bearerToken);
else
    await _toolService.AddToolServersToAgentAsync(
        kernel, userAuthorization, authHandlerName, turnContext);
```

The Kernel is mutated — no value to capture or reassign. After the call, the Kernel's plugin collection includes the WorkIQ MCP tools.

---

## launchSettings.json — Dev Profile

```json
{
  "profiles": {
    "WorkIQ Dev": {
      "commandName": "Project",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development",
        "SKIP_TOOLING_ON_ERRORS": "true",
        "BEARER_TOKEN_MCP_MAILTOOLS": "<from a365 develop get-token>"
      },
      "applicationUrl": "http://localhost:3978"
    }
  }
}
```

Token variable naming: `BEARER_TOKEN_<UPPERCASE_SERVER_NAME_NO_SPACES>`

---

## Permissions Workflow

`a365 develop add-mcp-servers` only writes `ToolingManifest.json`. Permissions are separate:

| Scenario | Command | Who |
|----------|---------|-----|
| Blueprint not yet created | `a365 setup all` (reads manifest automatically) | Developer |
| Blueprint already exists | `a365 setup permissions mcp` | **Global Administrator** |
| V1→V2 migration (remove legacy scopes) | `a365 setup permissions mcp --remove-legacy-scopes` | **Global Administrator** |
| Custom client app | `a365 develop add-permissions` | Developer (needs `Application.ReadWrite.All`) |

The GA must run `a365 setup permissions mcp` from the project directory (where `a365.config.json` lives).

### Permissions per server

All WorkIQ servers use **delegated** scopes — they require an OBO token (signed-in user or Agentic User). The agent code wires `Tools.ListInvoke.All`; the Graph scopes below are granted at the Entra app level.

| WorkIQ Server | V1/V2 | Graph Delegated Scopes |
|---------------|-------|------------------------|
| Work IQ Mail | V2 | `Mail.ReadWrite`, `Mail.Send` |
| Work IQ Calendar | V2 | `Calendars.ReadWrite` |
| Work IQ Teams | V2 | `ChannelMessage.Read.All`, `Team.ReadBasic.All` |
| Work IQ SharePoint | V2 | `Sites.ReadWrite.All`, `Files.ReadWrite.All` |
| Work IQ OneDrive | V2 | `Files.ReadWrite.All` |
| Work IQ Word | V2 | `Files.ReadWrite.All` |
| Work IQ User | V2 | `User.Read`, `Presence.Read.All` |
| Work IQ Copilot | V2 | `AiEnterpriseInteraction.ReadWrite.All` |
| Dataverse & Dynamics 365 | V1/V2 | `user_impersonation` (Dataverse resource) |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `GetMcpToolsAsync` returns empty list | Run `a365 develop list-configured` — verify WorkIQ servers are listed |
| Token errors in dev | Run `a365 develop get-token`; set `BEARER_TOKEN_<SERVER>` env var |
| 403 from WorkIQ server at runtime | GA has not run `a365 setup permissions mcp` — share `ToolingManifest.json` with admin |
| `IMcpToolRegistrationService` not resolved | Add both singletons to `builder.Services` before `Build()` |
| Build error after package add | Run `dotnet restore`; check for version conflicts |
