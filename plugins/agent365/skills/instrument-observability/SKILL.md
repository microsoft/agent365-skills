---
name: instrument-observability
description: >
  Instruments Microsoft Agent 365 observability into existing .NET AgentFramework, Node.js, or
  Python agents. Adds OTel-based tracing, context propagation, A365 exporter, manual
  instrumentation scopes (InvokeAgentScope, InferenceScope, ExecuteToolScope — required for
  store publishing), and updates configuration files. Asks a two-stage question — agent kind
  (AI Teammate or Agent (Non AI Teammate)) and auth mode — to determine
  the correct token path: OBO (`obo` / `agentic-user`) or Service Principal (`s2s`)
  (FMI 3-hop token chain with Power Platform scope supported for .NET, Node.js, and Python — each language
  gets a scaffold token-service file that acquires and refreshes the Observability API token via the FMI chain). Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: path to agent project, or framework hint (dotnet|nodejs|python)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-instrument-observability.js
      timeout: 30000
    - type: prompt
      prompt: |
        Packages, entry-point wiring, baggage, token resolver, config files,
        and build are validated by validate-instrument-observability.js.
        This prompt covers only the items the JS validator can't inspect.

        Verify:
        1. agentType (ai-teammate / system-agent) and authMode (obo / s2s /
           agentic-user) were determined and authMode is recorded in an inline
           comment in the message handler.
        2. Instrumented code is annotated with the marker comment so a future
           reader can spot it: `// A365 Observability — best-effort
           instrumentation` (or `#` for Python).
        3. For .NET S2S only: baggage is set via
           `new BaggageBuilder().FromTurnContext(turnContext).Build()` (not
           chained onto InvokeAgentScope); InvokeAgentScope.Start() is a
           separate using-scope with InvokeAgentScopeDetails(endpoint: ...).
        4. For Node.js S2S only: startTokenService() runs before
           useMicrosoftOpenTelemetry().
        5. For Python S2S only: run_token_service() is scheduled as an asyncio
           task before use_microsoft_opentelemetry().

        Return {"ok": false, "reason": "<item>"} if any required item is
        missing, otherwise {"ok": true}.
      timeout: 30000
---

# Instrument A365 Observability

> **Trigger phrases** — any of these will activate this skill automatically:
> - "instrument observability for this agent"
> - "add a365 observability to this agent"
> - "add observability to this agent"
> - "set up tracing for this agent"
> - "make this agent visible in microsoft defender"
> - "enable agent 365 telemetry"
> - "wire up opentelemetry for this agent"
> - "add observability to this .net agent"
> - "add observability to this node.js agent"
> - "add a365 observability to this python agent"

---

## Overview

This skill instruments Microsoft Agent 365 observability into an existing agent codebase
without disrupting the agent's core logic. It:

1. **Detects** the agent type (.NET AgentFramework, Node.js, or Python)
2. **Installs** the correct A365 observability packages (core + hosting + optional extensions)
3. **Wires** observability in the entry point
4. **Adds** BaggageBuilder context or BaggageMiddleware to message handlers
5. **Implements** the agentic token resolver with caching
6. **Adds** manual instrumentation scopes (InvokeAgentScope, InferenceScope, ExecuteToolScope — **required for store publishing**)
7. **Updates** configuration files with observability settings
8. **Validates** the build passes

> **Store publishing requirement:** The Agent 365 store validation requires `InvokeAgentScope`,
> `InferenceScope`, and `ExecuteToolScope` to be implemented. This skill wires them.

All changes are **additive** and **idempotent** — rerunning the skill is safe.

---

## Phase 0: Load Detection Cache and Validate

**TaskCreate** — "Load detection cache and validate with user"

**Read** `.a365-workspace-detection.json`.

If the file is missing or `detectedAt` is older than 60 minutes:
> "`a365-setup` must be run before this skill — it registers your agent with Agent 365 and writes
> the project detection cache this skill depends on. Run `a365-setup` now, then return here."

Stop until the user confirms `a365-setup` has been run.

Load from cache: `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `agentType`, `authMode` (if previously stored).

Present the loaded values in one message and wait for confirmation:

```
Here's what we detected about your agent:
  • Stack:    {agentStack}
  • Language: {programmingLanguage}

Reply **yes** to confirm, or describe any corrections.
```

**TaskUpdate** — Mark complete: "Load detection cache and validate with user"

---

## Phase 0.5: Agent Kind and Authentication Mode

**TaskCreate** — "Determine agent kind and authentication mode"

**Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` — section **"Agent Type and Auth Mode Detection"** — and follow it exactly.

If `agentType` and `authMode` are already present in the detection cache (from a prior skill run in this session), confirm the values with the user and skip the questions. Read `authMode` case-insensitively (`S2S` = `s2s`, `OBO` = `obo`); always write back the canonical lowercase value.

Store `agentType` (`ai-teammate` = AI Teammate, or `system-agent` = Agent (Non AI Teammate)) and `authMode`:
- **AI Teammate:** `agentic-user` (agent's own M365 identity — not the caller's token; auto-set, no question needed)
- **Agent (Non AI Teammate):** `obo` (On-Behalf-Of — signed-in user token) or `s2s` (Service Principal, no user token)

