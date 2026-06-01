# Python AI Teammate Reference Patterns

Authoritative code patterns for the `make-ai-teammate` skill — Python AgentFramework variant.
Source: [Agent365-Samples/python/agent-framework/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework/sample-agent)

---

## Required Dependencies (pyproject.toml)

All `microsoft-agents-a365-*` packages went **GA at 1.0.0** on 2026-05-01. `microsoft-agents-hosting-aiohttp` is at 0.9.1.

```toml
[project]
name = "your-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    # Framework SDK (install one)
    "agent-framework-azure-ai",                           # AgentFramework
    # "openai-agents",                                    # OpenAI Agents SDK
    # "claude-agent-sdk >= 0.1.0",                        # Claude
    # "langchain", "langchain-openai", "langgraph",       # LangChain
    # "semantic-kernel",                                  # Semantic Kernel

    # Microsoft Agents SDK — hosting and integration
    "microsoft-agents-hosting-aiohttp >= 1.0.0",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",

    # Azure SDK
    "azure-identity",

    # Core
    "python-dotenv",
    "aiohttp",
    "uvicorn[standard] >= 0.20.0",
    "fastapi >= 0.100.0",
    "httpx >= 0.24.1, < 0.28",
    "pydantic >= 2.0.0",
    "typing-extensions >= 4.0.0",
    "wrapt >= 1.15.0",

    # Microsoft Agent 365 SDK packages (GA 1.0.0)
    "microsoft-agents-a365-runtime >= 1.0.0",
    "microsoft-agents-a365-notifications >= 1.0.0",
    "microsoft-agents-a365-observability-core >= 1.0.0",
    "microsoft-agents-a365-observability-hosting >= 1.0.0",
    "microsoft-agents-a365-tooling >= 1.0.0",

    # MCP tooling adapter (install one matching your framework — parity with .NET IMcpToolRegistrationService)
    "microsoft-agents-a365-tooling-extensions-agentframework >= 1.0.0",
    # "microsoft-agents-a365-tooling-extensions-openai >= 1.0.0",
    # "microsoft-agents-a365-tooling-extensions-claude >= 1.0.0",

    "microsoft-opentelemetry >= 1.2.0",
]

[tool.uv]
prerelease = "allow"
```

Install:
```bash
uv sync
# or
pip install -e .
```

---

## Tested-against version matrix

Patterns in this reference are validated against these versions. pip excludes pre-releases by default (unlike npm's `latest` dist-tag behavior), so a plain `pip install` is safer than the Node.js equivalent — but `[tool.uv] prerelease = "allow"` flips that, so be aware that uv will pick up pre-releases of the A365 packages.

| Package | Tested version | Pin |
|---------|----------------|-----|
| `microsoft-agents-hosting-aiohttp` | 1.0.0 | `>= 1.0.0` |
| `microsoft-agents-hosting-core` | 0.9.x | unpinned |
| `microsoft-agents-authentication-msal` | 0.9.x | unpinned |
| `microsoft-agents-activity` | 0.9.x | unpinned |
| `microsoft-agents-a365-runtime` | 1.0.0 | `>= 1.0.0` |
| `microsoft-agents-a365-notifications` | 1.0.0 | `>= 1.0.0` |
| `microsoft-agents-a365-observability-core` | 1.0.0 | `>= 1.0.0` |
| `microsoft-agents-a365-observability-hosting` | 1.0.0 | `>= 1.0.0` |
| `microsoft-agents-a365-tooling` | 1.0.0 | `>= 1.0.0` |
| `microsoft-agents-a365-tooling-extensions-agentframework` | 1.0.0 | `>= 1.0.0` |
| `microsoft-opentelemetry` | 1.2.0 | `>= 1.2.0` |

> If you want to **block** preview upgrades while uv has `prerelease = "allow"`, change the constraint to `== 1.0.0` (exact pin) on the A365 packages. Removing the `[tool.uv] prerelease = "allow"` line is now safe — `microsoft-opentelemetry` reached GA at `1.2.0`, so plain `pip install` / `uv sync` resolves stable versions without `--pre`.

> **Preview package workarounds:** if you end up on a `microsoft-agents-a365-*` pre-release, expect type shapes to drift from the GA AgentInterface contract. Common compile-break: `add_tool_servers_to_agent` may require `initial_tools=[]` as a positional arg in preview vs keyword in GA. Pass `initial_tools=[]` explicitly to be safe. Downgrade to `== 1.0.0` if drift becomes painful.

---

## agent.py — AgentInterface Implementation

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import asyncio
import logging
import os
import re
from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from agent_framework import ChatAgent
from agent_framework.azure import AzureOpenAIChatClient
from microsoft_agents_a365.notifications import NotificationTypes

logger = logging.getLogger(__name__)

# Sanitize user display names before injecting into the system prompt
def _sanitize_display_name(name: str | None, max_len: int = 64) -> str:
    if not name or not name.strip():
        return "unknown"
    safe = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).strip()
    return safe[:max_len].rstrip() or "unknown"

