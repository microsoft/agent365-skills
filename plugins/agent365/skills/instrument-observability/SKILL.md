---
name: instrument-observability
version: 1.4.2
description: >
  Instruments Microsoft Agent 365 observability into existing .NET AgentFramework, Node.js, or
  Python agents. Adds OTel-based tracing, context propagation, A365 exporter, manual
  instrumentation scopes (InvokeAgentScope, InferenceScope, ExecuteToolScope — required for
  store publishing), and updates configuration files. Asks a two-stage question — agent kind
  (AI Teammate (Digital Worker) or Standard Agent (Non Digital Worker)) and auth mode — to determine
  the correct token path: OBO (user-delegated / agentic-identity / Assistive) or Autonomous S2S
  (MSAL client-credentials token chain supported for .NET, Node.js, and Python — each language
  gets a scaffold token-service file that acquires and refreshes the Observability API token). Non-destructive and idempotent.
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
        2. agentType (ai-teammate/AI Teammate (Digital Worker) or system-agent/Standard Agent (Non Digital Worker)) and authMode (user-delegated, agentic-identity, or S2S) were determined and authMode is recorded in an inline comment in the message handler.
        3. A365 observability packages were installed (check package.json, .csproj, or pyproject.toml/requirements.txt).
        4. Observability was configured in the entry point (Program.cs, index.js/ts, or app.py).
        5. For OBO path: BaggageBuilder context added to the message handler (or BaggageMiddleware registered); RegisterObservability called per-turn with (agentId, tenantId, AgenticTokenStruct, scopes). For S2S path — all languages: no per-turn RegisterObservability/RefreshObservabilityToken/register_observability call; token comes from the scaffold token-service file started at startup. .NET additionally: baggage set via new BaggageBuilder().FromTurnContext(turnContext).Build() (FromTurnContext is a BaggageBuilder extension ONLY — NOT on InvokeAgentScope); InvokeAgentScope.Start() called separately with InvokeAgentScopeDetails(endpoint: ...) — NOT chained; scaffold files Observability/ObservabilityServiceExtensions.cs and Observability/ObservabilityTokenService.cs exist. Node.js S2S: observability/observability-token-service.ts exists; startObservabilityTokenService() called before ObservabilityManager.configure(); useS2SEndpoint=true. Python S2S: observability/observability_token_service.py exists; start_observability_token_service() task created before configure(); use_s2s_endpoint=True.
        6. Agentic token resolver with caching is implemented.
        7. Configuration files (appsettings.json or .env) include observability variables.
        8. Build/compile succeeds (dotnet build, npm run build, or python import check).
        9. All instrumented code is marked with: // A365 Observability — best-effort instrumentation
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
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

If `agentType` and `authMode` are already present in the detection cache (from a prior skill run in this session), confirm the values with the user and skip the questions.

