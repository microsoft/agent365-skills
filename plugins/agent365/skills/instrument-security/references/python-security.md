# Python — Defender prevention implementation

Complete implementation of the `security/` package for a Python agent. Read
[defender-webhook.md](defender-webhook.md) first for the endpoint contract,
identity model, and AISession rules.

The package splits into two layers:

| Layer | Files | Framework-specific? |
|---|---|---|
| Core | `config.py`, `entra_auth.py`, `ai_session.py`, `defender_client.py` | No — identical for every Python agent |
| Adapter | `adapters/<framework>.py` | Yes — one module per agent framework |

Only the adapter changes between frameworks. It translates the framework's
native callbacks into the four inspection points and applies the verdict.

## Framework support

| Framework | Status |
|---|---|
| Google ADK | ✅ Verified end-to-end on Vertex AI Agent Engine |
| Agent Framework | ⚠️ Best-effort — core ports as-is; adapter needs the framework's middleware hooks |
| LangChain | ⚠️ Best-effort — map onto callback handlers / `RunnableConfig` callbacks |
| OpenAI Agents SDK | ⚠️ Best-effort — map onto agent + tool hooks |

Everything below §4 (`security/config.py` through `security/defender_client.py`)
is framework-agnostic and can be used verbatim regardless of the row above.
§5 is the Google ADK adapter — the verified one.

---

## 1. How ADK callbacks map to enforcement

ADK exposes exactly the four inspection points this integration needs. What each
callback *returns* is the enforcement mechanism:

| Callback | Signature | Return to block | Effect |
|---|---|---|---|
| `before_agent_callback` | `(callback_context)` | `types.Content` | Agent never runs; the content becomes the reply |
| `after_agent_callback` | `(callback_context)` | `types.Content` | Replaces the agent's answer |
| `before_tool_callback` | `(tool, args, tool_context)` | `dict` | Tool never executes; the dict is the tool result |
| `after_tool_callback` | `(tool, args, tool_context, tool_response)` | `dict` | Replaces the result the model sees |

Returning `None` leaves ADK's behavior untouched — the path taken for every
allowed call and, under fail-open, whenever Defender is unreachable.

Two ADK behaviors drive the design:

- **Callbacks may be sync or async.** ADK awaits the result if it is awaitable,
  so hooks can be `async def` and run the blocking webhook call in a worker
  thread via `asyncio.to_thread` instead of stalling the event loop.
- **A callback list stops at the first non-`None` result.** This makes naive
  appending unsafe — see §3.

### Where content comes from

| Hook | Source |
|---|---|
| before_agent | `callback_context.user_content` → `.parts[].text` |
| after_agent | no output argument is passed; read back the last non-user event for this `invocation_id` from `callback_context.session.events` |
| before_tool | `tool.name`, `args` |
| after_tool | `tool_response` |

---

## 2. Package layout

```
<agent_package>/security/
├── __init__.py            # public surface
├── config.py              # env-driven config, endpoint table, hook toggles
├── entra_auth.py          # Entra token via the agent's own identity (FMI 3-hop)
├── ai_session.py          # AISession builders, one per inspection point
├── defender_client.py     # webhook POST + decision model + fail policy
└── adapters/
    ├── __init__.py
    └── google_adk.py      # the four hooks + additive wiring
```

Everything above `adapters/` is platform-agnostic and is reused verbatim when a
second platform (AWS, etc.) is added — only a new adapter module is required.

---

## 3. Composition, not appending

An agent that already has A365 observability wired typically has an after-tool
callback that closes a tracing scope **and returns a redacted payload**. Because
ADK stops at the first callback returning a value, appending the security hook
after it would silently skip security on exactly the calls that were rewritten.

`secure_agent_callbacks` therefore composes:

- **before_agent / before_tool** — existing hooks run first; a short-circuit is
  respected; otherwise security decides.
- **after_agent / after_tool** — existing hooks always run (so tracing scopes
  close), then security inspects the **effective** value the model or user would
  receive, and a block verdict wins.

This preserves existing behavior in every case and keeps enforcement
unbypassable.

---

## 4. Files

### `security/__init__.py`

```python
# A365 Security — added by instrument-security skill
"""Microsoft Defender prevention (Security for AI) integration.

Platform-agnostic building blocks:

* :mod:`config`          — environment-driven configuration.
* :mod:`entra_auth`      — Entra access tokens for the Defender webhook, obtained
  with the agent's **own** Agent 365 Entra identity.
* :mod:`ai_session`      — builders for the Security4AI ``AISession`` payload.
* :mod:`defender_client` — HTTP transport plus allow/block decision parsing.

Platform adapters live in :mod:`.adapters` — one module per agent platform
(Google ADK today; AWS and others plug in alongside it).
"""

from .config import SecurityConfig, get_config
from .defender_client import DefenderClient, DefenderDecision, get_client

__all__ = [
    "SecurityConfig",
    "get_config",
    "DefenderClient",
    "DefenderDecision",
    "get_client",
]
```

### `security/config.py`

Environment-driven. Agent identity values (`AGENT365_*`) are the ones already
stamped into `.env` by `a365 setup all`, so prevention authenticates as the same
identity the agent uses everywhere else; only `DEFENDER_*` is new.

