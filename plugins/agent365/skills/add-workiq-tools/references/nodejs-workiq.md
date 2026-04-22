# Node.js LangChain — WorkIQ MCP Tool Patterns

Reference for the `add-workiq-tools` skill. Workflow is CLI-driven:
`a365 develop list-available` → `a365 develop add-mcp-servers` → wire `A365McpToolClient`.

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

## npm Package

| Package | Purpose | Install |
|---------|---------|---------|
| `@microsoft/agents-a365-tooling` | MCP tool client for Node.js | `npm install @microsoft/agents-a365-tooling` |

---

## index.ts — Loading WorkIQ Tools

```typescript
// A365 WorkIQ — added by add-workiq-tools skill
import { A365McpToolClient } from '@microsoft/agents-a365-tooling';

// A365 WorkIQ — added by add-workiq-tools skill
const mcpClient = new A365McpToolClient({
  agentId: process.env.AGENTIC_APP_ID!,
  mcpServersConfig: './ToolingManifest.json', // written by a365 develop add-mcp-servers
});

// Inside request/turn handler — call once per turn with the user's OBO token:
// A365 WorkIQ — added by add-workiq-tools skill
const workIQTools = await mcpClient.getToolsAsync({
  userToken: userAccessToken, // OBO token from the incoming request context
});

// A365 WorkIQ — added by add-workiq-tools skill
const agent = await createReactAgent({
  llm,
  tools: [...existingTools, ...workIQTools],
  prompt,
});
```

Token resolution:
- **Dev**: SDK reads `BEARER_TOKEN` or `BEARER_TOKEN_<SERVER_NAME>` env vars
- **Production**: SDK performs OBO exchange using `userAccessToken` against `audience` in manifest

---

## .env Variables

```dotenv
# A365 WorkIQ — added by add-workiq-tools skill
AGENTIC_APP_ID=<your-agent-blueprint-id>

# Development: single token fallback (from a365 develop get-token)
BEARER_TOKEN=<token>

# Development: per-server V2 tokens (preferred)
BEARER_TOKEN_MCP_MAILTOOLS=<token>
BEARER_TOKEN_MCP_CALENDARTOOLS=<token>

# Allow agent to start even if WorkIQ tools fail to load
SKIP_TOOLING_ON_ERRORS=true
```

Token variable naming: `BEARER_TOKEN_<UPPERCASE_SERVER_NAME_NO_SPACES>`

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
| `getToolsAsync` returns empty array | Run `a365 develop list-configured` — verify servers are listed |
| Token errors in dev | Run `a365 develop get-token`; set `BEARER_TOKEN` or per-server vars |
| OBO exchange fails in production | Verify `AGENTIC_APP_ID` is set and GA has run `a365 setup permissions mcp` |
| 403 at runtime | GA needs to run `a365 setup permissions mcp` with updated `ToolingManifest.json` |
| `Cannot find module` for tooling package | Run `npm install`; verify `@microsoft/agents-a365-tooling` is in `package.json` |