Store `agentType` (`ai-teammate` = AI Teammate (Digital Worker), or `system-agent` = Standard Agent (Non Digital Worker)) and `authMode`:
- **AI Teammate (Digital Worker):** `user-delegated` (OBO as signed-in user) or `agentic-identity` (OBO as agent's own M365 identity)
- **Standard Agent (Non Digital Worker):** `agentic-identity` (Assistive OBO) or `S2S` (Autonomous / Service Principal)

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

### For .NET AgentFramework

1. **Read** the current entry point (`Program.cs` or detected file).

2. **Edit** — Add observability wiring following the reference pattern in `dotnet-observability.md`:
   - Add using directives for the observability namespaces
   - **OBO path** (`user-delegated` or `agentic-identity`): call `builder.Services.AddAgenticTracingExporter();` then `builder.AddA365Tracing();`
   - **S2S path**: First **Write** the two scaffold files from the reference doc — `Observability/ObservabilityServiceExtensions.cs` (DI extension with `AddAgent365Observability()`) and `Observability/ObservabilityTokenService.cs` (background service that acquires the Observability API token via MSAL client credentials). Then call `builder.Services.AddAgent365Observability();` and `builder.AddA365Tracing();`. Also run `dotnet add package Microsoft.Identity.Client`.
   - Optionally register `adapter.Use(new BaggageTurnMiddleware())` (OBO path only) to auto-populate baggage on every request
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Node.js

1. **Read** the current entry point (`index.ts`, `app.ts`, or detected file).

2. **Edit** — Add observability initialization following the reference pattern in `nodejs-observability.md`:
   - Add imports for `ObservabilityManager` from `@microsoft/agents-a365-observability`
   - **OBO path**: Add `ObservabilityManager.configure()` with `withTokenResolver` pointing to `AgenticTokenCacheInstance`. Call `.start()` before any LLM imports.
   - **S2S path**: First **Write** `observability/observability-token-service.ts` using the scaffold pattern from `nodejs-observability.md` (S2S section). This module acquires the Observability API token via MSAL client credentials and refreshes it every 50 min. Then call `await startObservabilityTokenService()` before `ObservabilityManager.configure()`, set `exporterOptions.useS2SEndpoint = true`, and wire `withTokenResolver(getS2SObservabilityToken)`. Also run `npm install @azure/msal-node` if not already present.
   - Optionally register `adapter.use(new BaggageMiddleware())` (OBO path) to auto-populate baggage on every request
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Python

1. **Read** the current entry point (`app.py`, `host_agent_server.py`, or detected file).

2. **Edit** — Add observability configuration following the reference pattern in `python-observability.md`:
   - Add `from microsoft_agents_a365.observability.core import configure` and call `configure()` with `service_name`, `service_namespace`, and `token_resolver`
   - **OBO path**: Wire `token_resolver` to `AgenticTokenCache` from the hosting package.
   - **S2S path**: First **Write** `observability/observability_token_service.py` using the scaffold pattern from `python-observability.md` (S2S section). This module acquires the Observability API token via MSAL client credentials and refreshes it every 50 min via an `asyncio` background task. Then call `asyncio.create_task(start_observability_token_service())` before `configure()`, set `use_s2s_endpoint=True` in `Agent365ExporterOptions`, and set `token_resolver=get_s2s_observability_token`. Also install `msal` if not already present.
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

2. **Edit** — Follow the reference pattern in `dotnet-observability.md` based on `authMode`:

   **OBO path** (`user-delegated` or `agentic-identity`):
   - Inject `IExporterTokenCache<AgenticTokenStruct>` in the constructor
   - Use `new BaggageBuilder().FromTurnContext(turnContext).Build()` — requires `using Microsoft.Agents.A365.Observability.Hosting.Extensions;`; `Build()` returns `IDisposable`, use `using var`
   - Call `RegisterObservability` with all four arguments per turn (wrap in try/catch — non-fatal):
     ```csharp
     _agentTokenCache.RegisterObservability(
         turnContext.Activity.Recipient.AgenticAppId,
         turnContext.Activity.Recipient.TenantId,
         new AgenticTokenStruct(
             userAuthorization: UserAuthorization,
             turnContext: turnContext,
             authHandlerName: "AGENTIC"),
         EnvironmentUtils.GetObservabilityAuthenticationScope()
     );
     ```
     - `user-delegated`: token exchange resolves to the **signed-in user's** identity → traces attributed to the user
     - `agentic-identity`: token exchange resolves to the **agentic user** provisioned in Azure AD → traces attributed to the agent
   - Add inline comment: `// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow`

   **S2S path**:
   - Inject `Agent365ObservabilityContext` (singleton registered by `AddAgent365Observability()`) in the constructor — **not** `IExporterTokenCache<AgenticTokenStruct>`
   - **Baggage:** Use `new BaggageBuilder().FromTurnContext(turnContext).Build()` as a separate `using var baggageScope` — `FromTurnContext()` is an extension on `BaggageBuilder` **only**; it does not exist on `InvokeAgentScope` or any scope type
   - **Scope:** Use `InvokeAgentScope.Start(new Request(...), new InvokeAgentScopeDetails(endpoint: new Uri("...")), _obs.AgentDetails)` as a separate `using var scope` — `InvokeAgentScopeDetails` has **no parameterless constructor**; always pass at least `endpoint`
   - **No** per-turn `RegisterObservability()` call; **no** `.FromTurnContext()` chaining on the scope
   - Add inline comment: `// A365 auth mode: S2S — MSAL client credentials via ObservabilityTokenService (scope: api://9b975845-388f-4429-889e-eab1ef63949c/.default)`

   Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Node.js

1. **Read** the detected message handler file.

2. **Edit** — Add BaggageBuilder context following the reference pattern in `nodejs-observability.md`:
   - Import `BaggageBuilder` from `@microsoft/agents-a365-observability`
   - Import `AgenticTokenCacheInstance`, `BaggageBuilderUtils` from `@microsoft/agents-a365-observability-hosting`
   - Import `getObservabilityAuthenticationScope` from `@microsoft/agents-a365-runtime`
   - **OBO paths only** (`user-delegated` / `agentic-identity`): Call `AgenticTokenCacheInstance.RefreshObservabilityToken(agentId, tenantId, context, authorization, scopes)` at the start of each turn (non-fatal, wrap in try/catch):
     - `user-delegated`: `authorization` is the **user's** delegated token → traces attributed to the user
     - `agentic-identity`: `authorization` resolves to the **agentic user** provisioned in Azure AD → traces attributed to the agent
   - **S2S path**: Do **NOT** call `AgenticTokenCacheInstance.RefreshObservabilityToken` — there is no user authorization token. The `withTokenResolver` in `ObservabilityManager.configure()` (set up in Phase 3) handles authentication via MSAL client credentials.
   - Use `BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), context).build()` to build baggage automatically from TurnContext
   - Wrap the handler body in `await baggageScope.run(async () => { ... })`
   - Add inline comment: `// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow`
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Python

1. **Read** the detected message handler file.

2. **Edit** — Add BaggageBuilder context following the reference pattern in `python-observability.md`:
   - Import `BaggageBuilder` from `microsoft_agents_a365.observability.core`
   - Import `populate` from `microsoft_agents_a365.observability.hosting.scope_helpers.populate_baggage`
   - Import `AgenticTokenCache`, `AgenticTokenStruct` from `microsoft_agents_a365.observability.hosting.token_cache_helpers`
   - Import `get_observability_authentication_scope` from `microsoft_agents_a365.runtime`
   - Call `token_cache.register_observability(agent_id=..., tenant_id=..., token_generator=AgenticTokenStruct(authorization=AGENT_APP.auth, turn_context=context), observability_scopes=get_observability_authentication_scope())`:
     - `user-delegated`: the OBO exchange resolves to the **signed-in user's** identity
     - `agentic-identity`: the OBO exchange resolves to the **agentic user** provisioned in Azure AD
     - `S2S`: agent authenticates as itself — no user context available
   - Use `populate(builder, turn_context)` to auto-populate baggage, then `with builder.build():`
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

The `ObservabilityTokenService` background service (created in Phase 3 via the scaffold) acquires and refreshes the Observability API token automatically via MSAL client credentials — no manual `TokenResolver` delegate needed.

1. **Check** if `Observability/ObservabilityServiceExtensions.cs` and `Observability/ObservabilityTokenService.cs` exist. If yes, **skip** — they were already created in Phase 3.

2. **If absent** (Phase 3 was skipped or re-running the skill on a partial state), create them now following the S2S scaffold patterns in `dotnet-observability.md`. These files provide `AddAgent365Observability()` (DI extension registering `AddServiceTracingExporter`, `ObservabilityTokenService`, and `Agent365ObservabilityContext`) and `ObservabilityTokenService` (background service that acquires the Observability API token via MSAL client credentials and refreshes it every 50 minutes).

### For Node.js (OBO path)

`AgenticTokenCacheInstance` from `@microsoft/agents-a365-observability-hosting` handles caching automatically. The `ObservabilityManager.configure()` call in Phase 3 wires it as the `tokenResolver`. No additional token resolver module is needed unless `Use_Custom_Resolver=true` is required (see reference doc for custom resolver pattern).

### For Node.js (S2S path)

**Check** if `observability/observability-token-service.ts` exists. If yes, **skip** — it was created in Phase 3.

**If absent** (Phase 3 was skipped or re-running), create it now using the scaffold from `nodejs-observability.md` (S2S section). This file exports `startObservabilityTokenService()` (call at app startup) and `getS2SObservabilityToken()` (pass as `withTokenResolver`). The token is refreshed every 50 minutes targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`.

### For Python (OBO path)

`AgenticTokenCache` from `microsoft_agents_a365.observability.hosting.token_cache_helpers` handles caching automatically. It was wired as the `token_resolver` in the `configure()` call in Phase 3. No additional module is needed.

### For Python (S2S path)

**Check** if `observability/observability_token_service.py` exists. If yes, **skip** — it was created in Phase 3.

**If absent**, create it now using the scaffold from `python-observability.md` (S2S section). This file exports `start_observability_token_service()` (schedule as `asyncio.create_task()` at startup) and `get_s2s_observability_token()` (pass as `token_resolver` in `configure()`). The token is refreshed every 50 minutes targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`.

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

### For Node.js

Follow the reference patterns in `nodejs-observability.md` for:
- **`InvokeAgentScope`** — wrap the top-level message handler. Use `ScopeUtils.populateInvokeAgentScopeFromTurnContext` from `@microsoft/agents-a365-observability-hosting` to auto-populate from TurnContext
- **`InferenceScope`** — wrap each LLM call. Use `ScopeUtils.populateInferenceScopeFromTurnContext` if available
- **`ExecuteToolScope`** — wrap each tool call. Use `ScopeUtils.populateExecuteToolScopeFromTurnContext` if available
- **`OutputScope`** — for async scenarios

### For Python

Follow the reference patterns in `python-observability.md` for:
- **`InvokeAgentScope`** — wrap the top-level message handler as a context manager
- **`InferenceScope`** — wrap each LLM call
- **`ExecuteToolScope`** — wrap each tool call
- **`OutputScope`** — for async response scenarios

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
   - If `Agent365Observability` section exists → **preserve** all existing values (AgentBlueprintId, TenantId, AgentName, AgentDescription)
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
       "AgentDescription": ""
       // S2S path only — add:
       // "ClientId": "<agent-blueprint-client-id>",
       // "ClientSecret": "<agent-blueprint-client-secret>"  // MSI tried first in prod; secret is local-dev fallback
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
   ```

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
   python3 -c "from microsoft_agents_a365.observability.core import configure; from microsoft_agents_a365.observability.hosting import AgenticTokenCache; print('A365 observability imports OK')" 2>/dev/null || python -c "from microsoft_agents_a365.observability.core import configure; from microsoft_agents_a365.observability.hosting import AgenticTokenCache; print('A365 observability imports OK')"
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
   **Agent kind:** [AI Teammate (Digital Worker) | Standard Agent (Non Digital Worker)]
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

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **.NET Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
- **Python Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/python-observability.md`