```python
# A365 Security — added by instrument-security skill
"""Configuration for the Defender prevention integration.

Agent identity values (`AGENT365_*`) are the ones already stamped into `.env`
by ``a365 setup all`` and reused here, so prevention authenticates as the same
Entra identity the agent uses everywhere else. Only the `DEFENDER_*` values are
specific to prevention.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

# Defender third-party prevention endpoint. Override with DEFENDER_WEBHOOK_URL.
DEFENDER_ENDPOINT = (
    "https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze"
)

# The prevention resource the access token is issued FOR — the first-party
# "Defender for AI Prevention Webhook" application.
#
# Note the identifier URI is an https:// form, NOT api:// — requesting
# api://86a21212-.../.default fails with AADSTS500011 even when the service
# principal is present, because that URI is not one of the SP's names.
DEFENDER_RESOURCE_APP_ID = "86a21212-634e-4553-b3d6-e477e4c9d9ec"
DEFENDER_SCOPE = "https://rtp-a365.ai.defender.microsoft.com/.default"

# Application role the agent identity must hold to call the prevention endpoint.
# Granted to the Agent Identity service principal, not the blueprint.
DEFENDER_APP_ROLE = "AIAgentsRTP.ToolInvocation"

# The four inspection points supported. Platform adapters map their native
# hooks onto these names.
ALL_HOOKS = ("before_agent", "after_agent", "before_tool", "after_tool")

# The token is always obtained through the FMI 3-hop chain — blueprint credential
# -> agent identity -> Defender — so the token's appid/oid are the agent's own
# Entra identity. This is the only supported flow: there is no gateway or
# delegation path, and the webhook authorizes on the app role, not an app allow-list.

FAIL_MODES = ("open", "closed")

_TRUTHY = {"1", "true", "yes", "on"}


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name)
    return default if not raw else raw.lower() in _TRUTHY


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


def _is_placeholder(value: str) -> bool:
    return not value or value.startswith("<<")


@dataclass(frozen=True)
class SecurityConfig:
    """Resolved prevention configuration for one process."""

    enabled: bool
    webhook_url: str

    # --- Agent 365 Entra identity (from the blueprint) ---------------------
    tenant_id: str
    agent_id: str
    blueprint_id: str
    client_id: str
    agent_object_id: str
    agent_name: str
    agent_description: str
    platform_agent_id: str
    platform_type: str

    # --- Token acquisition (FMI 3-hop) -------------------------------------
    scope: str
    use_managed_identity: bool
    client_secret: str = field(repr=False, default="")

    # --- Behavior ----------------------------------------------------------
    fail_mode: str = "open"
    timeout_seconds: float = 10.0
    enabled_hooks: frozenset[str] = frozenset(ALL_HOOKS)
    max_content_chars: int = 20000
    model_name: str = ""

    @property
    def fail_closed(self) -> bool:
        """True when a webhook error must block the inspected action."""
        return self.fail_mode == "closed"

    def hook_enabled(self, hook: str) -> bool:
        return self.enabled and hook in self.enabled_hooks

    def describe(self) -> str:
        """Non-sensitive one-line summary, safe to log at startup."""
        return (
            f"enabled={self.enabled} url={self.webhook_url} "
            f"failMode={self.fail_mode} "
            f"hooks={','.join(sorted(self.enabled_hooks))} "
            f"tenant={self.tenant_id or '<unset>'} agentId={self.agent_id or '<unset>'} "
            f"blueprintId={self.blueprint_id or '<unset>'} scope={self.scope or '<unset>'}"
        )

    def validation_errors(self) -> list[str]:
        """Configuration problems that make prevention unusable."""
        errors: list[str] = []
        if not self.webhook_url:
            errors.append("no Defender endpoint resolved (DEFENDER_WEBHOOK_URL override is invalid)")
        if _is_placeholder(self.tenant_id):
            errors.append("AGENT365_TENANT_ID is not set")
        if _is_placeholder(self.scope):
            errors.append("no prevention scope resolved (DEFENDER_WEBHOOK_SCOPE override is invalid)")
        if self.fail_mode not in FAIL_MODES:
            errors.append(f"DEFENDER_FAIL_MODE '{self.fail_mode}' is not one of {', '.join(FAIL_MODES)}")
        # The FMI chain needs the agent identity (fmi_path + hop-3 client) and the
        # blueprint credential that asserts it.
        if _is_placeholder(self.agent_id):
            errors.append("AGENT365_AGENT_ID is not set")
        if _is_placeholder(self.client_id):
            errors.append("AGENT365_CLIENT_ID is not set")
        if not self.use_managed_identity and _is_placeholder(self.client_secret):
            errors.append("AGENT365_CLIENT_SECRET is not set (and managed identity is off)")
        return errors


def _resolve_hooks() -> frozenset[str]:
    raw = _env("DEFENDER_HOOKS")
    if not raw:
        return frozenset(ALL_HOOKS)
    requested = {part.strip().lower() for part in raw.split(",") if part.strip()}
    return frozenset(hook for hook in ALL_HOOKS if hook in requested)


def load_config() -> SecurityConfig:
    """Build a :class:`SecurityConfig` from the current environment."""
    webhook_url = _env("DEFENDER_WEBHOOK_URL") or DEFENDER_ENDPOINT

    blueprint_id = _env("AGENT365_BLUEPRINT_ID")
    agent_id = _env("AGENT365_AGENT_ID")
    client_id = _env("AGENT365_CLIENT_ID") or blueprint_id

    # Scope resolution, in precedence order:
    #   1. DEFENDER_WEBHOOK_SCOPE  — full override for a non-standard resource
    #   2. DEFENDER_WEBHOOK_APP_ID — legacy override; kept for callers that pin an
    #      app whose identifier URI really is the api:// form
    #   3. DEFENDER_SCOPE        — the shipped constant (normal case)
    webhook_app_id = _env("DEFENDER_WEBHOOK_APP_ID")
    scope = (
        _env("DEFENDER_WEBHOOK_SCOPE")
        or (f"api://{webhook_app_id}/.default" if webhook_app_id else "")
        or DEFENDER_SCOPE
    )

    return SecurityConfig(
        enabled=_env_bool("DEFENDER_ENABLED", True),
        webhook_url=webhook_url,
        tenant_id=_env("AGENT365_TENANT_ID"),
        agent_id=agent_id,
        blueprint_id=blueprint_id,
        client_id=client_id,
        # Entra objectId of the agent's service principal. Optional: the webhook
        # stamps it from the authenticated token's `oid` when omitted.
        agent_object_id=_env("AGENT365_AGENT_OBJECT_ID"),
        agent_name=_env("AGENT365_AGENT_NAME", "agent365-agent"),
        agent_description=_env("AGENT365_AGENT_DESCRIPTION"),
        platform_agent_id=_env("AGENT365_PLATFORM_AGENT_ID") or agent_id or client_id,
        platform_type=_env("AGENT365_PLATFORM_TYPE", "CUSTOM_BUILT_AGENTS_USING_SDK"),
        scope=scope,
        use_managed_identity=_env_bool("AGENT365_USE_MANAGED_IDENTITY", False),
        client_secret=_env("AGENT365_CLIENT_SECRET"),
        fail_mode=_env("DEFENDER_FAIL_MODE", "open").lower(),
        timeout_seconds=_env_float("DEFENDER_TIMEOUT_SECONDS", 10.0),
        enabled_hooks=_resolve_hooks(),
        max_content_chars=_env_int("DEFENDER_MAX_CONTENT_CHARS", 20000),
        model_name=_env("AGENT_MODEL"),
    )


@lru_cache(maxsize=1)
def get_config() -> SecurityConfig:
    """Process-wide cached configuration."""
    return load_config()
```

