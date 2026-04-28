# Python — A365 Observability Reference

Authoritative package versions and code patterns for instrumenting A365 observability
into a Python agent. All samples mirror the official Microsoft Learn docs (updated 2026-04-22).

---

## pip Packages

| Package | Purpose |
|---------|---------|
| `microsoft-agents-a365-observability-core` | `configure()`, `BaggageBuilder`, `Agent365ExporterOptions`, all scope types — required for all agents |
| `microsoft-agents-a365-runtime` | `get_observability_authentication_scope()` — required for all agents |
| `microsoft-agents-a365-observability-hosting` | `AgenticTokenCache`, `AgenticTokenStruct`, `BaggageMiddleware`, `ObservabilityHostingManager`, `populate` helper |
| `microsoft-agents-a365-observability-extensions-semantic-kernel` | SK auto-instrumentation (optional) |
| `microsoft-agents-a365-observability-extensions-openai` | OpenAI Agents SDK auto-instrumentation (optional) |
| `microsoft-agents-a365-observability-extensions-agent-framework` | Agent Framework auto-instrumentation (optional) |
| `microsoft-agents-a365-observability-extensions-langchain` | LangChain auto-instrumentation (optional) |

Install commands:

> **Critical — version mismatch:** The stable PyPI release (`pip install microsoft-agents-a365-observability-core`) installs **v0.1.0**, which has a completely different and incompatible API (different `InvokeAgentScope.start()` signature, no `InvokeAgentScopeDetails`, no `UserDetails`, no `BaggageMiddleware`). Always install with `--pre` to get the 0.3.x API that these patterns document.

```bash
# Required for all agents (--pre required for 0.3.x API)
pip install --pre microsoft-agents-a365-observability-core
pip install --pre microsoft-agents-a365-runtime

# Required for AI Teammate agents (hosting path)
pip install --pre microsoft-agents-a365-observability-hosting

# Optional auto-instrumentation extensions
pip install microsoft-agents-a365-observability-extensions-semantic-kernel
pip install microsoft-agents-a365-observability-extensions-openai
pip install microsoft-agents-a365-observability-extensions-agent-framework
pip install microsoft-agents-a365-observability-extensions-langchain
```

---

## Entry Point — Observability Init

### Basic configuration (env-var driven)

```python
from microsoft_agents_a365.observability.core import configure

def token_resolver(agent_id: str, tenant_id: str) -> str | None:
    # Implement secure token retrieval here.
    # Return the raw access token only — do not include the "Bearer " prefix.
    return "<token>"

configure(
    service_name="my-agent-service",
    service_namespace="my.namespace",
    token_resolver=token_resolver,
)
# ENABLE_A365_OBSERVABILITY_EXPORTER env var controls whether spans go to console or A365.
```

### Advanced configuration with exporter options

```python
from microsoft_agents_a365.observability.core import configure, Agent365ExporterOptions

configure(
    service_name="my-agent-service",
    service_namespace="my.namespace",
    exporter_options=Agent365ExporterOptions(
        cluster_category="prod",
        token_resolver=token_resolver,
    ),
    suppress_invoke_agent_input=True,  # suppress input messages on InvokeAgent spans
)
```

### S2S configuration (`authMode: S2S`)

S2S observability is supported for Python. The pattern mirrors the `.NET ObservabilityTokenService` — a background coroutine acquires and refreshes the Observability API token via MSAL client credentials. No OBO user token is required.

> Reference: [Agent observability — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/observability)

#### Step 1 — Create `observability/observability_token_service.py`

Write this scaffold module to handle background token acquisition and refresh:

