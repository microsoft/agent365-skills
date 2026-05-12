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
| `Microsoft.Agents.A365.Tooling` | Core MCP tooling runtime | `dotnet add package Microsoft.Agents.A365.Tooling --prerelease` |
| `Microsoft.Agents.A365.Tooling.Extensions.AgentFramework` | AgentFramework adapter — `IMcpToolRegistrationService` | `dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease` |
| `Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel` | Semantic Kernel adapter | `dotnet add package Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel --prerelease` |

Install core + the adapter for your framework. Example for AgentFramework:
```bash
dotnet add package Microsoft.Agents.A365.Tooling --prerelease
dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease
```

---

## Program.cs — Service Registration

```csharp
// A365 WorkIQ — added by add-workiq-tools skill
using Microsoft.Agents.A365.Tooling;

// A365 WorkIQ — added by add-workiq-tools skill
builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>();
```

---

## Agent Class — GetMcpToolsAsync (AgentFramework)

Based on Agent365-Samples PR #272 — no `tokenOverride` parameter:

```csharp
// A365 WorkIQ — added by add-workiq-tools skill
using Microsoft.Agents.A365.Tooling;

// Inside OnMessageActivityAsync or equivalent:

// A365 WorkIQ — added by add-workiq-tools skill
var workIQTools = await _toolService.GetMcpToolsAsync(
    agentId,           // from a365.generated.config.json → agentBlueprintId
    UserAuthorization, // from ITurnContext
    handlerForMcp,     // auth handler name from appsettings ("AgenticBotAuth")
    context            // ITurnContext
).ConfigureAwait(false);

// A365 WorkIQ — added by add-workiq-tools skill
var chatOptions = new ChatOptions { Tools = [.. workIQTools] };
```

The SDK resolves tokens automatically:
- **Dev**: reads `BEARER_TOKEN_<SERVER_NAME>` env var (e.g. `BEARER_TOKEN_MCP_MAILTOOLS`)
- **Production**: performs per-audience OBO exchange using the user's access token

---

## Agent Class — AddToolServersToAgentAsync (Semantic Kernel variant)

```csharp
// A365 WorkIQ — added by add-workiq-tools skill
await _toolService.AddToolServersToAgentAsync(
    kernel,
    userAuthorization,
    authHandlerName,
    turnContext
    // No tokenOverride — SDK handles internally (PR #272 pattern)
).ConfigureAwait(false);
```

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
        "BEARER_TOKEN_MCP_MAILTOOLS": "<from a365 develop get-token>",
        "BEARER_TOKEN_MCP_CALENDARTOOLS": "<from a365 develop get-token>"
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