### `security/entra_auth.py`

Acquires the prevention token through the FMI 3-hop chain so the agent
authenticates as **itself** — the blueprint credential only starts the chain, and
the token that reaches Defender carries the Agent Identity in `azp`/`oid`.

```
Blueprint (client secret or MSI)
  └─ Hop 1+2: client_credentials + fmi_path=<agentId> → FMI assertion
     └─ Agent Identity
        └─ Hop 3: client_assertion → prevention token
```

The hooks call this synchronously from the request path, so acquisition and the
in-process cache are synchronous. Vertex AI Agent Engine offers no application
lifecycle hook for a background refresh loop, so the token is fetched lazily and
cached until shortly before expiry.

Never raises: returns `""` so the caller applies the fail policy. Note a *missing app
role grant* does not fail here — the token is issued without a `roles` claim and the
webhook rejects it with 401/403 instead.

```python
# A365 Security — added by instrument-security skill
"""S2S Defender prevention token acquisition (3-hop FMI chain).

    Blueprint (client secret or MSI)
      -> Hop 1+2: FMI token (api://AzureADTokenExchange/.default, fmi_path=<agentId>)
        -> Agent Identity
          -> Hop 3: Defender prevention token

The agent authenticates as **itself**. The blueprint credential is only the
starting point of the chain; the token that reaches Defender carries the Agent
Identity in ``azp``/``oid``, so a verdict is always attributable to the specific
agent that asked for it.

The prevention hooks call ``get_defender_token`` synchronously from the request
path, so acquisition and caching are synchronous here. Vertex AI Agent Engine
gives no application lifecycle hook for a background refresh loop, so the token is
fetched lazily and cached until shortly before it expires.

This module never raises. A failure returns ``""`` and the caller applies the
configured fail mode — an auth outage must not take the agent down with it.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

import httpx
import msal

from .config import DEFENDER_SCOPE, SecurityConfig, get_config

logger = logging.getLogger(__name__)

FMI_SCOPE = "api://AzureADTokenExchange/.default"

_EXPIRY_BUFFER = timedelta(minutes=5)
_TOKEN_LIFETIME = timedelta(minutes=55)

_lock = threading.Lock()
_cache: dict[str, tuple[str, datetime]] = {}


def _cache_token(key: str, token: str) -> None:
    with _lock:
        _cache[key] = (token, datetime.now(timezone.utc) + _TOKEN_LIFETIME)


def _get_cached_token(key: str) -> str | None:
    with _lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        token, expires_at = entry
        if datetime.now(timezone.utc) + _EXPIRY_BUFFER >= expires_at:
            del _cache[key]
            return None
        return token


def reset_cache() -> None:
    """Drop every cached token (used by tests and after a grant changes)."""
    with _lock:
        _cache.clear()


def _acquire_t1(cfg: SecurityConfig, token_url: str, agent_id: str) -> str:
    """Hop 1+2 — Blueprint credential exchanged for an Agent Identity FMI token.

    MSAL Python does not pass `fmi_path` through, so this is a direct token
    endpoint POST.
    """
    data = {
        "grant_type": "client_credentials",
        "client_id": cfg.client_id,
        "scope": FMI_SCOPE,
        "fmi_path": agent_id,
    }

    if cfg.use_managed_identity:
        from azure.identity import ManagedIdentityCredential

        credential = ManagedIdentityCredential()
        msi_token = credential.get_token("api://AzureADTokenExchange")
        data["client_assertion_type"] = (
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        )
        data["client_assertion"] = msi_token.token
    else:
        data["client_secret"] = cfg.client_secret

    with httpx.Client(timeout=cfg.timeout_seconds) as client:
        result = client.post(token_url, data=data).json()

    if "access_token" not in result:
        raise RuntimeError(
            f"FMI hop 1+2 failed: {result.get('error_description', result)}"
        )
    return result["access_token"]


def _acquire_prevention_token(cfg: SecurityConfig, tenant_id: str, agent_id: str) -> str:
    authority = f"https://login.microsoftonline.com/{tenant_id}"
    t1_token = _acquire_t1(cfg, f"{authority}/oauth2/v2.0/token", agent_id)

    identity_app = msal.ConfidentialClientApplication(
        client_id=agent_id,
        client_credential={"client_assertion": t1_token},
        authority=authority,
    )
    result = identity_app.acquire_token_for_client(scopes=[cfg.scope])
    if "access_token" not in result:
        raise RuntimeError(
            f"Prevention token (hop 3) failed: "
            f"{result.get('error_description', result)}"
        )
    return result["access_token"]


def get_defender_token(cfg: SecurityConfig | None = None) -> str:
    """Resolve the Defender prevention token for this agent.

    Never raises — a failed acquisition must not break the agent turn; the caller
    applies the configured fail-open / fail-closed policy instead.

    Returns an empty string when the token cannot be acquired. Note that a
    *missing app role grant* does not fail here: the token is issued without a
    ``roles`` claim and the webhook rejects it with 401/403 instead.
    """
    cfg = cfg or get_config()

    errors = cfg.validation_errors()
    if errors:
        logger.warning("[defender] token skipped — invalid config: %s", "; ".join(errors))
        return ""

    key = f"{cfg.agent_id}:{cfg.tenant_id}:{cfg.scope}"
    cached = _get_cached_token(key)
    if cached:
        return cached

    try:
        token = _acquire_prevention_token(cfg, cfg.tenant_id, cfg.agent_id)
    except Exception:
        logger.warning(
            "[defender] prevention token acquisition failed (scope=%s)",
            cfg.scope,
            exc_info=True,
        )
        return ""

    _cache_token(key, token)
    logger.info("[defender] prevention token acquired for agent %s.", cfg.agent_id)
    return token


__all__ = ["FMI_SCOPE", "DEFENDER_SCOPE", "get_defender_token", "reset_cache"]
```

### `security/ai_session.py`

One builder per inspection point. See
[defender-webhook.md §3](defender-webhook.md) for the schema rules these encode.

