# Python AI Teammate Reference Patterns

Authoritative code patterns for the `make-ai-teammate` skill — Python AgentFramework variant.
Source: [Agent365-Samples/python/agent-framework/sample-agent](https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework/sample-agent)

> **SDK-wide module-path conventions** (apply to every variant in this file):
> - PyPI `microsoft-agents-hosting-*` → Python `microsoft_agents.hosting.*` *(namespace package — dashes become dots, not underscores)*
> - PyPI `microsoft-agents-a365-*` → Python `microsoft_agents_a365.*` *(underscore between `agents` and `a365`, dot before the leaf)*
> - PyPI `microsoft-opentelemetry` → Python `microsoft.opentelemetry` *(also namespaced under `microsoft`)*
>
> Do NOT use the all-underscore form (`microsoft_agents_hosting_aiohttp`, `microsoft_opentelemetry`, `microsoft_agents_a365_notifications`) — those will `ModuleNotFoundError` at runtime even though the dist-info directory is named that way.

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
    "microsoft-agents-a365-tooling >= 1.0.0",

    # MCP tooling adapter (install one matching your framework — parity with .NET IMcpToolRegistrationService)
    "microsoft-agents-a365-tooling-extensions-agentframework >= 1.0.0",
    # "microsoft-agents-a365-tooling-extensions-openai >= 1.0.0",
    # "microsoft-agents-a365-tooling-extensions-claude >= 1.0.0",

    # Unified OpenTelemetry distro (re-exports BaggageBuilder / InvokeAgentScope / etc.
    # via microsoft.opentelemetry.a365.core). Do NOT also install
    # microsoft-agents-a365-observability-core / -hosting — the distro re-exports
    # everything those expose, and installing both causes duplicate-type imports
    # and span double-export.
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
        auth: Authorization,
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

