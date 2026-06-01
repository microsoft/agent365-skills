# Python — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Python agent. Aligned with `microsoft-opentelemetry` **GA 1.2.x** (released 2026-05-11).

> **Major shift from earlier 0.x:** the legacy packages
> (`microsoft-agents-a365-observability-core`, `-hosting`, `-runtime`, and the four
> `-extensions-*` packages) are **deprecated**. The entry point `use_microsoft_opentelemetry`
> ships from `microsoft-opentelemetry`, but `BaggageBuilder`, `get_observability_authentication_scope`,
> and the scope types are still importable from their legacy module paths (transitive deps).
> See `MIGRATION_A365.md` in the distro repo for the authoritative migration guide.
>
> **Sample-lag note (2026-05):** `Agent365-Samples/python/agent-framework/sample-agent` is the verified canonical sample — it uses **manual per-turn `BaggageBuilder()` in the handler** (NOT `ObservabilityHostingManager` middleware) and imports `BaggageBuilder` + `get_observability_authentication_scope` from `microsoft.opentelemetry.a365.core.middleware.baggage_builder` and `microsoft_agents_a365.runtime.environment_utils` respectively. The OpenAI sample still uses the legacy `configure(...)` + `OpenAIAgentsTraceInstrumentor().instrument()` pattern — the skill direction (unified `use_microsoft_opentelemetry`) is forward-looking; migrate existing code to it.

---

## Auth Mode Mapping

The agent's `authMode` (read from `.a365-workspace-detection.local.json`) determines which path to wire. The code shape is **identical** for `obo` and `agentic-user` — only the identity the token exchange returns differs. `s2s` uses a completely separate token-service scaffold.

| `authMode` | Used by | Token mechanism | Identity in traces | Wiring | Per-turn token refresh |
|---|---|---|---|---|---|
| `agentic-user` | AI Teammate (always) | OBO exchange | Agent's own M365 identity (Agentic User — UPN, mailbox) | `AgenticTokenCache` or custom resolver | ✅ Call `exchange_token()` and cache the result |
| `obo` | Non-AI Teammate | OBO exchange | Whatever the configured Azure AD auth handler resolves — typically the signed-in user, but can also be the agent's own identity | `AgenticTokenCache` or custom resolver | ✅ Call `exchange_token()` and cache the result |
| `s2s` | Non-AI Teammate | Service principal client credentials (no token exchange) | Agent Identity SP — no user context | Custom `a365_token_resolver` + background FMI token service | ❌ Do NOT call `exchange_token()` |

> AI Teammate is **always** `agentic-user` — no question is asked. Non-AI Teammate agents are asked at setup whether they want `obo` or `s2s`.
>
> Note: "OBO" describes the **token exchange mechanism**, not who the agent acts as. Both `obo` and `agentic-user` use OBO under the hood — they differ only in which identity the configured Azure AD auth handler returns. `s2s` does not use OBO at all.

---

## pip Packages

