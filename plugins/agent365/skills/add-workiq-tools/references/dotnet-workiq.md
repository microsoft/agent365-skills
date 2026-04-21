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

## NuGet Package

| Package | Purpose | Install |
|---------|---------|---------|
| `Microsoft.Agents.A365.Tooling.Extensions.AgentFramework` | MCP tool loading | `dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease` |

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
| Custom client app | `a365 develop add-permissions` | Developer (needs `Application.ReadWrite.All`) |

The GA must verify `deploymentProjectPath` in `a365.config.json` before running `a365 setup permissions mcp`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `GetMcpToolsAsync` returns empty list | Run `a365 develop list-configured` — verify WorkIQ servers are listed |
| Token errors in dev | Run `a365 develop get-token`; set `BEARER_TOKEN_<SERVER>` env var |
| 403 from WorkIQ server at runtime | GA has not run `a365 setup permissions mcp` — share `ToolingManifest.json` with admin |
| `IMcpToolRegistrationService` not resolved | Add both singletons to `builder.Services` before `Build()` |
| Build error after package add | Run `dotnet restore`; check for version conflicts |