```python
# observability/observability_token_service.py
# A365 Observability — best-effort instrumentation (verify against official sample)
import asyncio
import logging
import os
from msal import ConfidentialClientApplication

# Dedicated Observability API app — scope updated per SDK release (April 2025)
OBSERVABILITY_SCOPE = "api://9b975845-388f-4429-889e-eab1ef63949c/.default"
TOKEN_REFRESH_INTERVAL_SECS = 50 * 60  # 50 minutes (token TTL = 60 min)

logger = logging.getLogger(__name__)
_cached_token: str = ""
_msal_app: ConfidentialClientApplication | None = None


def _get_msal_app() -> ConfidentialClientApplication:
    global _msal_app
    if _msal_app is None:
        _msal_app = ConfidentialClientApplication(
            client_id=os.environ["BLUEPRINT_CLIENT_ID"],
            client_credential=os.environ["BLUEPRINT_CLIENT_SECRET"],
            authority=f"https://login.microsoftonline.com/{os.environ['TENANT_ID']}",
        )
    return _msal_app


def _acquire_token() -> str:
    result = _get_msal_app().acquire_token_for_client(scopes=[OBSERVABILITY_SCOPE])
    return result.get("access_token", "") or ""


async def start_observability_token_service() -> None:
    """Call once at startup — acquires the first token and refreshes every 50 min."""
    global _cached_token
    _cached_token = _acquire_token()
    while True:
        await asyncio.sleep(TOKEN_REFRESH_INTERVAL_SECS)
        try:
            _cached_token = _acquire_token()
        except Exception as exc:
            logger.warning("[A365 Observability] S2S token refresh failed (non-fatal): %s", exc)


def get_s2s_observability_token(agent_id: str, tenant_id: str) -> str | None:
    """Token resolver passed to configure(token_resolver=...)."""
    return _cached_token or None
```

Also install the required MSAL package if not already present:
```bash
pip install msal
# or: uv add msal
```

#### Step 2 — Wire in entry point (`host_agent_server.py` or `app.py`)

```python
# authMode: S2S — service principal, no user OBO.
# Token must be acquired via MSAL client credentials, NOT AgenticTokenCache.
import asyncio
from microsoft_agents_a365.observability.core import configure, Agent365ExporterOptions
from observability.observability_token_service import (
    start_observability_token_service,
    get_s2s_observability_token,
)

async def main():
    # Start background token refresh BEFORE configure() is called.
    asyncio.create_task(start_observability_token_service())

    configure(
        service_name="my-agent",
        service_namespace="my.namespace",
        exporter_options=Agent365ExporterOptions(
            use_s2s_endpoint=True,       # S2S-specific: routes to the S2S endpoint
            token_resolver=get_s2s_observability_token,
        ),
    )
    # ... rest of server startup
```

#### S2S environment variables

```dotenv
# Blueprint service principal (from a365 setup output)
BLUEPRINT_CLIENT_ID=
BLUEPRINT_CLIENT_SECRET=
TENANT_ID=
```

Message handler baggage setup is **identical** to `user-delegated` / `agentic-identity` — only the token resolver, `use_s2s_endpoint` flag, and absence of `register_observability()` differ. Do **not** call `token_cache.register_observability()` for S2S agents.

### Hosting path — AgenticTokenCache (AI Teammate agents)

```python
from microsoft_agents_a365.observability.core import configure
from microsoft_agents_a365.observability.hosting.token_cache_helpers import (
    AgenticTokenCache,
    AgenticTokenStruct,
)
from microsoft_agents_a365.runtime import get_observability_authentication_scope

# Create a shared cache instance (module-level singleton)
token_cache = AgenticTokenCache()

# Wire the cache as your token resolver — call configure() before any spans are created
configure(
    service_name="my-agent-service",
    service_namespace="my.namespace",
    token_resolver=token_cache.get_observability_token,
)
```

---

## Adapter — BaggageMiddleware

Register `BaggageMiddleware` to auto-populate baggage from every incoming `TurnContext`.
This removes the need to call `BaggageBuilder` manually in each activity handler.

```python
from microsoft_agents_a365.observability.hosting import BaggageMiddleware

adapter.use(BaggageMiddleware())
# The middleware skips async replies (ContinueConversation) to avoid overwriting baggage.
```