```python
# A365 Security — added by instrument-security skill
"""Builders for the Security4AI ``AISession`` payload (protobuf-JSON shape).

One builder per inspection point. Each produces a complete session — Defender
evaluates a single request at a time, so every call carries the environment,
identities, and exactly the activity being inspected.

Schema notes that are easy to get wrong:

* ``environment.agent.id`` must set one of the deprecated ``foundry`` /
  ``copilot_studio`` / ``a365`` cases — the rule engine still resolves agent
  identity from that oneof and rejects a session without it.
* ``entra.objectId`` must be non-empty when the ``entra`` identifier is present.
  It is omitted here unless configured; the webhook stamps it from the
  authenticated token's ``oid`` claim, which is both trustworthy and always
  available for an agent-identity call.
* ``sessionContext`` must be non-null or the rule engine fails the evaluation
  open.
* Activity oneofs: ``agentRequest`` / ``agentResponse`` / ``toolRequest`` /
  ``toolResponse``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

from .config import SecurityConfig

# Security4AI MessageRole enum values.
ROLE_USER = "MESSAGE_ROLE_USER"
ROLE_ASSISTANT = "MESSAGE_ROLE_ASSISTANT"
ROLE_TOOL = "MESSAGE_ROLE_TOOL"


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _truncate(text: str, limit: int) -> str:
    if limit <= 0 or len(text) <= limit:
        return text
    return f"{text[:limit]}…[truncated {len(text) - limit} chars]"


def new_tool_call_id() -> str:
    return f"tooluse_{uuid.uuid4().hex[:12]}"


def build_messages(
    role: str, texts: Iterable[str], *, max_chars: int
) -> list[dict[str, Any]]:
    """Wrap plain strings into Security4AI ``Message`` objects."""
    parts = [{"text": _truncate(text, max_chars)} for text in texts if text]
    if not parts:
        return []
    return [{"role": role, "content": parts}]


def _agent_identifier(cfg: SecurityConfig) -> dict[str, Any]:
    """Agent identity: A365 (required oneof) + Entra + hosting platform."""
    a365: dict[str, Any] = {
        "id": cfg.agent_id or cfg.client_id,
        "name": cfg.agent_name,
    }
    if cfg.tenant_id:
        a365["tenantId"] = cfg.tenant_id
    if cfg.blueprint_id:
        a365["blueprintId"] = cfg.blueprint_id

    identifier: dict[str, Any] = {
        "a365": a365,
        "platform": {
            "type": cfg.platform_type,
            "id": cfg.platform_agent_id,
            "name": cfg.agent_name,
        },
    }

    # Only send `entra` when a non-empty objectId is configured — an empty
    # objectId is rejected. Otherwise the webhook fills it from the token.
    if cfg.agent_object_id:
        entra: dict[str, Any] = {
            "tenantId": cfg.tenant_id,
            "objectId": cfg.agent_object_id,
        }
        if cfg.blueprint_id:
            entra["blueprintId"] = cfg.blueprint_id
        identifier["entra"] = entra

    return identifier


def _environment(
    cfg: SecurityConfig,
    *,
    tools: Sequence[Mapping[str, Any]] | None = None,
    instructions: str | None = None,
) -> dict[str, Any]:
    agent: dict[str, Any] = {
        "id": _agent_identifier(cfg),
        "identity": {
            "tenantId": cfg.tenant_id,
            "appId": cfg.agent_id or cfg.client_id,
        },
    }
    if cfg.agent_object_id:
        agent["identity"]["entraObjectId"] = cfg.agent_object_id
    if tools:
        agent["tools"] = [dict(tool) for tool in tools]
    if cfg.model_name:
        agent["llmConfiguration"] = {"modelName": cfg.model_name}
    if instructions:
        agent["instructions"] = _truncate(instructions, cfg.max_content_chars)
    return {"agent": agent}


def _caller_identity(cfg: SecurityConfig, *, user_id: str = "") -> dict[str, Any]:
    """Identity of whoever invoked the agent.

    The webhook overwrites tenant/app/object id from the validated token; the
    values here are hints for correlation, never a trust boundary.
    """
    identity: dict[str, Any] = {
        "tenantId": cfg.tenant_id,
        "appId": cfg.agent_id or cfg.client_id,
        "userAgent": f"agent365-sdk-agent/{cfg.platform_type.lower()}",
    }
    if user_id:
        identity["appName"] = user_id
    return identity


def _session_context(session_id: str) -> dict[str, Any]:
    # Must be non-null: a null session context fails the evaluation open.
    return {"a365": {"id": session_id or f"a365-{uuid.uuid4()}"}}


def _evaluation_policy() -> dict[str, Any]:
    return {
        "type": "EVALUATION_POLICY_TYPE_BLOCKING",
        "threatScenarios": [{"type": "THREAT_SCENARIO_TYPE_ALL"}],
    }


def _session(
    cfg: SecurityConfig,
    *,
    activity: Mapping[str, Any],
    session_id: str,
    user_id: str = "",
    tools: Sequence[Mapping[str, Any]] | None = None,
    instructions: str | None = None,
) -> dict[str, Any]:
    return {
        "environment": _environment(cfg, tools=tools, instructions=instructions),
        "callerIdentity": _caller_identity(cfg, user_id=user_id),
        "sessionContext": _session_context(session_id),
        "activities": [dict(activity)],
        "evaluationPolicy": _evaluation_policy(),
        "timestamp": _timestamp(),
    }


def _activity_context() -> dict[str, Any]:
    return {"a365": {}}


# --------------------------------------------------------------------------- #
# Inspection point builders
# --------------------------------------------------------------------------- #
def build_agent_request_session(
    cfg: SecurityConfig,
    *,
    prompts: Sequence[str],
    session_id: str,
    request_id: str = "",
    user_id: str = "",
    tools: Sequence[Mapping[str, Any]] | None = None,
    instructions: str | None = None,
) -> dict[str, Any]:
    """Inbound user prompt, inspected before the agent runs."""
    activity: dict[str, Any] = {
        "agentRequest": {
            "context": _activity_context(),
            "timestamp": _timestamp(),
            "messages": build_messages(
                ROLE_USER, prompts, max_chars=cfg.max_content_chars
            ),
        }
    }
    if request_id:
        activity["agentRequest"]["requestId"] = request_id
    return _session(
        cfg,
        activity=activity,
        session_id=session_id,
        user_id=user_id,
        tools=tools,
        instructions=instructions,
    )


def build_agent_response_session(
    cfg: SecurityConfig,
    *,
    responses: Sequence[str],
    session_id: str,
    request_id: str = "",
    user_id: str = "",
    tools: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Final agent answer, inspected before it reaches the user."""
    activity: dict[str, Any] = {
        "agentResponse": {
            "context": _activity_context(),
            "timestamp": _timestamp(),
            "messages": build_messages(
                ROLE_ASSISTANT, responses, max_chars=cfg.max_content_chars
            ),
        }
    }
    if request_id:
        activity["agentResponse"]["requestId"] = request_id
    return _session(
        cfg,
        activity=activity,
        session_id=session_id,
        user_id=user_id,
        tools=tools,
    )


def build_tool_request_session(
    cfg: SecurityConfig,
    *,
    tool_name: str,
    arguments: Mapping[str, Any] | None,
    session_id: str,
    tool_call_id: str = "",
    tool_type: str = "mcp",
    tool_description: str = "",
    request_id: str = "",
    user_id: str = "",
) -> dict[str, Any]:
    """Tool call and its arguments, inspected before the tool executes."""
    activity = {
        "toolRequest": {
            "context": _activity_context(),
            "timestamp": _timestamp(),
            "toolName": tool_name,
            "toolCallId": tool_call_id or new_tool_call_id(),
            "toolType": tool_type,
            "structuredArguments": dict(arguments or {}),
        }
    }
    if tool_description:
        activity["toolRequest"]["toolDescription"] = tool_description
    if request_id:
        activity["toolRequest"]["requestId"] = request_id

    tool_definition = {"id": tool_name, "name": tool_name, "type": tool_type}
    if tool_description:
        tool_definition["description"] = tool_description

    return _session(
        cfg,
        activity=activity,
        session_id=session_id,
        user_id=user_id,
        tools=[tool_definition],
    )


def build_tool_response_session(
    cfg: SecurityConfig,
    *,
    tool_name: str,
    result: Any,
    session_id: str,
    tool_call_id: str = "",
    tool_type: str = "mcp",
    request_id: str = "",
    user_id: str = "",
) -> dict[str, Any]:
    """Tool result, inspected before the model consumes it.

    This is where indirect prompt injection and malicious content returned by
    an external tool are caught.
    """
    tool_response: dict[str, Any] = {
        "context": _activity_context(),
        "timestamp": _timestamp(),
        "toolName": tool_name,
        "toolCallId": tool_call_id or new_tool_call_id(),
        "toolType": tool_type,
    }

    # `result` is a oneof: structured JSON or plain text.
    if isinstance(result, (dict, list)):
        tool_response["structuredData"] = _clamp_structure(result, cfg.max_content_chars)
    else:
        tool_response["text"] = _truncate(str(result), cfg.max_content_chars)

    if request_id:
        tool_response["requestId"] = request_id

    return _session(
        cfg,
        activity={"toolResponse": tool_response},
        session_id=session_id,
        user_id=user_id,
        tools=[{"id": tool_name, "name": tool_name, "type": tool_type}],
    )


def _clamp_structure(value: Any, max_chars: int) -> Any:
    """Recursively truncate long strings so one huge result can't blow the request."""
    if isinstance(value, str):
        return _truncate(value, max_chars)
    if isinstance(value, dict):
        return {key: _clamp_structure(item, max_chars) for key, item in value.items()}
    if isinstance(value, list):
        return [_clamp_structure(item, max_chars) for item in value]
    return value
```

