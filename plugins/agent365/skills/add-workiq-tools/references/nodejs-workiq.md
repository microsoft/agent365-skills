# Node.js LangChain — WorkIQ MCP Tool Patterns

Reference for the `add-workiq-tools` skill. Workflow is CLI-driven:
`a365 develop list-available` → `a365 develop add-mcp-servers` → wire `McpToolRegistrationService`.

Official sample:
`https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/langchain`

---

## A365 CLI Commands (the source of truth for ToolingManifest.json)

```bash
# See all available MCP servers in the catalog
a365 develop list-available

# Add selected WorkIQ servers (updates ToolingManifest.json only — no permissions yet)
a365 develop add-mcp-servers "Work IQ Mail" "Work IQ Teams" "Work IQ Calendar"

# Verify what is now configured
a365 develop list-configured

# Get a dev bearer token for local testing (interactive browser auth)
a365 develop get-token

# Get a raw token string
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

## npm Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `@microsoft/agents-a365-tooling` | Core MCP tooling runtime | `npm install @microsoft/agents-a365-tooling` |
| `@microsoft/agents-a365-tooling-extensions-langchain` | LangChain adapter — `McpToolRegistrationService` | `npm install @microsoft/agents-a365-tooling-extensions-langchain` |

---

## client.ts — Loading WorkIQ Tools per Turn

Create a single `McpToolRegistrationService` instance at module level, then call
`addToolServersToAgent()` inside the per-turn `getClient()` factory.

```typescript
import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-langchain';
import { Authorization, TurnContext } from '@microsoft/agents-hosting';

// Module-level singleton — created once, reused across turns
const toolService = new McpToolRegistrationService();

export async function getClient(
  authorization: Authorization,
  authHandlerName: string,
  turnContext: TurnContext,
): Promise<Client> {
  // Create the base LangChain agent first (without tools)
  const agent = createAgent({ model, name: agentName, systemPrompt: '...' });

  // Attach MCP tool servers for this turn
  let agentWithTools = agent;
  try {
    agentWithTools = await toolService.addToolServersToAgent(
      agent,
      authorization,
      authHandlerName,   // e.g. 'agentic'
      turnContext,
      process.env.BEARER_TOKEN ?? '',  // dev only — empty in production
    );
  } catch (error) {
    console.error('Error adding MCP tool servers:', error);
    // falls back to agent without tools
  }

  return new LangChainClient(agentWithTools, turnContext);
}
```

Key points:
- `McpToolRegistrationService` reads `ToolingManifest.json` when `NODE_ENV=development`
- In production, tool server URLs come from the provisioned blueprint config
- `BEARER_TOKEN` is only used in dev; production uses the `authorization` context for OBO exchange
- Errors are caught and the agent falls back gracefully — never block the turn

---

## ToolingManifest.json — Written by CLI

`a365 develop add-mcp-servers` writes entries like this (V2 schema):

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
    }
  ]
}
```

Do not hand-edit this file. Key V2 fields:
- `scope` — unified across all WorkIQ servers: `Tools.ListInvoke.All`
- `audience` — V2 service principal GUID: `910333d2-47e9-43ca-981f-6df2f4531ef4`
- `publisher` — always `"Microsoft"` for first-party WorkIQ servers

---

## .env Variables

```dotenv
# Development: single fallback bearer token from `a365 develop get-token`
BEARER_TOKEN=<token>

# V2 per-server bearer tokens (dev mode — SDK reads BEARER_TOKEN_<SERVER_NAME_UPPER>)
# Preferred over the single BEARER_TOKEN fallback when set
BEARER_TOKEN_MCP_MAILTOOLS=<token>
BEARER_TOKEN_MCP_CALENDARTOOLS=<token>

# Platform endpoint — leave empty to use the production default
MCP_PLATFORM_ENDPOINT=
MCP_PLATFORM_AUTHENTICATION_SCOPE=

# NODE_ENV=development causes the SDK to load servers from ToolingManifest.json
NODE_ENV=development
```

Token variable naming convention: `BEARER_TOKEN_<UPPERCASE_SERVER_UNIQUE_NAME_NO_UNDERSCORES_REMOVED>` — e.g. `mcp_CalendarTools` → `BEARER_TOKEN_MCP_CALENDARTOOLS`.

In production `NODE_ENV` is `production` (or `WEBSITE_SITE_NAME` is set by Azure App Service),
and bearer token env vars are not used — token exchange happens per-audience via `authorization.exchangeToken()`.

---

## Permissions Workflow

`a365 develop add-mcp-servers` only writes `ToolingManifest.json`. Permissions are separate:

| Scenario | Command | Who |
|----------|---------|-----|
| Blueprint not yet created | `a365 setup all` (reads manifest automatically) | Developer |
| Blueprint already exists | `a365 setup permissions mcp` | **Global Administrator** |

The GA must run these commands from the project directory (where `a365.config.json` lives):
```bash
a365 setup permissions mcp
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `addToolServersToAgent` returns agent with no tools | Run `a365 develop list-configured` — verify servers are listed; check `NODE_ENV=development` |
| Token errors in dev | Run `a365 develop get-token`; set `BEARER_TOKEN` in `.env` |
| OBO exchange fails in production | Verify `authHandlerName` matches the authorization handler registered in `AgentApplication` |
| 403 at runtime | GA needs to run `a365 setup permissions mcp` with the updated `ToolingManifest.json` |
| `Cannot find module '@microsoft/agents-a365-tooling-extensions-langchain'` | Run `npm install @microsoft/agents-a365-tooling-extensions-langchain` |
| `Cannot find module '@microsoft/agents-a365-tooling'` | Run `npm install @microsoft/agents-a365-tooling` |
