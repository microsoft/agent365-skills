# Python — WorkIQ MCP Tool Patterns

Reference for the `add-workiq-tools` skill. The CLI workflow (`list-available` → `add-mcp-servers`) is identical to .NET and Node.js — only the agent code wiring differs per framework.

> **Verified against SDK source on 2026-05-21:**
> - SDK packages: https://github.com/microsoft/Agent365-python/tree/main/libraries
> - Samples: https://github.com/microsoft/Agent365-Samples/tree/main/python
>
> Sections marked **BEST-EFFORT** below have a verified SDK package but **no published Microsoft sample** — wiring shape is inferred from the SDK signature. Generated code is marked with `# A365 WorkIQ — best-effort wiring (verify against SDK source before production)` and must be verified against the linked SDK file before shipping.

---

## A365 CLI Commands (source of truth for ToolingManifest.json)

```bash
# See all available MCP servers in the catalog
a365 develop list-available

# Add selected WorkIQ servers — names MUST match exact mcpServerName from list-available.
# V2 catalog names shown; pull current values from your `a365 develop list-available` output.
a365 develop add-mcp-servers "mcp_MailTools" "mcp_CalendarTools"

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

## pip Packages (verified IDs)

| Package | Purpose | Sample published? |
|---------|---------|-------------------|
| `microsoft-agents-a365-tooling` | Core MCP tooling runtime | yes (core) |
| `microsoft-agents-a365-tooling-extensions-agentframework` | Agent Framework adapter | [yes](https://github.com/microsoft/Agent365-Samples/blob/main/python/agent-framework/sample-agent/agent.py) |
| `microsoft-agents-a365-tooling-extensions-openai` | OpenAI Agents SDK adapter | [yes](https://github.com/microsoft/Agent365-Samples/blob/main/python/openai/sample-agent/agent.py) |
| `microsoft-agents-a365-tooling-extensions-googleadk` | Google ADK adapter | [yes](https://github.com/microsoft/Agent365-Samples/blob/main/python/google-adk/sample-agent/agent.py) |
| `microsoft-agents-a365-tooling-extensions-semantickernel` | Semantic Kernel adapter | **no** — best-effort wiring below |
| `microsoft-agents-a365-tooling-extensions-azureaifoundry` | Azure AI Foundry adapter | **no** — best-effort wiring below |

> **Single-word framework suffixes — no internal dashes.** `microsoft-agents-a365-tooling-extensions-agent-framework` (with dash) is **not** a valid pip name and will fail `pip install` with "no matching distribution".

**Frameworks with no SDK extension:**

- **LangChain** — no Microsoft adapter, no sample. This skill hard-stops for Python LangChain. If you must wire WorkIQ manually, model after the Claude DIY scaffold (next bullet).
- **Claude SDK** and **CrewAI** — no Microsoft adapter; both samples ship a local `mcp_tool_registration_service.py` (next to `agent.py`) that wraps the core `McpToolServerConfigurationService`. Out of scope for `add-workiq-tools` — copy from the samples manually:
  - Claude: https://github.com/microsoft/Agent365-Samples/blob/main/python/claude/sample-agent/mcp_tool_registration_service.py (~165 lines)
  - CrewAI: https://github.com/microsoft/Agent365-Samples/blob/main/python/crewai/sample_agent/mcp_tool_registration_service.py (~600 lines, ships its own MCP HTTP client)

Install core + the matching adapter:
```bash
pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-<framework> 2>/dev/null \
  || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-<framework>
```

Also append the package names to `requirements.txt` or `[project.dependencies]` in `pyproject.toml` — `pip install` alone does not update either file, and the stop-hook validator requires the package name to appear in one of them.

---

## Python Agent Framework — Wiring (VERIFIED)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/python/agent-framework/sample-agent/agent.py

**Import** (verified):
```python
# A365 WorkIQ — added by add-workiq-tools skill
from microsoft_agents_a365.tooling.extensions.agentframework.services.mcp_tool_registration_service import (
    McpToolRegistrationService,
)
```

**Wiring** — instantiate the service in `__init__`, then attach MCP tools per agent lifetime (idempotent via `mcp_servers_initialized` flag). The sample uses a two-branch ladder switched by `USE_AGENTIC_AUTH`:

```python
import os
import logging

logger = logging.getLogger(__name__)