| Package | Purpose |
|---------|---------|
| `microsoft-opentelemetry` (1.2.x GA) | Sole entry point. Re-exports `use_microsoft_opentelemetry`, baggage helpers (`populate`, `BaggageMiddleware`, `ObservabilityHostingManager`), `AgenticTokenCache`, all scope types (`InvokeAgentScope`, `InferenceScope`, `ExecuteToolScope`, `OutputScope`), and all contract types (`AgentDetails`, `CallerDetails`, `UserDetails`, `Request`, `Response`, `InvokeAgentScopeDetails`, `InferenceCallDetails`, `ToolCallDetails`, etc.). **Note:** Unlike Node.js, no `shutdown_microsoft_opentelemetry` helper is exported — see [Graceful Shutdown](#graceful-shutdown) for the OTel SDK-based pattern. |
| `microsoft-opentelemetry[langchain]` | Optional extra — adds LangChain instrumentation deps (only if your agent uses LangChain) |
| `msal` (^1.34) | MSAL Python `ConfidentialClientApplication` for Hop 3 token acquisition (S2S only) |
| `azure-identity` (^1.20) | `ManagedIdentityCredential` for MSI-based token acquisition (S2S only) |
| `httpx` (^0.27) | Direct HTTP POST for FMI Hop 1+2 (MSAL `fmi_path` workaround — see Known Issues) |

Install:
```bash
# Required for all agents
pip3 install microsoft-opentelemetry 2>/dev/null || pip install microsoft-opentelemetry

# Optional LangChain extra
pip3 install "microsoft-opentelemetry[langchain]" 2>/dev/null || pip install "microsoft-opentelemetry[langchain]"

# S2S only
pip3 install msal azure-identity httpx 2>/dev/null || pip install msal azure-identity httpx
```

> **No `--pre` flag needed.** `microsoft-opentelemetry` is GA — install latest stable.

Minimum Python: **3.10+** (for `str | None` typing in code samples; the package itself supports 3.9+).

### Google ADK projects — pin the OTel stack

If `pyproject.toml` lists `google-adk`, `uv sync` will spin for minutes resolving the OTel graph because `google-adk` requires `opentelemetry-sdk<1.39.0` while `microsoft-opentelemetry` 1.2.x pulls a newer transitive OTel SDK. Force a compatible version with `[tool.uv] override-dependencies`:

```toml
# pyproject.toml — merge into existing [tool.uv] or add this block
[tool.uv]
prerelease = "allow"
override-dependencies = [
    "opentelemetry-api>=1.38.0,<1.39.0",
    "opentelemetry-sdk>=1.38.0,<1.39.0",
]
```

This is the same pattern documented in `make-ai-teammate/references/python-ai-teammate.md` for the Google ADK sample. Apply only to Google ADK projects — all other stacks (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel) accept OTel 1.39+ without this pin.

---

## Entry Point — Observability Init (before any LLM imports)

Initialize the unified distro **before** importing the rest of your app so OpenAI Agents,
LangChain, Semantic Kernel, and Agent Framework auto-instrumentation can patch their
target libraries.

### OBO / agentic-user (same code; identity decided by the auth handler)

```python
# A365 Observability — best-effort instrumentation (verify against official sample)
# Must be called BEFORE importing other modules
from dotenv import load_dotenv
load_dotenv()

from microsoft.opentelemetry import use_microsoft_opentelemetry
from microsoft.opentelemetry.a365.hosting.token_cache_helpers import AgenticTokenCache

_token_cache = AgenticTokenCache()

use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,   # REQUIRED in 1.0+ to actually export spans
    a365_token_resolver=_token_cache.get_observability_token,
)
```

> **Two flags required (1.0 breaking change):** `enable_a365=True` only registers
> A365 span processors. You must **also** set `a365_enable_observability_exporter=True`
> (or env `ENABLE_A365_OBSERVABILITY_EXPORTER=true`) to send spans to A365.

> **GenAI auto-instrumentation is now ON by default.** OpenAI Agents, LangChain,
> Semantic Kernel, and Agent Framework are auto-patched. Do NOT call legacy
> `*Instrumentor().instrument()` — manual calls produce **duplicate spans**.
>
> **OpenAI Agents SDK migration note:** the published `Agent365-Samples/python/openai/sample-agent` still imports the legacy `configure(...)` API + `OpenAIAgentsTraceInstrumentor().instrument()`. **If you see `OpenAIAgentsTraceInstrumentor().instrument()` in user code copied from that sample, REMOVE it** — auto-instrumentation in `microsoft-opentelemetry` 1.2+ handles it. Replace `configure(...)` with `use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, ...)`.

> **Non-GenAI instrumentations** (HTTP, DB, etc.) are **disabled by default** when
> `enable_a365=True`. Opt them back in via the distro's `instrumentation_options` kwarg if needed.

### S2S (`authMode: s2s`)

S2S uses the **3-hop FMI (Federated Managed Identity) token chain**:

```
Blueprint (client_credentials / MSI)
  → Hop 1+2: FMI token (api://AzureADTokenExchange/.default with fmi_path=agentId)
    → Agent Identity token
      → Hop 3: Observability API token (scope=api://9b975845-388f-4429-889e-eab1ef63949c/.default)
```

```python
# authMode: s2s — service principal, no user OBO.
import asyncio
import logging
import os

from dotenv import load_dotenv
from aiohttp import web

from microsoft.opentelemetry import use_microsoft_opentelemetry
from microsoft.opentelemetry.a365.core import AgentDetails, CallerDetails, UserDetails

from observability import token_cache
from observability.observability_token_service import acquire_initial_token, run_token_service

load_dotenv()

# ── Configuration ────────────────────────────────────────────────────────────
TENANT_ID = os.environ.get("AGENT365_TENANT_ID", "")
AGENT_ID = os.environ.get("AGENT365_AGENT_ID", "")
BLUEPRINT_ID = os.environ.get("AGENT365_BLUEPRINT_ID", "")
CLIENT_ID = os.environ.get("AGENT365_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("AGENT365_CLIENT_SECRET", "")
AGENT_NAME = os.environ.get("AGENT365_AGENT_NAME", "my-agent")
AGENT_DESCRIPTION = os.environ.get("AGENT365_AGENT_DESCRIPTION", "")
USE_MANAGED_IDENTITY = os.environ.get("AGENT365_USE_MANAGED_IDENTITY", "true").lower() == "true"


def _has_a365_credentials() -> bool:
    required_values = [TENANT_ID, AGENT_ID, CLIENT_ID]
    if not all(v and not v.startswith("<<") for v in required_values):
        return False
    if USE_MANAGED_IDENTITY:
        return True
    return bool(CLIENT_SECRET) and not CLIENT_SECRET.startswith("<<")


A365_ENABLED = _has_a365_credentials()

# ── Agent Details (shared across all scopes) ─────────────────────────────────
agent_details = AgentDetails(
    agent_id=AGENT_ID or "local-dev",
    agent_name=AGENT_NAME,
    agent_description=AGENT_DESCRIPTION,
    agent_blueprint_id=BLUEPRINT_ID,
    tenant_id=TENANT_ID or "local-dev",
)

caller_details = CallerDetails(
    user_details=UserDetails(
        user_id=os.environ.get("AGENT365_SPONSOR_USER_ID", CLIENT_ID),
        user_email=os.environ.get("AGENT365_SPONSOR_USER_EMAIL", ""),
        user_name=os.environ.get("AGENT365_SPONSOR_USER_NAME", AGENT_NAME),
    ),
)

# ── Observability — clean S2S config (1.0+) ──────────────────────────────────
use_microsoft_opentelemetry(
    enable_a365=A365_ENABLED,
    a365_enable_observability_exporter=True,
    a365_use_s2s_endpoint=True,             # ← first-class kwarg (no workaround needed)
    a365_token_resolver=lambda aid, tid: token_cache.get_cached_token(aid, tid) or "",
)

# ── Background Tasks ─────────────────────────────────────────────────────────
async def start_background_tasks(app: web.Application) -> None:
    if A365_ENABLED:
        try:
            await acquire_initial_token(
                tenant_id=TENANT_ID,
                agent_id=AGENT_ID,
                blueprint_client_id=CLIENT_ID,
                blueprint_client_secret=CLIENT_SECRET,
                use_managed_identity=USE_MANAGED_IDENTITY,
            )
        except Exception:
            logging.warning("Initial token acquisition failed; continuing with background refresh.", exc_info=True)

        app["token_task"] = asyncio.create_task(
            run_token_service(
                tenant_id=TENANT_ID,
                agent_id=AGENT_ID,
                blueprint_client_id=CLIENT_ID,
                blueprint_client_secret=CLIENT_SECRET,
                use_managed_identity=USE_MANAGED_IDENTITY,
            )
        )
    else:
        logging.warning(
            "Agent365 credentials not configured — skipping token service. "
            "Run 'a365 setup all' to enable A365 observability export."
        )
```

> **`a365_use_s2s_endpoint=True` is required for S2S agents.** Without it, the exporter
> posts to `/observability/` (OBO endpoint) instead of `/observabilityService/` (S2S endpoint),
> causing 401 errors.

---

## S2S Token Service Scaffold

#### Step 1 — `observability/token_cache.py`

```python
# observability/token_cache.py
# A365 Observability — best-effort instrumentation (verify against official sample)

import threading
from datetime import datetime, timedelta, timezone

_lock = threading.Lock()
_cache: dict[str, tuple[str, datetime]] = {}
_EXPIRY_BUFFER = timedelta(minutes=5)


def cache_token(agent_id: str, tenant_id: str, token: str, expires_in: timedelta = timedelta(hours=1)) -> None:
    key = f"{agent_id}:{tenant_id}"
    expires_at = datetime.now(timezone.utc) + expires_in
    with _lock:
        _cache[key] = (token, expires_at)


def get_cached_token(agent_id: str, tenant_id: str) -> str | None:
    key = f"{agent_id}:{tenant_id}"
    with _lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        token, expires_at = entry
        if datetime.now(timezone.utc) + _EXPIRY_BUFFER >= expires_at:
            del _cache[key]
            return None
        return token
```

#### Step 2 — `observability/observability_token_service.py`

Background token acquisition via 3-hop FMI chain (direct HTTP POST for Hop 1+2 due to MSAL Python limitation, MSAL for Hop 3):

```python
# observability/observability_token_service.py
# A365 Observability — best-effort instrumentation (verify against official sample)
# A365 auth mode: S2S — 3-hop FMI token chain (direct HTTP POST + MSAL)
#   Hop 1+2: Blueprint (MSI or client secret) → T1 via token endpoint POST + fmi_path → Agent Identity
#   Hop 3:   Agent Identity uses T1 as assertion → Observability API token

import asyncio
import logging
from datetime import timedelta

import httpx
import msal

from observability import token_cache

logger = logging.getLogger(__name__)

FMI_SCOPE = "api://AzureADTokenExchange/.default"
OBSERVABILITY_SCOPES = ["api://9b975845-388f-4429-889e-eab1ef63949c/.default"]
REFRESH_INTERVAL_SECONDS = 50 * 60  # 50 minutes


async def acquire_initial_token(tenant_id, agent_id, blueprint_client_id, blueprint_client_secret, use_managed_identity):
    """Acquire the first observability token before background services start."""
    await _acquire_and_register_token(tenant_id, agent_id, blueprint_client_id, blueprint_client_secret, use_managed_identity)


async def run_token_service(tenant_id, agent_id, blueprint_client_id, blueprint_client_secret, use_managed_identity):
    """Background token acquisition loop."""
    logger.info("ObservabilityTokenService started (use_managed_identity=%s).", use_managed_identity)
    while True:
        try:
            await _acquire_and_register_token(tenant_id, agent_id, blueprint_client_id, blueprint_client_secret, use_managed_identity)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Failed to acquire observability token; will retry in %d seconds.", REFRESH_INTERVAL_SECONDS, exc_info=True)
        await asyncio.sleep(REFRESH_INTERVAL_SECONDS)


async def _acquire_and_register_token(tenant_id, agent_id, blueprint_client_id, blueprint_client_secret, use_managed_identity):
    authority = f"https://login.microsoftonline.com/{tenant_id}"
    token_url = f"{authority}/oauth2/v2.0/token"

    # Hop 1+2: Blueprint → T1 via FMI path
    if use_managed_identity:
        t1_token = await _acquire_t1_via_msi(token_url, blueprint_client_id, agent_id)
    else:
        t1_token = await _acquire_t1_via_client_secret(token_url, blueprint_client_id, blueprint_client_secret, agent_id)

    # Hop 3: Agent Identity uses T1 → Observability API token
    identity_app = msal.ConfidentialClientApplication(
        client_id=agent_id,
        client_credential={"client_assertion": t1_token},
        authority=authority,
    )
    obs_result = identity_app.acquire_token_for_client(scopes=OBSERVABILITY_SCOPES)
    if "access_token" not in obs_result:
        raise RuntimeError(f"Failed to acquire observability token: {obs_result.get('error_description', obs_result)}")

    token_cache.cache_token(agent_id, tenant_id, obs_result["access_token"], expires_in=timedelta(minutes=55))
    logger.info("Observability token registered for agent %s.", agent_id)


async def _acquire_t1_via_msi(token_url, blueprint_client_id, agent_id):
    """Acquire T1 token using Managed Identity (production) — direct HTTP POST."""
    from azure.identity.aio import ManagedIdentityCredential

    async with ManagedIdentityCredential() as credential:
        msi_token = await credential.get_token("api://AzureADTokenExchange")

    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data={
            "grant_type": "client_credentials",
            "client_id": blueprint_client_id,
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": msi_token.token,
            "scope": FMI_SCOPE,
            "fmi_path": agent_id,
        })
        result = resp.json()

    if "access_token" not in result:
        raise RuntimeError(f"FMI T1 via MSI failed: {result.get('error_description', result)}")
    return result["access_token"]


async def _acquire_t1_via_client_secret(token_url, blueprint_client_id, blueprint_client_secret, agent_id):
    """Acquire T1 token using client secret (local dev) — direct HTTP POST with fmi_path."""
    # MSAL Python v1.34.0 does NOT properly support `fmi_path` as a kwarg.
    # Workaround: direct HTTP POST with fmi_path as form data until MSAL ships native support.
    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data={
            "grant_type": "client_credentials",
            "client_id": blueprint_client_id,
            "client_secret": blueprint_client_secret,
            "scope": FMI_SCOPE,
            "fmi_path": agent_id,
        })
        result = resp.json()

    if "access_token" not in result:
        raise RuntimeError(f"FMI T1 via client secret failed: {result.get('error_description', result)}")
    return result["access_token"]
```

#### S2S environment variables

```dotenv
# Agent 365 Observability — S2S
AGENT365_TENANT_ID=
AGENT365_AGENT_ID=
AGENT365_BLUEPRINT_ID=
AGENT365_CLIENT_ID=
AGENT365_CLIENT_SECRET=
AGENT365_AGENT_NAME=my-agent
AGENT365_AGENT_DESCRIPTION=
AGENT365_USE_MANAGED_IDENTITY=true

# Sponsor identity for CallerDetails (MAC portal visibility — S2S has no signed-in user)
AGENT365_SPONSOR_USER_ID=<blueprint-sponsor-user-object-id>
AGENT365_SPONSOR_USER_EMAIL=<sponsor@contoso.com>
AGENT365_SPONSOR_USER_NAME=<Sponsor Display Name>

ENABLE_A365_OBSERVABILITY_EXPORTER=true
# Note: AGENT365_USE_S2S_ENDPOINT env var is no longer used —
# `a365_use_s2s_endpoint=True` is set in code via use_microsoft_opentelemetry().
```

---

## Adapter — Hosting Baggage

Register hosting baggage helpers to auto-populate baggage from every incoming `TurnContext`.
This removes the need to call `BaggageBuilder` manually in each handler.

```python
from microsoft.opentelemetry.a365.hosting import (
    ObservabilityHostingManager,
    ObservabilityHostingOptions,
)

ObservabilityHostingManager.configure(
    adapter.middleware_set,
    ObservabilityHostingOptions(
        enable_baggage=True,           # defaults to False — must be explicitly set
        enable_output_logging=True,    # defaults to False — optional output logging
    ),
)
```

> **Both options default to `False`.** Without `enable_baggage=True`, the middleware won't
> populate baggage from `TurnContext`, and your spans will lack tenant/agent identity.

---

## Message Handler

With `ObservabilityHostingManager.configure(..., enable_baggage=True)` registered at startup,
the handler does NOT build baggage manually. Per-turn behavior differs by auth mode.

### OBO and agentic-user — refresh exporter token per turn

The handler shape is identical for both `obo` and `agentic-user`. The Azure AD auth handler
configured in your `AgentApplication` decides which identity the token exchange returns:

- **`agentic-user`** (AI Teammate) — `agent_app.auth.exchange_token(...)` returns a token for
  the agent's own Azure AD user identity (Agentic User). Traces attribute to the agent.
- **`obo`** (non-AI Teammate) — `agent_app.auth.exchange_token(...)` returns a token for
  whatever the configured Azure AD auth handler resolves. Typically this is the signed-in user
  (traces attribute to that user), but it can also be the agent's own identity if the handler
  is configured that way.

```python
# A365 Observability — best-effort instrumentation (verify against official sample)
# A365 auth mode: agentic-user  (or: obo)
from microsoft_agents_a365.runtime.environment_utils import get_observability_authentication_scope
from token_cache import cache_agentic_token


async def _setup_observability_token(self, context, tenant_id, agent_id):
    """OBO / agentic-user: exchange token and cache for the exporter to pick up."""
    try:
        exaau_token = await self.agent_app.auth.exchange_token(
            context,
            scopes=get_observability_authentication_scope(),
            auth_handler_id=self.auth_handler_name,   # from config — NOT hardcoded "AGENTIC"
        )
        cache_agentic_token(tenant_id, agent_id, exaau_token.token)
    except Exception as e:
        logger.warning(f"Failed to cache observability token: {e}")


@AGENT_APP.activity("message", auth_handlers=["AGENTIC"])
async def on_message(context: TurnContext, state: TurnState):
    tenant_id = context.activity.recipient.tenant_id
    agent_id = context.activity.recipient.agentic_app_id

    # OBO / agentic-user: refresh per-turn token (skip this for S2S).
    await self._setup_observability_token(context, tenant_id, agent_id)

    # ObservabilityHostingManager (registered at startup) already populated baggage
    # from TurnContext. Your handler logic can run directly:
    response = await self.invoke_llm(context.activity.text)
    await context.send_activity(response)
```

> **`auth_handler_id`** must come from config (`AgentApplication:AgenticAuthHandlerName`)
> — **never hardcode `"AGENTIC"`**. The handler is the auth handler registered in your
> agent setup; its configured identity (user delegated or agent's own) determines whose
> token gets returned.

#### Canonical: manual per-turn baggage construction (matches AF sample)

**This is the path the verified `Agent365-Samples/python/agent-framework/sample-agent` actually takes** — `ObservabilityHostingManager` middleware is a fallback, but the AF sample builds baggage manually inside the handler to ensure the outer wrapping is present for InvokeAgentScope + InferenceScope. Without this exact ordering, spans risk being filtered as "0 identity groups" — same silent-drop risk seen in the Node.js LangChain path.

```python
# A365 Observability — best-effort instrumentation (verify against official sample)
# Imports use the legacy module paths (still required even with the unified distro entry point):
from microsoft.opentelemetry.a365.core.middleware.baggage_builder import BaggageBuilder
from microsoft_agents_a365.runtime.environment_utils import get_observability_authentication_scope

# In your message handler:
tenant_id = context.activity.recipient.tenant_id
agent_id = context.activity.recipient.agentic_app_id

with BaggageBuilder().tenant_id(tenant_id).agent_id(agent_id).build():
    # InvokeAgentScope / InferenceScope / agent invocation inside this `with` block
    # so they inherit the baggage. Spans outside will be filtered.
    pass
```

### S2S — no per-turn refresh

For `s2s`, the background token service started in the entry point populates the in-memory
cache every 50 minutes. The custom `a365_token_resolver` wired in `use_microsoft_opentelemetry()`
reads from that cache on each export. The handler does NOT touch tokens.

```python
# A365 Observability — best-effort instrumentation (verify against official sample)
# A365 auth mode: s2s

@AGENT_APP.activity("message")
async def on_message(context: TurnContext, state: TurnState):
    # ObservabilityHostingManager (registered at startup) already populated baggage
    # from TurnContext. No per-turn token refresh — background token service handles auth.
    # Do NOT call _setup_observability_token / exchange_token for S2S.

    response = await self.invoke_llm(context.activity.text)
    await context.send_activity(response)
```

---

## Manual Instrumentation Scopes

> **Store publishing requirement:** `InvokeAgentScope`, `InferenceScope`, and `ExecuteToolScope`
> are **required** for store validation. Missing any one causes store validation failure.

> **Scope-type imports come from the legacy `microsoft.opentelemetry.a365.core` module path** — the unified `microsoft-opentelemetry` distro entry point (`use_microsoft_opentelemetry`) is in `microsoft.opentelemetry`, but the scope classes themselves still live in the legacy module (transitive dep of the distro). The AF sample uses these legacy paths.

> **`ScopeUtils.populate_*_from_context` is removed in 1.0+.** Construct scopes directly
> with `.start(...)`.

```python
# Verified import paths from Agent365-Samples/python/agent-framework/sample-agent
from microsoft.opentelemetry.a365.core import (
    AgentDetails,
    InferenceCallDetails,
    InferenceOperationType,
    InferenceScope,
    InvokeAgentScope,
    InvokeAgentScopeDetails,
    ExecuteToolScope,
    ToolCallDetails,
    Request,
    Response,
    ServiceEndpoint,
    CallerDetails,
    UserDetails,
    Channel,
    SpanDetails,
    OutputScope,
)
```

### InvokeAgentScope

```python
# AI Teammate: write BOTH identity dimensions so MAC shows per-instance AND
# blueprint-rolled-up activity. They are emitted as separate span tags:
#   agent_id           -> gen_ai.agent.id                   (this agentic INSTANCE)
#   agent_blueprint_id -> microsoft.a365.agent.blueprint.id (MAC roll-up to the blueprint)
# If EITHER is empty MAC loses that grouping dimension. Resolve agent_id LIVE from the
# turn's recipient (verified field: recipient.agentic_app_id). NOTE: the Python
# ChannelAccount has NO blueprint field, so agent_blueprint_id MUST come from env
# (stamped by `a365 setup all`) — never leave it empty.
recipient = context.activity.recipient
agent_details = AgentDetails(
    agent_id=getattr(recipient, "agentic_app_id", None) or os.environ.get("AGENT365_AGENT_ID", ""),
    agent_name=os.environ.get("AGENT365_AGENT_NAME", "My Agent"),
    agent_description=os.environ.get("AGENT365_AGENT_DESCRIPTION", ""),
    agentic_user_id=getattr(recipient, "agentic_user_id", "") or "",
    agentic_user_email=getattr(recipient, "agentic_user_id", "") or "",
    agent_blueprint_id=os.environ.get("AGENT365_BLUEPRINT_ID", ""),  # <- MAC blueprint roll-up (env only)
    tenant_id=getattr(recipient, "tenant_id", None) or os.environ.get("AGENT365_TENANT_ID", ""),
)

scope_details = InvokeAgentScopeDetails(
    endpoint=ServiceEndpoint(hostname="myagent.contoso.com", port=443),
)

request = Request(
    content="User asks a question",
    session_id="session-42",
    conversation_id="conv-xyz",
    channel=Channel(name="msteams"),
)

caller_details = CallerDetails(
    user_details=UserDetails(
        user_id="user-123",
        user_email="jane.doe@contoso.com",
        user_name="Jane Doe",
    ),
)

with InvokeAgentScope.start(request, scope_details, agent_details, caller_details) as scope:
    scope.record_input_messages(["User asks a question"])
    response = call_agent(...)
    scope.record_output_messages([response])
```

### Resolve caller UPN (AI Teammate / OBO — populates MAC "User principal name")

For AI Teammate (`agentic-user`) turns, don't hardcode `user_email` like the `"jane.doe@contoso.com"` above — resolve it per turn. The observability SDK does **not** auto-populate it (`BaggageBuilder.user_email()` and `UserDetails.user_email` are manual setters). It's what MAC shows in its **"User principal name"** column, and it's blank on the most common turn (a direct Teams 1:1 chat), because `activity.from_property.id` is an MRI (`29:…` / `8:orgid:…`), not a UPN. Notification / `@mention` / email turns *do* carry the UPN in `from_property.id`.

Resolution order: (1) `from_property.id` contains `@` → it **is** the UPN; (3) otherwise look it up from the Teams roster via [`TeamsInfo.get_member`](https://github.com/microsoft/Agents-for-python/blob/main/libraries/microsoft-agents-hosting-teams/microsoft_agents/hosting/teams/teams_info.py) (verified — returns `TeamsChannelAccount` with `user_principal_name` / `email`). Cache per `conversation|member` — it's a network call.

```python
from microsoft_agents.hosting.teams import TeamsInfo

_upn_cache: dict[str, str] = {}

# Best-effort: returns the caller's UPN/email, or None if the roster is unavailable.
# NEVER raises — a blank UPN must not break the turn (the tag is simply omitted).
async def resolve_caller_upn(turn_context) -> str | None:
    frm = turn_context.activity.from_property
    if frm and isinstance(frm.id, str) and "@" in frm.id:           # (1) already a UPN
        return frm.id

    conv = turn_context.activity.conversation
    conv_id = conv.id if conv else None
    member_id = getattr(frm, "aad_object_id", None) or getattr(frm, "id", None)
    if not conv_id or not member_id:
        return None

    cache_key = f"{conv_id}|{member_id}"
    if cache_key in _upn_cache:                                     # (4) cache
        return _upn_cache[cache_key]

    try:
        member = await TeamsInfo.get_member(turn_context, member_id)  # (3) roster
        upn = getattr(member, "user_principal_name", None) or getattr(member, "email", None)
        if upn:
            _upn_cache[cache_key] = upn
        return upn
    except Exception:
        return None  # connector unavailable / permission gap — omit the tag, don't fail the turn

# Then in the handler, before InvokeAgentScope.start:
caller_upn = await resolve_caller_upn(context)
frm = context.activity.from_property
caller_details = CallerDetails(
    user_details=UserDetails(
        user_id=getattr(frm, "aad_object_id", None) or getattr(frm, "id", "") or "",
        user_name=getattr(frm, "name", "") or "",
        user_email=caller_upn or "",   # ← MAC "User principal name"
    ),
)
# Equivalent baggage path: builder.user_email(caller_upn or "")
```

> **S2S agents skip this** — no signed-in user, so `user_email` comes from the Blueprint sponsor env var (`AGENT365_SPONSOR_USER_EMAIL`), not the roster.

### Shared Observability Context Module (`observability/obs_context.py`)

For S2S agents, create a shared module to avoid circular imports between agent, monitor, and main:

```python
# observability/obs_context.py
import os
from microsoft.opentelemetry.a365.core import AgentDetails, CallerDetails, UserDetails

TENANT_ID = os.environ.get("AGENT365_TENANT_ID", "")
AGENT_ID = os.environ.get("AGENT365_AGENT_ID", "")
BLUEPRINT_ID = os.environ.get("AGENT365_BLUEPRINT_ID", "")

agent_details = AgentDetails(
    agent_id=AGENT_ID,
    agent_name=os.environ.get("AGENT365_AGENT_NAME", ""),
    agent_description=os.environ.get("AGENT365_AGENT_DESCRIPTION", ""),
    agent_blueprint_id=BLUEPRINT_ID,
    tenant_id=TENANT_ID,
)

# For S2S agents with no signed-in user, use Blueprint sponsor identity for CallerDetails.
caller_details = CallerDetails(
    user_details=UserDetails(
        user_id=os.environ.get("AGENT365_SPONSOR_USER_ID", BLUEPRINT_ID),
        user_email=os.environ.get("AGENT365_SPONSOR_USER_EMAIL", ""),
        user_name=os.environ.get("AGENT365_SPONSOR_USER_NAME", ""),
    ),
)
```

> **Why `CallerDetails`?** Without it, traces will NOT appear in the Microsoft Admin Center
> (MAC) portal. For S2S agents with no real user, use the Blueprint sponsor's identity.

### ExecuteToolScope

```python
tool_details = ToolCallDetails(
    tool_name="summarize",
    tool_type="function",
    tool_call_id="tc-001",
    arguments="{'text': '...'}",
    description="Summarize provided text",
    endpoint=ServiceEndpoint(hostname="tools.contoso.com", port=8080),
)

with ExecuteToolScope.start(request, tool_details, agent_details) as scope:
    result = run_tool(tool_details)
    scope.record_response(result)
```

### InferenceScope

> **⚠️ Python SDK uses camelCase parameter names** (matching the underlying .NET/Java convention):
> `operationName`, `model`, `providerName`, `inputTokens`, `outputTokens`, `finishReasons`, `thoughtProcess`, `endpoint`.
> Do NOT use snake_case (`operation_name`, `provider_name`) — this causes `TypeError` at runtime.

```python
inference_details = InferenceCallDetails(
    operationName=InferenceOperationType.CHAT,
    model="gpt-4o-mini",
    providerName="azure-openai",
    inputTokens=123,
    outputTokens=456,
    finishReasons=["stop"],
)

with InferenceScope.start(request, inference_details, agent_details) as scope:
    completion = call_llm(...)
    scope.record_output_messages([completion.text])
    scope.record_input_tokens(completion.usage.input_tokens)
    scope.record_output_tokens(completion.usage.output_tokens)
```

### OutputScope (async scenarios)

```python
parent_context = invoke_scope.get_context()
response = Response(messages=["Here is your organized inbox."])

with OutputScope.start(
    request,
    response,
    agent_details,
    span_details=SpanDetails(parent_context=parent_context),
):
    pass
```

---

## Auto-Instrumentation (now ON by default)

OpenAI Agents SDK, LangChain, Semantic Kernel, and Agent Framework are **auto-instrumented**
when the distro initializes — no manual `*Instrumentor().instrument()` calls needed.

```python
# Default behavior: all four auto-enabled when their packages are installed
use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
    a365_token_resolver=...,
)
```

> **Calling legacy `*Instrumentor().instrument()` methods will produce duplicate spans.**
> Remove any manual instrumentor calls if migrating from a 0.x prerelease.

---

## Graceful Shutdown

The distro doesn't yet document an official shutdown helper (gap vs Node.js's
`shutdownMicrosoftOpenTelemetry()`). For now, rely on the OTel SDK's `TracerProvider.shutdown()`
and/or `atexit` to flush pending spans:

```python
import atexit
from opentelemetry import trace

def _shutdown_tracing():
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()

atexit.register(_shutdown_tracing)
```

For aiohttp applications, also register an `on_cleanup` hook:

```python
async def cleanup_observability(app):
    _shutdown_tracing()

app.on_cleanup.append(cleanup_observability)
```

---

## .env Variables

```dotenv
# ── A365 Observability ────────────────────────────────────────────────────────
# In 1.0+, both code kwargs OR env vars work — code is preferred.
#   enable_a365=True                          ≈ ENABLE_A365_OBSERVABILITY=true
#   a365_enable_observability_exporter=True   ≈ ENABLE_A365_OBSERVABILITY_EXPORTER=true
#
# When using code kwargs (recommended), the env vars are not required.
ENABLE_A365_OBSERVABILITY_EXPORTER=true

# ── Observability verbose logging ───────────────────────────────────────────
# OTEL_LOG_LEVEL controls the OpenTelemetry SDK's own internal logger
# (DEBUG / INFO / WARN / ERROR). A365_OBSERVABILITY_LOG_LEVEL is a
# pipe-separated list of levels emitted by the A365 exporter.
# Recommended: INFO + info|warn|error in prod; WARN + warn|error to reduce noise.
OTEL_LOG_LEVEL=INFO
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error

# Sponsor identity for CallerDetails (S2S agents — no signed-in user).
AGENT365_SPONSOR_USER_ID=<<Blueprint ID>>
AGENT365_SPONSOR_USER_NAME=<<Blueprint Name>>
AGENT365_SPONSOR_USER_EMAIL=<<Sponsor Email>>
# ─────────────────────────────────────────────────────────────────────────────
```

| Variable | Local dev | Production |
|---|---|---|
| `ENABLE_A365_OBSERVABILITY_EXPORTER` | `false` (console only) | `true` |
| `OTEL_LOG_LEVEL` | `INFO` (or `WARN` to quiet) | `INFO` |
| `A365_OBSERVABILITY_LOG_LEVEL` | `info\|warn\|error` (or omit) | `info\|warn\|error` |
| `AGENT365_SPONSOR_USER_ID` | `<<Blueprint ID>>` | `<<Blueprint ID>>` |
| `AGENT365_SPONSOR_USER_NAME` | `<<Blueprint Name>>` | `<<Blueprint Name>>` |
| `AGENT365_SPONSOR_USER_EMAIL` | `<<Sponsor Email>>` | `<<Sponsor Email>>` |

> **Removed:** `AGENT365_USE_S2S_ENDPOINT` env var (use `a365_use_s2s_endpoint=True` in code).

---

## Validate Locally

Set `ENABLE_A365_OBSERVABILITY_EXPORTER=false` (or omit `a365_enable_observability_exporter`) — spans go to the console only.

To investigate export failures, enable verbose logging:

```python
import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("microsoft.opentelemetry").setLevel(logging.DEBUG)
logging.getLogger("microsoft.opentelemetry.a365").setLevel(logging.DEBUG)
```

Key log messages:
```text
DEBUG  Token resolved for agent {agentId} tenant {tenantId}
DEBUG  Exporting {n} spans to {url}
DEBUG  HTTP 200 - correlation ID: abc-123
ERROR  Token resolution failed: {error}
ERROR  HTTP 401 exporting spans - correlation ID: abc-123
INFO   No spans with tenant/agent identity found; nothing exported.
```

Import check to verify the package is installed:
```bash
python -c "from microsoft.opentelemetry import use_microsoft_opentelemetry; from microsoft.opentelemetry.a365.hosting import ObservabilityHostingManager; print('A365 observability imports OK')"
```

---

## `use_microsoft_opentelemetry()` kwargs

| Kwarg | Description |
|-------|-------------|
| `enable_a365` | Enables A365 observability instrumentation (registers span processors) |
| `a365_enable_observability_exporter` | **Required in 1.0+** alongside `enable_a365` to actually export spans to A365 |
| `a365_token_resolver` | Sync callable `(agent_id, tenant_id) -> str \| None` for export authentication |
| `a365_use_s2s_endpoint` | `True` posts to `/observabilityService/` (S2S endpoint); `False` posts to `/observability/` (OBO endpoint) |
| `a365_cluster_category` | Optional cluster label such as `prod` |
| `a365_suppress_invoke_agent_input` | Suppresses input messages on `InvokeAgent` spans |
| `a365_observability_scope_override` | Overrides the default OAuth scope (default: `api://9b975845-388f-4429-889e-eab1ef63949c/.default`) |
| `resource` | Standard OpenTelemetry `Resource` for `service.name` / `service.namespace` |

---

## Key API Surface (all from `microsoft-opentelemetry`)

| Symbol | Module | Purpose |
|--------|--------|---------|
| `use_microsoft_opentelemetry()` | `microsoft.opentelemetry` | Configure the OTel pipeline with the A365 exporter |
| `AgentDetails` | `microsoft.opentelemetry.a365.core` | Agent identity for manual scopes |
| `BaggageBuilder` | `microsoft.opentelemetry.a365.core` | Propagates tenant/agent/conversation context across spans |
| `populate(builder, context)` | `microsoft.opentelemetry.a365.hosting.scope_helpers.populate_baggage` | Auto-populates `BaggageBuilder` from `TurnContext` |
| `ObservabilityHostingManager` | `microsoft.opentelemetry.a365.hosting` | Composite hosting configuration for adapter middleware |
| `ObservabilityHostingOptions` | `microsoft.opentelemetry.a365.hosting` | Options for `ObservabilityHostingManager.configure` (defaults: `enable_baggage=False`, `enable_output_logging=False`) |
| `BaggageMiddleware` | `microsoft.opentelemetry.a365.hosting` | Adapter middleware — registered by `ObservabilityHostingManager` |
| `AgenticTokenCache` | `microsoft.opentelemetry.a365.hosting.token_cache_helpers` | Hosting token cache for OBO / agentic-user flows |
| `get_observability_authentication_scope()` | `microsoft_agents_a365.runtime.environment_utils` | Returns the default OAuth scope string (legacy module path — still required) |
| `InvokeAgentScope.start(request, scope_details, agent_details, caller_details)` | `microsoft.opentelemetry.a365.core` | Agent invocation scope (context manager) |
| `ExecuteToolScope.start(request, tool_details, agent_details)` | `microsoft.opentelemetry.a365.core` | Tool execution scope (context manager) |
| `InferenceScope.start(request, inference_details, agent_details)` | `microsoft.opentelemetry.a365.core` | LLM inference scope (context manager) |
| `OutputScope.start(request, response, agent_details, span_details)` | `microsoft.opentelemetry.a365.core` | Async output scope |
| `scope.record_input_messages` / `record_output_messages` | — | Record prompts and completions |
| `scope.record_input_tokens` / `record_output_tokens` | — | Record token counts |
| `scope.record_response(result)` | — | Record tool execution result |
| `scope.get_context()` | — | OTel context (used as parent in `OutputScope`) |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `use_microsoft_opentelemetry()` not called | Call it before any spans are created (and before LLM/framework imports) |
| Traces not in Admin Center | Missing `a365_enable_observability_exporter=True` (1.0 breaking change) | Set the kwarg in code, or `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in env |
| Duplicate spans for OpenAI/LangChain/SK/AgentFramework | Manual `*Instrumentor().instrument()` call after migration | Remove the manual instrumentor calls — auto-instrumentation is ON by default in 1.0+ |
| Spans missing baggage | `ObservabilityHostingManager.configure` not called or `enable_baggage` not set to `True` | Default is `False`. Pass `ObservabilityHostingOptions(enable_baggage=True)` explicitly |
| Token resolver returns `None` | Per-turn OBO token cache was never refreshed | Call `exchange_token()` and cache the result at the start of each handler turn (OBO / agentic-user only) |
| `ModuleNotFoundError: microsoft.opentelemetry` | Package not installed | `pip install microsoft-opentelemetry` |
| `uv sync` runs for minutes / appears to hang on a Google ADK project | OTel resolver backtracking between `google-adk` (`opentelemetry-sdk<1.39.0`) and `microsoft-opentelemetry` 1.1.x (newer transitive OTel SDK) | Add `[tool.uv] override-dependencies` to `pyproject.toml` pinning `opentelemetry-api` and `opentelemetry-sdk` to `>=1.38.0,<1.39.0`. See the "Google ADK projects — pin the OTel stack" section above. |
| 401 on export | Missing `Agent365.Observability.OtelWrite` permission | CLI 1.1+ grants this automatically via `a365 setup all`. For pre-1.1 agents, GA must grant manually |
| Spans dropped silently | Missing tenant/agent ID in baggage | Ensure `enable_baggage=True` and that `populate(builder, context)` runs before scope creation |
| S2S: OBO token-refresh code still runs in the handler | S2S does not use per-turn OBO token exchange | Remove the OBO handler refresh path; token comes from the background token service via `a365_token_resolver` |
| S2S 401: wrong Hop 3 scope | FMI Hop 3 used `https://api.powerplatform.com/.default` from older samples | Change Hop 3 scope to `api://9b975845-388f-4429-889e-eab1ef63949c/.default` |
| S2S 401 even with correct scope | `OtelWrite` role not on Agent Identity SP | For agents provisioned before CLI 1.1, manually assign `Agent365.Observability.OtelWrite` to the Agent Identity SP via Entra portal |
| S2S: MSI fails locally | No Managed Identity in dev | Set `AGENT365_USE_MANAGED_IDENTITY=false` and provide `AGENT365_CLIENT_SECRET` |
| S2S: FMI Hop 1+2 returns 400 | `fmi_path` missing or wrong `client_id` | Ensure `fmi_path=<agentId>` (Agent Identity app ID, not Blueprint ID) and `client_id=<blueprintClientId>` |
| S2S: `TypeError: Session.request() got an unexpected keyword argument 'fmi_path'` | MSAL Python v1.34.0 limitation | Use direct HTTP POST to `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` with `fmi_path` as form data instead of MSAL `acquire_token_for_client(fmi_path=...)`. MSAL is still used for Hop 3 (no `fmi_path` needed) |
| `InferenceCallDetails.__init__() got an unexpected keyword argument 'operation_name'` | Python SDK uses camelCase kwargs | Use `operationName=`, `providerName=`, `inputTokens=`, `outputTokens=`, `finishReasons=` (camelCase, NOT snake_case) |
| Pending spans lost on exit | No shutdown handler | Register `atexit.register(_shutdown_tracing)` calling `trace.get_tracer_provider().shutdown()` |