### `security/defender_client.py`

Transport plus the decision model. Never raises; folds every failure into a
decision whose `block` follows the fail mode and whose `evaluated` flag
distinguishes "allowed" from "never checked".

```python
# A365 Security — added by instrument-security skill
"""HTTP transport for the Defender third-party prevention webhook.

``POST {webhook_url}`` with an ``AISession`` body and an Entra bearer token
obtained from the agent's own identity. The response is the prevention
decision::

    {"blockAction": true, "reasonCode": 403, "reason": "...", "diagnostics": "..."}

:meth:`DefenderClient.analyze` never raises. Transport, auth, and protocol
errors are folded into a :class:`DefenderDecision` whose ``block`` value follows
the configured fail-open / fail-closed policy, so callers always get a usable
verdict.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Mapping

import httpx

from .config import SecurityConfig, get_config
from .entra_auth import get_defender_token

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DefenderDecision:
    """Outcome of one prevention evaluation."""

    block: bool
    reason: str = ""
    reason_code: int | None = None
    diagnostics: str = ""
    http_status: int | None = None
    error: str = ""
    latency_ms: float = 0.0
    evaluated: bool = False

    @property
    def failed(self) -> bool:
        """True when no verdict was obtained (auth, transport, or server error)."""
        return not self.evaluated

    def block_message(self, subject: str) -> str:
        """Human-readable text explaining the block, shown to the model/user."""
        reason = self.reason or (
            "The request could not be security-validated."
            if self.failed
            else "It was flagged as unsafe."
        )
        text = (
            f"{subject} was blocked by Microsoft Defender for AI "
            f"(Security for AI prevention). Reason: {reason}"
        )
        if self.diagnostics:
            text += f" [{self.diagnostics}]"
        return text

    def log_fields(self) -> dict[str, Any]:
        return {
            "block": self.block,
            "evaluated": self.evaluated,
            "reasonCode": self.reason_code,
            "reason": self.reason,
            "diagnostics": self.diagnostics,
            "httpStatus": self.http_status,
            "error": self.error,
            "latencyMs": round(self.latency_ms, 1),
        }


class DefenderClient:
    """Calls the Defender prevention webhook for a single agent process."""

    def __init__(self, config: SecurityConfig | None = None) -> None:
        self._config = config or get_config()

    @property
    def config(self) -> SecurityConfig:
        return self._config

    def _failure(self, message: str, *, status: int | None = None, started: float) -> DefenderDecision:
        """Build the decision used when no verdict could be obtained."""
        decision = DefenderDecision(
            block=self._config.fail_closed,
            reason=(
                "Security validation is unavailable and this agent is configured "
                "to fail closed."
                if self._config.fail_closed
                else ""
            ),
            http_status=status,
            error=message,
            latency_ms=(time.perf_counter() - started) * 1000.0,
            evaluated=False,
        )
        logger.warning(
            "[defender] no verdict (%s) — %s. %s",
            message,
            "BLOCKING (fail-closed)" if decision.block else "allowing (fail-open)",
            json.dumps(decision.log_fields(), default=str),
        )
        return decision

    def analyze(
        self,
        ai_session: Mapping[str, Any],
        *,
        correlation_id: str = "",
    ) -> DefenderDecision:
        """Evaluate one AISession and return the prevention decision."""
        started = time.perf_counter()
        correlation_id = correlation_id or f"a365-{uuid.uuid4()}"

        token = get_defender_token(self._config)
        if not token:
            return self._failure("entra token unavailable", started=started)

        try:
            with httpx.Client(timeout=self._config.timeout_seconds) as client:
                response = client.post(
                    self._config.webhook_url,
                    content=json.dumps(ai_session).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {token}",
                        "x-ms-correlation-id": correlation_id,
                    },
                )
        except Exception as exc:  # noqa: BLE001 — transport errors are a policy decision
            return self._failure(f"{type(exc).__name__}: {exc}", started=started)

        latency_ms = (time.perf_counter() - started) * 1000.0

        if response.status_code >= 400:
            return self._failure(
                f"http {response.status_code}: {response.text[:500]}",
                status=response.status_code,
                started=started,
            )

        try:
            payload = response.json()
        except ValueError:
            return self._failure(
                f"non-JSON response: {response.text[:200]}",
                status=response.status_code,
                started=started,
            )

        decision = DefenderDecision(
            block=bool(payload.get("blockAction")),
            reason=payload.get("reason") or "",
            reason_code=payload.get("reasonCode"),
            diagnostics=payload.get("diagnostics") or "",
            http_status=response.status_code,
            latency_ms=latency_ms,
            evaluated=True,
        )
        logger.info(
            "[defender] verdict correlationId=%s %s",
            correlation_id,
            json.dumps(decision.log_fields(), default=str),
        )
        return decision


_client: DefenderClient | None = None


def get_client() -> DefenderClient:
    """Process-wide client instance."""
    global _client
    if _client is None:
        _client = DefenderClient()
    return _client
```

