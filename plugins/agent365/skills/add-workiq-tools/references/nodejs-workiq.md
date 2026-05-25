# Node.js — WorkIQ MCP Tool Patterns

Reference for the `add-workiq-tools` skill. Workflow is CLI-driven:
`a365 develop list-available` → `a365 develop add-mcp-servers` → wire `McpToolRegistrationService`.

Microsoft publishes three Node.js extensions: **LangChain**, **OpenAI Agents SDK**, **Claude SDK**. No Semantic Kernel or Google ADK packages exist for Node.js — those stacks are unsupported by this skill.

Official samples:
- LangChain: https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/langchain/sample-agent
- OpenAI: https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/openai/sample-agent
- Claude: https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/claude/sample-agent

---

## A365 CLI Commands (the source of truth for ToolingManifest.json)

```bash
# See all available MCP servers in the catalog
a365 develop list-available

# Add selected WorkIQ servers — names MUST match exact mcpServerName from list-available.
# V2 catalog names shown; pull current values from your `a365 develop list-available` output.
a365 develop add-mcp-servers "mcp_MailTools" "mcp_TeamsTools" "mcp_CalendarTools"

# Verify what is now configured
a365 develop list-configured

# Get a dev bearer token for local testing (interactive browser auth)
a365 develop get-token

# Get a raw token string
a365 develop get-token --resource mcp -o raw
```

**Never hand-edit `ToolingManifest.json`** — always use `a365 develop add-mcp-servers`.

---

## Available WorkIQ Capabilities

Run `a365 develop list-available` for the live catalog — these are capability categories, not the exact CLI argument names (V2 names look like `mcp_MailTools`, `mcp_CalendarTools`, etc.).

| Capability | Category |
|---|---|
| Mail | Email |
| Calendar | Calendar |
| Teams | Teams chat |
| SharePoint | Documents |
| OneDrive | File storage |
| Word | Documents |
| User / Presence | Profile / presence |
| Copilot | M365 Copilot |
| Dataverse and Dynamics 365 | Business data |

---

## npm Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `@microsoft/agents-a365-tooling` | Core MCP tooling runtime | `npm install @microsoft/agents-a365-tooling` |
| `@microsoft/agents-a365-tooling-extensions-langchain` | LangChain adapter — `addToolServersToAgent` returns a **new** `ReactAgent`; caller MUST capture | `npm install @microsoft/agents-a365-tooling-extensions-langchain` |
| `@microsoft/agents-a365-tooling-extensions-openai` | OpenAI Agents SDK adapter — `addToolServersToAgent` **mutates `agent.mcpServers` in place**; return ignored | `npm install @microsoft/agents-a365-tooling-extensions-openai` |
| `@microsoft/agents-a365-tooling-extensions-claude` | Claude SDK adapter — `addToolServersToAgent` first param is `Options` from `@anthropic-ai/claude-agent-sdk`; **mutates `agentOptions.allowedTools` and `.mcpServers`**, returns `Promise<void>` | `npm install @microsoft/agents-a365-tooling-extensions-claude` |

> **Return-value semantics differ per framework.**
> - **LangChain** returns a NEW agent (tools are immutable on `createAgent`). Caller **must** reassign: `agentWithTools = await toolService.addToolServersToAgent(...)`. Ignoring the return = no tools attached.
> - **OpenAI** mutates `agent.mcpServers` in place and returns the same agent. Reassigning is harmless but unnecessary.
> - **Claude** mutates `agentOptions.allowedTools` and `agentOptions.mcpServers` in place; return type is `Promise<void>`. Cross-pasting LangChain's "capture return" pattern into Claude will write `void` into the variable.

**Frameworks without a Microsoft Node.js extension** (this skill hard-stops for these):
- Semantic Kernel — no package
- Google ADK — no package

Install core + the adapter for your framework. Example for LangChain:
```bash
npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-langchain
```

---

## LangChain — Wiring (VERIFIED)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/nodejs/langchain/sample-agent/src/client.ts

Create a single `McpToolRegistrationService` instance at module level, then call `addToolServersToAgent()` inside the per-turn `getClient()` factory. **Capture the return** — LangChain rebuilds the agent because `createAgent`'s tools are immutable.

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
  // Build the personalized agent without tools
  const personalizedAgent = createAgent({ model, name: agentName, systemPrompt: `...${displayName}...` });

  // A365 WorkIQ — added by add-workiq-tools skill
  // Capture the return — LangChain extension returns a NEW agent with tools attached.
  let agentWithMcpTools = undefined;
  try {
    agentWithMcpTools = await toolService.addToolServersToAgent(
      personalizedAgent,
      authorization,
      authHandlerName,
      turnContext,
      process.env.BEARER_TOKEN || '',  // dev only — empty in production
    );
  } catch (error) {
    console.error('Error adding MCP tool servers:', error);
    // falls back to agent without tools
  }

  return new LangChainClient(agentWithMcpTools || personalizedAgent, turnContext);
}
```

---

## OpenAI Agents SDK — Wiring (VERIFIED)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/nodejs/openai/sample-agent/src/client.ts

OpenAI extension mutates `agent.mcpServers` **in place** — return value is the same agent. Variable name in the sample is `agent` (not `personalizedAgent`). After registration, the `OpenAIClient` calls `server.connect()` / `server.close()` per turn around `run(agent, prompt)`.

```typescript
import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-openai';
import { Agent } from '@openai/agents';
import { Authorization, TurnContext } from '@microsoft/agents-hosting';