```python
from microsoft_agents_a365.observability.hosting import ObservabilityHostingManager, ObservabilityHostingOptions

# Alternative: use ObservabilityHostingManager for composite configuration
options = ObservabilityHostingOptions(enable_baggage=True)
ObservabilityHostingManager.configure(adapter.middleware_set, options)
```

---

## Message Handler — Token Registration + BaggageBuilder

```python
from microsoft_agents_a365.observability.core import BaggageBuilder
from microsoft_agents_a365.observability.hosting.scope_helpers.populate_baggage import populate
from microsoft_agents_a365.observability.hosting.token_cache_helpers import (
    AgenticTokenCache,
    AgenticTokenStruct,
)
from microsoft_agents_a365.runtime import get_observability_authentication_scope

@AGENT_APP.activity("message", auth_handlers=["AGENTIC"])
async def on_message(context: TurnContext, state: TurnState):
    # Register the token so the exporter can authenticate exports (non-fatal).
    try:
        token_cache.register_observability(
            agent_id=context.activity.recipient.agentic_app_id,
            tenant_id=context.activity.recipient.tenant_id,
            token_generator=AgenticTokenStruct(
                authorization=AGENT_APP.auth,
                turn_context=context,
            ),
            observability_scopes=get_observability_authentication_scope(),
        )
    except Exception as ex:
        print(f"[A365 Observability] Token registration failed (non-fatal): {ex}")

    # Build baggage from TurnContext.
    # Skip if BaggageMiddleware is already registered on the adapter.
    builder = BaggageBuilder()
    populate(builder, context)  # auto-populates from activity

    with builder.build():
        # ... your agent message handling logic ...
        pass
```

Manual BaggageBuilder (without the populate helper):

```python
from microsoft_agents_a365.observability.core import BaggageBuilder

with (
    BaggageBuilder()
    .tenant_id("tenant-123")
    .agent_id("agent-456")
    .conversation_id("conv-789")
    .build()
):
    # Any spans started in this context will receive these as attributes
    pass
```

---

## Manual Instrumentation Scopes

> **Store publishing requirement:** `InvokeAgentScope`, `InferenceScope`, and `ExecuteToolScope`
> are **required** for store validation. Missing any one causes store validation failure.

### InvokeAgentScope

```python
from microsoft_agents_a365.observability.core import (
    InvokeAgentScope,
    InvokeAgentScopeDetails,
    AgentDetails,
    CallerDetails,
    UserDetails,
    Channel,
    Request,
    ServiceEndpoint,
)

# Reuse the same agent_details and request instances across all scopes in a request.
agent_details = AgentDetails(
    agent_id="agent-456",
    agent_name="My Agent",
    agent_description="An AI agent powered by Azure OpenAI",
    agentic_user_id="auid-123",
    agentic_user_email="agent@contoso.com",
    agent_blueprint_id="blueprint-789",
    tenant_id="tenant-123",
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
    # Record input messages
    scope.record_input_messages(["User asks a question"])
    # Perform agent invocation logic
    response = call_agent(...)
    # Record output messages
    scope.record_output_messages([response])
```

### ExecuteToolScope

```python
from microsoft_agents_a365.observability.core import (
    ExecuteToolScope,
    ToolCallDetails,
    Request,
    ServiceEndpoint,
)

# Use the same agent_details and request instances from InvokeAgentScope above.

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

```python
from microsoft_agents_a365.observability.core import (
    InferenceScope,
    InferenceCallDetails,
    InferenceOperationType,
)

# Use the same agent_details and request instances from InvokeAgentScope above.

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
from microsoft_agents_a365.observability.core import (
    OutputScope,
    Response,
    SpanDetails,
)

# Use the same agent_details and request instances from InvokeAgentScope above.

# Get the parent context from the originating scope
parent_context = invoke_scope.get_context()

response = Response(messages=["Here is your organized inbox with 15 urgent emails."])

