---
name: instrument-observability
version: 1.6.0
description: >
  Instruments Microsoft Agent 365 observability into existing .NET AgentFramework, Node.js, or
  Python agents. Adds OTel-based tracing, context propagation, A365 exporter, manual
  instrumentation scopes (InvokeAgentScope, InferenceScope, ExecuteToolScope — required for
  store publishing), and updates configuration files. Asks a two-stage question — agent kind
  (AI Teammate or Agent (Non AI Teammate)) and auth mode — to determine
  the correct token path: OBO (user-delegated / agentic-identity / Assistive) or Autonomous S2S
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
        Before ending, verify ALL of the following:
        1. Agent type was correctly detected (.NET AgentFramework, Node.js, or Python).
        2. agentType (ai-teammate/AI Teammate or system-agent/Agent (Non AI Teammate)) and authMode (user-delegated, agentic-identity, or S2S) were determined and authMode is recorded in an inline comment in the message handler.
        3. A365 observability packages were installed (check package.json, .csproj, or pyproject.toml/requirements.txt).
        4. Observability was configured in the entry point (Program.cs, index.js/ts, or app.py).
        5. For OBO path: BaggageBuilder context added to the message handler (or BaggageMiddleware registered); per-turn token refresh (RegisterObservability/.RefreshObservabilityToken/cache_agentic_token) implemented. For S2S path — all languages: no per-turn token refresh call; token comes from the scaffold token-service file started at startup. .NET additionally: baggage set via new BaggageBuilder().FromTurnContext(turnContext).Build() (FromTurnContext is a BaggageBuilder extension ONLY — NOT on InvokeAgentScope); InvokeAgentScope.Start() called separately with InvokeAgentScopeDetails(endpoint: ...) — NOT chained; scaffold files Observability/ObservabilityServiceExtensions.cs and Observability/ObservabilityTokenService.cs exist. Node.js S2S: observability/observability-token-service.ts exists; startTokenService() called before useMicrosoftOpenTelemetry(). Python S2S: observability/observability_token_service.py exists; run_token_service() task created before use_microsoft_opentelemetry().
        6. Agentic token resolver with caching is implemented.
        7. Configuration files (appsettings.json or .env) include observability variables.
        8. Build/compile succeeds (dotnet build, npm run build, or python import check).
        9. All instrumented code is marked with: // A365 Observability — best-effort instrumentation
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 30000
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

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

If `agentType` and `authMode` are already present in the detection cache (from a prior skill run in this session), confirm the values with the user and skip the questions.