**Update `.a365-workspace-detection.json`** — merge `agentType` and `authMode` into the existing cache file, preserving all other fields (`agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `detectedAt`). Use the **Write** tool to write the merged object back.

The `authMode` value drives Phases 3–5: OBO and S2S paths differ in entry point wiring (Phase 3), message handler pattern (Phase 4), and token resolver (Phase 5). **Phases 2, 6, 7, and 8 are identical regardless of `authMode`.**

**TaskUpdate** — Mark complete: "Determine agent type and authentication mode"

---

## Phase 1: Detect Agent Type

**TaskCreate** — "Detect agent type and load reference patterns"

1. **Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` for detection heuristics.

2. **Run detection** following the rules in `agent-detection.md`:
   - Check for `.NET AgentFramework` indicators (Microsoft.Agent.*, AgentFramework) → `.csproj`
   - Check for `Node.js` indicators (package.json, @langchain, openai, @microsoft/agents-*)
   - Check for `Python` indicators (requirements.txt, pyproject.toml, `.py` files, `microsoft-agents`)
   - Determine package file (*.csproj, package.json, pyproject.toml/requirements.txt)
   - Determine entry point (Program.cs, index.ts/js, app.py / host_agent_server.py)
   - Determine message handler location

3. **Load reference patterns:**
   - If .NET: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
   - If Node.js: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
   - If Python: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/python-observability.md`

4. **If agent type cannot be determined**, write marker `.a365setup-unknown-agent` and **exit early** with clear error message.

5. **TaskUpdate** — Mark complete and report detected agent type to user.

---

## Phase 2: Install A365 Observability Packages

**TaskCreate** — "Install A365 observability packages"

All languages converge on a single unified distro that re-exports the legacy
A365 observability + hosting types and auto-instruments common LLM SDKs:

| Language | Install command | S2S extra (FMI token chain) |
|----------|-----------------|------------------------------|
| .NET     | `dotnet add package Microsoft.OpenTelemetry` | `dotnet add package Azure.Identity Microsoft.Identity.Client` |
| Node.js  | `npm install @microsoft/opentelemetry`       | `npm install @azure/msal-node @azure/identity` |
| Python   | `pip install microsoft-opentelemetry`        | `pip install msal azure-identity httpx` |

**Do not** install legacy `*.Observability.Runtime` / `-hosting` / `-extensions-*`
packages alongside the unified distro — the distro re-exports their types and
mixing the two produces CS0433 duplicate-type errors (.NET) or duplicate spans
(Node.js / Python). After install, verify the package appears in the manifest
(`*.csproj` / `package.json` / `requirements.txt` or `pyproject.toml`).
`pip install` does not update the dependency manifest — prefer
`uv add microsoft-opentelemetry` (or `poetry add ...`) for Python.

**Python — Google ADK gotcha:** if `pyproject.toml` lists `google-adk`,
`uv sync` will backtrack for minutes resolving the OTel graph. Pin OTel via
`[tool.uv] override-dependencies` — see python-observability.md → "Google ADK
projects — pin the OTel stack" for the exact block. Other Python stacks
(AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel) don't need this.

Full per-language package tables, version constraints, and the LangChain extras
flag live in the references — see the "Required packages" section of:

- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/python-observability.md`

**TaskUpdate** — Mark complete.

---

## Phase 3: Wire Observability in Entry Point

**TaskCreate** — "Wire observability in entry point"

> **Pre-existing placeholders:** As of CLI 1.1, `a365 setup all` auto-writes `Agent365Observability` placeholder sections to `appsettings.json` (.NET) or `.env` (Node.js/Python). Before creating config from scratch, **check if placeholders already exist** and fill in values rather than duplicating the section.

### For .NET AgentFramework

1. **Read** the current entry point (`Program.cs` or detected file).

2. **Edit** — Add observability wiring following the reference pattern in `dotnet-observability.md`:
   - Add `using Microsoft.OpenTelemetry;` to `Program.cs`.
   - **OBO / agentic-user path** (AI Teammate AND Standard .NET agents): Call `builder.UseMicrosoftOpenTelemetry(o => { ... })` with `o.Exporters = ExportTarget.Agent365 | ExportTarget.Console` (Dev) or `ExportTarget.Agent365` (Production). The distro **auto-registers `IExporterTokenCache<AgenticTokenStruct>`** in DI — no `AddAgenticTracingExporter()` call needed. Leave `o.Agent365.Exporter.UseS2SEndpoint` at its default (`false`) — the exporter POSTs to `/observability/` which the OBO token cache authenticates. Also set `"EnableAgent365Exporter": true` in `appsettings.json` to activate the backend exporter — the SDK defaults this to `false` when absent, so without it the exporter is wired but inert.
   - **Required: `IChatClient.UseOpenTelemetry()`** — when registering the `IChatClient` (e.g. Azure OpenAI), chain `.AsBuilder().UseFunctionInvocation().UseOpenTelemetry(sourceName: null, cfg => cfg.EnableSensitiveData = true).Build()`. This is what makes the AI SDK emit the `gen_ai.inference` and `gen_ai.tool` spans that `InvokeAgentScope` (Phase 5.5) anchors as children. **Skipping this means no LLM spans appear in MAC, even with everything else wired** — the `InvokeAgent` parent becomes a hollow span. `EnableSensitiveData = true` includes prompts/completions in span attributes (PII consideration — set to `false` for regulated data).
   - **S2S path**: First **Write** the two scaffold files from the reference doc — `Observability/ObservabilityServiceExtensions.cs` (DI extension with `AddAgent365Observability()` using `ServiceTokenCache` and conditional `ObservabilityTokenService`) and `Observability/ObservabilityTokenService.cs` (background service that acquires the Observability API token via the MSAL FMI 3-hop chain with `.WithFmiPath()` targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback). Then call `builder.Services.AddAgent365Observability();` and `builder.UseMicrosoftOpenTelemetry(...)` with token resolver reading from the `ServiceTokenCache`. **Critical:** Set `o.Agent365.Exporter.UseS2SEndpoint = true` in the options callback — without this, the exporter posts to the wrong path (`/observability/` instead of `/observabilityService/`) and gets HTTP 401. See "Known Issues" section.
   - Optionally register `adapter.Use(new BaggageTurnMiddleware())` (OBO path only) to auto-populate baggage on every request
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Node.js

1. **Read** the current entry point (`index.ts`, `app.ts`, or detected file).

2. **Edit** — Add observability initialization following the reference pattern in `nodejs-observability.md`:
   - Import `useMicrosoftOpenTelemetry`, `shutdownMicrosoftOpenTelemetry`, `configureA365Hosting`, and `AgenticTokenCacheInstance` — **all from `@microsoft/opentelemetry`** (single package as of GA 1.0; do NOT import from the legacy `-observability`, `-hosting`, or `-runtime` packages).
   - **OBO / agentic-user path**: Call `useMicrosoftOpenTelemetry({ a365: { enabled: true, enableObservabilityExporter: true, tokenResolver } })` **before** any LLM/framework imports. Both `enabled: true` AND `enableObservabilityExporter: true` are required in 1.0+ to actually export spans. Wire `tokenResolver` to `AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId) ?? ''`.
   - **S2S path**: First **Write** `observability/token-cache.ts` (in-memory token cache with `cacheToken`/`getCachedToken`/`tokenResolver`) and `observability/observability-token-service.ts` using the scaffold pattern from `nodejs-observability.md` (S2S section). This module acquires the Observability API token via MSAL FMI 3-hop chain (`@azure/msal-node` with `fmiPath` parameter, targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback) and refreshes it every 50 min. Then call `useMicrosoftOpenTelemetry({ a365: { enabled: true, enableObservabilityExporter: true, useS2SEndpoint: true, tokenResolver: a365TokenResolver } })`. `useS2SEndpoint: true` is now a first-class option (1.0+); the old workaround with custom `Agent365Exporter` via `spanProcessors` and `ENABLE_A365_OBSERVABILITY_EXPORTER=false` is no longer needed for new instrumentation. If the old workaround is already present in an existing agent, leave it in place — do not delete code as part of this additive skill; flag it in the final summary as a candidate for cleanup if the user explicitly asks to migrate.
   - **Both paths**: Call `configureA365Hosting(adapter, { enableBaggage: true })` once at startup to register `BaggageMiddleware`. This replaces manual `adapter.use(new BaggageMiddleware())` and removes the need for `BaggageBuilderUtils.fromTurnContext` in handlers.
   - **Both paths**: Register `SIGTERM`/`SIGINT` handlers calling `await shutdownMicrosoftOpenTelemetry()` to flush pending spans on shutdown.
   - **Auto-instrumentation note**: Do NOT call `OpenAIAgentsTraceInstrumentor.enable()` or `LangChainTraceInstrumentor.instrument()` — these are auto-enabled in 1.0+ and manual calls cause duplicate spans. To opt out, set `instrumentationOptions: { openaiAgents: { enabled: false } }`.
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Python

1. **Read** the current entry point (`app.py`, `host_agent_server.py`, or detected file).

2. **Edit** — Add observability configuration following the reference pattern in `python-observability.md`:
   - Import `use_microsoft_opentelemetry` from `microsoft.opentelemetry` (single unified package; do NOT import from the legacy `microsoft_agents_a365.*` namespace).
   - **OBO / agentic-user path**: Call `use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_token_resolver=...)`. Both `enable_a365=True` AND `a365_enable_observability_exporter=True` are required in 1.0+ to actually export spans. Wire `a365_token_resolver` to `AgenticTokenCache().get_observability_token` from `microsoft.opentelemetry.a365.hosting.token_cache_helpers` (or a custom resolver reading from `token_cache.py`).
   - **S2S path**: First **Write** `observability/token_cache.py` (in-memory token cache with `cache_token`/`get_cached_token`) and `observability/observability_token_service.py` using the scaffold pattern from `python-observability.md` (S2S section). This module acquires the Observability API token via a 3-hop FMI chain: direct HTTP POST with `fmi_path` for Hops 1+2 (MSAL Python does not properly serialize `fmi_path` — known limitation), then `msal.ConfidentialClientApplication` for Hop 3, targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback, refreshes every 50 min via an `asyncio` background task. Then call `use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=...)`. `a365_use_s2s_endpoint=True` is now a first-class kwarg — no workaround needed. Schedule `run_token_service()` as an asyncio task and call `acquire_initial_token()` in your aiohttp lifespan startup. Also install `msal`, `azure-identity`, and `httpx`.
   - **Both paths**: Call `ObservabilityHostingManager.configure(adapter.middleware_set, ObservabilityHostingOptions(enable_baggage=True))` once at startup to auto-populate baggage from `TurnContext`. **Note:** `enable_baggage` defaults to `False` — must be explicitly set to `True`.
   - **Auto-instrumentation note**: Do NOT call legacy `*Instrumentor().instrument()` methods for LangChain/OpenAI/SK/AgentFramework — these are auto-enabled in 1.0+ and manual calls cause duplicate spans.
   - Mark all new lines with: `# A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

4. **TaskUpdate** — Mark complete.

---

## Phase 4: Add BaggageBuilder Context to Message Handler

**TaskCreate** — "Add BaggageBuilder context to message handler"

> **Skip this phase** if BaggageMiddleware was registered in Phase 3 — the middleware handles
> baggage propagation automatically for every request.

> **Auth mode note:** All three `authMode` values use `authHandlerName: "AGENTIC"` in the
> code — the token exchange call is identical. The identity in traces is determined by Azure AD
> provisioning and the incoming token. Add an inline comment indicating which mode was chosen.

### For .NET AgentFramework

1. **Read** the detected message handler file.

2. **Edit** — Follow the reference pattern in `dotnet-observability.md` (full code sample under "Agent Class — Message Handler (OBO Path)"):

   **OBO path** (`obo` / `agentic-user`) — applies to both **AI Teammate** agents and **Standard .NET agents**:
   - Inject `IExporterTokenCache<AgenticTokenStruct>` in the constructor (auto-registered by the distro — no `AddAgenticTracingExporter()` call needed).
   - Inject `IConfiguration` (for blueprint/observability config) and `ILogger<MyAgent>`.
   - **Resolve agent ID for BOTH auth paths** — agentic instance ID from the Activity for agentic turns, **decoded from the OBO token** via `Utility.ResolveAgentIdentity` for non-agentic turns. Do NOT fall back to `Guid.Empty.ToString()` — that creates a synthetic identity the exporter cannot authenticate, polluting traces with `"No token obtained. Skipping export for this identity."` warnings.
     ```csharp
     string? resolvedAgentId = null;
     if (turnContext.Activity.IsAgenticRequest())
     {
         resolvedAgentId = turnContext.Activity.GetAgenticInstanceId();
     }
     else if (!string.IsNullOrEmpty(authHandlerName))
     {
         try
         {
             var oboToken = await UserAuthorization
                 .GetTurnTokenAsync(turnContext, authHandlerName, cancellationToken: cancellationToken)
                 .ConfigureAwait(false);
             if (!string.IsNullOrEmpty(oboToken))
             {
                 resolvedAgentId = Utility.ResolveAgentIdentity(turnContext, oboToken);
             }
         }
         catch (Exception ex)
         {
             _logger.LogDebug(ex, "Could not resolve agent id from OBO token; A365 observability skipped for this turn.");
         }
     }

     var resolvedTenantId = turnContext.Activity.Conversation?.TenantId
                         ?? turnContext.Activity.Recipient?.TenantId;

     var hasObservabilityIdentity = !string.IsNullOrEmpty(resolvedAgentId)
                                 && !string.IsNullOrEmpty(resolvedTenantId);
     ```
     `GetAgenticInstanceId()` returns the agent's **service principal object ID** (the instance ID assigned by A365 for the Teams agentic identity). `Utility.ResolveAgentIdentity(turnContext, token)` decodes the agent identity from a JWT OBO token. Both paths produce the same kind of ID — what shows up in MAC Advanced Hunting.
   - **Conditional baggage + token registration** — only when `hasObservabilityIdentity == true`. Skip both calls cleanly when the identity can't be resolved:
     ```csharp
     using IDisposable? baggageScope = hasObservabilityIdentity
         ? new BaggageBuilder()
             .TenantId(resolvedTenantId!)
             .AgentId(resolvedAgentId!)
             .Build()
         : null;

     if (hasObservabilityIdentity)
     {
         try
         {
             _agentTokenCache.RegisterObservability(
                 resolvedAgentId!,
                 resolvedTenantId!,
                 new AgenticTokenStruct(
                     userAuthorization: UserAuthorization,
                     turnContext: turnContext,
                     authHandlerName: authHandlerName ?? string.Empty),
                 EnvironmentUtils.GetObservabilityAuthenticationScope());
         }
         catch (Exception ex)
         {
             _logger.LogWarning(ex, "Failed to register observability token.");
         }
     }
     ```
     Note: Some SDK versions support object-initializer syntax instead. If the constructor form fails to compile, try property-initializer: `new AgenticTokenStruct { UserAuthorization = ..., TurnContext = ..., AuthHandlerName = ... }`.
   - The `authHandlerName` should resolve to the agentic auth handler name (from config `AgentApplication:AgenticAuthHandlerName`) when `IsAgenticRequest()` is true, OBO handler name (from `AgentApplication:OboAuthHandlerName`) otherwise.
   - **Keep the `Agent365Observability` section in `appsettings.json`** (`EnableAgent365Exporter` and base exporter settings are still required — Phase 6 handles these). For **OBO**, you do **not** need to hardcode per-agent IDs, tenant IDs, or S2S credentials in that section — the agent ID and tenant ID are resolved from the request at runtime on each turn.
   - **The inline pattern shown above is preferred** for new code (mirrors PR #308 in `microsoft/Agent365-Samples`). The older `A365OtelWrapper.InvokeObservedAgentOperation(...)` static-wrapper pattern at `Agent365-samples/dotnet/agent-framework/sample-agent/telemetry/A365OtelWrapper.cs` is functionally equivalent but uses a separate helper class.

   **S2S path**:
   - Inject `Agent365ObservabilityContext` (singleton registered by `AddAgent365Observability()`) in the constructor — **not** `IExporterTokenCache<AgenticTokenStruct>`
   - **Baggage:** Use `new BaggageBuilder().FromTurnContext(turnContext).Build()` as a separate `using var baggageScope` — `FromTurnContext()` is an extension on `BaggageBuilder` **only**; it does not exist on `InvokeAgentScope` or any scope type
   - **Scope:** Use `InvokeAgentScope.Start(new Request(...), new InvokeAgentScopeDetails(endpoint: new Uri("...")), _obs.AgentDetails, callerDetails)` as a separate `using var scope` — `InvokeAgentScopeDetails` has **no parameterless constructor**; always pass at least `endpoint`. `CallerDetails` with the blueprint sponsor's identity is **required** for S2S traces to appear in the portal
   - **No** per-turn `RegisterObservability()` call; **no** `.FromTurnContext()` chaining on the scope
   - Add inline comment: `// A365 auth mode: S2S — FMI 3-hop chain via ObservabilityTokenService (scope: api://9b975845-388f-4429-889e-eab1ef63949c/.default)`

   Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Node.js

1. **Read** the detected message handler file.

2. **Edit** — Refresh the per-turn exporter token following the reference pattern in `nodejs-observability.md`:
   - Import `AgenticTokenCacheInstance` from `@microsoft/opentelemetry` (single unified package).
   - **OBO paths only** (`obo` / `agentic-user`): Resolve `agentId` and `tenantId` dynamically from TurnContext each turn (never from config), then refresh the exporter token (non-fatal, wrap in try/catch):
     ```
     const agentId  = turnContext.activity?.recipient?.agenticAppId ?? '';
     const tenantId = turnContext.activity?.recipient?.tenantId     ?? '';
     await AgenticTokenCacheInstance.RefreshObservabilityToken(
       agentId, tenantId, turnContext,
       agentApplication.authorization,   // ← the AgentApplication auth object, NOT an auth-handler name string
     );
     ```
     - `obo` (signed-in user): `agentApplication.authorization` exchanges the token as the **signed-in user** → traces attributed to the user
     - `obo` (agentic identity): `agentApplication.authorization` exchanges the token as the **agentic user** provisioned in Azure AD → traces attributed to the agent
     - Default observability scope is auto-applied (`api://9b975845-388f-4429-889e-eab1ef63949c/.default`) — no need to import `getObservabilityAuthenticationScope` (removed in 1.0).
     - **Recommended pattern:** Extract the agentId/tenantId resolution and token refresh into a `preloadObservabilityToken(turnContext)` helper function to keep the handler clean. See `nodejs-observability.md` for the full helper implementation.
   - **S2S path**: Do **NOT** call `AgenticTokenCacheInstance.RefreshObservabilityToken` — there is no user authorization token. The `tokenResolver` passed to `useMicrosoftOpenTelemetry()` (set up in Phase 3) handles authentication via the FMI 3-hop chain token service.
   - **Baggage:** No manual baggage construction in the handler. Phase 3 registered `configureA365Hosting(adapter, { enableBaggage: true })` which auto-populates baggage from `TurnContext` for every request. The old `BaggageBuilderUtils.fromTurnContext(...)` pattern is no longer in the public API (removed in 1.0) — do NOT add it back.
   - Add inline comment: `// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow`
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Python

1. **Read** the detected message handler file.

2. **Edit** — Refresh the per-turn exporter token following the reference pattern in `python-observability.md`:
   - Default observability scope is auto-applied by `microsoft-opentelemetry` 1.1+ — do **not** import `get_observability_authentication_scope` unless you need to override the default. If overriding, pass via `a365_observability_scope_override` to `use_microsoft_opentelemetry`. The `exchange_token()` call below omits `scopes=` and lets the auth handler resolve the default.
   - Import `cache_agentic_token` from `token_cache` (the custom module created in Phase 5) — or use `AgenticTokenCache` from the hosting helpers.
   - **OBO paths only** (`obo` / `agentic-user`): Resolve `agent_id` and `tenant_id` dynamically from context each turn (never from config), then exchange the OBO token (non-fatal, wrap in try/except):
     ```python
     agent_id  = context.activity.recipient.agentic_app_id
     tenant_id = context.activity.recipient.tenant_id
     await self._setup_observability_token(context, tenant_id, agent_id)
     ```
     The `_setup_observability_token` helper exchanges and caches the token:
     ```python
     async def _setup_observability_token(self, context, tenant_id, agent_id):
         exaau_token = await self.agent_app.auth.exchange_token(
             context,
             scopes=get_observability_authentication_scope(),
             auth_handler_id=self.auth_handler_name  # from config — NOT hardcoded "AGENTIC"
         )
         cache_agentic_token(tenant_id, agent_id, exaau_token.token)
     ```
     - `auth_handler_name` must come from config (e.g., `AgentApplication:AgenticAuthHandlerName`) — **never hardcode `"AGENTIC"`**; it is the registered auth handler name in your agent setup.
     - `agentic-user` (AI Teammate): the exchange returns a token for the **agent's own Agentic User** identity → traces attribute to the agent
     - `obo` (non-AI Teammate): the exchange returns whatever the configured auth handler resolves — typically the **signed-in user**, but it can also be the agent's own identity if the handler is configured that way
   - **S2S path**: Do **NOT** call `_setup_observability_token` — token comes from the background token service wired in Phase 3. The handler should NOT touch tokens.
   - **Baggage:** No manual baggage construction in the handler. Phase 3 registered `ObservabilityHostingManager.configure(adapter.middleware_set, ObservabilityHostingOptions(enable_baggage=True))` which auto-populates baggage from `TurnContext` for every request. (Optional fallback if you skipped that: build manually with `populate(builder, context)` then `with builder.build():`.)
   - Add inline comment: `# A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow`
   - Mark all new lines with: `# A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

4. **TaskUpdate** — Mark complete.

---

## Phase 5: Implement Agentic Token Resolver

**TaskCreate** — "Implement agentic token resolver with caching"

For AI Teammate agents and Standard agents on the OBO/agentic-user path, the built-in token cache handles caching automatically — no custom resolver needed. With the **`Microsoft.OpenTelemetry` distro** the cache is auto-registered by `UseMicrosoftOpenTelemetry(...)` (Phase 3). With the **legacy individual packages** it's registered explicitly via `AddAgenticTracingExporter` (.NET), `AgenticTokenCacheInstance` (Node.js), or `AgenticTokenCache` (Python). Skip to step 3 for these agents.

### For .NET AgentFramework (hosting path)

1. The distro's `builder.UseMicrosoftOpenTelemetry(...)` call (Phase 3) **auto-registers `IExporterTokenCache<AgenticTokenStruct>`** in DI — no separate `AddAgenticTracingExporter()` call is needed. If you're on the legacy two-package wiring, `AddAgenticTracingExporter()` provides the same DI instance.

2. In the agent class, inject `IExporterTokenCache<AgenticTokenStruct>` in the constructor and call `RegisterObservability(...)` per turn (already done in Phase 4).

### For .NET AgentFramework (S2S path)

The `ObservabilityTokenService` background service (created in Phase 3 via the scaffold) acquires and refreshes the Observability API token automatically via the FMI 3-hop chain (Blueprint → Agent Identity → Power Platform PFAT token) — no manual `TokenResolver` delegate needed.

1. **Check** if `Observability/ObservabilityServiceExtensions.cs` and `Observability/ObservabilityTokenService.cs` exist. If yes, **skip** — they were already created in Phase 3.

2. **If absent** (Phase 3 was skipped or re-running the skill on a partial state), create them now following the S2S scaffold patterns in `dotnet-observability.md`. These files provide `AddAgent365Observability()` (DI extension registering `AddServiceTracingExporter`, `ObservabilityTokenService`, and `Agent365ObservabilityContext`) and `ObservabilityTokenService` (background service that acquires the Observability API token via the FMI 3-hop chain and refreshes it every 50 minutes).

### For Node.js (OBO path)

`AgenticTokenCacheInstance` from `@microsoft/agents-a365-observability-hosting` handles caching automatically. The `useMicrosoftOpenTelemetry()` call in Phase 3 wires it as the `tokenResolver`. No additional token resolver module is needed unless `Use_Custom_Resolver=true` is required (see reference doc for custom resolver pattern).

### For Node.js (S2S path)

**Check** if `observability/observability-token-service.ts` exists. If yes, **skip** — it was created in Phase 3.

**If absent** (Phase 3 was skipped or re-running), create `observability/token-cache.ts` and `observability/observability-token-service.ts` now using the scaffold from `nodejs-observability.md` (S2S section). The token service uses MSAL (`@azure/msal-node`) with `fmiPath` to acquire tokens via the FMI 3-hop chain targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. Call `startTokenService(config)` at app startup and pass `tokenResolver` from the cache module to `useMicrosoftOpenTelemetry()`.

### For Python (OBO path)

The `token_cache.py` custom module (located at project root or `observability/token_cache.py`) provides `cache_agentic_token` and `get_cached_agentic_token`. The `a365_token_resolver` in `use_microsoft_opentelemetry()` (Phase 3) is wired to `get_cached_agentic_token`. The per-turn `_setup_observability_token` helper (Phase 4) calls `cache_agentic_token` after each OBO exchange. If `token_cache.py` is absent (e.g., this phase is reached before Phase 4 ran), create it now following the OBO token cache pattern in `python-observability.md`.

### For Python (S2S path)

**Check** if `observability/observability_token_service.py` exists. If yes, **skip** — it was created in Phase 3.

**If absent**, create `observability/token_cache.py` and `observability/observability_token_service.py` now using the scaffold from `python-observability.md` (S2S section). The token service uses MSAL (`msal.ConfidentialClientApplication`) with `fmi_path` to acquire tokens via the FMI 3-hop chain targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. Call `acquire_initial_token()` for pre-warm, schedule `run_token_service()` as `asyncio.create_task()`, and pass `token_cache.get_cached_token` as the `a365_token_resolver` in `use_microsoft_opentelemetry()`.

**TaskUpdate** — Mark complete.

---

## Phase 5.5: Wire Manual Instrumentation Scopes

**TaskCreate** — "Wire InvokeAgentScope, InferenceScope, ExecuteToolScope"

> **Auto-instrumentation vs manual:** Whether manual scopes are needed depends on `authMode` and
> whether auto-instrumentation framework extensions were installed in Phase 2.
>
> | Situation | InvokeAgentScope | InferenceScope | ExecuteToolScope |
> |---|---|---|---|
> | `authMode = "s2s"` | Required — add always | Required — add always | Required — add always |
> | OBO + framework extension installed (Phase 2) | Required — add always | **Skip** — auto-instrumentation generates these | Only for local/custom tools not covered by the extension |
> | OBO + no framework extension | Required — add always | Required — add always | Required — add always |
>
> "Autonomous" agents can run on either OBO or S2S — auth mode is the actual differentiator here, not whether the agent is autonomous.
>
> **Rule:** Never skip `InvokeAgentScope` — it wraps the turn and is always required for traces to
> appear in the MAC portal. Auto-instrumentation extensions cover LLM calls (`InferenceScope`) and
> framework-managed tool calls (`ExecuteToolScope`), but they do not wrap the agent turn itself.

**Determine which scopes to add:**

- If `authMode = "s2s"`: proceed directly — add all three scopes without prompting (required for S2S agents).
- If OBO and a framework extension **was** installed in Phase 2:
  - Add `InvokeAgentScope` always.
  - **Skip `InferenceScope`** — the framework extension instruments LLM calls automatically.
  - Ask: *"Does your agent make any local or custom tool calls that are **not** routed through the framework? If yes, I'll add `ExecuteToolScope` wrappers for those."* Add `ExecuteToolScope` only if the user confirms custom tool calls exist.
- If OBO and **no** framework extension was installed in Phase 2:
  - Ask: *"Do you want to add InvokeAgentScope, InferenceScope, and ExecuteToolScope wrappers? These are required for store publishing."*
  - Add all three if the user confirms.

> **Store publishing:** The Agent 365 store validator requires `InvokeAgentScope`, `InferenceScope`,
> and `ExecuteToolScope` to be present. For OBO agents with framework extensions, the extension
> satisfies `InferenceScope` and framework-managed `ExecuteToolScope` automatically.

### For .NET AgentFramework

Follow the reference patterns in `dotnet-observability.md` for each scope being added:
- **`InvokeAgentScope`** — wrap the top-level message handler to capture agent invocation telemetry. **Gate the scope on `hasObservabilityIdentity`** (see Phase 4) so it's only opened when a real (agent, tenant) tuple is available; otherwise the scope groups spans under a synthetic identity the exporter cannot authenticate.
- **`InferenceScope`** — wrap each LLM call to capture model, token counts, finish reasons *(skip if framework extension installed)*
- **`ExecuteToolScope`** — wrap each local/custom tool call *(skip if framework extension covers all tool calls)*
- **`OutputScope`** — use for async response scenarios where output isn't captured synchronously
- `CallerDetails` must be passed to `InvokeAgentScope.Start()` as the 4th parameter — **required** for traces to appear in the MAC portal. For OBO/agentic-user, build it from `turnContext.Activity.From` (AadObjectId/Name). For S2S, read sponsor details from config (`Agent365Observability:Sponsor` section) and construct `CallerDetails` with `UserDetails(userId, userName, userEmail)`.
- **Safe `InvokeAgentScopeDetails.endpoint` URI**: build the endpoint from `Agent365Observability:AgentBlueprintId` (a GUID — always URI-safe) under the RFC 2606 reserved `.invalid` TLD. Do NOT slugify the free-form display name — characters like apostrophes, `&`, parentheses, or slashes throw `UriFormatException` at runtime:
  ```csharp
  var blueprintForUri = obsConfig["AgentBlueprintId"];
  var endpointUri = !string.IsNullOrEmpty(blueprintForUri)
      ? new Uri($"https://{blueprintForUri}.agent.invalid/")
      : new Uri("https://agent.invalid/");
  ```
- **Set `ChatClientAgentOptions.Id` to match `resolvedAgentId`** when constructing the `ChatClientAgent` for each turn. Without this, the AI SDK auto-generates a fresh N-format GUID (32 hex chars, no dashes) per turn, producing orphan identity groups the exporter cannot authenticate (logs show `"Obtained token for agent <random32hex> tenant ..."` followed by `"No token obtained. Skipping export for this identity."`). Pattern:
  ```csharp
  var options = new ChatClientAgentOptions
  {
      Name = obsConfig["AgentName"] ?? "Agent",
      ChatOptions = toolOptions,
      ChatHistoryProvider = ...,
  };
  if (!string.IsNullOrEmpty(resolvedAgentId))
  {
      options.Id = resolvedAgentId;
  }
  ```
- Pass `UserDetails` directly (not wrapped in `CallerDetails`) to `InferenceScope.Start()` and `ExecuteToolScope.Start()` as the optional 4th parameter
- The `Agent365ObservabilityContext` singleton (S2S path) should hold both `AgentDetails` and `CallerDetails` properties

### For Node.js

Follow the reference patterns in `nodejs-observability.md` for each scope being added:
- **`InvokeAgentScope`** — wrap the top-level message handler. Use `ScopeUtils.populateInvokeAgentScopeFromTurnContext` from `@microsoft/agents-a365-observability-hosting` to auto-populate from TurnContext
- **`InferenceScope`** — wrap each LLM call *(skip if framework extension installed)*
- **`ExecuteToolScope`** — wrap each local/custom tool call *(skip if framework extension covers all tool calls)*
- **`OutputScope`** — for async scenarios
- `CallerDetails` must be passed to `InvokeAgentScope.start()` as the 4th parameter — **required** for traces to appear in the MAC portal
- For S2S agents, read sponsor details from env vars (`agent365Observability__sponsorUserId`, `agent365Observability__sponsorUserName`, `agent365Observability__sponsorUserEmail`) and construct the `CallerDetails` object
- Pass `UserDetails` directly to `InferenceScope.start()` and `ExecuteToolScope.start()` as the optional 4th parameter
- Export `callerDetails` (for `InvokeAgentScope`) and `userDetails` (for `InferenceScope`/`ExecuteToolScope`) from the entry point module alongside `agentDetails`

### For Python

Follow the reference patterns in `python-observability.md` for each scope being added:
- **`InvokeAgentScope`** — wrap the top-level message handler as a context manager
- **`InferenceScope`** — wrap each LLM call *(skip if framework extension installed)*
- **`ExecuteToolScope`** — wrap each local/custom tool call *(skip if framework extension covers all tool calls)*
- **`OutputScope`** — for async response scenarios
- `CallerDetails` / `UserDetails` must be supplied when creating the top-level `InvokeAgentScope` — **required** for traces to appear in the MAC portal
- For S2S agents, read sponsor details from config or environment and construct `CallerDetails(UserDetails(userId, userName, userEmail))`
- Pass `UserDetails` directly to `InferenceScope`, `ExecuteToolScope`, and `OutputScope` when their optional user parameter is available
- Keep shared observability state with both `agent_details` and `caller_details` / `user_details` so nested scopes can reuse them consistently

All new lines marked with the language-appropriate comment:
- C# / JavaScript / TypeScript: `// A365 Observability — best-effort instrumentation (verify against official sample)`
- Python: `# A365 Observability — best-effort instrumentation (verify against official sample)`

**TaskUpdate** — Mark complete.

---

## Phase 6: Update Configuration Files

**TaskCreate** — "Update configuration files with observability settings"

**Read** the language-appropriate reference for the complete config block:

- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md` → "appsettings.json"
- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md` → ".env"
- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/python-observability.md` → ".env"

Apply these invariants across all three languages:

1. **Preserve existing values.** If `Agent365Observability` (.NET) or
   `ENABLE_A365_OBSERVABILITY_EXPORTER` (Node.js / Python) already exists, do not
   overwrite. Add only missing keys.

2. **.NET — exactly one `Logging` section.** Read `appsettings.json` fully
   before writing. If `Logging` or `Logging.LogLevel` exists, **merge** the new
   log-level keys (`Microsoft.Agents.A365.Observability: Debug`,
   `OpenTelemetry: Debug`) into that block. A second `Logging` block produces
   silently invalid config where only the last one wins.

3. **.NET — `EnableAgent365Exporter: true` at the root.** `a365 setup` may write
   `false`; this skill corrects it. Add an `appsettings.Development.json` with
   `"EnableAgent365Exporter": false` so local dev traces go to console only.

4. **Sponsor / CallerDetails — required for MAC portal trace visibility.**
   - .NET: `Agent365Observability.Sponsor` (UserId, UserName, UserEmail) in `appsettings.json`.
   - Node.js: `agent365Observability__sponsorUserId / __sponsorUserName / __sponsorUserEmail` in `.env`.
   - Python: same keys exposed via the resolver — see python-observability.md.

5. **S2S-only additions:**
   - .NET: add `ClientId`, `ClientSecret`, and `UseManagedIdentity: false` (for
     local dev — MSI fails off-Azure with `CredentialUnavailableError`) under
     `Agent365Observability`.
   - Node.js / Python: `useS2SEndpoint: true` (Node) / `a365_use_s2s_endpoint=True`
     (Python) is set in code in Phase 3 — no env var equivalent in 1.0+. The
     legacy `AGENT365_USE_S2S_ENDPOINT` env var is ignored.

6. **Inform the user** when:
   - `AgentBlueprintId` / `TenantId` are empty → "run `a365 setup` to populate".
   - Exporter is `false` (Node.js / Python local dev) → "instrumented but
     disabled; set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` to start exporting".

If the project also uses `.env.example` (Node.js / Python), update it with
placeholder values to match `.env`.

**TaskUpdate** — Mark complete.

---

## Phase 7: Validate Build

**TaskCreate** — "Validate build passes"

### For .NET AgentFramework

1. **Bash** — Run:
   ```bash
   dotnet build
   ```

2. **If build fails**, collect error output and present to user with suggested fixes.

3. **If build succeeds**, confirm to user.

### For Node.js

1. **Bash** — Run:
   ```bash
   npm install   # Ensure new packages are installed
   npm run build || npm run compile || echo "No build script found — skipping compile check"
   ```

2. **If build fails**, collect error output and present to user with suggested fixes.

3. **If build succeeds** (or no build script exists), confirm to user.

### For Python

1. **Bash** — Run an import check to verify the package loads without errors:
   ```bash
   python3 -c "from microsoft.opentelemetry import use_microsoft_opentelemetry; from microsoft.opentelemetry.a365.hosting import ObservabilityHostingManager; print('A365 observability imports OK')" 2>/dev/null || python -c "from microsoft.opentelemetry import use_microsoft_opentelemetry; from microsoft.opentelemetry.a365.hosting import ObservabilityHostingManager; print('A365 observability imports OK')"
   ```

2. **If import fails**, collect error output and present to user with suggested fixes (usually a missing `pip install`).

3. **If import succeeds**, confirm to user.

4. **TaskUpdate** — Mark complete.

---

## Phase 8: Test Locally

**TaskCreate** — "Test locally"

Ask the user:

```
AskUserQuestion:
  question: "Build succeeded. Want to run a quick local test now?"
  options:
    - "Yes — run the test-local skill"
    - "No — I'll test later"
```

If yes, invoke the `test-local` skill.

**TaskUpdate** — Mark complete.

---

## Phase 9: Final Summary

1. **TaskList** — Show all completed tasks.

2. **Present summary** to user:
   ```
   ✅ A365 observability instrumented successfully!

   **Agent type:** [.NET AgentFramework | Node.js | Python]
   **Agent kind:** [AI Teammate | Agent (Non AI Teammate)]
   **Auth mode:** [Access data as signed-in user | Its own persistent identity | Runs autonomously]
   **Packages installed:** [list packages]
   **Files modified:** [list files]

   **Next steps:**
   1. Enable exporting when ready for production:
      - .NET: set EnableAgent365Exporter: true in appsettings.json
      - Node.js / Python: set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env
   2. Run your agent and verify traces appear in the Observability dashboard.
   3. [If authMode = obo] Confirm the OBO token exchange is working correctly.
      - Signed-in user sub-type: verify the signed-in user's token is passed correctly.
        → OBO flow docs: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
      - Agentic identity sub-type: ensure the agentic user identity has been provisioned in Azure AD.
        → Identity docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/identity
   4. [If authMode = agentic-user] Confirm the agentic-user M365 license and identity are provisioned.
      → Identity docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/identity
   5. [If authMode = s2s] No user token required — verify agent blueprint credentials are configured.
      → Auth flow docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/authentication-flow

   All instrumented lines are marked with:
   // A365 Observability — best-effort instrumentation (verify against official sample)
   ```

3. **Remind user** to:
   - Review the instrumented code against the official A365 samples
   - Update configuration with real endpoint values
   - Test the agent in a live environment

---

## Error Handling

### Unknown Agent Type
If the agent type cannot be determined:
- Write marker: `.a365setup-unknown-agent`
- Exit early with message: "Could not detect agent type. Please verify this is a .NET AgentFramework, Node.js, or Python agent project."

### Build Failures
If the build fails after instrumentation:
- Do NOT revert changes
- Present error output to user
- Suggest fixes based on error messages
- Offer to help debug

### Missing Files
If expected files are not found:
- Ask user to confirm the project structure
- Suggest running detection again
- Offer to create missing files if appropriate

---

## Idempotency

This skill is safe to rerun. On subsequent runs:
- Skip package installation if packages already present
- Skip code edits if observability is already wired (detect by marker comments)
- Update configuration only if values are missing
- Always revalidate the build

---

## S2S Known Issues and Workarounds

### OtelWrite App Role Assignment

`a365 setup all` **automatically grants** `Agent365.Observability.OtelWrite` to the Agent Identity SP (both delegated and application) for all newly provisioned agents. No Global Administrator is required for agents set up with this CLI version.

**Upgrade path — agents provisioned before this CLI release:** OtelWrite must be granted manually. A Global Administrator must do one of the following:

Option A — Entra portal:
1. [Entra portal](https://entra.microsoft.com) > App registrations > select Blueprint app > API permissions
2. Add a permission > APIs my organization uses > search `9b975845-388f-4429-889e-eab1ef63949c`
3. Add both **Delegated** and **Application** `Agent365.Observability.OtelWrite` > Grant admin consent

Option B — Graph API (read `agentIdentityClientId` from `a365.generated.config.json`):

```bash
# Create a temp JSON body file (required on Windows due to az rest escaping)
echo '{"principalId":"<agentIdentitySPObjectId>","resourceId":"2a275186-1775-4439-8551-5438df22cdfc","appRoleId":"8f71190c-00c8-461d-a63b-f74abde9ba52"}' > body.json
az rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/<agentIdentitySPObjectId>/appRoleAssignments" --body @body.json
rm body.json
```

- `resourceId` `2a275186-...` is the Observability API SP object ID
- `appRoleId` `8f71190c-...` is the OtelWrite role ID
- For agents provisioned before CLI 1.1, this manual step is still required

### Node.js and .NET SDK `/otlp/` URL Path Bug

The Node.js SDK (`@microsoft/agents-a365-observability@0.2.0-preview.5`) and .NET SDK (`0.3.4-beta`) include `/otlp/` in the S2S export URL path. The Power Platform PFAT gateway returns `401 MSAuth10AuthenticatorTypeUnknown` on this path. Python SDK `0.1.0` does NOT include `/otlp/` and works correctly.

**Status:** Awaiting SDK fix. No workaround should be applied in generated code — this is an SDK-level issue.

### S2S Endpoint Path — `useS2SEndpoint` Not Passed by Distro

The `@microsoft/opentelemetry` distro creates `Agent365Exporter` internally but does NOT pass `useS2SEndpoint: true`. For S2S agents, the exporter defaults to the OBO path (`/observability/tenants/{tenantId}/otlp/agents/{agentId}/traces`), but S2S requires `/observabilityService/...`.

**Node.js (`@microsoft/opentelemetry` 1.0+ GA — FIXED):**

`useS2SEndpoint` is now a first-class option in the `a365` options. Generated S2S agent code should pass it directly:
```typescript
useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
    useS2SEndpoint: true,   // first-class option in 1.0+
    tokenResolver: a365TokenResolver,
  },
});
```
The old `AGENT365_USE_S2S_ENDPOINT` env var workaround and custom `spanProcessors` workarounds are no longer needed.

**.NET (`Microsoft.OpenTelemetry` 1.0.x GA):**

The `UseMicrosoftOpenTelemetry()` builder extension does NOT set `UseS2SEndpoint = true` on the `Agent365ExporterOptions` when using the unified distro. Without this, the exporter posts to `/observability/` (OBO path) instead of `/observabilityService/` (S2S path), causing HTTP 401.

**Fix:** Set `UseS2SEndpoint = true` explicitly in the `UseMicrosoftOpenTelemetry` options callback:
```csharp
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Exporters = ExportTarget.Agent365 | ExportTarget.Console;
    o.Agent365.Exporter.UseS2SEndpoint = true;  // ← Required for S2S agents
    o.Agent365.Exporter.TokenResolver = async (agentId, tenantId) =>
    {
        return tokenCache != null
            ? await tokenCache.GetObservabilityToken(agentId, tenantId)
            : null;
    };
});
```

**URL paths:**
- OBO: `observability/tenants/{tenantId}/otlp/agents/{agentId}/traces`
- S2S: `observabilityService/tenants/{tenantId}/otlp/agents/{agentId}/traces`

### Node.js MSAL `fmiPath` Not Supported (AADSTS82008)

No published version of `@azure/msal-node` (v3.x or v5.x) serializes the `fmiPath` parameter to the token endpoint request body. Passing `fmiPath` in `acquireTokenByClientCredential()` options (even with `as any`) is silently ignored, resulting in:

```
AADSTS82008: All agentic applications requesting a token exchange token must include the fmipath parameter on the token request.
```

**Workaround (implemented in `nodejs-observability.md`):** For the client-secret local-dev path (`acquireT1ViaClientSecret`), use a direct HTTP POST to `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` with `fmi_path={agentId}` as a URL-encoded form parameter. The MSI path still uses MSAL + `ManagedIdentityCredential` which handles FMI via a different mechanism.

**Status:** Awaiting `@azure/msal-node` to ship native `fmiPath` support. Remove the HTTP workaround once available.

### Node.js LangChain Instrumentor Initialization Order

`LangChainTraceInstrumentor.instrument(LangChainCallbacks)` requires `ObservabilityManager` to be fully initialized. Calling it as a standalone statement after `useMicrosoftOpenTelemetry()` throws `"ObservabilityManager is not configured yet"` when `a365.enabled: true`.

**Workaround:** Use `instrumentationOptions: { langchain: {} }` inside the `useMicrosoftOpenTelemetry()` options object. This ensures the distro initializes the manager and the LangChain instrumentor in the correct order.

### .NET `InferenceCallDetails` Constructor — `providerName` Is Required

The `InferenceCallDetails` constructor signature is `(InferenceOperationType operationName, string model, string providerName, int? inputTokens, int? outputTokens, string[]? finishReasons, string? conversationId)`. The `providerName` parameter is **required** (not optional). Omitting it causes CS7036.

**Correct usage:**
```csharp
new InferenceCallDetails(
    operationName: InferenceOperationType.Chat,
    model: "gpt-5.4",
    providerName: "Azure OpenAI")
```

### .NET `ExecuteToolScope.RecordResponse` Takes `string`, Not `Response`

`ExecuteToolScope.RecordResponse()` accepts a `string` parameter (the tool result), not a `Response` object. Passing `new Response(...)` causes CS1503.

**Correct usage:**
```csharp
toolScope.RecordResponse(resultString);
```

### .NET `appsettings.json` — S2S Configuration Notes

For S2S agents:
- `EnableAgent365Exporter` must be `true` in `appsettings.json` (not `false` — `a365 setup` may write `false` by default)
- `UseManagedIdentity` must be `false` for local development (MSI is only available on Azure infrastructure)
- Both `ClientId` and `ClientSecret` are required under `Agent365Observability` for the FMI 3-hop chain

### CallerDetails Required for MAC Portal Trace Visibility

For S2S agents, `CallerDetails` with `UserDetails` (`userId`, `userName`, `userEmail`) must be passed to `InvokeAgentScope.Start()` / `.start()`. Without `CallerDetails`, exported spans reach the observability API (HTTP 200) but do **not** appear in the Microsoft Admin Center (MAC) portal's Advanced Hunting view.

**Node.js API differences:**
- `InvokeAgentScope.start()` takes `CallerDetails` (wraps `userDetails`) as 4th parameter
- `InferenceScope.start()` and `ExecuteToolScope.start()` take `UserDetails` directly as 4th parameter
- `OutputScope.start()` takes `UserDetails` directly as 4th parameter

**.NET API:**
- `InvokeAgentScope.Start()` takes `CallerDetails` (wraps `UserDetails`) as 4th parameter
- Other scopes do not take `CallerDetails` directly

**Recommendation:** For agents without a real signed-in user (typically S2S, but can apply to OBO scenarios with no UI), use the Blueprint sponsor's identity:
- `UserId` = Blueprint App (Client) ID
- `UserName` = Blueprint display name
- `UserEmail` = Agent sponsor's email address

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **.NET Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
- **Python Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/python-observability.md`