with OutputScope.start(
    request,
    response,
    agent_details,
    span_details=SpanDetails(parent_context=parent_context),
):
    # Output messages are recorded automatically from the response
    pass
```

---

## Auto-Instrumentation Extensions

### Semantic Kernel

```python
from microsoft_agents_a365.observability.core import configure
from microsoft_agents_a365.observability.extensions.semantickernel.trace_instrumentor import SemanticKernelInstrumentor

configure(
    service_name="my-semantic-kernel-agent",
    service_namespace="ai.agents"
)

instrumentor = SemanticKernelInstrumentor()
instrumentor.instrument()
# Your Semantic Kernel code is now automatically traced
```

### OpenAI Agents SDK

```python
from microsoft_agents_a365.observability.core import configure
from microsoft_agents_a365.observability.extensions.openai import OpenAIAgentsTraceInstrumentor

configure(
    service_name="my-openai-agent",
    service_namespace="ai.agents"
)

instrumentor = OpenAIAgentsTraceInstrumentor()
instrumentor.instrument()
# Your OpenAI Agents code is now automatically traced
```

### Agent Framework

```python
from microsoft_agents_a365.observability.core import configure
from microsoft_agents_a365.observability.extensions.agentframework import AgentFrameworkInstrumentor

configure(
    service_name="my-agent",
    service_namespace="ai.agents",
)

AgentFrameworkInstrumentor().instrument()
```

### LangChain

```python
from microsoft_agents_a365.observability.core import configure
from microsoft_agents_a365.observability.extensions.langchain import LangChainInstrumentor

configure(
    service_name="my-langchain-agent",
    service_namespace="ai.agents"
)

instrumentor = LangChainInstrumentor()
instrumentor.instrument()
# Your LangChain code is now automatically traced
```

---

## .env Variables

> **Note:** If you ran `a365 setup`, `ENABLE_A365_OBSERVABILITY_EXPORTER=false` is **already
> present** in your `.env` file. Preserve this value when instrumenting.

```dotenv
# ── A365 Observability ────────────────────────────────────────────────────────
# Set to true to export to Microsoft Admin Center (production only).
# a365 setup automatically adds this with value "false".
ENABLE_A365_OBSERVABILITY_EXPORTER=false
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Validate Locally

Set `ENABLE_A365_OBSERVABILITY_EXPORTER=false` — spans export to the console.

To investigate export failures, enable verbose logging in your application startup:

```python
import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("microsoft_agents_a365.observability.core").setLevel(logging.DEBUG)

# Or target only the exporter:
logging.getLogger(
    "microsoft_agents_a365.observability.core.exporters.agent365_exporter"
).setLevel(logging.DEBUG)
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

Import check to verify packages are installed:

```bash
python -c "from microsoft_agents_a365.observability.core import configure; from microsoft_agents_a365.observability.hosting.token_cache_helpers import AgenticTokenCache; print('A365 observability imports OK')"
```

---

## configure() Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service_name` | Service name shown in Admin Center | required |
| `service_namespace` | Service namespace for OTel resource | required |
| `token_resolver` | `(agent_id, tenant_id) -> str \| None` callable | `None` |
| `exporter_options` | `Agent365ExporterOptions` instance — takes precedence over `token_resolver` | `None` |
| `suppress_invoke_agent_input` | When `True`, suppresses input messages on `InvokeAgent` spans | `False` |
| `logger_name` | Python logger name for debug output | `microsoft_agents_a365.observability.core` |

## Agent365ExporterOptions Properties

| Property | Description | Default |
|----------|-------------|---------|
| `use_s2s_endpoint` | Use service-to-service endpoint path | `False` |
| `max_queue_size` | Max queue size for batch processor | `2048` |
| `scheduled_delay_ms` | Delay between export batches (ms) | `5000` |
| `exporter_timeout_ms` | Timeout for export operation (ms) | `30000` |
| `max_export_batch_size` | Max batch size | `512` |

---

## Key API Surface

