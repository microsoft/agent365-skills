# Python AI Teammate Reference Patterns

Authoritative code patterns for the `make-ai-teammate` skill — Python AgentFramework variant.
Source: [Agent365-Samples/python/agent-framework/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework/sample-agent)

---

## Required Dependencies (pyproject.toml)

```toml
[project]
name = "your-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    # AgentFramework SDK
    "agent-framework-azure-ai",

    # Microsoft Agents SDK — hosting and integration
    "microsoft-agents-hosting-aiohttp",
    "microsoft-agents-hosting-core",
    "microsoft-agents-authentication-msal",
    "microsoft-agents-activity",

    # Azure SDK
    "azure-identity",

    # Core
    "python-dotenv",
    "aiohttp",
    "uvicorn[standard]>=0.20.0",
    "fastapi>=0.100.0",
    "httpx>=0.24.0",
    "pydantic>=2.0.0",
    "typing-extensions>=4.0.0",

    # Microsoft Agent 365 SDK packages
    "microsoft_agents_a365_runtime >= 0.1.0",
    "microsoft_agents_a365_notifications >= 0.1.0"
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

## agent.py — AgentInterface Implementation

```python
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import asyncio
import logging
import os
import re
from agent_interface import AgentInterface

from agent_framework import ChatAgent
from agent_framework.azure import AzureOpenAIChatClient
from microsoft_agents_a365_notifications import NotificationType

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
        self._agent: ChatAgent | None = None

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
        chat_client = self._create_chat_client()
        return ChatAgent(chat_client=chat_client, tools=tools or [])

    async def initialize(self) -> None:
        self._agent = self._create_agent()
        logger.info("Agent initialized")

    async def process_user_message(
        self,
        message: str,
        auth: str | None,
        auth_handler_name: str | None,
        context,
    ) -> str:
        user_name = getattr(getattr(context, "activity", None), "from_property", None)
        if user_name:
            user_name = getattr(user_name, "name", None)
        safe_name = _sanitize_display_name(user_name)
        prompt = AGENT_PROMPT_TEMPLATE.format(user_name=safe_name)

        result = await self._agent.run(message, system_prompt=prompt)
        return self._extract_result(result)
    # Note: WorkIQ MCP tool setup is added by the add-workiq-tools skill.

    async def handle_agent_notification_activity(
        self,
        notification_type: str,
        payload,
        context,
        auth: str | None,
        auth_handler_name: str | None,
    ) -> str | None:
        if notification_type == NotificationType.EMAIL_NOTIFICATION:
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

from aiohttp import web
from microsoft_agents_hosting_aiohttp import CloudAdapterAiohttp
from microsoft_agents_hosting_core import ActivityTypes
from microsoft_agents_a365_notifications import (
    agent_notification,
    ChannelId,
    NotificationType,
)

logger = logging.getLogger(__name__)

AUTH_HANDLER_NAME = os.getenv("AUTH_HANDLER_NAME", "")


class GenericAgentHost:
    def __init__(self, agent: AgentInterface):
        self._agent = agent
        self._adapter: CloudAdapterAiohttp | None = None
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

            auth = None
            if AUTH_HANDLER_NAME:
                token_result = await context.get_token(AUTH_HANDLER_NAME)
                auth = getattr(token_result, "token", None)
            if not auth:
                auth = os.getenv("BEARER_TOKEN")

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
                    auth,
                    AUTH_HANDLER_NAME or None,
                    context,
                )
                await context.send_activity(reply)
            finally:
                typing_active = False
                typing_task.cancel()

        @agent_notification.on_agent_notification(
            channel_id=ChannelId(channel="agents", sub_channel="*")
        )
        async def on_notification(context, state):
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

        self._adapter = CloudAdapterAiohttp(
            client_id=os.getenv("CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID", ""),
            client_secret=os.getenv("CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET", ""),
            tenant_id=os.getenv("CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID", ""),
        )
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
        return await self._adapter.process(request)

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


class AgentInterface(ABC):
    @abstractmethod
    async def initialize(self) -> None: ...

    @abstractmethod
    async def process_user_message(
        self,
        message: str,
        auth: str | None,
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
        auth: str | None,
        auth_handler_name: str | None,
    ) -> str | None:
        return None
```

---

## .env template

```dotenv
# Authentication
AUTH_HANDLER_NAME=
BEARER_TOKEN=

# Azure OpenAI
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-05-01-preview

# A365 Connections
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__SCOPES=

CONNECTIONSMAP_0_SERVICEURL=*
CONNECTIONSMAP_0_CONNECTION=SERVICE_CONNECTION

# Agentic auth settings
USE_AGENTIC_AUTH=true
AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__TYPE=AgenticUserAuthorization
AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__SCOPES=https://graph.microsoft.com/.default

# Server
PORT=3978
PYTHON_ENVIRONMENT=development
LOG_LEVEL=INFO
```

---

## Key Invariants

| Rule | Why |
|------|-----|
| `load_dotenv()` at top of `host_agent_server.py` before any imports | Env vars must be set before SDK packages read them at import time |
| `_sanitize_display_name()` strips control characters | `context.activity.from_property.name` is user-controlled text; prevents prompt injection |
| `agent_notification.on_agent_notification(channel_id=ChannelId(channel="agents", sub_channel="*"))` | Subscribes to all agent notification subtypes including email and WPX_COMMENT |
| Typing indicator loop at 4 s | Prevents Teams from clearing the typing indicator before the LLM responds |
| `requires-python = ">=3.11"` | `str | None` union syntax requires 3.10+; `asyncio.TaskGroup` requires 3.11+ |
| `ToolingManifest.json` created with Calendar + Mail servers | Add more servers with the `add-workiq-tools` skill |
| `/api/health` returns 200 without auth | Load balancers and A365 infrastructure require unauthenticated health probes |