Store `agentType` (`ai-teammate` = AI Teammate, or `system-agent` = Agent (Non AI Teammate)) and `authMode`:
- **AI Teammate:** `user-delegated` (OBO as signed-in user) or `agentic-identity` (OBO as agent's own M365 identity)
- **Agent (Non AI Teammate):** `agentic-identity` (Assistive OBO) or `S2S` (Autonomous / Service Principal)

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

### For .NET AgentFramework

1. **Bash** — Run package installation (core + hosting):
   ```bash
   dotnet add package Microsoft.Agents.A365.Observability.Runtime
   dotnet add package Microsoft.Agents.A365.Observability.Hosting
   ```

   **For S2S / autonomous agents using the unified distro** (preferred):
   ```bash
   dotnet add package Microsoft.OpenTelemetry --version 1.0.0-beta.1
   dotnet add package Azure.Identity
   dotnet add package Microsoft.Identity.Client
   # Required: v1.0.0-beta.1 depends on Microsoft.Extensions.Logging v10.0.0
   dotnet add package Microsoft.Extensions.Logging --version "10.0.0-*"
   ```
   > **⚠️ TFM requirement:** If the project targets `net8.0`, upgrade to `net9.0` or later. The `Microsoft.OpenTelemetry` v1.0.0-beta.1 package has a hard dependency on `Microsoft.Extensions.Logging` v10.0.0 which causes a runtime `FileNotFoundException` on `net8.0`. See "Known Issues" section.

2. **Optional auto-instrumentation extensions** — ask the user which AI framework they use.

   **If the user selects `Extensions.OpenAI` — pre-flight check (do this first, as a named step):**
   ```bash
   dotnet list package | grep Azure.AI.OpenAI
   ```
   If the installed version is below `2.7.0-beta.2`, upgrade it **before** installing the extension:
   ```bash
   dotnet add package Azure.AI.OpenAI --version 2.7.0-beta.2
   ```
   Do this proactively — do not wait for a build failure to discover the version conflict.

   Then install the selected extension(s):
   ```bash
   # Semantic Kernel
   dotnet add package Microsoft.Agents.A365.Observability.Extensions.SemanticKernel
   # OpenAI (requires Azure.AI.OpenAI >= 2.7.0-beta.2 — checked above)
   dotnet add package Microsoft.Agents.A365.Observability.Extensions.OpenAI
   # Agent Framework
   dotnet add package Microsoft.Agents.A365.Observability.Extensions.AgentFramework
   ```

3. **Verify** the packages appear in the `.csproj` file.

### For Node.js

1. **Bash** — Run package installation (core + hosting):
   ```bash
   npm install @microsoft/agents-a365-observability
   npm install @microsoft/agents-a365-runtime
   npm install @microsoft/agents-a365-observability-hosting
   ```

2. **Optional auto-instrumentation extensions** — ask the user which AI framework they use.

   **If the user selects `extensions-openai` — pre-flight check (do this first):**
   The extension requires `@openai/agents ^0.7.0` as a peer dependency — this is the **OpenAI Agents SDK**, NOT the `openai` npm package and NOT `@azure/openai`. Check and install the peer dep first:
   ```bash
   npm list @openai/agents
   # If missing or below 0.7.0:
   npm install @openai/agents@^0.7.0
   ```

   Then install the selected extension(s):
   ```bash
   # OpenAI Agents SDK (requires @openai/agents ^0.7.0 — checked above)
   npm install @microsoft/agents-a365-observability-extensions-openai
   # LangChain
   npm install @microsoft/agents-a365-observability-extensions-langchain
   ```

3. **Verify** the packages appear in `package.json`.

### For Python

1. **Version pre-flight (critical — do this first):** The stable PyPI release of `microsoft-agents-a365-observability-core` (v0.1.0) has a **completely different and incompatible API** from what this skill instruments. The correct API is in the 0.3.x prerelease. Check the installed version before proceeding:
   ```bash
   pip3 show microsoft-agents-a365-observability-core 2>/dev/null || pip show microsoft-agents-a365-observability-core 2>/dev/null | grep Version
   ```
   If missing or below `0.3.0.dev1`, install with `--pre`:
   ```bash
   pip3 install --pre microsoft-agents-a365-observability-core 2>/dev/null || pip install --pre microsoft-agents-a365-observability-core
   pip3 install --pre microsoft-agents-a365-observability-hosting 2>/dev/null || pip install --pre microsoft-agents-a365-observability-hosting
   ```

2. **Bash** — Run package installation (core + hosting):
   ```bash
   pip3 install --pre microsoft-agents-a365-observability-core 2>/dev/null || pip install --pre microsoft-agents-a365-observability-core
   pip3 install --pre microsoft-agents-a365-runtime 2>/dev/null || pip install --pre microsoft-agents-a365-runtime
   pip3 install --pre microsoft-agents-a365-observability-hosting 2>/dev/null || pip install --pre microsoft-agents-a365-observability-hosting
   ```

4. **Optional auto-instrumentation extensions** — ask the user which AI framework they use and install accordingly:
   ```bash
   # Semantic Kernel
   pip3 install microsoft-agents-a365-observability-extensions-semantic-kernel 2>/dev/null || pip install microsoft-agents-a365-observability-extensions-semantic-kernel
   # OpenAI Agents SDK
   pip3 install microsoft-agents-a365-observability-extensions-openai 2>/dev/null || pip install microsoft-agents-a365-observability-extensions-openai
   # Agent Framework
   pip3 install microsoft-agents-a365-observability-extensions-agent-framework 2>/dev/null || pip install microsoft-agents-a365-observability-extensions-agent-framework
   # LangChain
   pip3 install microsoft-agents-a365-observability-extensions-langchain 2>/dev/null || pip install microsoft-agents-a365-observability-extensions-langchain
   ```

5. **Update the dependency manifest** — `pip install` does not modify `requirements.txt` or `pyproject.toml` automatically. Explicitly add the installed packages:
   - `requirements.txt` project: append each package name with `>=0.3.0.dev1` version constraint
   - `pyproject.toml` project: add under `[project] dependencies` or run `uv add <package> --prerelease` / `poetry add <package>`

6. **Verify** the packages appear in `requirements.txt` or `pyproject.toml`.

7. **TaskUpdate** — Mark complete.

---

## Phase 3: Wire Observability in Entry Point

**TaskCreate** — "Wire observability in entry point"

> **Pre-existing placeholders:** As of CLI 1.1, `a365 setup all` auto-writes `Agent365Observability` placeholder sections to `appsettings.json` (.NET) or `.env` (Node.js/Python). Before creating config from scratch, **check if placeholders already exist** and fill in values rather than duplicating the section.

### For .NET AgentFramework

1. **Read** the current entry point (`Program.cs` or detected file).

2. **Edit** — Add observability wiring following the reference pattern in `dotnet-observability.md`:
   - Add using directives for the observability namespaces
   - **OBO path** (`user-delegated` or `agentic-identity`): call `builder.Services.AddAgenticTracingExporter(clusterCategory: "production");` then `builder.AddA365Tracing(config => { config.WithAgentFramework(); });` — requires `using Microsoft.Agents.A365.Observability.Extensions.AgentFramework;` and the NuGet package `Microsoft.Agents.A365.Observability.Extensions.AgentFramework`. Also set `"EnableAgent365Exporter": true` in `appsettings.json` to activate the backend exporter (when `false`, traces are only emitted to console).
   - **S2S path**: First **Write** the two scaffold files from the reference doc — `Observability/ObservabilityServiceExtensions.cs` (DI extension with `AddAgent365Observability()` using `ServiceTokenCache` and conditional `ObservabilityTokenService`) and `Observability/ObservabilityTokenService.cs` (background service that acquires the Observability API token via the MSAL FMI 3-hop chain with `.WithFmiPath()` targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback). Then call `builder.Services.AddAgent365Observability();` and `builder.UseMicrosoftOpenTelemetry(...)` with token resolver reading from the `ServiceTokenCache`. **Critical:** Set `o.Agent365.Exporter.UseS2SEndpoint = true` in the options callback — without this, the exporter posts to the wrong path (`/observability/` instead of `/observabilityService/`) and gets HTTP 401. See "Known Issues" section.
   - Optionally register `adapter.Use(new BaggageTurnMiddleware())` (OBO path only) to auto-populate baggage on every request
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Node.js

1. **Read** the current entry point (`index.ts`, `app.ts`, or detected file).

2. **Edit** — Add observability initialization following the reference pattern in `nodejs-observability.md`:
   - Add imports for `ObservabilityManager` from `@microsoft/agents-a365-observability`
   - **OBO path**: Call `useMicrosoftOpenTelemetry({ a365: { enabled: true, tokenResolver } })` from `@microsoft/opentelemetry` **before** any LLM/framework imports. The `tokenResolver` reads from `AgenticTokenCacheInstance`.
   - **S2S path**: First **Write** `observability/token-cache.ts` (in-memory token cache with `cacheToken`/`getCachedToken`/`tokenResolver`) and `observability/observability-token-service.ts` using the scaffold pattern from `nodejs-observability.md` (S2S section). This module acquires the Observability API token via MSAL FMI 3-hop chain (`@azure/msal-node` with `fmiPath` parameter, targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback) and refreshes it every 50 min. Then call `useMicrosoftOpenTelemetry()` with the S2S workaround pattern from `nodejs-observability.md` (custom `Agent365Exporter` + `A365SpanProcessor` via `spanProcessors` when `AGENT365_USE_S2S_ENDPOINT=true`). Set `ENABLE_A365_OBSERVABILITY_EXPORTER=false` in `.env`. Also run `npm install @microsoft/opentelemetry @azure/msal-node @azure/identity @opentelemetry/sdk-trace-base`.
   - Optionally register `adapter.use(new BaggageMiddleware())` (OBO path) to auto-populate baggage on every request
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Python

1. **Read** the current entry point (`app.py`, `host_agent_server.py`, or detected file).

2. **Edit** — Add observability configuration following the reference pattern in `python-observability.md`:
   - Add `from microsoft.opentelemetry.a365.core import use_microsoft_opentelemetry` and call `use_microsoft_opentelemetry(enable_a365=True, a365_token_resolver=...)` with `service_name` and `service_namespace`
   - **OBO path**: Wire `a365_token_resolver` to return the cached agentic token from `token_cache.py`.
   - **S2S path**: First **Write** `observability/token_cache.py` (in-memory token cache with `cache_token`/`get_cached_token`) and `observability/observability_token_service.py` using the scaffold pattern from `python-observability.md` (S2S section). This module acquires the Observability API token via MSAL FMI 3-hop chain (`msal.ConfidentialClientApplication` with `fmi_path` parameter, targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback) and refreshes it every 50 min via an `asyncio` background task. Then call `use_microsoft_opentelemetry(enable_a365=True, a365_token_resolver=...)` from `microsoft.opentelemetry` and schedule `run_token_service()` as an asyncio task. Also install `msal` and `azure-identity` if not already present.
   - Optionally register `BaggageMiddleware` or use `ObservabilityHostingManager` on the adapter (OBO path) to auto-populate baggage on every request
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

2. **Edit** — Follow the reference pattern (see `Agent365-samples/dotnet/agent-framework/sample-agent/telemetry/A365OtelWrapper.cs`):

   **OBO path** (`user-delegated` or `agentic-identity`):
   - Inject `IExporterTokenCache<AgenticTokenStruct>` in the constructor
   - **Resolve agent ID and tenant ID from the agentic request** — add a helper method:
     ```csharp
     private static (string agentId, string tenantId) ResolveTenantAndAgentId(ITurnContext turnContext)
     {
         string agentId = turnContext.Activity.IsAgenticRequest()
             ? turnContext.Activity.GetAgenticInstanceId()
             : Guid.Empty.ToString();

         string tenantId = turnContext.Activity.Conversation?.TenantId
             ?? turnContext.Activity.Recipient?.TenantId
             ?? Guid.Empty.ToString();

         return (agentId, tenantId);
     }
     ```
     `GetAgenticInstanceId()` returns the agent's **service principal object ID** (the instance ID assigned by A365). This is the correct ID for observability export — it maps to the agent in the MAC portal.
   - Use `new BaggageBuilder().TenantId(tenantId).AgentId(agentId).Build()` to set baggage context.
   - Call `RegisterObservability` with all four arguments per turn (wrap in try/catch — non-fatal):
     ```csharp
     _agentTokenCache.RegisterObservability(
         agentId,
         tenantId,
         new AgenticTokenStruct(
             userAuthorization: UserAuthorization,
             turnContext: turnContext,
             authHandlerName: authHandlerName),
         EnvironmentUtils.GetObservabilityAuthenticationScope()
     );
     ```
     Note: Some SDK versions support object-initializer syntax instead. If the constructor form fails to compile, try property-initializer: `new AgenticTokenStruct { UserAuthorization = ..., TurnContext = ..., AuthHandlerName = ... }`.
   - The `authHandlerName` should be the agentic auth handler name (from config `AgentApplication:AgenticAuthHandlerName`) when `IsAgenticRequest()` is true, empty string otherwise.
   - **No `Agent365Observability` config section needed** — all values are resolved from the agentic request at runtime.
   - **Recommended pattern:** Create a reusable static wrapper method (e.g. `A365OtelWrapper.InvokeObservedAgentOperation(...)`) that encapsulates agent ID resolution, baggage building, token registration, and the operation invocation. See the reference sample's `telemetry/A365OtelWrapper.cs`.

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

2. **Edit** — Add BaggageBuilder context following the reference pattern in `nodejs-observability.md`:
   - Import `BaggageBuilder` from `@microsoft/opentelemetry`
   - Import `AgenticTokenCacheInstance`, `BaggageBuilderUtils` from `@microsoft/agents-a365-observability-hosting`
   - Import `getObservabilityAuthenticationScope` from `@microsoft/agents-a365-runtime`
   - **OBO paths only** (`user-delegated` / `agentic-identity`): Resolve `agentId` and `tenantId` dynamically from TurnContext each turn (never from config), then refresh the exporter token (non-fatal, wrap in try/catch):
     ```
     const agentId  = turnContext.activity?.recipient?.agenticAppId ?? '';
     const tenantId = turnContext.activity?.recipient?.tenantId     ?? '';
     await AgenticTokenCacheInstance.RefreshObservabilityToken(
       agentId, tenantId, turnContext,
       agentApplication.authorization,   // ← the AgentApplication auth object, NOT an auth-handler name string
       getObservabilityAuthenticationScope()
     );
     ```
     - `user-delegated`: `agentApplication.authorization` exchanges the token as the **signed-in user** → traces attributed to the user
     - `agentic-identity`: `agentApplication.authorization` exchanges the token as the **agentic user** provisioned in Azure AD → traces attributed to the agent
     - **Recommended pattern:** Extract the agentId/tenantId resolution and token refresh into a `preloadObservabilityToken(turnContext)` helper function to keep the handler clean. See `nodejs-observability.md` for the full helper implementation.
   - **S2S path**: Do **NOT** call `AgenticTokenCacheInstance.RefreshObservabilityToken` — there is no user authorization token. The `tokenResolver` passed to `useMicrosoftOpenTelemetry()` (set up in Phase 3) handles authentication via the FMI 3-hop chain token service.
   - Use `BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), turnContext).build()` to build baggage automatically from TurnContext. **Note:** `fromTurnContext()` is a static method on `BaggageBuilderUtils` — it does **not** exist directly on `BaggageBuilder`; always use `BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), ctx)`.
   - Wrap the handler body in `await baggageScope.run(async () => { ... })` and call `baggageScope.dispose()` in a `finally` block
   - Add inline comment: `// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow`
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Python

1. **Read** the detected message handler file.

2. **Edit** — Add BaggageBuilder context following the reference pattern in `python-observability.md`:
   - Import `BaggageBuilder` from `microsoft.opentelemetry.a365.core`
   - Import `populate` from `microsoft.opentelemetry.a365.hosting.scope_helpers.populate_baggage`
   - Import `cache_agentic_token` from `token_cache` (the custom module created in Phase 5)
   - Import `get_observability_authentication_scope` from `microsoft.opentelemetry.a365.runtime`
   - **OBO paths only** (`user-delegated` / `agentic-identity`): Resolve `agent_id` and `tenant_id` dynamically from context each turn (never from config), then exchange the OBO token (non-fatal, wrap in try/except):
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
     - `user-delegated`: exchange resolves to the **signed-in user's** identity
     - `agentic-identity`: exchange resolves to the **agentic user** provisioned in Azure AD
   - **S2S path**: Do **NOT** call `_setup_observability_token` — token comes from the background token service wired in Phases 3/5. Baggage setup below still applies.
   - Use `populate(builder, context)` to auto-populate baggage (parameter is `context`, not `turn_context`), then `with builder.build():`
   - Wrap existing agent logic inside the baggage scope
   - Add inline comment: `# A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow`
   - Mark all new lines with: `# A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

4. **TaskUpdate** — Mark complete.

---

## Phase 5: Implement Agentic Token Resolver

**TaskCreate** — "Implement agentic token resolver with caching"

For AI Teammate agents using the hosting packages, the built-in token cache (`AddAgenticTracingExporter` for .NET, `AgenticTokenCacheInstance` for Node.js, `AgenticTokenCache` for Python) handles caching automatically — no custom resolver needed. Skip to step 3 for these agents.

### For .NET AgentFramework (hosting path)

1. `AddAgenticTracingExporter()` (registered in Phase 3) provides the `IExporterTokenCache<AgenticTokenStruct>` DI instance — no additional token resolver class needed.

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

**TaskCreate** — "Wire InvokeAgentScope, InferenceScope, ExecuteToolScope (required for store publishing)"

> **Store publishing requirement:** The Agent 365 store validator requires `InvokeAgentScope`,
> `InferenceScope`, and `ExecuteToolScope` to be present and populating telemetry. Missing any one
> of these three scopes causes store validation failure.

Ask the user: "Do you want to add the InvokeAgentScope, InferenceScope, and ExecuteToolScope wrappers now? These are required for store publishing."

If the user confirms (or if this is for store publishing):

### For .NET AgentFramework

Follow the reference patterns in `dotnet-observability.md` for:
- **`InvokeAgentScope`** — wrap the top-level message handler to capture agent invocation telemetry
- **`InferenceScope`** — wrap each LLM call to capture model, token counts, finish reasons
- **`ExecuteToolScope`** — wrap each tool call to capture tool name, arguments, result
- **`OutputScope`** — use for async response scenarios where output isn't captured synchronously
- `CallerDetails` must be passed to `InvokeAgentScope.Start()` as the 4th parameter — this is **required** for traces to appear in the MAC portal
- For S2S autonomous agents, read sponsor details from config (`Agent365Observability:Sponsor` section) and construct `CallerDetails` with `UserDetails(userId, userName, userEmail)`
- Pass `UserDetails` directly (not wrapped in `CallerDetails`) to `InferenceScope.Start()` and `ExecuteToolScope.Start()` as the optional 4th parameter
- The `Agent365ObservabilityContext` singleton should hold both `AgentDetails` and `CallerDetails` properties

### For Node.js

Follow the reference patterns in `nodejs-observability.md` for:
- **`InvokeAgentScope`** — wrap the top-level message handler. Use `ScopeUtils.populateInvokeAgentScopeFromTurnContext` from `@microsoft/agents-a365-observability-hosting` to auto-populate from TurnContext
- **`InferenceScope`** — wrap each LLM call. Use `ScopeUtils.populateInferenceScopeFromTurnContext` if available
- **`ExecuteToolScope`** — wrap each tool call. Use `ScopeUtils.populateExecuteToolScopeFromTurnContext` if available
- **`OutputScope`** — for async scenarios
- `CallerDetails` must be passed to `InvokeAgentScope.start()` as the 4th parameter — this is **required** for traces to appear in the MAC portal
- For S2S autonomous agents, read sponsor details from env vars (`agent365Observability__sponsorUserId`, `agent365Observability__sponsorUserName`, `agent365Observability__sponsorUserEmail`) and construct the `CallerDetails` object
- Pass `UserDetails` directly to `InferenceScope.start()` and `ExecuteToolScope.start()` as the optional 4th parameter
- Export `callerDetails` (for `InvokeAgentScope`) and `userDetails` (for `InferenceScope`/`ExecuteToolScope`) from the entry point module alongside `agentDetails`

### For Python

Follow the reference patterns in `python-observability.md` for:
- **`InvokeAgentScope`** — wrap the top-level message handler as a context manager
- **`InferenceScope`** — wrap each LLM call
- **`ExecuteToolScope`** — wrap each tool call
- **`OutputScope`** — for async response scenarios
- `CallerDetails` / `UserDetails` must be supplied when creating the top-level `InvokeAgentScope` — this is **required** for traces to appear in the MAC portal
- For S2S autonomous agents, read sponsor details from config or environment and construct `CallerDetails(UserDetails(userId, userName, userEmail))`
- Pass `UserDetails` directly to `InferenceScope`, `ExecuteToolScope`, and `OutputScope` when their optional user parameter is available
- Keep shared observability state with both `agent_details` and `caller_details` / `user_details` so nested scopes can reuse them consistently

All new lines marked with the language-appropriate comment:
- C# / JavaScript / TypeScript: `// A365 Observability — best-effort instrumentation (verify against official sample)`
- Python: `# A365 Observability — best-effort instrumentation (verify against official sample)`

**TaskUpdate** — Mark complete.

---

## Phase 6: Update Configuration Files

**TaskCreate** — "Update configuration files with observability settings"

### For .NET AgentFramework

1. **Read** `appsettings.json` fully — **before writing anything** — and identify:
   - Whether a `Logging` section already exists anywhere in the file
   - Whether `Logging.LogLevel` already exists
   - The existing `EnableAgent365Exporter`, `AgentBlueprintId`, and `TenantId` values

   > **Merge safety rule (enforce without exception):** A JSON file may only have one `Logging` section. If `Logging` or `Logging.LogLevel` already exists, **merge** the new log level keys into that block. Never append a second `Logging` section — this produces silently invalid config where only the last block wins.

2. **Check for existing `a365 setup` configuration:**
   - `EnableAgent365Exporter` — always set to `true` in `appsettings.json` (the Development override sets it to `false`; `a365 setup` may have written `false` here, which this skill corrects)
   - If `Agent365Observability` section exists → **preserve** all existing values (AgentBlueprintId, TenantId, AgentName, AgentDescription, Sponsor)
   - If missing → add with defaults

3. **Edit** — Add or update observability configuration following the reference pattern:

   **`appsettings.json`** (exporter enabled by default in all environments except Development):
   ```json
   {
     "EnableAgent365Exporter": true,   // ← enabled by default; Development override turns it off
     "Agent365Observability": {
       "AgentBlueprintId": "...",      // ← populated by a365 setup (or placeholder if not run)
       "TenantId": "...",
       "AgentName": "",
       "AgentDescription": "",
       "Sponsor": {
         "UserId": "<<Blueprint ID>>",
         "UserName": "<<Blueprint Name>>",
         "UserEmail": "<<Blueprint Sponsor Email>>"
       },
       // S2S path only — add:
       // "ClientId": "<agent-blueprint-client-id>",
       // "ClientSecret": "<agent-blueprint-client-secret>",  // MSI tried first in prod; secret is local-dev fallback
       // "UseManagedIdentity": false  // ← set false for local dev (MSI only works on Azure infra)
     },
     "Logging": {
       "LogLevel": {
         "Default": "Information",
         "Microsoft.Agents.A365.Observability": "Debug",
         "OpenTelemetry": "Debug"
       }
     }
   }
   ```

   > **S2S note:** `EnableAgent365Exporter` must be `true` for S2S span export to work. `a365 setup` may write `false` — this skill corrects it. Also set `UseManagedIdentity: false` for local dev since MSI is only available on Azure infrastructure (App Service, AKS, VM). On local machines, MSI fails with `CredentialUnavailableError: Network unreachable`.
   >
   > **Sponsor note:** For S2S / autonomous agents, the `Sponsor` section provides `CallerDetails` for MAC portal trace visibility. Use the Blueprint app ID as `UserId`, the Blueprint display name as `UserName`, and the agent sponsor's email as `UserEmail`.

   **`appsettings.Development.json`** (create if absent — disables exporter for local dev so traces go to console only):
   ```json
   {
     "EnableAgent365Exporter": false
   }
   ```

4. **Critical:** The `Logging.LogLevel` section is **required** for observability events to appear in console output and Microsoft Defender. Without this, the SDK is instrumented but logs are suppressed. The `a365 setup` command does **not** add logging configuration.

5. **If `appsettings.json` does not exist**, create it with the complete structure above.

6. **If `Logging` or `Logging.LogLevel` already exists**, merge the new entries into that existing block. Do **not** create a second `Logging` section — only one is allowed in a JSON config file.

7. **Inform user:**
   - "Observability exporter is enabled by default (`EnableAgent365Exporter: true` in `appsettings.json`). For local development, `appsettings.Development.json` overrides this to `false` so traces go to console only."
   - If `AgentBlueprintId` or `TenantId` are empty: "Run `a365 setup` to populate AgentBlueprintId and TenantId, or fill them manually from your Entra app registration."
   - If S2S path: "Add `ClientId` and `ClientSecret` under `Agent365Observability` in `appsettings.json` — `ObservabilityTokenService` requires both. In production, MSI is tried first and the secret is a local-dev fallback; `ClientSecret` must still be present in config."

### For Node.js

1. **Read** `.env` (or `.env.local`, `.env.development`).

2. **Check for existing `a365 setup` configuration:**
   - If `ENABLE_A365_OBSERVABILITY_EXPORTER` exists → **preserve** it (do not change)
   - If missing → add with default value `false`

3. **Edit** — Add or update observability environment variables following the reference pattern in `nodejs-observability.md`:
   ```dotenv
   ENABLE_A365_OBSERVABILITY_EXPORTER=false
   SERVICE_NAME=my-agent
   A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
   Use_Custom_Resolver=false

   # Sponsor / CallerDetails for MAC portal trace visibility
   agent365Observability__sponsorUserId=<<Blueprint ID>>
   agent365Observability__sponsorUserName=<<Blueprint Name>>
   agent365Observability__sponsorUserEmail=<<Blueprint Sponsor Email>>
   ```
   - **S2S path only:** Also add `AGENT365_USE_S2S_ENDPOINT=true` — this tells the distro to use the `/observabilityService/...` endpoint path instead of `/observability/...`.

4. **If `.env` does not exist**, create it with the variables above.

5. **If the project uses `.env.example`**, also update it with placeholder values.

6. **Inform user:**
   - If `ENABLE_A365_OBSERVABILITY_EXPORTER` is `false`: "Observability is instrumented but disabled. Set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env to start exporting traces."

### For Python

1. **Read** `.env` (or `.env.local`).

2. **Edit** — Add or update observability environment variables:
   ```dotenv
   ENABLE_A365_OBSERVABILITY_EXPORTER=false
   ```
   - **S2S path only:** Also add `AGENT365_USE_S2S_ENDPOINT=true` — this tells the distro to use the `/observabilityService/...` endpoint path instead of `/observability/...`.

3. **If `.env` does not exist**, create it with the variable above.

4. **Inform user:**
   - If `ENABLE_A365_OBSERVABILITY_EXPORTER` is `false`: "Observability is instrumented but disabled. Set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env to start exporting traces."

7. **TaskUpdate** — Mark complete.

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

1. **Bash** — Run an import check to verify the packages load without errors:
   ```bash
   python3 -c "from microsoft.opentelemetry.a365.core import use_microsoft_opentelemetry; print('A365 observability imports OK')" 2>/dev/null || python -c "from microsoft.opentelemetry.a365.core import use_microsoft_opentelemetry; print('A365 observability imports OK')"
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
   3. [If authMode = user-delegated] Confirm the signed-in user's token is being passed correctly.
      → Docs: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
   4. [If authMode = agentic-identity] Ensure the agentic user identity has been provisioned in Azure AD.
      → Identity docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/identity
      → OBO flow docs: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
   5. [If authMode = S2S] No user token required — verify agent blueprint credentials are configured.
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

`a365 setup all` **attempts** to grant `Agent365.Observability.OtelWrite` to the Agent Identity SP, but this requires **Global Administrator** privileges. If the logged-in user is not a Global Admin, the assignment silently fails with 403 and trace exports will return HTTP 403 from the observability service.

**The CLI prints a PowerShell admin consent script** in its output when the assignment fails. When running `a365 setup all`, **always scan the output for this script block** and display it to the user in a fenced code block so they can copy it and hand it to a Global Admin.

If the script was not captured, grant the permission manually via Entra portal (requires Global Admin):
1. [Entra portal](https://entra.microsoft.com) > App registrations > select Blueprint app > API permissions
2. Add a permission > APIs my organization uses > search `9b975845-388f-4429-889e-eab1ef63949c`
3. Add both **Delegated** and **Application** `Agent365.Observability.OtelWrite` > Grant admin consent

Alternatively, read the `agentIdentityClientId` from `a365.generated.config.json` and use the Graph API:

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

**This bug affects BOTH Node.js and .NET SDKs:**

**Node.js (`@microsoft/opentelemetry` v0.1.0-beta.1):**

1. `A365Configuration` — add `useS2SEndpoint` property + `AGENT365_USE_S2S_ENDPOINT` env var support
2. `distro.js` — pass `a365Config.useS2SEndpoint` when constructing `Agent365Exporter`

**For generated agent code:** Set the env var in `.env`:
```
AGENT365_USE_S2S_ENDPOINT=true
```

This is a distro-level fix. The `useMicrosoftOpenTelemetry()` call does NOT need a custom `spanProcessors` array — the built-in exporter reads the env var via `A365Configuration` and passes it to `Agent365Exporter`.

**.NET (`Microsoft.OpenTelemetry` v1.0.0-beta.1):**

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

### .NET `Microsoft.OpenTelemetry` v1.0.0-beta.1 Requires .NET 10 Logging

`Microsoft.OpenTelemetry` v1.0.0-beta.1 has a hard dependency on `Microsoft.Extensions.Logging` v10.0.0. On projects targeting `net8.0` or `net9.0`, this causes a runtime `FileNotFoundException` for `Microsoft.Extensions.Logging, Version=10.0.0.0`.

**Workaround:** Add an explicit package reference to the v10 preview of `Microsoft.Extensions.Logging`:
```bash
dotnet add package Microsoft.Extensions.Logging --version "10.0.0-*"
```

If the project targets `net8.0`, also upgrade the TFM to `net9.0` for best compatibility:
```xml
<TargetFramework>net9.0</TargetFramework>
```

**Status:** This is expected to be resolved when `Microsoft.OpenTelemetry` ships a stable release or when the project targets `net10.0`.

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

For S2S / autonomous agents:
- `EnableAgent365Exporter` must be `true` in `appsettings.json` (not `false` — `a365 setup` may write `false` by default)
- `UseManagedIdentity` must be `false` for local development (MSI is only available on Azure infrastructure)
- Both `ClientId` and `ClientSecret` are required under `Agent365Observability` for the FMI 3-hop chain

### CallerDetails Required for MAC Portal Trace Visibility

For S2S / autonomous agents, `CallerDetails` with `UserDetails` (`userId`, `userName`, `userEmail`) must be passed to `InvokeAgentScope.Start()` / `.start()`. Without `CallerDetails`, exported spans reach the observability API (HTTP 200) but do **not** appear in the Microsoft Admin Center (MAC) portal's Advanced Hunting view.

**Node.js API differences:**
- `InvokeAgentScope.start()` takes `CallerDetails` (wraps `userDetails`) as 4th parameter
- `InferenceScope.start()` and `ExecuteToolScope.start()` take `UserDetails` directly as 4th parameter
- `OutputScope.start()` takes `UserDetails` directly as 4th parameter

**.NET API:**
- `InvokeAgentScope.Start()` takes `CallerDetails` (wraps `UserDetails`) as 4th parameter
- Other scopes do not take `CallerDetails` directly

**Recommendation:** For autonomous agents without a real user, use the Blueprint sponsor's identity:
- `UserId` = Blueprint App (Client) ID
- `UserName` = Blueprint display name
- `UserEmail` = Agent sponsor's email address

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **.NET Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
- **Python Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/python-observability.md`