Source of truth: [`Agent365-Samples/python/agent-framework/sample-agent/host_agent_server.py`](https://github.com/microsoft/Agent365-Samples/blob/main/python/agent-framework/sample-agent/host_agent_server.py).

The file below is the published sample, with **two skill-driven adjustments** called out inline:
- `PORT` default — the sample uses Bot Framework's legacy `3978`; this skill aligns to **`5000`** because that's what `a365 validate`'s harness probes for all stacks.
- `BaggageBuilder` import — the sample uses the SDK-native path (`microsoft_agents_a365.observability.core.middleware.baggage_builder`). This skill prefers the **unified distro re-export** (`microsoft.opentelemetry.a365.core.BaggageBuilder`) so the project doesn't need to install the legacy `microsoft-agents-a365-observability-*` packages alongside the distro (the build skill flags that combination as forbidden — duplicate-type / double-export hazard).

Everything else is verbatim from the sample. The companion `token_cache.py` (used by `cache_agentic_token` / `get_cached_agentic_token`) is a small per-project helper — copy from the sample's repo or re-implement against your preferred cache.

```python
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Generic Agent Host Server - Hosts agents implementing AgentInterface"""

# --- Imports ---

import asyncio
import logging
import os
import socket
from os import environ
from aiohttp.web import Application, Request, Response, json_response, run_app
from aiohttp.web_middlewares import middleware as web_middleware
from dotenv import load_dotenv
from agent_interface import AgentInterface, check_agent_inheritance
from microsoft_agents.activity import (
    load_configuration_from_env,
    Activity,
    ActivityTypes,
    ChannelId,
)
from microsoft_agents.authentication.msal import MsalConnectionManager
from microsoft_agents.hosting.aiohttp import (
    CloudAdapter,
    jwt_authorization_middleware,
    start_agent_process,
)
from microsoft_agents.hosting.core import (
    AgentApplication,
    AgentAuthConfiguration,
    AuthenticationConstants,
    Authorization,
    ClaimsIdentity,
    MemoryStorage,
    TurnContext,
    TurnState,
)
from microsoft_agents_a365.notifications import (
    AgentNotification,
    AgentNotificationActivity,
    EmailResponse,
    NotificationTypes,
)
from microsoft.opentelemetry import use_microsoft_opentelemetry
# Skill adjustment: BaggageBuilder via the unified distro re-export — avoids
# needing microsoft-agents-a365-observability-core installed alongside the distro.
from microsoft.opentelemetry.a365.core import BaggageBuilder
from microsoft_agents_a365.runtime.environment_utils import (
    get_observability_authentication_scope,
)
from token_cache import cache_agentic_token, get_cached_agentic_token

# --- Configuration ---

ms_agents_logger = logging.getLogger("microsoft_agents")
ms_agents_logger.addHandler(logging.StreamHandler())
ms_agents_logger.setLevel(logging.INFO)

observability_logger = logging.getLogger("microsoft_agents_a365.observability")
observability_logger.setLevel(logging.ERROR)

logger = logging.getLogger(__name__)

load_dotenv()

agents_sdk_config = load_configuration_from_env(environ)

# --- Public API ---

def create_and_run_host(
    agent_class: type[AgentInterface], *agent_args, **agent_kwargs
):
    """Create and run a generic agent host"""
    if not check_agent_inheritance(agent_class):
        raise TypeError(
            f"Agent class {agent_class.__name__} must inherit from AgentInterface"
        )

    # Initialize Microsoft OpenTelemetry distro for observability.
    use_microsoft_opentelemetry(
        enable_a365=True,
        enable_azure_monitor=False,
        a365_token_resolver=lambda agent_id, tenant_id: get_cached_agentic_token(
            tenant_id, agent_id
        )
        or "",
    )

    host = GenericAgentHost(agent_class, *agent_args, **agent_kwargs)
    auth_config = host.create_auth_configuration()
    host.start_server(auth_config)

# --- Generic Agent Host ---

class GenericAgentHost:
    """Generic host for agents implementing AgentInterface"""

    # --- Initialization ---

    def __init__(self, agent_class: type[AgentInterface], *agent_args, **agent_kwargs):
        if not check_agent_inheritance(agent_class):
            raise TypeError(
                f"Agent class {agent_class.__name__} must inherit from AgentInterface"
            )

        # Auth handler name — set AUTH_HANDLER_NAME=AGENTIC for production agentic auth.
        self.auth_handler_name = os.getenv("AUTH_HANDLER_NAME", "") or None
        if self.auth_handler_name:
            logger.info(f"🔐 Using auth handler: {self.auth_handler_name}")
        else:
            logger.info("🔓 No auth handler configured (AUTH_HANDLER_NAME not set)")

        self.agent_class = agent_class
        self.agent_args = agent_args
        self.agent_kwargs = agent_kwargs
        self.agent_instance = None
        self.storage = MemoryStorage()
        self.connection_manager = MsalConnectionManager(**agents_sdk_config)
        self.adapter = CloudAdapter(connection_manager=self.connection_manager)
        self.authorization = Authorization(
            self.storage, self.connection_manager, **agents_sdk_config
        )
        self.agent_app = AgentApplication[TurnState](
            storage=self.storage,
            adapter=self.adapter,
            authorization=self.authorization,
            **agents_sdk_config,
        )
        self.agent_notification = AgentNotification(self.agent_app)
        self._setup_handlers()
        logger.info("✅ Notification handlers registered successfully")

    # --- Observability ---

    async def _setup_observability_token(
        self, context: TurnContext, tenant_id: str, agent_id: str
    ):
        if not self.auth_handler_name:
            logger.debug("Skipping observability token exchange (no auth handler)")
            return
        try:
            exaau_token = await self.agent_app.auth.exchange_token(
                context,
                scopes=get_observability_authentication_scope(),
                auth_handler_id=self.auth_handler_name,
            )
            cache_agentic_token(tenant_id, agent_id, exaau_token.token)
        except Exception as e:
            logger.warning(f"⚠️ Failed to cache observability token: {e}")

    async def _validate_agent_and_setup_context(self, context: TurnContext):
        tenant_id = context.activity.recipient.tenant_id
        agent_id = context.activity.recipient.agentic_app_id

        if not self.agent_instance:
            logger.error("Agent not available")
            await context.send_activity("❌ Sorry, the agent is not available.")
            return None

        await self._setup_observability_token(context, tenant_id, agent_id)
        return tenant_id, agent_id

    # --- Handlers (Messages & Notifications) ---

    def _setup_handlers(self):
        """Setup message and notification handlers"""

        # Configure auth handlers - only required when auth_handler_name is set.
        handler_config = (
            {"auth_handlers": [self.auth_handler_name]} if self.auth_handler_name else {}
        )

        async def help_handler(context: TurnContext, _: TurnState):
            await context.send_activity(
                f"👋 **Hi there!** I'm **{self.agent_class.__name__}**, your AI assistant.\n\n"
                "How can I help you today?"
            )

        self.agent_app.conversation_update("membersAdded", **handler_config)(help_handler)
        self.agent_app.message("/help", **handler_config)(help_handler)

        @self.agent_app.activity("installationUpdate")
        async def on_installation_update(context: TurnContext, _: TurnState):
            action = context.activity.action
            if action == "add":
                await context.send_activity(
                    "Thank you for hiring me! Looking forward to assisting you in your "
                    "professional journey!"
                )
            elif action == "remove":
                await context.send_activity(
                    "Thank you for your time, I enjoyed working with you."
                )

        @self.agent_app.activity("message", **handler_config)
        async def on_message(context: TurnContext, _: TurnState):
            try:
                result = await self._validate_agent_and_setup_context(context)
                if result is None:
                    return
                tenant_id, agent_id = result

                with BaggageBuilder().tenant_id(tenant_id).agent_id(agent_id).build():
                    user_message = context.activity.text or ""
                    if not user_message.strip() or user_message.strip() == "/help":
                        return

                    # Immediate ack message before the LLM work begins.
                    await context.send_activity("Got it — working on it…")
                    await context.send_activity(Activity(type="typing"))

                    # Typing indicator loop — refreshes every ~4s. Teams clears the
                    # typing indicator after ~5s, so it must be re-sent.
                    async def _typing_loop():
                        try:
                            while True:
                                await asyncio.sleep(4)
                                await context.send_activity(Activity(type="typing"))
                        except asyncio.CancelledError:
                            pass

                    typing_task = asyncio.create_task(_typing_loop())
                    try:
                        response = await self.agent_instance.process_user_message(
                            user_message, self.agent_app.auth, self.auth_handler_name, context
                        )
                        await context.send_activity(response)
                    finally:
                        typing_task.cancel()
                        try:
                            await typing_task
                        except asyncio.CancelledError:
                            pass
            except Exception as e:
                logger.error(f"❌ Error: {e}")
                await context.send_activity(f"Sorry, I encountered an error: {str(e)}")

        # Wildcard notification handler — routes by notification_type internally.
        # Handler signature is (context, state, notification_activity) — 3 params, not 2.
        @self.agent_notification.on_agent_notification(
            channel_id=ChannelId(channel="agents", sub_channel="*"),
            **handler_config,
        )
        async def on_notification(
            context: TurnContext,
            state: TurnState,
            notification_activity: AgentNotificationActivity,
        ):
            try:
                result = await self._validate_agent_and_setup_context(context)
                if result is None:
                    return
                tenant_id, agent_id = result

                with BaggageBuilder().tenant_id(tenant_id).agent_id(agent_id).build():
                    if not hasattr(
                        self.agent_instance, "handle_agent_notification_activity"
                    ):
                        await context.send_activity(
                            "This agent doesn't support notification handling yet."
                        )
                        return

                    response = await self.agent_instance.handle_agent_notification_activity(
                        notification_activity, self.agent_app.auth,
                        self.auth_handler_name, context,
                    )

                    # Email replies must be wrapped in EmailResponse — sending plain
                    # text to an email notification conversation does NOT reply to
                    # the original email; it produces a separate Teams message.
                    if notification_activity.notification_type == NotificationTypes.EMAIL_NOTIFICATION:
                        await context.send_activity(
                            EmailResponse.create_email_response_activity(response)
                        )
                        return

                    await context.send_activity(response)
            except Exception as e:
                logger.error(f"❌ Notification error: {e}")
                await context.send_activity(
                    f"Sorry, I encountered an error processing the notification: {str(e)}"
                )

    # --- Agent Initialization ---

    async def initialize_agent(self):
        if self.agent_instance is None:
            self.agent_instance = self.agent_class(*self.agent_args, **self.agent_kwargs)
            await self.agent_instance.initialize()

    # --- Authentication ---

    def create_auth_configuration(self) -> AgentAuthConfiguration | None:
        client_id = environ.get("CLIENT_ID")
        tenant_id = environ.get("TENANT_ID")
        client_secret = environ.get("CLIENT_SECRET")

        if client_id and tenant_id and client_secret:
            return AgentAuthConfiguration(
                client_id=client_id,
                tenant_id=tenant_id,
                client_secret=client_secret,
                scopes=["5a807f24-c9de-44ee-a3a7-329e88a00ffc/.default"],
            )

        if environ.get("BEARER_TOKEN"):
            logger.info("🔑 Anonymous dev mode")
        else:
            logger.warning("⚠️ No auth env vars; running anonymous")

        return None

    # --- Server ---

    def start_server(self, auth_configuration: AgentAuthConfiguration | None = None):
        async def entry_point(req: Request) -> Response:
            return await start_agent_process(
                req, req.app["agent_app"], req.app["adapter"]
            )

        async def health(_req: Request) -> Response:
            return json_response(
                {
                    "status": "ok",
                    "agent_type": self.agent_class.__name__,
                    "agent_initialized": self.agent_instance is not None,
                }
            )

        middlewares = []

        if auth_configuration:
            @web_middleware
            async def jwt_with_health_bypass(request, handler):
                # Skip JWT for /api/health so orchestrators (ACA, AKS, App Service)
                # can probe health without a bearer token.
                if request.path == "/api/health":
                    return await handler(request)
                return await jwt_authorization_middleware(request, handler)
            middlewares.append(jwt_with_health_bypass)

        @web_middleware
        async def anonymous_claims(request, handler):
            if not auth_configuration:
                request["claims_identity"] = ClaimsIdentity(
                    {
                        AuthenticationConstants.AUDIENCE_CLAIM: "anonymous",
                        AuthenticationConstants.APP_ID_CLAIM: "anonymous-app",
                    },
                    False,
                    "Anonymous",
                )
            return await handler(request)
        middlewares.append(anonymous_claims)

        app = Application(middlewares=middlewares)
        app.router.add_post("/api/messages", entry_point)
        app.router.add_get("/api/messages", lambda _: Response(status=200))
        app.router.add_get("/api/health", health)
        app["agent_configuration"] = auth_configuration
        app["agent_app"] = self.agent_app
        app["adapter"] = self.agent_app.adapter

        app.on_startup.append(lambda app: self.initialize_agent())
        app.on_shutdown.append(lambda app: self.cleanup())

        # Skill adjustment: PORT defaults to 5000 (what a365 validate probes), not 3978.
        desired_port = int(environ.get("PORT", 5000))
        port = desired_port

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", desired_port)) == 0:
                port = desired_port + 1

        print(f"🚀 Server: localhost:{port}")
        print(f"📚 Endpoint: http://localhost:{port}/api/messages")
        print(f"❤️ Health: http://localhost:{port}/api/health")

        try:
            run_app(app, host="localhost", port=port, handle_signals=True)
        except KeyboardInterrupt:
            print("\n👋 Server stopped")

    # --- Cleanup ---

    async def cleanup(self):
        if self.agent_instance:
            try:
                await self.agent_instance.cleanup()
            except Exception as e:
                logger.error(f"Cleanup error: {e}")
```

### Notifications — canonical patterns (from [`learn.microsoft.com/.../notification?tabs=python`](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/notification?tabs=python))

**Imports:**
```python
from microsoft_agents.hosting.core import AgentApplication, Authorization, TurnContext
from microsoft_agents_a365.notifications import (
    AgentNotification,
    AgentNotificationActivity,
    NotificationTypes,
)
from microsoft_agents.activity import ChannelId
```

> The published docs show `from microsoft_agents_a365 import AgentApplication` — that re-export does NOT exist in `microsoft-agents-a365-notifications==1.0.0`. Import `AgentApplication` from `microsoft_agents.hosting.core` instead.

**Wildcard handler — required signature is `(context, state, notification)`:**
```python
agent_notification = AgentNotification(app)

@agent_notification.on_agent_notification(
    ChannelId(channel="agents", sub_channel="*")
)
async def handle_all_notifications(context, state, notification):
    if notification.notification_type == NotificationTypes.EMAIL_NOTIFICATION:
        ...
    elif notification.notification_type == NotificationTypes.WPX_COMMENT:
        ...
```

**Per-subchannel convenience decorators** (these all wrap the wildcard internally):
```python
@agent_notification.on_email()
@agent_notification.on_word()
@agent_notification.on_excel()
@agent_notification.on_powerpoint()
```

**Lifecycle events** — use `on_agent_lifecycle_notification("*")`. Event types:
| Event | Event ID |
|---|---|
| User Identity Created | `agenticUserIdentityCreated` |
| Workload Onboarding Updated | `agenticUserWorkloadOnboardingUpdated` |
| User Deleted | `agenticUserDeleted` |

```python
@agent_notification.on_agent_lifecycle_notification("*")
async def handle_lifecycle(context, state, notification):
    lifecycle = notification.agent_lifecycle_notification
    if lifecycle and lifecycle.lifecycle_event_type == "agenticUserIdentityCreated":
        ...
```

**Optional kwargs on every notification decorator:** `rank` (lower = higher priority, default `32767`) and `auto_sign_in_handlers=['agentic']` for automatic per-handler auth.

> **SDK bug — `AgentNotification.on_lifecycle()` is broken in `microsoft-agents-a365-notifications==1.0.0`.** Its body calls a non-existent `self.on_lifecycle_notification(...)` and raises `AttributeError`. The published docs use `on_agent_lifecycle_notification("*")` directly — that is the supported pattern, not a workaround.

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
from microsoft_agents_a365.tooling import McpToolServerConfigurationService

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
| `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__{CLIENTID,CLIENTSECRET,TENANTID}` | `MsalConnectionManager(**load_configuration_from_env(os.environ))` → outbound auth for Teams replies | prod / dev tunnel |
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
# Port 5000 — the a365 validate harness probes :5000 for ALL stacks (.NET, Python,
# Node.js). The legacy 3978 (Bot Framework default) is not what the validator uses.
PORT=5000
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
| `AgentNotification(app).on_agent_notification(ChannelId(channel="agents", sub_channel="*"))` | Subscribes to all agent notification subtypes including email, WPX_COMMENT, and lifecycle. Handler signature is `(context, state, notification_activity)` — three params. |
| Typing indicator loop at 4 s | Prevents Teams from clearing the typing indicator before the LLM responds |
| `requires-python = ">=3.11"` | `str | None` union syntax requires 3.10+; `asyncio.TaskGroup` requires 3.11+ |
| Outer `try/except` around `start_agent_process(request, app, adapter)` in the messages route | Activities flow through `start_agent_process(request, agent_app, adapter)` from `microsoft_agents.hosting.aiohttp` — NOT `adapter.process(request)`. Wrap the call so pre-turn validation errors → 400 and any other escape → 500; never let the aiohttp event loop crash on an unhandled exception. |
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
    "microsoft-agents-a365-notifications >= 1.0.0",
    "python-dotenv",
    "aiohttp",
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
        self._agent: Agent | None = None

    async def initialize(self) -> None:
        self._agent = Agent(
            name="MyAgent",
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            instructions="You are a helpful assistant.",
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

        # Recreate agent with per-turn instructions (or update instructions field)
        agent = Agent(
            name="MyAgent",
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            instructions=prompt,
        )
        result = await Runner.run(agent, message)
        return result.final_output or "Sorry, I couldn't get a response."
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
    "microsoft-agents-a365-notifications >= 1.0.0",
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
    "microsoft-agents-a365-notifications >= 1.0.0",
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
    "microsoft-agents-a365-notifications >= 1.0.0",
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
    "microsoft-agents-a365-notifications >= 1.0.0",
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