### `security/adapters/__init__.py`

```python
# A365 Security — added by instrument-security skill
"""Platform adapters that bridge native agent hooks onto Defender prevention.

Each adapter translates one agent framework's callback contract into the
platform-agnostic :mod:`security.ai_session` builders and
:class:`security.defender_client.DefenderClient`.
"""

from .google_adk import (
    after_agent_security_hook,
    after_tool_security_hook,
    before_agent_security_hook,
    before_tool_security_hook,
    secure_agent_callbacks,
)

__all__ = [
    "before_agent_security_hook",
    "after_agent_security_hook",
    "before_tool_security_hook",
    "after_tool_security_hook",
    "secure_agent_callbacks",
]
```

### `security/adapters/google_adk.py`

```python
# A365 Security — added by instrument-security skill
"""Google ADK adapter: Defender prevention on the four agent callbacks.

Mapping from ADK callback to inspected content and enforcement:

===========================  ==========================  ==========================
ADK callback                 Inspected                   Block mechanism
===========================  ==========================  ==========================
``before_agent_callback``    inbound user prompt         return ``types.Content`` —
                                                         the agent never runs and
                                                         this text is the reply
``after_agent_callback``     final agent answer          return ``types.Content`` —
                                                         replaces the answer
``before_tool_callback``     tool name + arguments       return ``dict`` — the tool
                                                         is never executed
``after_tool_callback``      tool result                 return ``dict`` — replaces
                                                         the result the model sees
===========================  ==========================  ==========================

Returning ``None`` from any hook leaves ADK's behavior untouched, which is what
happens for every allowed call and (with the default fail-open policy) whenever
Defender cannot be reached.

The webhook call is blocking I/O, so it runs in a worker thread via
``asyncio.to_thread`` — ADK awaits coroutine callbacks, so the event loop is
never stalled.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any, Callable, Optional, Sequence

from google.genai import types

from .. import ai_session
from ..config import SecurityConfig, get_config
from ..defender_client import DefenderDecision, get_client

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Content extraction helpers
# --------------------------------------------------------------------------- #
def _texts_from_content(content: Any) -> list[str]:
    """Pull the text parts out of a ``types.Content``-like object."""
    if content is None:
        return []
    parts = getattr(content, "parts", None) or []
    texts = []
    for part in parts:
        text = getattr(part, "text", None)
        if text:
            texts.append(text)
    return texts


def _user_prompts(callback_context: Any) -> list[str]:
    return _texts_from_content(getattr(callback_context, "user_content", None))


def _final_agent_texts(callback_context: Any) -> list[str]:
    """Text the agent produced during this invocation.

    ``after_agent_callback`` receives no output argument, so the answer is read
    back from the session's events for the current invocation.
    """
    session = getattr(callback_context, "session", None)
    events = list(getattr(session, "events", None) or [])
    invocation_id = getattr(callback_context, "invocation_id", None)
    agent_name = getattr(callback_context, "agent_name", None)

    texts: list[str] = []
    for event in reversed(events):
        if invocation_id and getattr(event, "invocation_id", None) != invocation_id:
            continue
        author = getattr(event, "author", None)
        if author == "user":
            continue
        if agent_name and author and author != agent_name:
            continue
        found = _texts_from_content(getattr(event, "content", None))
        if found:
            texts = found
            break
    return texts


def _session_id(context: Any) -> str:
    session = getattr(context, "session", None)
    return (
        getattr(session, "id", None)
        or getattr(context, "invocation_id", None)
        or ""
    )


def _user_id(context: Any) -> str:
    session = getattr(context, "session", None)
    return getattr(session, "user_id", None) or ""


def _tool_definition(tool: Any) -> dict[str, str]:
    return {
        "id": getattr(tool, "name", "unknown_tool"),
        "name": getattr(tool, "name", "unknown_tool"),
        "type": "mcp",
        "description": getattr(tool, "description", "") or "",
    }


# --------------------------------------------------------------------------- #
# Evaluation plumbing
# --------------------------------------------------------------------------- #
async def _evaluate(session_payload: dict, correlation_id: str) -> DefenderDecision:
    """Run the (blocking) webhook call off the event loop."""
    client = get_client()
    return await asyncio.to_thread(
        client.analyze, session_payload, correlation_id=correlation_id
    )


def _blocked_content(text: str) -> types.Content:
    """Model-authored content that replaces the agent turn when blocked."""
    return types.Content(role="model", parts=[types.Part(text=text)])


def _blocked_tool_result(decision: DefenderDecision, tool_name: str) -> dict[str, Any]:
    """Tool result shape that surfaces the block reason to the model and user."""
    text = decision.block_message(f"Tool '{tool_name}'")
    return {
        "content": [{"type": "text", "text": text}],
        "isError": True,
        "blocked": True,
        "reason": decision.reason,
        "reasonCode": decision.reason_code,
        "diagnostics": decision.diagnostics,
    }


def _should_skip(hook: str, cfg: SecurityConfig) -> bool:
    if not cfg.hook_enabled(hook):
        return True
    errors = cfg.validation_errors()
    if errors:
        logger.warning(
            "[defender] %s hook disabled — invalid config: %s", hook, "; ".join(errors)
        )
        return True
    return False


# --------------------------------------------------------------------------- #
# The four ADK hooks
# --------------------------------------------------------------------------- #
async def before_agent_security_hook(
    callback_context: Any,
) -> Optional[types.Content]:
    """Inspect the inbound prompt; block the whole turn when Defender says so."""
    cfg = get_config()
    if _should_skip("before_agent", cfg):
        return None

    prompts = _user_prompts(callback_context)
    if not prompts:
        return None

    invocation_id = getattr(callback_context, "invocation_id", "") or ""
    payload = ai_session.build_agent_request_session(
        cfg,
        prompts=prompts,
        session_id=_session_id(callback_context),
        request_id=invocation_id,
        user_id=_user_id(callback_context),
    )
    decision = await _evaluate(payload, invocation_id)

    if decision.block:
        logger.warning(
            "[defender] BLOCKED user prompt invocation=%s reasonCode=%s reason=%s",
            invocation_id,
            decision.reason_code,
            decision.reason,
        )
        return _blocked_content(decision.block_message("This request"))
    return None


async def after_agent_security_hook(
    callback_context: Any,
) -> Optional[types.Content]:
    """Inspect the agent's answer; replace it when Defender blocks."""
    cfg = get_config()
    if _should_skip("after_agent", cfg):
        return None

    responses = _final_agent_texts(callback_context)
    if not responses:
        return None

    invocation_id = getattr(callback_context, "invocation_id", "") or ""
    payload = ai_session.build_agent_response_session(
        cfg,
        responses=responses,
        session_id=_session_id(callback_context),
        request_id=invocation_id,
        user_id=_user_id(callback_context),
    )
    decision = await _evaluate(payload, invocation_id)

    if decision.block:
        logger.warning(
            "[defender] BLOCKED agent response invocation=%s reasonCode=%s reason=%s",
            invocation_id,
            decision.reason_code,
            decision.reason,
        )
        return _blocked_content(decision.block_message("This response"))
    return None


async def before_tool_security_hook(
    tool: Any,
    args: dict[str, Any],
    tool_context: Any,
) -> Optional[dict]:
    """Inspect tool arguments; stop the tool from running when blocked."""
    cfg = get_config()
    if _should_skip("before_tool", cfg):
        return None

    tool_name = getattr(tool, "name", "unknown_tool")
    invocation_id = getattr(tool_context, "invocation_id", "") or ""
    payload = ai_session.build_tool_request_session(
        cfg,
        tool_name=tool_name,
        arguments=args,
        session_id=_session_id(tool_context),
        tool_call_id=getattr(tool_context, "function_call_id", "") or "",
        tool_description=getattr(tool, "description", "") or "",
        request_id=invocation_id,
        user_id=_user_id(tool_context),
    )
    decision = await _evaluate(payload, invocation_id)

    if decision.block:
        logger.warning(
            "[defender] BLOCKED tool=%s invocation=%s reasonCode=%s reason=%s diagnostics=%s",
            tool_name,
            invocation_id,
            decision.reason_code,
            decision.reason,
            decision.diagnostics,
        )
        return _blocked_tool_result(decision, tool_name)
    return None


async def after_tool_security_hook(
    tool: Any,
    args: dict[str, Any],
    tool_context: Any,
    tool_response: Any,
) -> Optional[dict]:
    """Inspect the tool result before the model consumes it.

    This is the indirect-prompt-injection checkpoint: content fetched by a tool
    is untrusted input, and blocking here keeps it out of the model context.
    """
    cfg = get_config()
    if _should_skip("after_tool", cfg):
        return None

    tool_name = getattr(tool, "name", "unknown_tool")
    invocation_id = getattr(tool_context, "invocation_id", "") or ""
    payload = ai_session.build_tool_response_session(
        cfg,
        tool_name=tool_name,
        result=tool_response,
        session_id=_session_id(tool_context),
        tool_call_id=getattr(tool_context, "function_call_id", "") or "",
        request_id=invocation_id,
        user_id=_user_id(tool_context),
    )
    decision = await _evaluate(payload, invocation_id)

    if decision.block:
        logger.warning(
            "[defender] BLOCKED tool result tool=%s invocation=%s reasonCode=%s reason=%s",
            tool_name,
            invocation_id,
            decision.reason_code,
            decision.reason,
        )
        return _blocked_tool_result(decision, tool_name)
    return None


# --------------------------------------------------------------------------- #
# Additive wiring
# --------------------------------------------------------------------------- #
async def _run_callbacks(existing: Any, *args: Any, **kwargs: Any) -> Any:
    """Run the agent's own callback(s) and return the first non-None result.

    Mirrors ADK's own semantics (callbacks may be a single callable or a list,
    and may be sync or async) so composing does not change their behavior.
    """
    if existing is None:
        return None

    callbacks = (
        list(existing)
        if isinstance(existing, Sequence) and not callable(existing)
        else [existing]
    )
    for callback in callbacks:
        result = callback(*args, **kwargs)
        if inspect.isawaitable(result):
            result = await result
        if result is not None:
            return result
    return None


def _compose_before_agent(existing: Any) -> Callable:
    """Agent's hooks first; if they don't short-circuit, security decides."""

    async def composed(callback_context: Any, **kwargs: Any) -> Optional[types.Content]:
        result = await _run_callbacks(existing, callback_context=callback_context, **kwargs)
        if result is not None:
            return result
        return await before_agent_security_hook(callback_context)

    return composed


def _compose_after_agent(existing: Any) -> Callable:
    """Agent's hooks always run (they close tracing scopes); security can override."""

    async def composed(callback_context: Any, **kwargs: Any) -> Optional[types.Content]:
        result = await _run_callbacks(existing, callback_context=callback_context, **kwargs)
        blocked = await after_agent_security_hook(callback_context)
        return blocked if blocked is not None else result

    return composed


def _compose_before_tool(existing: Any) -> Callable:
    async def composed(
        tool: Any, args: dict[str, Any], tool_context: Any, **kwargs: Any
    ) -> Optional[dict]:
        result = await _run_callbacks(
            existing, tool=tool, args=args, tool_context=tool_context, **kwargs
        )
        if result is not None:
            return result
        return await before_tool_security_hook(tool, args, tool_context)

    return composed


def _compose_after_tool(existing: Any) -> Callable:
    """Agent's hooks run first, then security inspects the *effective* result.

    The agent's own after-tool hook may redact or rewrite the payload (and must
    run so tracing scopes close). Security therefore evaluates whatever the
    model would actually receive, and its block verdict wins.
    """

    async def composed(
        tool: Any,
        args: dict[str, Any],
        tool_context: Any,
        tool_response: Any,
        **kwargs: Any,
    ) -> Optional[dict]:
        result = await _run_callbacks(
            existing,
            tool=tool,
            args=args,
            tool_context=tool_context,
            tool_response=tool_response,
            **kwargs,
        )
        effective = result if result is not None else tool_response
        blocked = await after_tool_security_hook(tool, args, tool_context, effective)
        return blocked if blocked is not None else result

    return composed


_COMPOSERS = {
    "before_agent_callback": ("before_agent", _compose_before_agent),
    "after_agent_callback": ("after_agent", _compose_after_agent),
    "before_tool_callback": ("before_tool", _compose_before_tool),
    "after_tool_callback": ("after_tool", _compose_after_tool),
}


def secure_agent_callbacks(**callbacks: Any) -> dict[str, Any]:
    """Wrap the agent's callback keyword arguments with Defender prevention.

    Usage::

        root_agent = Agent(
            ...,
            **secure_agent_callbacks(
                before_agent_callback=before_agent_hook,
                after_tool_callback=after_tool_hook,
            ),
        )

    Existing callbacks are preserved and always run; only hooks enabled by
    configuration are wrapped, so disabling one leaves the original untouched.
    """
    cfg = get_config()

    merged = dict(callbacks)
    for key, (hook_name, composer) in _COMPOSERS.items():
        if cfg.hook_enabled(hook_name):
            merged[key] = composer(merged.get(key))

    logger.info("[defender] prevention configured: %s", cfg.describe())
    return merged
```