AGENT_PROMPT_TEMPLATE = """You will speak like a friendly and professional virtual assistant.

The user's name is {user_name}. Use their name naturally where appropriate.

Use the tools available to you to help answer the user's questions.
"""


class MyAgent(AgentInterface):
    """AI Teammate agent using AgentFramework."""

    def __init__(self):
        # Persistent agent + its chat client. add-workiq-tools' setup_mcp_servers
        # reassigns self.agent via add_tool_servers_to_agent(chat_client=self.chat_client,
        # ...), so BOTH must live on self (not as locals) or MCP wiring breaks at runtime.
        self.agent: ChatAgent | None = None
        self.chat_client: AzureOpenAIChatClient | None = None

    def _create_chat_client(self) -> AzureOpenAIChatClient:
        endpoint   = os.environ["AZURE_OPENAI_ENDPOINT"]
        deployment = os.environ["AZURE_OPENAI_DEPLOYMENT"]
        api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-05-01-preview")
        api_key    = os.getenv("AZURE_OPENAI_API_KEY")

        if api_key:
            return AzureOpenAIChatClient(
                endpoint=endpoint,
                deployment=deployment,
                api_version=api_version,
                api_key=api_key,
            )
        else:
            # Fall back to Azure CLI credential (DefaultAzureCredential)
            from azure.identity import DefaultAzureCredential
            return AzureOpenAIChatClient(
                endpoint=endpoint,
                deployment=deployment,
                api_version=api_version,
                credential=DefaultAzureCredential(),
            )

    def _create_agent(self, tools: list | None = None) -> ChatAgent:
        return ChatAgent(chat_client=self.chat_client, tools=tools or [])

    async def initialize(self) -> None:
        self.chat_client = self._create_chat_client()
        self.agent = self._create_agent()
        logger.info("Agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        prompt = AGENT_PROMPT_TEMPLATE.format(user_name=safe_name)

        # add-workiq-tools rewrites this to pass the personalized prompt THROUGH
        # setup_mcp_servers(instructions=prompt) — which rebuilds self.agent WITH the MCP
        # tools attached — then runs self.agent.run(message). When WorkIQ isn't wired, the
        # bare agent takes the prompt via system_prompt= at run time. Either way the prompt
        # reaches the SAME persistent self.agent, so tools are never dropped. Mirrors:
        # https://github.com/microsoft/Agent365-Samples/blob/main/python/agent-framework/sample-agent/agent.py
        if hasattr(self, "setup_mcp_servers"):
            await self.setup_mcp_servers(auth, auth_handler_name, context, instructions=prompt)
            result = await self.agent.run(message)
        else:
            result = await self.agent.run(message, system_prompt=prompt)
        return self._extract_result(result)

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationTypes.EMAIL_NOTIFICATION:
            # Read email via WorkIQ Mail, then generate reply
            reply = await self.process_user_message(
                f"Handle this email notification: {payload}", auth, auth_handler_name, context
            )
            return reply
        return None

    def _extract_result(self, result) -> str:
        if isinstance(result, str):
            return result
        if hasattr(result, "content"):
            return str(result.content)
        return str(result)

    async def cleanup(self) -> None:
        logger.info("Agent cleaned up")
```

---

## host_agent_server.py — aiohttp Server + A365 Routing

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import asyncio
import logging
import os
from typing import Type
from dotenv import load_dotenv

load_dotenv()

from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from aiohttp import web
from microsoft_agents_hosting_aiohttp import CloudAdapter
from microsoft_agents_hosting_core import ActivityTypes
from microsoft_agents.hosting.core.authorization import MsalConnectionManager
from microsoft_agents.activity import ChannelId   # ChannelId lives in activity, NOT notifications
from microsoft_agents_a365.notifications import AgentNotification

logger = logging.getLogger(__name__)

AUTH_HANDLER_NAME = os.getenv("AUTH_HANDLER_NAME", "")


class GenericAgentHost:
    def __init__(self, agent: AgentInterface):
        self._agent = agent
        self._adapter: CloudAdapter | None = None
        self._app: web.Application | None = None

    def _setup_handlers(self):
        """Register all activity handlers on the adapter."""

        @self._adapter.on_activity(ActivityTypes.members_added)
        async def on_members_added(context, state):
            for member in context.activity.members_added or []:
                if member.id != context.activity.recipient.id:
                    await context.send_activity("Hello! I can help you today.")

        @self._adapter.on_activity(ActivityTypes.installation_update)
        async def on_installation_update(context, state):
            action = getattr(context.activity, "action", None)
            if action == "add":
                await context.send_activity("Thank you for hiring me!")
            elif action == "remove":
                await context.send_activity("Thank you for your time!")

        @self._adapter.on_activity(ActivityTypes.message)
        async def on_message(context, state):
            # Immediate ack
            await context.send_activity("Got it — working on it…")
            await context.send_activity({"type": "typing"})

            # Pass the Authorization instance from the adapter (NOT a raw token string).
            # The agent class calls authorization.exchange_token(...) per turn for OBO /
            # agentic-user, or reads BEARER_TOKEN env when USE_AGENTIC_AUTH is false.
            authorization = self._adapter.authorization

            # Typing indicator loop
            typing_active = True
            async def typing_loop():
                while typing_active:
                    await asyncio.sleep(4)
                    if typing_active:
                        await context.send_activity({"type": "typing"})

            typing_task = asyncio.create_task(typing_loop())
            try:
                reply = await self._agent.process_user_message(
                    context.activity.text or "",
                    authorization,
                    AUTH_HANDLER_NAME or None,
                    context,
                )
                await context.send_activity(reply)
            finally:
                typing_active = False
                typing_task.cancel()

        # AgentNotification routes inbound A365 notifications (email, WPX, etc.). It is a
        # CLASS that wraps the app — instantiate it with the adapter, then use its
        # on_agent_notification decorator. It is NOT a module-level function.
        notifications = AgentNotification(self._adapter)

        @notifications.on_agent_notification(
            ChannelId(channel="agents", sub_channel="*")
        )
        async def on_notification(context, state, notification):
            notification_type = getattr(context.activity, "name", None)
            reply = await self._agent.handle_agent_notification_activity(
                notification_type,
                context.activity.value,
                context,
                None,
                AUTH_HANDLER_NAME or None,
            )
            if reply:
                await context.send_activity(reply)

    async def start_server(self):
        await self._agent.initialize()

        # MsalConnectionManager reads all CONNECTIONS__* / AGENTAPPLICATION__* env vars
        # and resolves the right token issuer per service URL. Do NOT pass raw
        # client_id / client_secret / tenant_id to the adapter — the connection
        # manager owns that.
        connection_manager = MsalConnectionManager.from_environment()
        self._adapter = CloudAdapter(connection_manager=connection_manager)
        self._setup_handlers()

        self._app = web.Application()
        self._app.router.add_post("/api/messages", self._handle_messages)
        self._app.router.add_get("/api/health", self._handle_health)

        port = int(os.getenv("PORT", "3978"))
        runner = web.AppRunner(self._app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", port)
        await site.start()
        logger.info(f"Agent server running on port {port}")
        await asyncio.Event().wait()  # keep running

    async def _handle_messages(self, request: web.Request) -> web.Response:
        # Per-request log — cheap "did Teams reach us?" debugging default.
        try:
            body = await request.json()
        except Exception:
            body = {}
        text = (body.get("text") or "")[:60]
        logger.info(
            f"[/api/messages] type={body.get('type')} "
            f"from={(body.get('from') or {}).get('name')} text={text}"
        )
        # Belt-and-suspenders: if the SDK exposes an on_turn_error hook on the adapter
        # (Bot-Framework convention), configure it in start_server(). The outer try/except
        # here catches anything that escapes — auth/context-setup errors or hook-internal
        # throws — and returns 500 so we don't crash the aiohttp event loop.
        try:
            return await self._adapter.process(request)
        except Exception as err:
            logger.exception("[/api/messages] adapter.process raised", exc_info=err)
            return web.Response(status=500, text='{"error":"Internal server error"}',
                                content_type="application/json")

    async def _handle_health(self, request: web.Request) -> web.Response:
        import json
        from datetime import datetime, timezone
        body = json.dumps({"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()})
        return web.Response(text=body, content_type="application/json")

    async def cleanup(self):
        await self._agent.cleanup()


def create_and_run_host(agent_class: Type[AgentInterface]):
    """Entry point — instantiates the agent class and starts the host server."""
    agent = agent_class()
    host = GenericAgentHost(agent)
    asyncio.run(host.start_server())
```

---

## agent_interface.py — Abstract Base

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

from abc import ABC, abstractmethod

from microsoft_agents.hosting.core import Authorization


class AgentInterface(ABC):
    @abstractmethod
    async def initialize(self) -> None: ...

    @abstractmethod
    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str: ...

    @abstractmethod
    async def cleanup(self) -> None: ...

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        return None
```

---

## mcp_tool_registration_service.py — MCP Tool Loader (parity with .NET DI)

For parity with the .NET `IMcpToolRegistrationService` DI hook, Python uses a module-level singleton that wraps the SDK's `McpToolServerConfigurationService`. The agent class instantiates this once and reuses it across turns.

```python
# mcp_tool_registration_service.py
# A365 MCP — single instance imported by agent.py.
# Wraps the SDK's McpToolServerConfigurationService and resolves servers
# from ToolingManifest.json. The add-workiq-tools skill writes servers to
# that file; this service reads them at runtime.

import logging
from microsoft_agents_a365_tooling import McpToolServerConfigurationService

logger = logging.getLogger(__name__)


class McpToolRegistrationService:
    def __init__(self) -> None:
        self._service = McpToolServerConfigurationService()
        self._cache: dict[str, list] = {}

    async def discover_and_connect_servers(
        self, conversation_id: str, authorization, auth_handler_name: str, context
    ) -> list:
        """Resolve MCP tools for a conversation; cached after first call per turn."""
        if conversation_id in self._cache:
            return self._cache[conversation_id]

        # Notify the user (informative update) while tools load.
        await context.send_activity({"type": "typing"})
        tools = await self._service.get_mcp_tools_async(
            authorization=authorization,
            auth_handler_id=auth_handler_name,
            context=context,
        )
        self._cache[conversation_id] = tools
        return tools

    async def cleanup(self) -> None:
        await self._service.cleanup()


# Module-level singleton — import this from agent.py.
mcp_tool_service = McpToolRegistrationService()
```

---

## turn_context_utils.py — Caller Identity Helper

Reusable helper to pull caller identity from `TurnContext` consistently across notification and message handlers. Used by all framework variants.

```python
# turn_context_utils.py
# A365 — extracts caller identity from TurnContext for prompt building
# and observability attribution.

from typing import Optional


def extract_turn_context_details(
    context,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Returns (caller_name, caller_id, caller_aad_object_id) from a TurnContext.

    All three are best-effort and may be None for unauthenticated activities
    (e.g. local AgentsPlayground turns). Strip control characters before
    interpolating caller_name into prompts.
    """
    activity = getattr(context, "activity", None)
    if activity is None:
        return (None, None, None)

    from_property = getattr(activity, "from_property", None)
    caller_name = getattr(from_property, "name", None) if from_property else None
    caller_id = getattr(from_property, "id", None) if from_property else None
    caller_aad_object_id = (
        getattr(from_property, "aad_object_id", None) if from_property else None
    )
    return (caller_name, caller_id, caller_aad_object_id)
```

---

## .env template

Every key below is consumed by something specific. Comments indicate run-target applicability so the skill can flip values based on `runTarget` from `.a365-workspace-detection.local.json`.

### What reads what (canonical mapping)

| Key | Consumer | Required when |
|---|---|---|
| `AZURE_OPENAI_*` / `OPENAI_API_KEY` | `agent.py` LLM client constructor | always |
| `PORT` | `host_agent_server.py` (`web.TCPSite`) | always |
| `PYTHON_ENVIRONMENT` | App code convention (`Development` / `Production`). Python SDK does NOT have a NODE_ENV-style silent-401 gate, so this is mostly informational. | annotate target |
| `AUTH_HANDLER_NAME` | Python agent code at runtime to pick the active handler. `AGENTIC` in prod; empty leaves the agent with no handler. | prod / dev tunnel |
| `USE_AGENTIC_AUTH` | Per-project sample code (NOT the SDK) — switches between agentic-auth and `BEARER_TOKEN` paths for MCP. `true` for prod, `false` for local. | always (project-dependent) |
| `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__{CLIENTID,CLIENTSECRET,TENANTID}` | `MsalConnectionManager.from_environment()` → outbound auth for Teams replies | prod / dev tunnel |
| `CONNECTIONSMAP_0_{SERVICEURL,CONNECTION}` | Connection routing | prod / dev tunnel |
| `AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__{TYPE,SCOPES}` | Auth-handler settings | prod / dev tunnel |
| `ENABLE_A365_OBSERVABILITY_EXPORTER` | `microsoft-opentelemetry` distro (single canonical read) | prod (`=true`) / local (`=false`) |
| `agent365Observability__agentId`, `__tenantId` | Stamped by `a365 setup all`; read by observability wiring for `AgentDetails` → MAC portal grouping | prod / dev tunnel |
| `agent365Observability__agentName`, `__agentDescription` | Optional span attributes | optional |
| `BEARER_TOKEN` | Local MCP testing only (`a365 develop get-token`) | local-only — empty in prod |

> **What's NOT in this template** (parity with Node.js): `agent365Observability__agentBlueprintId` / `__clientId` / `__clientSecret` / `__sponsorUser*` — none of these are written by `a365 setup all` for Python or read by `microsoft-opentelemetry`. The `sponsorUser*` keys are S2S-only per `instrument-observability/SKILL.md`; AI Teammate uses `agentic-user`, where `CallerDetails` come from the turn context.

### The template

```dotenv
# ── LLM (always required — pick one stack) ─────────────────────────────────
# Azure OpenAI
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-05-01-preview
# OR: OPENAI_API_KEY=

# ── Server (always required) ────────────────────────────────────────────────
PORT=3978
# Skill rewrites this based on runTarget — informational marker, not a silent-401 gate (unlike Node.js NODE_ENV).
PYTHON_ENVIRONMENT=Production
LOG_LEVEL=INFO

# ── Agentic auth handler (prod / dev tunnel) ────────────────────────────────
AUTH_HANDLER_NAME=AGENTIC
USE_AGENTIC_AUTH=true
AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__TYPE=AgenticUserAuthorization
AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__SCOPES=https://graph.microsoft.com/.default

# ── Bot Framework outbound auth (prod / dev tunnel) ─────────────────────────
# Populated by `a365 setup all --aiteammate --m365` from a365.generated.config.json.
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=
CONNECTIONSMAP_0_SERVICEURL=*
CONNECTIONSMAP_0_CONNECTION=SERVICE_CONNECTION

# ── Observability (prod / dev tunnel) ───────────────────────────────────────
ENABLE_A365_OBSERVABILITY_EXPORTER=true
agent365Observability__agentId=
agent365Observability__tenantId=
agent365Observability__agentName=
agent365Observability__agentDescription=

# ── Local-only (AgentsPlayground / local MCP testing) ───────────────────────
# Leave empty in prod — agentic identity handles MCP auth at runtime.
BEARER_TOKEN=
```

### Skill behavior — rewriting based on `runTarget`

When `make-ai-teammate` Phase 8 runs for a Python project, the skill reads `runTarget` from `.a365-workspace-detection.local.json` and rewrites these keys (the rest are additive-only):

| Run target | `PYTHON_ENVIRONMENT` | `USE_AGENTIC_AUTH` | `ENABLE_A365_OBSERVABILITY_EXPORTER` |
|---|---|---|---|
| `runTarget=prod` AND `runTargetHosting ∈ {devtunnel, cloud}` | `Production` | `true` | `true` |
| `runTarget=local` (AgentsPlayground) | `Development` | `false` | `false` |

---

## Key Invariants

| Rule | Why |
|------|-----|
| `load_dotenv()` at top of `host_agent_server.py` before any imports | Env vars must be set before SDK packages read them at import time |
| `_sanitize_display_name()` strips control characters | `context.activity.from_property.name` is user-controlled text; prevents prompt injection |
| `AgentNotification(self._adapter).on_agent_notification(ChannelId(channel="agents", sub_channel="*"))` | Subscribes to all agent notification subtypes including email and WPX_COMMENT. `AgentNotification` is a class wrapping the app — NOT a module-level function. `ChannelId` is imported from `microsoft_agents.activity`. |
| Typing indicator loop at 4 s | Prevents Teams from clearing the typing indicator before the LLM responds |
| `requires-python = ">=3.11"` | `str | None` union syntax requires 3.10+; `asyncio.TaskGroup` requires 3.11+ |
| Outer `try/except` around `self._adapter.process(request)` in `_handle_messages` | Bot-Framework convention exposes an `on_turn_error` hook on adapters that catches errors inside the turn lifecycle. If your `microsoft-agents-hosting` version exposes that hook, configure it in `start_server()` (`self._adapter.on_turn_error = ...`). The outer try/except in `_handle_messages` is the belt-and-suspenders fallback that catches anything escaping the hook (pre-turn auth failures, hook-internal throws), preventing the aiohttp event loop from crashing on `unhandled exception`. |
| Per-request log line in `_handle_messages` | Cheap "did Teams reach us?" debugging default. Removable in prod if log volume matters. |

---

# Alternative `agent.py` Implementations

The `host_agent_server.py` and `agent_interface.py` files above are **identical for all Python frameworks**.
Only `agent.py` changes — it implements `AgentInterface.process_user_message()` using a different LLM backend.

---

## agent.py — OpenAI Agents SDK variant

Source: [Agent365-Samples/python/openai/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/python/openai/sample-agent)

```toml
# pyproject.toml additions
dependencies = [
    "openai-agents>=0.0.19",
    "microsoft-agents-hosting-aiohttp",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",
    "microsoft_agents_a365_notifications >= 0.1.0",
    "python-dotenv",
    "aiohttp",
]
```

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import asyncio
import dataclasses
import logging
import os
import re
from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from agents import Agent, Runner

from microsoft_agents_a365.notifications import NotificationTypes

logger = logging.getLogger(__name__)

def _sanitize_display_name(name: str | None, max_len: int = 64) -> str:
    if not name or not name.strip():
        return "unknown"
    safe = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).strip()
    return safe[:max_len].rstrip() or "unknown"

AGENT_PROMPT_TEMPLATE = """You will speak like a friendly and professional virtual assistant.

The user's name is {user_name}. Use their name naturally where appropriate.

Use the tools available to you to help answer the user's questions.
"""


class MyAgent(AgentInterface):
    """AI Teammate agent using the OpenAI Agents SDK."""

    def __init__(self):
        # Persistent agent — created ONCE and reused across turns. add-workiq-tools'
        # setup_mcp_servers reassigns this SAME attribute (self.agent) via
        # add_tool_servers_to_agent, so the MCP tools live on it. mcp_servers=[] gives
        # dataclasses.replace() a field to carry forward before WorkIQ is wired.
        self.agent: Agent | None = None
        self.mcp_servers: list = []

    async def initialize(self) -> None:
        self.agent = Agent(
            name="MyAgent",
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            instructions=AGENT_PROMPT_TEMPLATE.format(user_name="unknown"),
            mcp_servers=self.mcp_servers,
        )
        logger.info("Agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        prompt = AGENT_PROMPT_TEMPLATE.format(user_name=safe_name)

        # Personalize per turn WITHOUT discarding MCP tools. dataclasses.replace()
        # shallow-copies the PERSISTENT self.agent (carrying its mcp_servers) and swaps
        # only the instructions. NEVER build a fresh Agent(...) here — that drops every
        # tool add-workiq-tools attached to self.agent (this was the original bug). This
        # mirrors the verified OpenAI sample:
        # https://github.com/microsoft/Agent365-Samples/blob/main/python/openai/sample-agent/agent.py
        personalized_agent = dataclasses.replace(self.agent, instructions=prompt)

        # add-workiq-tools adds setup_mcp_servers (it reassigns self.agent with the MCP
        # tools attached). Call it when present; the bare pre-WorkIQ agent skips it.
        if hasattr(self, "setup_mcp_servers"):
            await self.setup_mcp_servers(auth, auth_handler_name, context)
            # Re-derive from the now-MCP-bearing self.agent so this turn gets the tools too.
            personalized_agent = dataclasses.replace(self.agent, instructions=prompt)

        result = await Runner.run(personalized_agent, message)
        return result.final_output or "Sorry, I couldn't get a response."

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationTypes.EMAIL_NOTIFICATION:
            reply = await self.process_user_message(
                f"Handle this email notification: {payload}", auth, auth_handler_name, context
            )
            return reply
        return None

    async def cleanup(self) -> None:
        logger.info("Agent cleaned up")
```

> **Azure OpenAI with OpenAI Agents SDK:** Set `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`,
> and `AZURE_OPENAI_DEPLOYMENT` env vars, then configure the default OpenAI client before
> creating `Agent` instances. See the official sample for the configuration helper.

---

## agent.py — Claude SDK variant

Source: [Agent365-Samples/python/claude/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/python/claude/sample-agent)

```toml
# pyproject.toml additions
dependencies = [
    "claude-agent-sdk>=0.1.0",
    "microsoft-agents-hosting-aiohttp",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",
    "microsoft_agents_a365_notifications >= 0.1.0",
    "python-dotenv",
    "aiohttp",
]
```

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import logging
import os
import re
from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    TextBlock,
)
from microsoft_agents_a365.notifications import NotificationTypes

logger = logging.getLogger(__name__)

def _sanitize_display_name(name: str | None, max_len: int = 64) -> str:
    if not name or not name.strip():
        return "unknown"
    safe = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).strip()
    return safe[:max_len].rstrip() or "unknown"

AGENT_SYSTEM_PROMPT_TEMPLATE = """You will speak like a friendly and professional virtual assistant.

The user's name is {user_name}. Use their name naturally where appropriate.

Use the tools available to you to help answer the user's questions.
"""


class MyAgent(AgentInterface):
    """AI Teammate agent using the Claude SDK."""

    def __init__(self):
        self._model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")

    async def initialize(self) -> None:
        logger.info("Claude agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        system_prompt = AGENT_SYSTEM_PROMPT_TEMPLATE.format(user_name=safe_name)

        options = ClaudeAgentOptions(
            model=self._model,
            system_prompt=system_prompt,
        )

        response_parts: list[str] = []
        async with ClaudeSDKClient(options=options) as client:
            async for event in client.receive_response(message):
                if isinstance(event, AssistantMessage):
                    for block in event.content:
                        if isinstance(block, TextBlock):
                            response_parts.append(block.text)

        return "".join(response_parts) or "Sorry, I couldn't get a response."
    # Note: WorkIQ MCP tool setup is added by the add-workiq-tools skill.

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationTypes.EMAIL_NOTIFICATION:
            reply = await self.process_user_message(
                f"Handle this email notification: {payload}", auth, auth_handler_name, context
            )
            return reply
        return None

    async def cleanup(self) -> None:
        logger.info("Claude agent cleaned up")
```

---

## agent.py — Google ADK variant

Source: [Agent365-Samples/python/google-adk/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/python/google-adk/sample-agent)

> **OTel version constraint:** Google ADK requires `opentelemetry-sdk<1.39.0`.
> Pin the full OTel stack to `1.38.x` in `pyproject.toml` using `[tool.uv] override-dependencies`.
> See the official sample's `pyproject.toml` for the full pin list.

```toml
# pyproject.toml additions
dependencies = [
    "google-adk>=1.18.0",
    "microsoft-agents-hosting-aiohttp",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",
    "microsoft_agents_a365_notifications >= 0.1.0",
    "python-dotenv",
    "aiohttp",
]

[tool.uv]
prerelease = "allow"
override-dependencies = [
    # Pin OTel stack — google-adk requires sdk<1.39.0
    "opentelemetry-api>=1.38.0,<1.39.0",
    "opentelemetry-sdk>=1.38.0,<1.39.0",
]
```

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import asyncio
import logging
import os
import re
from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService

from microsoft_agents_a365.notifications import NotificationTypes

logger = logging.getLogger(__name__)

def _sanitize_display_name(name: str | None, max_len: int = 64) -> str:
    if not name or not name.strip():
        return "unknown"
    safe = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).strip()
    return safe[:max_len].rstrip() or "unknown"

INSTRUCTION_TEMPLATE = """You are a helpful AI assistant.
The user's name is {user_name}. Use their name naturally where appropriate.
Use the tools available to you to help answer the user's questions.
"""


class MyAgent(AgentInterface):
    """AI Teammate agent using Google ADK."""

    def __init__(self):
        self._model = os.getenv("GOOGLE_MODEL", "gemini-2.5-flash")
        self._agent_name = "my_agent"

    async def initialize(self) -> None:
        logger.info("Google ADK agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        instruction = INSTRUCTION_TEMPLATE.format(user_name=safe_name)

        agent = Agent(
            name=self._agent_name,
            model=self._model,
            description="A helpful AI assistant",
            instruction=instruction,
        )

        # add-workiq-tools inserts the MCP attach HERE — between the Agent build and the
        # Runner, AFTER per-turn personalization:
        #   agent = await attach_workiq_tools(agent, auth, auth_handler_name, context)
        # ADK's per-turn rebuild is CORRECT (unlike the OpenAI variant's old fresh-Agent
        # bug): tools are re-attached every turn after the instruction is set, so nothing
        # is dropped. Do not hoist the Runner above this anchor. Mirrors:
        # https://github.com/microsoft/Agent365-Samples/blob/main/python/google-adk/sample-agent/agent.py

        session_service = InMemorySessionService()
        runner = Runner(
            agent=agent,
            app_name=self._agent_name,
            session_service=session_service,
        )

        response_parts: list[str] = []
        async for event in runner.run_async(
            user_id="user",
            session_id="session",
            new_message=message,
        ):
            if hasattr(event, "content") and event.content:
                for part in event.content.parts or []:
                    if hasattr(part, "text") and part.text:
                        response_parts.append(part.text)

        return "".join(response_parts) or "Sorry, I couldn't get a response."
    # Note: WorkIQ MCP tool setup is added by the add-workiq-tools skill.

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationTypes.EMAIL_NOTIFICATION:
            reply = await self.process_user_message(
                f"Handle this email notification: {payload}", auth, auth_handler_name, context
            )
            return reply
        return None

    async def cleanup(self) -> None:
        logger.info("Google ADK agent cleaned up")
```

---

## agent.py — LangChain variant (best-effort)

No official Python LangChain sample exists in Agent365-Samples. This is a best-effort pattern.

```toml
# pyproject.toml additions
dependencies = [
    "langchain>=0.3.0",
    "langchain-openai>=0.3.0",
    "microsoft-agents-hosting-aiohttp",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",
    "microsoft_agents_a365_notifications >= 0.1.0",
    "python-dotenv",
    "aiohttp",
]
```

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# A365 Observability — best-effort instrumentation (verify against official sample)

import logging
import os
import re
from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from langchain_openai import AzureChatOpenAI, ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from microsoft_agents_a365.notifications import NotificationTypes

logger = logging.getLogger(__name__)

def _sanitize_display_name(name: str | None, max_len: int = 64) -> str:
    if not name or not name.strip():
        return "unknown"
    safe = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).strip()
    return safe[:max_len].rstrip() or "unknown"

SYSTEM_PROMPT_TEMPLATE = """You are a helpful assistant.
The user's name is {user_name}. Use their name naturally where appropriate."""


def _create_llm():
    if os.getenv("AZURE_OPENAI_API_KEY") and os.getenv("AZURE_OPENAI_ENDPOINT"):
        return AzureChatOpenAI(
            azure_deployment=os.environ["AZURE_OPENAI_DEPLOYMENT"],
            azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2025-03-01-preview"),
        )
    return ChatOpenAI(
        model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        api_key=os.environ["OPENAI_API_KEY"],
    )


class MyAgent(AgentInterface):
    """AI Teammate agent using LangChain."""

    def __init__(self):
        self._llm = _create_llm()

    async def initialize(self) -> None:
        logger.info("LangChain agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(user_name=safe_name)

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=message),
        ]
        response = await self._llm.ainvoke(messages)
        return response.content or "Sorry, I couldn't get a response."
    # Note: WorkIQ MCP tool setup is added by the add-workiq-tools skill.

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationTypes.EMAIL_NOTIFICATION:
            reply = await self.process_user_message(
                f"Handle this email notification: {payload}", auth, auth_handler_name, context
            )
            return reply
        return None

    async def cleanup(self) -> None:
        logger.info("LangChain agent cleaned up")
```

---

## agent.py — Semantic Kernel variant (best-effort)

No official Python Semantic Kernel + AI Teammate sample exists in Agent365-Samples. This is a best-effort pattern.

```toml
# pyproject.toml additions
dependencies = [
    "semantic-kernel>=1.0.0",
    "microsoft-agents-hosting-aiohttp",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",
    "microsoft_agents_a365_notifications >= 0.1.0",
    "python-dotenv",
    "aiohttp",
]
```

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# A365 Observability — best-effort instrumentation (verify against official sample)

import logging
import os
import re
from agent_interface import AgentInterface
from microsoft_agents.hosting.core import Authorization

from semantic_kernel import Kernel
from semantic_kernel.connectors.ai.open_ai import (
    AzureChatCompletion,
    OpenAIChatCompletion,
)
from semantic_kernel.connectors.ai.chat_completion_client_base import ChatCompletionClientBase
from semantic_kernel.contents import ChatHistory

from microsoft_agents_a365.notifications import NotificationTypes

logger = logging.getLogger(__name__)

def _sanitize_display_name(name: str | None, max_len: int = 64) -> str:
    if not name or not name.strip():
        return "unknown"
    safe = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).strip()
    return safe[:max_len].rstrip() or "unknown"

SYSTEM_PROMPT_TEMPLATE = """You are a helpful assistant.
The user's name is {user_name}. Use their name naturally where appropriate."""


class MyAgent(AgentInterface):
    """AI Teammate agent using Semantic Kernel."""

    def __init__(self):
        self._kernel = Kernel()
        if os.getenv("AZURE_OPENAI_API_KEY") and os.getenv("AZURE_OPENAI_ENDPOINT"):
            self._kernel.add_service(AzureChatCompletion(
                deployment_name=os.environ["AZURE_OPENAI_DEPLOYMENT"],
                endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
                api_key=os.environ["AZURE_OPENAI_API_KEY"],
            ))
        else:
            self._kernel.add_service(OpenAIChatCompletion(
                ai_model_id=os.getenv("OPENAI_MODEL", "gpt-4o"),
                api_key=os.environ["OPENAI_API_KEY"],
            ))

    async def initialize(self) -> None:
        logger.info("Semantic Kernel agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: Authorization,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(user_name=safe_name)

        chat_service = self._kernel.get_service(type=ChatCompletionClientBase)
        history = ChatHistory(system_message=system_prompt)
        history.add_user_message(message)

        result = await chat_service.get_chat_message_contents(history)
        return result[0].content if result else "Sorry, I couldn't get a response."
    # Note: WorkIQ MCP tool setup is added by the add-workiq-tools skill.

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: Authorization,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationTypes.EMAIL_NOTIFICATION:
            reply = await self.process_user_message(
                f"Handle this email notification: {payload}", auth, auth_handler_name, context
            )
            return reply
        return None

    async def cleanup(self) -> None:
        logger.info("Semantic Kernel agent cleaned up")
```
| `ToolingManifest.json` NOT created by this skill — owned by `add-workiq-tools` | The CLI writes it via `a365 develop add-mcp-servers` so URLs / `audience` GUIDs stay authoritative. Pre-populating here would silently skip the WorkIQ offer at Phase 9.6. |
| `/api/health` returns 200 without auth | Load balancers and A365 infrastructure require unauthenticated health probes |