class MyAgent:
    def __init__(self):
        # ...existing __init__: self.chat_client, self.agent, self.AGENT_PROMPT...
        # A365 WorkIQ — added by add-workiq-tools skill
        self.tool_service = McpToolRegistrationService()
        self.mcp_servers_initialized = False

    async def setup_mcp_servers(self, auth, auth_handler_name, context, instructions=None):
        """Discover and attach WorkIQ MCP tools. Idempotent per agent lifetime."""
        if self.mcp_servers_initialized:
            return
        agent_instructions = instructions or self.AGENT_PROMPT
        use_agentic_auth = os.getenv("USE_AGENTIC_AUTH", "false").lower() == "true"
        bearer_token = os.getenv("BEARER_TOKEN", "")

        try:
            # A365 WorkIQ — added by add-workiq-tools skill
            if use_agentic_auth:
                # Agentic / production: omit auth_token. SDK calls auth.exchange_token() to mint
                # a fresh per-audience token via the configured Authorization handler.
                self.agent = await self.tool_service.add_tool_servers_to_agent(
                    chat_client=self.chat_client,
                    agent_instructions=agent_instructions,
                    initial_tools=[],
                    auth=auth,
                    auth_handler_name=auth_handler_name,
                    turn_context=context,
                )
            else:
                # Local dev: pass BEARER_TOKEN from .env. May be "" — SDK treats empty == None
                # and falls through to OBO exchange in production.
                self.agent = await self.tool_service.add_tool_servers_to_agent(
                    chat_client=self.chat_client,
                    agent_instructions=agent_instructions,
                    initial_tools=[],
                    auth=auth,
                    auth_handler_name=auth_handler_name,
                    auth_token=bearer_token,
                    turn_context=context,
                )
            if self.agent:
                self.mcp_servers_initialized = True
        except Exception as e:
            logger.error("MCP setup error: %s", e)

    async def process_user_message(self, message, auth, auth_handler_name, context):
        await self.setup_mcp_servers(auth, auth_handler_name, context)
        result = await self.agent.run(message)
        return self._extract_result(result)
```

### Parameter semantics (`add_tool_servers_to_agent` — AF extension)

| Param | What it actually does (from SDK source + sample) |
|-------|--------------------------------------------------|
| `chat_client` | Your LLM client (`AzureOpenAIChatClient` / `OpenAIChatClient`). Passed through to a new `RawAgent`. |
| `agent_instructions` | System prompt for the rebuilt agent. Personalize per turn if needed. |
| `initial_tools` | **Required** (positional, no default). Your pre-existing non-MCP tools. SDK does `all_tools = list(initial_tools) + discovered_mcp_tools`. Pass `[]` for MCP-only. Passing `None` raises `TypeError`. |
| `auth` | `Authorization` from `process_user_message`. SDK uses this internally for `exchange_token`. |
| `auth_handler_name` | Handler name registered in `AgentApplication.UserAuthorization`. |
| `turn_context` | Current `TurnContext`. **Kwarg is `turn_context=`** for AF only — OpenAI / SK / ADK use `context=`. Cross-pasting will raise `TypeError: unexpected keyword argument`. |
| `auth_token` | **Optional**. SDK guard is `if not auth_token and not is_dev:` — empty string and `None` are identical. In production both trigger `auth.exchange_token(turn_context, scopes, auth_handler_name)`. Pass a real token only for local dev (`a365 develop get-token`). |

The SDK function rebuilds the agent: `RawAgent(client=chat_client, tools=all_tools, instructions=agent_instructions)`. The return value is the new agent — **must be reassigned to `self.agent`**.

---

## Python OpenAI Agents SDK — Wiring (VERIFIED)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/python/openai/sample-agent/agent.py

**Import** (verified — note no `services/` subdir, unlike AF / SK / ADK):
```python
# A365 WorkIQ — added by add-workiq-tools skill
from microsoft_agents_a365.tooling.extensions.openai.mcp_tool_registration_service import (
    McpToolRegistrationService,
)
```

**Wiring** — the OpenAI sample uses a 3-priority ladder: `USE_AGENTIC_AUTH` → bearer token in config → auth handler only. Direct copy of the sample's call sites:

```python
import os
import logging

logger = logging.getLogger(__name__)