---

## 5. Wiring into the agent

```python
# A365 Security — added by instrument-security skill
from .security.adapters import secure_agent_callbacks

root_agent = Agent(
    model=MODEL,
    name="my_agent",
    instruction=...,
    tools=[...],
    before_model_callback=before_model_hook,   # untouched — not an inspection point
    after_model_callback=after_model_hook,
    **secure_agent_callbacks(
        before_agent_callback=before_agent_hook,
        after_agent_callback=after_agent_hook,
        before_tool_callback=before_tool_hook,
        after_tool_callback=after_tool_hook,
    ),
)
```

Pass the agent's existing callbacks in; they are preserved. Hooks disabled via
`DEFENDER_HOOKS` are passed through untouched.

---

## 6. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DEFENDER_ENABLED` | `true` | Master switch |
| `DEFENDER_WEBHOOK_URL` | `https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze` | Overrides the shipped `DEFENDER_ENDPOINT` constant |
| `DEFENDER_WEBHOOK_APP_ID` | `86a21212-634e-4553-b3d6-e477e4c9d9ec` | **Resource** the token is issued for. Not the agent's identity — the caller comes from the FMI chain. Never set this to a client/demo app id. |
| `DEFENDER_WEBHOOK_SCOPE` | `https://rtp-a365.ai.defender.microsoft.com/.default` | Explicit scope override. Note this resource uses the `https://` form — `api://<id>/.default` fails with `AADSTS500011`. |
| `DEFENDER_FAIL_MODE` | `open` | Behavior when no verdict is obtained |
| `DEFENDER_HOOKS` | all four | Comma-separated subset |
| `DEFENDER_TIMEOUT_SECONDS` | `10` | Per-call timeout |
| `DEFENDER_MAX_CONTENT_CHARS` | `20000` | Truncation limit |
| `AGENT365_AGENT_OBJECT_ID` | — | Optional; webhook stamps from the token when unset |

