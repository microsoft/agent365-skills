# Python — WorkIQ MCP Tool Patterns

Reference for the `add-workiq-tools` skill. The CLI workflow (list-available → add-mcp-servers)
is identical to .NET and Node.js. Only the agent code wiring differs.

> **Note:** Python WorkIQ SDK package names and API surface follow the same conventions as
> the Python observability SDK. Verify against the official sample before production use.

Official sample:
`https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework/sample-agent`

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

## pip Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `microsoft-agents-a365-tooling` | Core MCP tooling runtime | `pip install microsoft-agents-a365-tooling` |
| `microsoft-agents-a365-tooling-extensions-agent-framework` | AgentFramework adapter — `McpToolRegistrationService` | `pip install microsoft-agents-a365-tooling-extensions-agent-framework` |
| `microsoft-agents-a365-tooling-extensions-langchain` | LangChain adapter | `pip install microsoft-agents-a365-tooling-extensions-langchain` |
| `microsoft-agents-a365-tooling-extensions-openai` | OpenAI Agents SDK adapter | `pip install microsoft-agents-a365-tooling-extensions-openai` |
| `microsoft-agents-a365-tooling-extensions-semantic-kernel` | Semantic Kernel adapter | `pip install microsoft-agents-a365-tooling-extensions-semantic-kernel` |

Install core + the adapter for your framework. Example for AgentFramework:
```bash
pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-agent-framework 2>/dev/null || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-agent-framework
```

---

## Python AgentFramework — Loading WorkIQ Tools per Turn

Create a module-level `McpToolRegistrationService` singleton, then call
`get_mcp_tools_async()` inside the message handler.

```python
import os
from microsoft_agents_a365.tooling.extensions.agent_framework import McpToolRegistrationService
from microsoft_agents_hosting import TurnContext

# Module-level singleton — created once, reused across turns
# A365 WorkIQ — added by add-workiq-tools skill
_tool_service = McpToolRegistrationService()

class MyAgent(AgentApplication):

    async def on_message_activity(self, turn_context: TurnContext) -> None:
        # A365 WorkIQ — added by add-workiq-tools skill
        # A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
        agent_id = os.environ.get("AGENT_ID", "")
        work_iq_tools = await _tool_service.get_mcp_tools_async(
            agent_id,
            turn_context.activity.caller_id,  # UserAuthorization — "AGENTIC" handler resolves identity
            "AGENTIC",                         # authHandlerName — same for all authMode values
            turn_context
        )
        # Pass work_iq_tools to your LLM / function-calling pipeline
        # e.g. chat_options = {"tools": work_iq_tools}
```

Key points:
- `McpToolRegistrationService` reads `ToolingManifest.json` when `ENV=development`
- In production, tool server URLs come from the provisioned blueprint config
- `BEARER_TOKEN` env vars are only used in dev; production uses `caller_id` for OBO exchange
- Errors should be caught and the agent should fall back gracefully — never block the turn

---

## Python LangChain — Loading WorkIQ Tools per Turn

```python
import os
from microsoft_agents_a365.tooling.extensions.langchain import McpToolRegistrationService
from microsoft_agents_hosting import TurnContext

# Module-level singleton
# A365 WorkIQ — added by add-workiq-tools skill
_tool_service = McpToolRegistrationService()

async def get_agent(authorization, auth_handler_name: str, turn_context: TurnContext):
    # Create base LangChain agent first (without tools)
    agent = create_agent(llm=llm, tools=[], system_prompt="...")

    # Attach MCP tool servers for this turn
    # A365 WorkIQ — added by add-workiq-tools skill
    try:
        agent = await _tool_service.add_tool_servers_to_agent(
            agent,
            authorization,
            auth_handler_name,                  # "AGENTIC" for all authMode values
            turn_context,
            os.environ.get("BEARER_TOKEN", ""), # dev only — empty in production
        )
    except Exception as e:
        print(f"Error adding MCP tool servers: {e}")
        # falls back to agent without tools

    return agent
```

---

## Python OpenAI Agents SDK — Loading WorkIQ Tools per Turn

```python
from microsoft_agents_a365.tooling.extensions.openai import McpToolRegistrationService

_tool_service = McpToolRegistrationService()

async def get_tools(authorization, auth_handler_name: str, turn_context: TurnContext) -> list:
    # A365 WorkIQ — added by add-workiq-tools skill
    try:
        return await _tool_service.get_mcp_tools_async(
            os.environ.get("AGENT_ID", ""),
            authorization,
            auth_handler_name,
            turn_context,
        )
    except Exception as e:
        print(f"WorkIQ tools unavailable: {e}")
        return []
```

---

## .env Variables

```dotenv
# Development: single fallback bearer token from `a365 develop get-token`
BEARER_TOKEN=<token>

# V2 per-server bearer tokens (preferred over single BEARER_TOKEN when set)
BEARER_TOKEN_MCP_MAILTOOLS=<token>
BEARER_TOKEN_MCP_CALENDARTOOLS=<token>

# Platform endpoint — leave empty to use the production default
MCP_PLATFORM_ENDPOINT=
MCP_PLATFORM_AUTHENTICATION_SCOPE=

# ENV=development causes the SDK to load servers from ToolingManifest.json
ENV=development

# Skip tooling errors in dev so the turn doesn't fail if MCP is unavailable
SKIP_TOOLING_ON_ERRORS=true
```

Token variable naming: `BEARER_TOKEN_<UPPERCASE_SERVER_UNIQUE_NAME>` — e.g. `mcp_CalendarTools` → `BEARER_TOKEN_MCP_CALENDARTOOLS`.

---

## ToolingManifest.json — Written by CLI

`a365 develop add-mcp-servers` writes entries like this (V2 schema):

```json
{
  "mcpServers": [
    {
      "mcpServerName": "mcp_CalendarTools",
      "mcpServerUniqueName": "mcp_CalendarTools",
      "url": "https://agent365.svc.cloud.microsoft/agents/v2/servers/mcp_CalendarTools",
      "scope": "Tools.ListInvoke.All",
      "audience": "910333d2-47e9-43ca-981f-6df2f4531ef4",
      "publisher": "Microsoft"
    }
  ]
}
```

Do not hand-edit this file.

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
| `get_mcp_tools_async` returns empty list | Run `a365 develop list-configured` — verify servers are listed; check `ENV=development` |
| Token errors in dev | Run `a365 develop get-token`; set `BEARER_TOKEN` in `.env` |
| OBO exchange fails in production | Verify `auth_handler_name` matches the handler registered in `AgentApplication` |
| 403 from WorkIQ server at runtime | GA needs to run `a365 setup permissions mcp` with the updated `ToolingManifest.json` |
| `ModuleNotFoundError: microsoft_agents_a365.tooling` | Run `pip install microsoft-agents-a365-tooling` |
| `ModuleNotFoundError: ...extensions.agent_framework` | Run `pip install microsoft-agents-a365-tooling-extensions-agent-framework` |