class MyAgent:
    def __init__(self):
        # ...existing __init__: self.agent (openai.Agent), instructions, etc...
        # A365 WorkIQ — added by add-workiq-tools skill
        self.tool_service = McpToolRegistrationService()

    async def setup_mcp_servers(self, auth, auth_handler_name, context):
        use_agentic_auth = os.getenv("USE_AGENTIC_AUTH", "false").lower() == "true"
        bearer_token = os.getenv("BEARER_TOKEN", "")

        try:
            # A365 WorkIQ — added by add-workiq-tools skill
            # Priority 1: Agentic auth (production / Teams)
            if use_agentic_auth:
                self.agent = await self.tool_service.add_tool_servers_to_agent(
                    agent=self.agent,
                    auth=auth,
                    auth_handler_name=auth_handler_name,
                    context=context,
                )
            # Priority 2: Local dev with explicit bearer token
            elif bearer_token:
                self.agent = await self.tool_service.add_tool_servers_to_agent(
                    agent=self.agent,
                    auth=auth,
                    auth_handler_name=auth_handler_name,
                    context=context,
                    auth_token=bearer_token,
                )
            # Priority 3: Auth handler registered but USE_AGENTIC_AUTH not set
            elif auth_handler_name:
                self.agent = await self.tool_service.add_tool_servers_to_agent(
                    agent=self.agent,
                    auth=auth,
                    auth_handler_name=auth_handler_name,
                    context=context,
                )
        except Exception as e:
            logger.error("MCP setup error: %s", e)

    async def process_user_message(self, message, auth, auth_handler_name, context):
        await self.setup_mcp_servers(auth, auth_handler_name, context)
        # ...invoke self.agent per OpenAI Agents SDK pattern...
```

### Parameter semantics differences from AF

- Kwarg is **`context=`**, not `turn_context=`.
- **No `chat_client` / `agent_instructions` / `initial_tools`** — pass `agent=` (an `openai.Agent`) instead. The extension mutates `agent.mcpServers` in place but the sample still reassigns `self.agent = await ...` (return is the same object).
- The OpenAI sample does **not** pass `agentic_app_id`.

---

## Python Google ADK — Wiring (VERIFIED, with sample-vs-PyPI divergence)

Sample: https://github.com/microsoft/Agent365-Samples/blob/main/python/google-adk/sample-agent/agent.py

> ⚠️ **Sample uses a LOCAL DIY scaffold, NOT the PyPI extension.** The published sample imports `from mcp_tool_registration_service import McpToolRegistrationService` — a local `mcp_tool_registration_service.py` file shipped alongside `agent.py`, NOT the PyPI extension. The PyPI extension's `add_tool_servers_to_agent` signature does NOT accept `agentic_app_id`; calling it with that kwarg raises `TypeError`.
>
> **Two valid paths for this skill:**
> - **Path A (recommended for skill use) — use the PyPI extension:** import from `microsoft_agents_a365.tooling.extensions.googleadk.services.mcp_tool_registration_service`, drop `agentic_app_id` from the call. Loses the AGENTIC_APP_ID-env-var override pattern but works with stock pip-installed packages.
> - **Path B — match the verified sample:** copy the sample's local `mcp_tool_registration_service.py` (~165 lines) into the user's project and import it locally. Preserves the env-var override + timeout pattern; requires shipping the DIY file.

**Path A — PyPI extension (recommended):**

```python
# A365 WorkIQ — added by add-workiq-tools skill
from microsoft_agents_a365.tooling.extensions.googleadk.services.mcp_tool_registration_service import (
    McpToolRegistrationService,
)
```

Verified signature (`Agent365-python/libraries/microsoft-agents-a365-tooling-extensions-googleadk/.../services/mcp_tool_registration_service.py:56-65`):
```python
async def add_tool_servers_to_agent(
    self,
    agent,
    auth,
    auth_handler_name,
    context,
    auth_token: str = "",
) -> Agent
```

**Wiring (Path A):** No `agentic_app_id` kwarg; wrap in `asyncio.wait_for(timeout=10.0)` so a hung token exchange falls back to bare-LLM mode:

```python
import asyncio
import logging

logger = logging.getLogger(__name__)