Reused from the existing A365 setup: `AGENT365_TENANT_ID`, `AGENT365_AGENT_ID`,
`AGENT365_BLUEPRINT_ID`, `AGENT365_CLIENT_ID`, `AGENT365_CLIENT_SECRET`,
`AGENT365_AGENT_NAME`, `AGENT365_USE_MANAGED_IDENTITY`.

**Deployed runtimes do not read `.env`.** Forward `DEFENDER_*` through
`env_vars` on `agent_engines.create/update`, or the hooks will be configured out
at runtime while looking correctly wired locally.

---

## 7. Verifying

A benign turn should log one verdict per enabled hook:

```
[defender] verdict correlationId=e-93e2… {"block": false, "evaluated": true, "reasonCode": 200, …}   ← before_agent
[defender] verdict correlationId=e-93e2… {"block": false, …}                                          ← before_tool
[defender] verdict correlationId=e-93e2… {"block": false, …}                                          ← after_tool
[defender] verdict correlationId=e-93e2… {"block": false, …}                                          ← after_agent
[tool-call] platform_info
[model] The connection is not authenticated.
```

A known-bad turn blocks with the reason surfaced:

```
[defender] verdict … {"block": true, "reasonCode": 403,
                      "reason": "An AI agent attempted, during tool invocation, to communicate
                                 with domains matching known threat indicators.",
                      "diagnostics": "Detected threat types: MaliciousContentPropagation;
                                      MaliciousUrl: https://test.security.dfai.microsoft.com"}
[defender] BLOCKED user prompt invocation=e-a7ac… reasonCode=403
[model] This request was blocked by Microsoft Defender for AI (Security for AI prevention).
        Reason: … [Detected threat types: MaliciousContentPropagation; MaliciousUrl: …]
```

Troubleshooting:

| Symptom | Cause |
|---|---|
| No `[defender]` lines at all | `DEFENDER_ENABLED=false`, hooks not wired, or env vars missing in the deployed runtime |
| `evaluated=false` with `block=false` | No verdict obtained and fail-open masked it — read `error`/`httpStatus` |
| Known-bad allowed | Indicator never reached an inspected field, or the config errors are being logged and hooks skipped |
| One verdict instead of four | Only one hook is enabled, or existing callbacks short-circuit before security (check composition) |

Each enabled hook adds one webhook round trip (~1.5–3 s observed against dev) to
the turn. Enabling all four is the strongest posture; trim `DEFENDER_HOOKS` when
latency matters more than coverage on a given path.