// Module-level singleton
const toolService = new McpToolRegistrationService();

export async function getClient(
  authorization: Authorization,
  authHandlerName: string,
  turnContext: TurnContext,
): Promise<Client> {
  const agent = new Agent({
    name: 'OpenAI Agent',
    model: modelName,
    instructions: `...${displayName}...`,
  });

  // A365 WorkIQ — added by add-workiq-tools skill
  // Mutates agent.mcpServers in place — return value ignored.
  try {
    await toolService.addToolServersToAgent(
      agent,
      authorization,
      authHandlerName,
      turnContext,
      process.env.BEARER_TOKEN || '',
    );
  } catch (error) {
    console.warn('Failed to register MCP tool servers:', error);
  }

  return new OpenAIClient(agent, turnContext);
}
```

---

## Claude SDK — Wiring (VERIFIED)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/nodejs/claude/sample-agent/src/client.ts

Claude extension's first parameter is `Options` from `@anthropic-ai/claude-agent-sdk`, **not** an Agent. The call mutates `agentOptions.allowedTools` and `agentOptions.mcpServers` in place and returns `Promise<void>`. The Options object is then passed to the Claude SDK client per turn.

Verified signature:
```typescript
async addToolServersToAgent(
  agentOptions: Options,
  authorization: Authorization,
  authHandlerName: string,
  turnContext: TurnContext,
  authToken: string,
): Promise<void>
```

Wiring pattern (mirrors OpenAI shape — `Options` instead of `Agent`, no return capture):
```typescript
import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-claude';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { Authorization, TurnContext } from '@microsoft/agents-hosting';

// Module-level singleton
const toolService = new McpToolRegistrationService();

export async function getClient(
  authorization: Authorization,
  authHandlerName: string,
  turnContext: TurnContext,
): Promise<Client> {
  const agentOptions: Options = {
    systemPrompt: `...${displayName}...`,
    // ...other Claude SDK Options fields...
  };

  // A365 WorkIQ — added by add-workiq-tools skill
  // Mutates agentOptions.allowedTools and .mcpServers in place — returns void.
  try {
    await toolService.addToolServersToAgent(
      agentOptions,
      authorization,
      authHandlerName,
      turnContext,
      process.env.BEARER_TOKEN || '',
    );
  } catch (error) {
    console.error('Failed to register MCP tool servers:', error);
  }

  return new ClaudeClient(agentOptions, turnContext);
}
```

---

## Shared behavior across all three frameworks

- `McpToolRegistrationService` reads `ToolingManifest.json` when `NODE_ENV=development` (case-insensitive). Source: `RuntimeConfiguration.isNodeEnvDevelopment` in `@microsoft/agents-a365-runtime`.
- In production, tool server URLs come from the provisioned blueprint config via the MCP gateway.
- `BEARER_TOKEN` is only used in dev. In production the `authorization` context performs per-audience OBO exchange automatically (`AgenticAuthenticationService.GetAgenticUserToken`).
- Always wrap the call in try/catch — never let a tool-discovery failure block the turn.

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

Do not hand-edit this file. Key V2 fields:
- `scope` — unified across all WorkIQ servers: `Tools.ListInvoke.All`
- `audience` — V2 service principal GUID: `16b1878d-62c7-4009-aa25-68989d63bbad`
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

Token variable naming convention: `BEARER_TOKEN_<UPPERCASE_SERVER_UNIQUE_NAME_NO_UNDERSCORES_REMOVED>` — e.g. `mcp_MailTools` → `BEARER_TOKEN_MCP_MAILTOOLS`.

In production `NODE_ENV` is `production` (or `WEBSITE_SITE_NAME` is set by Azure App Service),
and bearer token env vars are not used — token exchange happens per-audience via `authorization.exchangeToken()`.

---

## Permissions Workflow

`a365 develop add-mcp-servers` only writes `ToolingManifest.json`. Permissions are separate:

| Scenario | Command | Who |
|----------|---------|-----|
| Blueprint not yet created | `a365 setup all` (reads manifest automatically) | Developer |
| Blueprint already exists | `a365 setup permissions mcp` | **Global Administrator** |
| V1→V2 migration (remove legacy scopes) | `a365 setup permissions mcp --remove-legacy-scopes` | **Global Administrator** |
| Custom client app | `a365 develop add-permissions` | Developer (needs `Application.ReadWrite.All`) |

The GA must run from the project directory (where `a365.config.json` lives):
```bash
a365 setup permissions mcp
```

### Permissions per server

All WorkIQ servers use **delegated** scopes — they require an OBO token (signed-in user or Agentic User). The agent code wires `Tools.ListInvoke.All`; the per-server Graph scopes are granted at the Entra app level by `a365 setup permissions mcp`, which reads them from the live catalog. Run `a365 develop list-available` to see the current scopes required per server — we don't reproduce them here because the catalog evolves.

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