async def attach_workiq_tools(agent, auth, auth_handler_name, turn_context, bearer_token=""):
    """Best-effort: attach WorkIQ MCP tools to an ADK Agent with a 10s timeout."""
    # Skip MCP if neither a bearer token nor an auth handler is available (e.g. Playground)
    if not bearer_token and not auth_handler_name:
        logger.info("No token and no auth handler — skipping MCP, running bare LLM")
        return agent

    try:
        # A365 WorkIQ — added by add-workiq-tools skill
        tool_service = McpToolRegistrationService()
        return await asyncio.wait_for(
            tool_service.add_tool_servers_to_agent(
                agent=agent,
                auth=auth,
                auth_handler_name=auth_handler_name,
                context=turn_context,
                auth_token=bearer_token,
            ),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        logger.warning("MCP tool init timed out — running without tools")
        return agent
    except Exception as e:
        logger.error("MCP tool init error: %s — running without tools", e)
        return agent
```

**Path B — DIY scaffold (matches sample):** copy `mcp_tool_registration_service.py` from https://github.com/microsoft/Agent365-Samples/blob/main/python/google-adk/sample-agent/mcp_tool_registration_service.py into the user's project root and `from mcp_tool_registration_service import McpToolRegistrationService`. The DIY signature accepts `agentic_app_id` (env-var override pattern) — only use this if the user explicitly wants the sample's exact behavior.

### Parameter semantics differences from OpenAI

- ADK sample passes `agentic_app_id` (from `AGENTIC_APP_ID` env, default `"agent123"`) — OpenAI does not.
- ADK always passes `auth_token` (even when `""`) — OpenAI passes it only in the bearer-token-priority branch.
- Wrapping in `asyncio.wait_for` is the sample's pattern; without it a hung token exchange blocks the turn.

---

## Python Semantic Kernel — Wiring (BEST-EFFORT — no published sample)

> **No Microsoft sample exists for this stack.** SDK package is published; wiring shape below is inferred from the SDK signature. **Verify against the SDK source before shipping to production:**
> https://github.com/microsoft/Agent365-python/blob/main/libraries/microsoft-agents-a365-tooling-extensions-semantickernel/microsoft_agents_a365/tooling/extensions/semantickernel/services/mcp_tool_registration_service.py

**Import**:
```python
# A365 WorkIQ — best-effort wiring (verify against SDK source before production)
from microsoft_agents_a365.tooling.extensions.semantickernel.services.mcp_tool_registration_service import (
    McpToolRegistrationService,
)
```

**Verified signature** (from SDK source linked above):
```python
async def add_tool_servers_to_agent(
    self,
    kernel,                          # semantic_kernel.Kernel
    auth,                            # Authorization
    auth_handler_name: str,
    context,                         # TurnContext (kwarg is `context=`)
    auth_token: Optional[str] = None,
) -> None                            # mutates Kernel in place; return value ignored
```

**Best-effort call site** — mirrors the OpenAI shape since no published Python SK sample exists. Verify against the SDK file linked above before production:

```python
# A365 WorkIQ — best-effort wiring (verify against SDK source before production)
await self.tool_service.add_tool_servers_to_agent(
    kernel=self.kernel,
    auth=auth,
    auth_handler_name=auth_handler_name,
    context=context,
    # auth_token=...   # optional — dev only; empty == None falls through to OBO exchange in prod
)
```

The SK extension mutates the Kernel in place — there is no return value to reassign.

---

## Python Azure AI Foundry — Wiring (BEST-EFFORT — no published sample)

> **No Microsoft sample exists for this stack.** SDK package is published, but neither the exact import path nor the call signature has been independently verified. **Read the SDK source before writing any code:**
> https://github.com/microsoft/Agent365-python/tree/main/libraries/microsoft-agents-a365-tooling-extensions-azureaifoundry

Add the package to `requirements.txt`:
```
microsoft-agents-a365-tooling-extensions-azureaifoundry
```

Wiring is not documented here — open the SDK source to find the exact `McpToolRegistrationService` import path and `add_tool_servers_to_agent` (or equivalent) signature before writing the call site. Mark all generated lines with:
```python
# A365 WorkIQ — best-effort wiring (no published sample; verify against SDK source before production)
```

---

## Python LangChain — UNSUPPORTED (no SDK extension, no sample)

There is no `microsoft-agents-a365-tooling-extensions-langchain` package on PyPI and no `python/langchain/` directory in Agent365-Samples. The `add-workiq-tools` skill hard-stops for this stack.

If you must wire WorkIQ into a Python LangChain agent, the closest published pattern is the Claude SDK sample's local `mcp_tool_registration_service.py` (~165 lines, linked above under "Frameworks with no SDK extension"). It wraps the core `McpToolServerConfigurationService` and exposes framework-specific accessors. Adapting it for LangChain (whose tools come from `langchain-core.tools`) is **out of scope** for this skill — it is a non-trivial scaffold that requires per-customer testing.

---

## .env Variables (VERIFIED env-var names)

```dotenv
# Bearer token for local dev (a365 develop get-token)
BEARER_TOKEN=<token>

# V2 per-server bearer tokens — uppercase server unique name
BEARER_TOKEN_MCP_MAILTOOLS=<token>
BEARER_TOKEN_MCP_CALENDARTOOLS=<token>

# Platform endpoint — leave empty to use prod
MCP_PLATFORM_ENDPOINT=
MCP_PLATFORM_AUTHENTICATION_SCOPE=

# Dev-mode flag — SDK reads PYTHON_ENVIRONMENT (priority 1)
#   Priority order (first non-empty wins, case-insensitive match against "development"):
#     1. PYTHON_ENVIRONMENT
#     2. ENVIRONMENT
#     3. ASPNETCORE_ENVIRONMENT
#     4. DOTNET_ENVIRONMENT
#   Source: microsoft_agents_a365/tooling/utils/utility.py::is_development_environment
PYTHON_ENVIRONMENT=Development

# Set to "true" for production / Teams. When true, the AF / OpenAI / SK / ADK extensions
# bypass any BEARER_TOKEN env vars and call auth.exchange_token() per turn.
USE_AGENTIC_AUTH=false

# Skip tooling errors so the turn doesn't fail if MCP is unavailable
SKIP_TOOLING_ON_ERRORS=true
```

Token variable naming: `BEARER_TOKEN_<UPPERCASE_SERVER_UNIQUE_NAME>` — e.g. `mcp_CalendarTools` → `BEARER_TOKEN_MCP_CALENDARTOOLS`.

> ⚠ **Production gotcha — `is_development_environment()` defaults to `True` when no env var is set.** It checks the 4 env vars above in priority order and returns true if any equals `"development"` (case-insensitive). The default value when **none** is set is also `"Development"`. So a production host that doesn't explicitly set `PYTHON_ENVIRONMENT=Production` (or any non-`Development` value) will run the SDK in dev mode — skipping `auth.exchange_token()` even when `USE_AGENTIC_AUTH=true`, and propagating an empty `agentic_app_id` to manifest-based discovery. Always set `PYTHON_ENVIRONMENT` explicitly in your cloud platform's environment config.

> **`ENV=development` does NOT work.** Earlier revisions of this reference used `ENV` — that variable is not checked by the SDK. Use `PYTHON_ENVIRONMENT=Development` (or any of the fallback names above).

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

All WorkIQ servers use **delegated** scopes — they require an OBO token (signed-in user or Agentic User). The agent code wires `Tools.ListInvoke.All`; the per-server Graph scopes are granted at the Entra app level by `a365 setup permissions mcp`, which reads them from the live catalog. Run `a365 develop list-available` to see the current scopes required per server — we don't reproduce them here because the catalog evolves.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `add_tool_servers_to_agent` returns None / empty tools | Run `a365 develop list-configured` — verify servers are listed. Check `PYTHON_ENVIRONMENT` is set correctly for your environment (Development for local; Production or any other non-`Development` value for prod). |
| `AttributeError: ... has no attribute 'get_mcp_tools_async'` | Method does not exist on any Python extension. Use `add_tool_servers_to_agent`. (Older revisions of this reference invented the name `get_mcp_tools_async` — the SDK never exposed it.) |
| `ModuleNotFoundError: microsoft_agents_a365.tooling.extensions.langchain` | No LangChain extension exists. See "Python LangChain — UNSUPPORTED" section. |
| `TypeError: ... unexpected keyword argument 'context'` (or `turn_context`) | AF extension uses `turn_context=`. OpenAI / SK / ADK use `context=`. Do not cross-paste between framework sections. |
| `TypeError: add_tool_servers_to_agent() missing 1 required positional argument: 'initial_tools'` | AF extension requires `initial_tools`. Pass `initial_tools=[]` for MCP-only. |
| `ModuleNotFoundError: ...extensions.agent_framework` | Wrong package name. Use `microsoft-agents-a365-tooling-extensions-agentframework` (no dash before `framework`). Same applies to `…-semantickernel` / `…-googleadk` / `…-azureaifoundry`. |
| Production agent silently runs in dev mode (no OBO exchange) | `is_development_environment()` defaults to `True` when no env var is set. Explicitly set `PYTHON_ENVIRONMENT=Production` in your cloud platform's environment config. See the production gotcha callout above. |
| Token errors in dev | Run `a365 develop get-token`; set `BEARER_TOKEN` in `.env` |
| OBO exchange fails in production | Verify `auth_handler_name` matches the handler registered in `AgentApplication` |
| 403 from WorkIQ server at runtime | GA needs to run `a365 setup permissions mcp` with the updated `ToolingManifest.json` |