| Symbol | Module | Purpose |
|--------|--------|---------|
| `configure()` | `microsoft_agents_a365.observability.core` | Initialize OTel with A365 exporter |
| `BaggageBuilder` | `microsoft_agents_a365.observability.core` | Propagates tenant/agent/conversation context across spans |
| `populate(builder, turn_context)` | `microsoft_agents_a365.observability.hosting.scope_helpers.populate_baggage` | Auto-populates `BaggageBuilder` from `TurnContext` |
| `BaggageMiddleware` | `microsoft_agents_a365.observability.hosting` | Adapter middleware — auto-populates baggage for every request |
| `ObservabilityHostingManager` | `microsoft_agents_a365.observability.hosting` | Composite hosting configuration |
| `AgenticTokenCache` | `microsoft_agents_a365.observability.hosting.token_cache_helpers` | Handles token caching for AI Teammate agents |
| `AgenticTokenStruct` | `microsoft_agents_a365.observability.hosting.token_cache_helpers` | Wraps `Authorization` + `TurnContext` for token generation |
| `get_observability_authentication_scope()` | `microsoft_agents_a365.runtime` | Returns the OAuth2 scope string |
| `InvokeAgentScope.start(request, scope_details, agent_details, caller_details)` | `microsoft_agents_a365.observability.core` | Start agent invocation telemetry scope (context manager) |
| `ExecuteToolScope.start(request, tool_details, agent_details)` | `microsoft_agents_a365.observability.core` | Start tool execution telemetry scope (context manager) |
| `InferenceScope.start(request, inference_details, agent_details)` | `microsoft_agents_a365.observability.core` | Start LLM inference telemetry scope (context manager) |
| `OutputScope.start(request, response, agent_details, span_details)` | `microsoft_agents_a365.observability.core` | Start output telemetry scope (async scenarios) |
| `scope.record_input_messages(msgs)` / `scope.record_output_messages(msgs)` | — | Record prompts and completions |
| `scope.record_input_tokens(n)` / `scope.record_output_tokens(n)` | — | Record token counts |
| `scope.record_response(result)` | — | Record tool execution result |
| `scope.get_context()` | — | Get OTel context for use as parent in `OutputScope` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console traces | `configure()` not called | Call `configure()` before any spans are created |
| Spans missing baggage | Handler not wrapped in baggage scope | Register `BaggageMiddleware` or use `with builder.build():` |
| Token resolver returns `None` | `register_observability()` not called per turn | Call it at the start of each message handler turn |
| `ModuleNotFoundError` | Package not installed | Run `pip install microsoft-agents-a365-observability-core` |
| Traces not in Admin Center | Exporter env var not set | Set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in production |
| 401 on export | Missing permission | Check if upgrading past `0.3.0` (requires new `Agent365.Observability.OtelWrite` permission) |
| Spans dropped silently | Missing tenant/agent ID | Ensure `BaggageBuilder` (or `BaggageMiddleware`) populates tenant/agent ID before creating spans |
| `TypeError` on `InvokeAgentScope.start()` — wrong number of args | Installed v0.1.0 (stable) instead of 0.3.x (prerelease) | Run `pip install --pre microsoft-agents-a365-observability-core` to get the 0.3.x API |
| `ImportError: cannot import name 'InvokeAgentScopeDetails'` | Using v0.1.0 which has `InvokeAgentDetails` instead | Upgrade with `pip install --pre microsoft-agents-a365-observability-core` |
| `ImportError: cannot import name 'BaggageMiddleware'` | `BaggageMiddleware` only exists in v0.3.x hosting | Run `pip install --pre microsoft-agents-a365-observability-hosting` |
| `ImportError: cannot import name 'UserDetails'` | v0.1.0 has no `UserDetails` type | Upgrade to 0.3.x with `--pre` |
| S2S: `register_observability` called for S2S agent | S2S does not use per-turn token registration | Remove `token_cache.register_observability()` from the handler; token comes from `_acquire_s2s_token` resolver in `configure()` |
