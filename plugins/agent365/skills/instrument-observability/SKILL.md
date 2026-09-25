---
name: instrument-observability
description: >
  Instruments Microsoft Agent 365 observability into existing .NET AgentFramework, Node.js, or
  Python agents. Adds OTel-based tracing, context propagation, A365 exporter, manual
  instrumentation scopes (InvokeAgentScope, InferenceScope, ExecuteToolScope — required for
  store publishing), and updates configuration files. Asks a two-stage question — agent kind
  (AI Teammate or Agent (Non AI Teammate)) and auth mode — to determine how the telemetry
  token is sourced. Every agent exports over the S2S route with an app-only token for the
  exporting agent identity: `obo` / `agentic-user` agents get an app-only token resolver that
  reuses the agent's hosting connection (blueprint credential), and `s2s` agents get a scaffold
  token-service file that acquires and refreshes the Observability API token via the FMI chain
  (.NET, Node.js, and Python). No OBS permission or admin consent is needed for registered
  blueprint agent instances. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
  - github-copilot-cli
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
5. **Implements** the app-only telemetry token resolver (S2S route) with caching
6. **Adds** manual instrumentation scopes (InvokeAgentScope, InferenceScope, ExecuteToolScope — **required for store publishing**)
7. **Updates** configuration files with observability settings
8. **Validates** the build passes

> **Store publishing requirement:** The Agent 365 store validation requires `InvokeAgentScope`,
> `InferenceScope`, and `ExecuteToolScope` to be implemented. This skill wires them.

All changes are **additive** and **idempotent** — rerunning the skill is safe. The one
exception is legacy delegated telemetry wiring, which this skill replaces (see "Migrating
delegated telemetry" in Phase 3).

> **Telemetry is always exported over the S2S route with an app-only token** for the exporting
> agent identity, whatever the `authMode`. The S2S route rejects delegated (`scp`) tokens, so
> OBO / Agentic User tokens are used only for workload calls (MCP / Graph), never for the
> exporter. Registered blueprint agent instances need no `Agent365.Observability.OtelWrite`
> permission or admin consent (subject to service policy), and `a365 setup all` no longer requests
> them for blueprint agents. AI Teammate setup (`a365 setup all --aiteammate`) still offers the
> `OtelWrite` application role; complete the app-role action item it prints, because the S2S route
> accepts that role.

---

## Phase 0: Load Detection Cache and Validate

> **Task-list display (applies throughout this skill).** This skill creates tasks **inline** via `**TaskCreate** — "..."` markers at the start of each phase, and marks them complete at phase end. The user must see this progress visibly. Each `TaskCreate` line corresponds to one checklist item; exactly one item in_progress at a time.
> - **Claude Code:** `TaskCreate` is in `allowed-tools` — calling it renders a native checklist UI; subsequent `TaskUpdate` calls flip statuses.
> - **VS Code Copilot Chat / GitHub Copilot CLI:** `allowed-tools` is ignored — before Phase 0.1, scan this SKILL.md for all `**TaskCreate** — "..."` lines and emit a markdown checklist in chat upfront (`- [ ] Load detection cache…`, `- [ ] Determine agent kind…`, etc.); flip items to `- [x]` as each phase completes.

**TaskCreate** — "Load detection cache and validate with user"

### Step 0.1 — Triage the workspace

Run in parallel:

- **Glob** `**/*.csproj`, `package.json`, `requirements.txt`, `pyproject.toml`, `src/**/*.ts`, `**/*.cs`, `**/*.py` → `hasProjectFiles`.
- **Read** `.a365-workspace-detection.local.json` → `cacheState` (`fresh` if `detectedAt` < 60 min, `stale` if older, `missing` if absent).

Decide:

| `cacheState` | `hasProjectFiles` | Action |
|--------------|-------------------|--------|
| `fresh`      | —                 | Continue to Step 0.2 below. |
| `missing` / `stale` | false       | **Hard stop with a useful message:** *"This skill instruments an existing agent for observability — there's no agent code in this workspace yet. Run `/agent365:make-ai-teammate` (if this will be a Teams/Copilot agent) or `/agent365:make-a365-agent` first to scaffold and register the agent, then come back here."* Do not proceed. |
| `missing` / `stale` | true        | Tell the user: *"Found existing agent code but no fresh Agent 365 registration. I'll run `a365-setup` now to register it and write the detection cache, then continue here automatically."* **Read** `${CLAUDE_PLUGIN_ROOT}/skills/a365-setup/SKILL.md` and follow it through completion, then continue to Step 0.2. |

### Step 0.2 — Load from cache

**🛑 STOP — `.a365-workspace-detection.local.json` MUST exist before this step.** Read the file path `.a365-workspace-detection.local.json` in the working directory. If it does not exist, you arrived at Step 0.2 by skipping Step 0.1's triage routing. Do NOT proceed. Do NOT invent default cache values. Do NOT run any further phase (no `npm install`, no `dotnet add package`, no `pip install`, no file edits). Instead:

1. Tell the user verbatim: *"I skipped the Step 0.1 triage and the detection cache wasn't written. Running `a365-setup` now to fix that, then I'll return here."*
2. **Read** `${CLAUDE_PLUGIN_ROOT}/skills/a365-setup/SKILL.md` and follow it to completion.
3. Re-verify the file now exists, then continue below.

The stop hook (`validate-instrument-observability.js`) will fail the session at end if the cache file is missing — this guard exists so the model halts immediately rather than instrumenting against unknown `authMode`.

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

If `agentType` and `authMode` are already present in the detection cache (from a prior skill run in this session OR pre-populated by a parent skill like make-ai-teammate), the confirmation behavior depends on `agentType`:
- **`agentType = "ai-teammate"`** — skip the confirmation prompt entirely. The AI Teammate identity model is unambiguous (`authMode = agentic-user`, no obo/s2s decision exists), so a confirm prompt adds friction without catching drift. Proceed silently.
- **`agentType = "system-agent"`** — confirm the cached values with the user before proceeding, since the obo/s2s choice is meaningful and a stale value would silently route to the wrong token path.

Read `authMode` case-insensitively (`S2S` = `s2s`, `OBO` = `obo`); always write back the canonical lowercase value.

Store `agentType` (`ai-teammate` = AI Teammate, or `system-agent` = Agent (Non AI Teammate)) and `authMode`:
- **AI Teammate:** `agentic-user` (agent's own M365 identity — not the caller's token; auto-set, no question needed)
- **Agent (Non AI Teammate):** `obo` (On-Behalf-Of — signed-in user token) or `s2s` (Service Principal, no user token)

**Update `.a365-workspace-detection.local.json`** — merge `agentType` and `authMode` into the existing cache file, preserving all other fields (`agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `detectedAt`). Use the **Write** tool to write the merged object back.

The `authMode` value drives Phases 3–5: both paths export over the S2S route with an app-only token, but they differ in how that token is sourced — entry point wiring (Phase 3), message handler pattern (Phase 4), and token resolver (Phase 5). **Phases 2, 6, 7, and 8 are identical regardless of `authMode`.**

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

5. **Framework-support soft-warn matrix.** Check `(programmingLanguage, agentStack)` from the detection cache and surface a warning when the stack lacks first-class auto-instrumentation in `@microsoft/opentelemetry` or `microsoft-opentelemetry`. The skill still proceeds — observability is the OTel SDK underneath, which works for any HTTP-based LLM — but the user should know they'll need to add manual `InferenceScope.start` wrappers around each LLM call.

   | Lang | Stack | Action |
   |---|---|---|
   | Node.js | LangChain, OpenAI Agents SDK, Claude SDK | ✅ Auto-instrumented (Claude with custom shape — see Phase 5.5) |
   | Node.js | Semantic Kernel, Google ADK | ⚠ Soft-warn — auto-instrumentation may not patch the LLM library; add manual `InferenceScope.start` around each LLM call |
   | Python | Agent Framework, OpenAI, Google ADK | ✅ Auto-instrumented |
   | Python | LangChain, Claude SDK, CrewAI | ⚠ Soft-warn — same as Node.js SK/ADK |
   | .NET | Agent Framework, Semantic Kernel | ✅ Auto-instrumented via `.UseOpenTelemetry()` on `IChatClient` |
   | .NET | Azure AI Foundry | ⚠ Soft-warn — best-effort wiring |

   For soft-warn rows, surface verbatim: *"Auto-instrumentation in `<unified-distro-package>` doesn't patch your LLM library directly. The skill will still wire `useMicrosoftOpenTelemetry`/`UseMicrosoftOpenTelemetry` (OTel SDK + A365 exporter), but you'll need to manually wrap each LLM call with `InferenceScope.start(...)` to capture `gen_ai.*` spans. See `<language>-observability.md` § 'InferenceScope — Manual Wrapping' for the pattern."* Continue to Phase 2.

6. **TaskUpdate** — Mark complete and report detected agent type (+ any soft-warn) to user.

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

> **Migrating delegated telemetry (the one non-additive edit).** If the project already wires
> the legacy delegated (OBO-route) telemetry path, replace it. That path is:
> - Node.js: `AgenticTokenCacheInstance.refreshObservabilityToken(..., authorization)`, a
>   `preloadObservabilityToken` helper, or a `tokenResolver` reading
>   `AgenticTokenCacheInstance.getObservabilityToken(...)`.
> - .NET: `RegisterObservability(..., new AgenticTokenStruct(...), ...)`, any
>   `new AgenticTokenStruct(...)` (for example an `A365OtelWrapper` helper), an
>   `IExporterTokenCache<AgenticTokenStruct>` dependency, or `AddAgenticTracingExporter()`.
> - Python: `exchange_token(...)` for the observability scope (with or without an explicit
>   `scopes=`), `cache_agentic_token(...)`, or an `AgenticTokenCache` / `get_cached_agentic_token`
>   resolver.
> - Any language: a distro call without the S2S route flag.
>
> The S2S route rejects those delegated tokens, and the delegated route needs admin consent. Swap the
> resolver for the app-only one, set the S2S route flag, and remove the per-turn delegated
> refresh. Keep the baggage and scope wiring. Durable or offline delivery spools keep each
> record's original route, so for `@microsoft/opentelemetry` 1.4.x set
> `a365.durableDelivery: { enabled: false }` during the migration (as the Agent 365 samples do)
> or clear the spool directory. List every replaced call in the final summary.

### For .NET AgentFramework

1. **Read** the current entry point (`Program.cs` or detected file).

2. **Edit** — Add observability wiring following the reference pattern in `dotnet-observability.md`:
   - Add `using Microsoft.OpenTelemetry;` to `Program.cs`.
   - **OBO / agentic-user path** (AI Teammate AND Standard .NET agents): First **Write** `Observability/AgentAppTokenResolver.cs` from the reference doc and register it with `builder.Services.AddSingleton<AgentAppTokenResolver>();`. It acquires an app-only Observability API token per agent identity from the agent's default (blueprint) connection. Then call `builder.UseMicrosoftOpenTelemetry(o => { ... })` with `o.Exporters = ExportTarget.Agent365 | ExportTarget.Console` (Dev) or `ExportTarget.Agent365` (Production), `o.Agent365.UseS2SEndpoint = true`, and `o.Agent365.TokenResolver = (agentId, tenantId) => obsTokens?.ResolveAsync(agentId, tenantId) ?? Task.FromResult<string?>(null);`, where `obsTokens` is resolved from `app.Services` after `builder.Build()`. On `Microsoft.OpenTelemetry` 1.0.2 and earlier these options live under `o.Agent365.Exporter`. Do NOT rely on the distro's auto-registered `IExporterTokenCache<AgenticTokenStruct>` — it serves delegated tokens that the S2S route rejects. Also set `"EnableAgent365Exporter": true` in `appsettings.json` to activate the backend exporter — the SDK defaults this to `false` when absent, so without it the exporter is wired but inert.
   - **Required: `IChatClient.UseOpenTelemetry()`** — when registering the `IChatClient` (e.g. Azure OpenAI), chain `.AsBuilder().UseFunctionInvocation().UseOpenTelemetry(sourceName: null, cfg => cfg.EnableSensitiveData = true).Build()`. This is what makes the AI SDK emit the `gen_ai.inference` and `gen_ai.tool` spans that `InvokeAgentScope` (Phase 5.5) anchors as children. **Skipping this means no LLM spans appear in MAC, even with everything else wired** — the `InvokeAgent` parent becomes a hollow span. `EnableSensitiveData = true` includes prompts/completions in span attributes (PII consideration — set to `false` for regulated data).
   - **S2S path**: First **Write** the two scaffold files from the reference doc — `Observability/ObservabilityServiceExtensions.cs` (DI extension with `AddAgent365Observability()` using `ServiceTokenCache` and conditional `ObservabilityTokenService`) and `Observability/ObservabilityTokenService.cs` (background service that acquires the Observability API token via the MSAL FMI 3-hop chain with `.WithFmiPath()` targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`, supports MSI with client-secret fallback). Then call `builder.Services.AddAgent365Observability();` and `builder.UseMicrosoftOpenTelemetry(...)` with token resolver reading from the `ServiceTokenCache`. **Critical:** Set `o.Agent365.UseS2SEndpoint = true` in the options callback (`o.Agent365.Exporter.UseS2SEndpoint` on 1.0.2 and earlier) — without this, the exporter posts to the wrong path (`/observability/` instead of `/observabilityService/`) and gets HTTP 401. See "Known Issues" section.
      - Optionally register `adapter.Use(new BaggageTurnMiddleware())` to auto-populate baggage on every request
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Node.js

1. **Read** the current entry point (`index.ts`, `app.ts`, or detected file).

2. **Edit** — Add observability initialization following the reference pattern in `nodejs-observability.md`:
   - Import `useMicrosoftOpenTelemetry`, `shutdownMicrosoftOpenTelemetry`, and `configureA365Hosting` — **all from `@microsoft/opentelemetry`** (single package as of GA 1.0; do NOT import from the legacy `-observability`, `-hosting`, or `-runtime` packages). Do NOT import `AgenticTokenCacheInstance` for telemetry — it serves delegated tokens.
   - **OBO / agentic-user path**: First **Write** `observability/app-token-resolver.ts` from `nodejs-observability.md` ("App-only Token Resolver Scaffold"). Then call `useMicrosoftOpenTelemetry({ a365: { enabled: true, enableObservabilityExporter: true, useS2SEndpoint: true, tokenResolver: appTokenResolver } })` **before** any LLM/framework imports, where `appTokenResolver = createAppTokenResolver(() => getObsConnection())`. Assign `getObsConnection = () => adapter.connectionManager.getDefaultConnection();` once the adapter exists. Both `enabled: true` AND `enableObservabilityExporter: true` are required in 1.0+ to actually export spans; `useS2SEndpoint: true` sends them to the S2S route, which accepts the app-only token.
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
   - **OBO / agentic-user path**: First **Write** `observability/app_token_resolver.py` from `python-observability.md` ("App-only Token Resolver Scaffold"). Then create `OBS_TOKENS = AppTokenResolver()` and call `use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_use_s2s_endpoint=True, a365_token_resolver=OBS_TOKENS.resolve)`. Both `enable_a365=True` AND `a365_enable_observability_exporter=True` are required in 1.0+ to actually export spans; `a365_use_s2s_endpoint=True` sends them to the S2S route. Do NOT wire `AgenticTokenCache().get_observability_token` or a cache of `exchange_token()` results — both serve delegated tokens.
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

> **Auth mode note:** Telemetry never goes through the auth handler. Every `authMode` exports
> over the S2S route with an app-only token (Phase 3), and the auth handler
> (`AgentApplication:AgenticAuthHandlerName`, etc.) is only for workload calls (MCP / Graph).
> Add an inline comment indicating which mode was chosen.

### For .NET AgentFramework

1. **Read** the detected message handler file.

2. **Edit** — Follow the reference pattern in `dotnet-observability.md` (full code sample under "Agent Class — Message Handler (OBO Path)"):

   **OBO path** (`obo` / `agentic-user`) — applies to both **AI Teammate** agents and **Standard .NET agents**:
   - Inject `IConfiguration` (for blueprint/observability config) and `ILogger<MyAgent>`. Do **not** inject `IExporterTokenCache<AgenticTokenStruct>` or make a per-turn `RegisterObservability(...)` call: the app-only `AgentAppTokenResolver` wired in Phase 3 supplies the export token. If an existing handler has either, remove it (see "Migrating delegated telemetry" in Phase 3).
   - **Resolve the exporting agent identity.** S2S export authenticates *as* this identity, so it must be an agent identity, never the blueprint. Agentic turns carry it on the Activity. Other turns fall back to the provisioned agent identity that `a365 setup all` writes to `Agent365Observability:AgentId` for non-AI-Teammate blueprint agents. Do NOT decode it from an OBO token: `Utility.ResolveAgentIdentity(context, oboToken)` returns the blueprint or bot app ID for OBO tokens. Do NOT fall back to `Guid.Empty.ToString()` either. Both produce an identity the exporter cannot authenticate.
     ```csharp
     var obsConfig = _configuration.GetSection("Agent365Observability");

     string? resolvedAgentId = turnContext.Activity.IsAgenticRequest()
         ? turnContext.Activity.GetAgenticInstanceId()
         : obsConfig["AgentId"];
     if (!Guid.TryParse(resolvedAgentId, out _)
         || string.Equals(resolvedAgentId, obsConfig["AgentBlueprintId"], StringComparison.OrdinalIgnoreCase))
     {
         resolvedAgentId = null;   // not an agent identity; the S2S route would reject it
     }

     var resolvedTenantId = turnContext.Activity.Conversation?.TenantId
                         ?? turnContext.Activity.Recipient?.TenantId
                         ?? obsConfig["TenantId"];

     var hasObservabilityIdentity = !string.IsNullOrEmpty(resolvedAgentId)
                                 && !string.IsNullOrEmpty(resolvedTenantId);
     ```
     `GetAgenticInstanceId()` returns the agentic instance ID (`Recipient.AgenticAppId`). That is the identity the app-only token is minted for, and what shows up in MAC Advanced Hunting.
   - **Conditional baggage** — only when `hasObservabilityIdentity == true`; skip cleanly when the identity can't be resolved:
     ```csharp
     using IDisposable? baggageScope = hasObservabilityIdentity
         ? new BaggageBuilder()
             .TenantId(resolvedTenantId!)
             .AgentId(resolvedAgentId!)
             .Build()
         : null;
     ```
   - **Keep the `Agent365Observability` section in `appsettings.json`** (`EnableAgent365Exporter` and base exporter settings are still required — Phase 6 handles these). No S2S credentials are needed there: `AgentAppTokenResolver` uses the agent's `Connections` settings, and agentic turns resolve their agent ID at runtime.
   - **The inline pattern shown above is preferred** for new code (mirrors PR #308 in `microsoft/Agent365-Samples`). The older `A365OtelWrapper.InvokeObservedAgentOperation(...)` static-wrapper pattern at `Agent365-samples/dotnet/agent-framework/sample-agent/telemetry/A365OtelWrapper.cs` is functionally equivalent but uses a separate helper class.

   **S2S path**:
   - Inject `Agent365ObservabilityContext` (singleton registered by `AddAgent365Observability()`) in the constructor
   - **Baggage:** Use `new BaggageBuilder().FromTurnContext(turnContext).Build()` as a separate `using var baggageScope` — `FromTurnContext()` is an extension on `BaggageBuilder` **only**; it does not exist on `InvokeAgentScope` or any scope type
   - **Scope:** Use `InvokeAgentScope.Start(new Request(...), new InvokeAgentScopeDetails(endpoint: new Uri("...")), _obs.AgentDetails, callerDetails)` as a separate `using var scope` — `InvokeAgentScopeDetails` has **no parameterless constructor**; always pass at least `endpoint`. `CallerDetails` with the blueprint sponsor's identity is **required** for S2S traces to appear in the portal
   - **No** per-turn `RegisterObservability()` call; **no** `.FromTurnContext()` chaining on the scope
   - Add inline comment: `// A365 auth mode: S2S — FMI 3-hop chain via ObservabilityTokenService (scope: api://9b975845-388f-4429-889e-eab1ef63949c/.default)`

   Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Node.js

1. **Read** the detected message handler file.

2. **Edit** — Follow the reference pattern in `nodejs-observability.md` ("Message Handler"):
   - **All auth modes:** the handler does **not** touch telemetry tokens. The `tokenResolver` wired in Phase 3 acquires the export token when spans are exported, so there is no per-turn refresh. That resolver is `observability/app-token-resolver.ts` for `obo` / `agentic-user`, and the background token service for `s2s`.
   - Do **NOT** call `AgenticTokenCacheInstance.refreshObservabilityToken(...)` or add a `preloadObservabilityToken` helper. That call exchanges a delegated token, needs admin consent, and the S2S route rejects the result. If an existing handler has one, remove it (see "Migrating delegated telemetry" in Phase 3).
   - The agent identity comes from TurnContext (`recipient.agenticAppId`) through the Phase 5.5 baggage scope, never from config. The only exception is the optional non-agentic fallback described in `nodejs-observability.md`.
   - **Baggage construction is done in Phase 5.5 (canonical pattern), NOT here.** In Phase 5.5 the message handler builds `BaggageBuilderUtils.fromTurnContext(new BaggageBuilder(), turnContext as any).build()` and runs `InvokeAgentScope.start(...)` inside `baggageScope.run(...)`. The `configureA365Hosting(adapter, { enableBaggage: true })` middleware registered in Phase 3 is a fallback that auto-populates baggage outside the handler, but it does NOT cover the scopes you'll add in Phase 5.5 — those need the manual outer wrapping or they get filtered as `Partitioned into 0 identity groups`. Do NOT call `InvokeAgentScope.start` in Phase 4.
   - Add inline comment: `// A365 auth mode: {authMode} — telemetry uses an app-only token on the S2S route`
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Python

1. **Read** the detected message handler file AND `host_agent_server.py`. The helper lives in the HOST file, not the agent class, so it can reach the host's `connection_manager` and be called by activity middleware. Per-turn baggage construction also lives in the handler/middleware layer in `host_agent_server.py`, NOT in `agent.py`.

2. **Edit `host_agent_server.py`** (the host file) — Prefetch the app-only telemetry token per turn following the reference pattern in `python-observability.md`:
   - **OBO paths** (`obo` / `agentic-user`): Resolve `agent_id` and `tenant_id` dynamically from context each turn (never from config), then prefetch the app-only token (non-fatal, wrap in try/except). `a365_token_resolver` is synchronous, so the async FMI acquisition happens here and the resolver only reads the cache:
     ```python
     agent_id  = context.activity.recipient.agentic_app_id
     tenant_id = context.activity.recipient.tenant_id
     await self._setup_observability_token(context, tenant_id, agent_id)
     ```
     The `_setup_observability_token` helper prefetches and caches the app-only token:
     ```python
     async def _setup_observability_token(self, context, tenant_id, agent_id):
         try:
             await OBS_TOKENS.prefetch(self.connection_manager, tenant_id, agent_id)
         except Exception as e:
             logger.warning(f"Failed to acquire observability token: {e}")
     ```
     - `self.connection_manager` is the host's `MsalConnectionManager` (the object passed to `CloudAdapter(connection_manager=...)`). Its default connection is the blueprint credential, so no auth handler or extra settings are involved. `CloudAdapter` does not expose it publicly. If the host only keeps it in a local variable, store it on the host with `self.connection_manager = ...` and pass that same object to the adapter. Never create a second one.
     - Call the helper at the start of **every handler that emits spans**: the message handler and any notification handler (`on_agent_notification`). The sync resolver can only serve tokens a prefetch cached.
     - Do **NOT** call `exchange_token(...)` with `get_observability_authentication_scope()`, or cache its result with `cache_agentic_token`. That is a delegated exchange: it needs admin consent, and the S2S route rejects the token. Replace any existing body that does this (see "Migrating delegated telemetry" in Phase 3).
   - **S2S path**: Do **NOT** call `_setup_observability_token` — token comes from the background token service wired in Phase 3. The handler should NOT touch tokens.
   - **Baggage:** No manual baggage construction in the handler. Phase 3 registered `ObservabilityHostingManager.configure(adapter.middleware_set, ObservabilityHostingOptions(enable_baggage=True))` which auto-populates baggage from `TurnContext` for every request. (Optional fallback if you skipped that: build manually with `populate(builder, context)` then `with builder.build():`.)
   - Add inline comment: `# A365 auth mode: {authMode} — telemetry uses an app-only token on the S2S route`
   - Mark all new lines with: `# A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

4. **TaskUpdate** — Mark complete.

---

## Phase 5: Implement App-only Token Resolver

**TaskCreate** — "Implement app-only token resolver with caching"

Every path exports with an app-only token for the exporting agent identity. `obo` / `agentic-user` agents use the app-only resolver scaffold, which reuses the hosting connection (blueprint credential). `s2s` agents use the background token-service scaffold. Phase 3 normally writes these files; this phase makes sure they exist on re-runs or partial states. **Never** fall back to the distro's delegated token caches (`IExporterTokenCache<AgenticTokenStruct>`, `AgenticTokenCacheInstance`, `AgenticTokenCache`) or to a legacy `Use_Custom_Resolver` cache of delegated tokens.

### For .NET AgentFramework (OBO / agentic-user path)

**Check** that `Observability/AgentAppTokenResolver.cs` exists and is registered with `builder.Services.AddSingleton<AgentAppTokenResolver>()`. Also check that `o.Agent365.UseS2SEndpoint = true` and `o.Agent365.TokenResolver` are set, with `obsTokens` resolved from `app.Services` after `Build()`. If any piece is missing, add it from `dotnet-observability.md` ("Scaffold: `Observability/AgentAppTokenResolver.cs`").

### For .NET AgentFramework (S2S path)

The `ObservabilityTokenService` background service (created in Phase 3 via the scaffold) acquires and refreshes the Observability API token automatically via the FMI 3-hop chain (Blueprint → Agent Identity → Observability API) — no manual `TokenResolver` delegate needed beyond the cache read wired in Phase 3.

1. **Check** if `Observability/ObservabilityServiceExtensions.cs` and `Observability/ObservabilityTokenService.cs` exist. If yes, **skip** — they were already created in Phase 3.

2. **If absent** (Phase 3 was skipped or re-running the skill on a partial state), create them now following the S2S scaffold patterns in `dotnet-observability.md`. These files provide `AddAgent365Observability()` (DI extension registering `AddServiceTracingExporter`, `ObservabilityTokenService`, and `Agent365ObservabilityContext`) and `ObservabilityTokenService` (background service that acquires the Observability API token via the FMI 3-hop chain and refreshes it every 50 minutes).

### For Node.js (OBO / agentic-user path)

**Check** that `observability/app-token-resolver.ts` exists. Also check that `useMicrosoftOpenTelemetry()` passes `useS2SEndpoint: true` and `tokenResolver: appTokenResolver`, and that `getObsConnection` is assigned once the adapter exists. If anything is absent, add it from `nodejs-observability.md` ("App-only Token Resolver Scaffold").

### For Node.js (S2S path)

**Check** if `observability/observability-token-service.ts` exists. If yes, **skip** — it was created in Phase 3.

**If absent** (Phase 3 was skipped or re-running), create `observability/token-cache.ts` and `observability/observability-token-service.ts` now using the scaffold from `nodejs-observability.md` (S2S section). The token service uses MSAL (`@azure/msal-node`) with `fmiPath` to acquire tokens via the FMI 3-hop chain targeting scope `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. Call `startTokenService(config)` at app startup and pass `tokenResolver` from the cache module to `useMicrosoftOpenTelemetry()`.

### For Python (OBO / agentic-user path)

**Check** that `observability/app_token_resolver.py` exists and that `use_microsoft_opentelemetry()` receives `a365_token_resolver=OBS_TOKENS.resolve` and `a365_use_s2s_endpoint=True`. Also check that the Phase 4 `_setup_observability_token` helper awaits `OBS_TOKENS.prefetch(...)`. If anything is absent, add it from `python-observability.md` ("App-only Token Resolver Scaffold").

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

**The pattern is per-stack — read `agentStack` from `.a365-workspace-detection.local.json` and branch:**

- **`LangChain`** or **`OpenAI`** → canonical wrapping pattern below (verified against the LangChain + OpenAI samples).
- **`Claude`** → **InferenceScope-only**, no outer baggageScope, no InvokeAgentScope. The Claude sample (`Agent365-Samples/nodejs/claude/sample-agent/src/client.ts`) wraps each LLM call individually in `src/client.ts`. Skip the canonical pattern below; follow the InferenceScope-only shape from the Claude sample instead. Tell the user: *"Claude SDK uses a different observability shape — wrapping per LLM call in client.ts instead of around the message handler. InvokeAgentScope is not used."*
- **`Semantic Kernel`** or **`Google ADK`** → handled by Phase 0.6 framework guard (soft-warn — auto-instrumentation may not patch the LLM library; manual `InferenceScope.start` wrapping required around each LLM call).

For LangChain + OpenAI, follow the reference patterns in `nodejs-observability.md` for each scope. **The wrapping order is non-negotiable — wrong order produces silent span drops** (logged as `Partitioned into 0 identity groups`).

**Canonical pattern (generate exactly this shape):**

```typescript
const baggageScope = BaggageBuilderUtils                                          // STEP 1 — outer baggage scope
  .fromTurnContext(new BaggageBuilder(), turnContext as any)
  .sessionDescription('agent-turn')
  .build();

await baggageScope.run(async () => {                                              // STEP 2 — scopes run INSIDE baggage
  const scope = InvokeAgentScope.start(request, scopeDetails, agentDetails, callerDetails);
  try {
    await scope.withActiveSpanAsync(async () => {
      // InferenceScope / ExecuteToolScope / agent invocation here
    });
  } finally { scope.dispose(); }
});
```

**Why this exact shape:**
- **No token step in the handler.** The app-only `tokenResolver` (Phase 3) acquires and caches the export token on demand, so a cold turn does not need a preload. Do not reintroduce `preloadObservabilityToken` / `refreshObservabilityToken`.
- **Without the outer `baggageScope.run` wrapping `InvokeAgentScope.start`**, the spans have no `microsoft.tenant.id` / `gen_ai.agent.id` baggage attached — the exporter filters them as `Partitioned into 0 identity groups (N spans skipped)` and they never reach MAC.

**Additional rules:**
- **Import `BaggageBuilder` AND `BaggageBuilderUtils`** from `@microsoft/opentelemetry`. Both are required.
- **`InvokeAgentScopeDetails`** is `{}` in Node.js — endpoint is optional and unused. Do NOT generate `endpoint: new Uri(...)` — that's the .NET API surface and will not compile in TypeScript.
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

5. **S2S route (all auth modes) and S2S-only additions:**
   - All languages: the S2S route flag is set in code in Phase 3 for **every** auth mode:
     `o.Agent365.UseS2SEndpoint = true` (.NET), `useS2SEndpoint: true` (Node), or
     `a365_use_s2s_endpoint=True` (Python). Keep it in code: Python's `A365_USE_S2S_ENDPOINT`
     env fallback is fragile (the code validator flags env-only selection), and the legacy
     `AGENT365_USE_S2S_ENDPOINT` env var is ignored.
   - `obo` / `agentic-user`: no extra settings — the app-only resolver reads the blueprint
     credential from the existing connection settings that `a365 setup all` wrote: `Connections`
     (.NET), `connections__service_connection__settings__*` (Node.js), or
     `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__*` (Python).
   - `s2s`, .NET: add `ClientId`, `ClientSecret`, and `UseManagedIdentity: false` (for
     local dev — MSI fails off-Azure with `CredentialUnavailableError`) under
     `Agent365Observability`.

6. **Inform the user** when:
   - `AgentBlueprintId` / `TenantId` are empty → "run `a365 setup` to populate".
   - Exporter is `false` (Node.js / Python local dev) → "instrumented but
     disabled; set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` to start exporting".

7. **Stamp the verbose-logging pair into `.env`** (Node.js / Python) — `OTEL_LOG_LEVEL=INFO` (OpenTelemetry SDK's own internal logger) **and** `A365_OBSERVABILITY_LOG_LEVEL=info|warn|error` (pipe-separated levels emitted by the A365 exporter). For .NET, write the equivalent `Logging.LogLevel.Microsoft.Agents.A365.Observability: Information` to `appsettings.json` AND set `OTEL_LOG_LEVEL=INFO` / `A365_OBSERVABILITY_LOG_LEVEL=info|warn|error` as env vars (.NET reads both forms). Recommended baseline: `INFO` + `info|warn|error` in prod; users can trim to `WARN` + `warn|error` to reduce noise. Write them as a labeled `# ── Observability verbose logging ──` block so the two vars stay grouped. **Additive — never overwrite** values the user has set.

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

## Phase 8.5: First-run smoke test (Node.js / Python only)

**TaskCreate** — "Verify a span actually exports"

Without this phase the skill ends "instrumented successfully" but the user has no way to know whether spans actually reach MAC until 15-90 min later when indexing catches up. This phase runs the agent for ~30 seconds with verbose-logging env vars enabled, sends one message, and greps the log for the specific line that confirms export succeeded. Pass/fail is visible immediately.

**Node.js:**

1. **Bash** (background) — start the agent with verbose logs enabled:
   ```bash
   OTEL_LOG_LEVEL=INFO A365_OBSERVABILITY_LOG_LEVEL=info|warn|error npm start > .a365-smoketest.log 2>&1 &
   ```
   Use Claude Code's `run_in_background: true` so the agent stays up while we probe.

2. **Wait ~5s for boot**, then send a test message to `/api/messages` (or instruct the user to send one via AgentsPlayground / Teams).

3. **Bash** — after ~30s, check the log for the export-success line:
   ```bash
   grep -E "export-group succeeded|exported successfully|rejectedSpans:0" .a365-smoketest.log | head -5
   ```

4. **Interpret:**
   - **Match found** → ✅ spans are exporting. Tell user: *"Verified — at least one identity-group exported successfully. MAC indexing takes 15-90 min; check `admin.cloud.microsoft → Advanced Hunting → CloudAppEvents` filtered by AgentId = `<AUID>` after that delay."*
   - **No match, only `Partitioned into 0 identity groups` lines** → ❌ silent drop. Most likely: missing outer baggage scope (Phase 5.5) OR missing exporter flag (`a365.enableObservabilityExporter: true` / env var). Re-check Phases 3 + 5.5.
   - **No match, errors visible** → surface the exact error to the user verbatim; do NOT proceed.

**Python:** same flow with `OTEL_LOG_LEVEL` + `A365_OBSERVABILITY_LOG_LEVEL` env vars and `python host_agent_server.py` instead of `npm start`.

**.NET:** skip this phase — the .NET CLI's own boot-time logging covers the verification path. If the user wants stricter checking, set `Logging.LogLevel.Microsoft.Agents.A365.Observability: Information` in `appsettings.json` and grep `dotnet run` output for `"Sending N spans to ..."` / `"HTTP 202 exporting spans"`.

**TaskUpdate** — Mark complete with the result (pass / fail / skipped).

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
      - Node.js / Python: set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env (or `a365.enableObservabilityExporter: true` in code — both required alongside `a365.enabled: true`)
   2. Run your agent and verify traces appear in the Observability dashboard.

   **What to expect for MAC visibility (first-run reality check):**
   - **Indexing lag: 15–90 minutes** between first successful export and spans appearing in `admin.cloud.microsoft → Advanced Hunting → CloudAppEvents`. If you query immediately after instrumenting, you'll see empty results — that's not a bug.
   - **Instance approval required.** Spans only attribute to a `CloudAppEvents` row when the AI Teammate's agent instance has been approved at `admin.cloud.microsoft/#/agents/all/requested` and an Agentic User UPN has been issued. Without that, exported spans land but don't surface in MAC queries.
   - **KQL filter MUST use the AUID, NOT the blueprint id.** The `AgentId` column in `CloudAppEvents` is the runtime AUID resolved from `turnContext.activity.recipient.agenticAppId`. For AI Teammates, the `agent365Observability__agentId` env var that `a365 setup all` stamps into `.env` is the BLUEPRINT id, and filtering by that value returns empty results. Get the AUID from your agent logs (the exporter logs `Obtained token for agent <AUID> tenant ...`) or from `recipient.agenticAppId` in any inbound activity.
   - **OBS authorization.** Telemetry is exported over the S2S route with an app-only token. Blueprint agents: no OBS permission or consent step — registered instances are authorized without `Agent365.Observability.OtelWrite` (subject to service policy); on 403 `insufficient_scope`, run `a365 setup all --agent-registration-only`. AI Teammates: complete the Observability API S2S app-role action item that `a365 setup all --aiteammate` printed, if it is still pending.

   **Verbose logging — only enable when actively debugging:**
   - Node.js / Python: uncomment `OTEL_LOG_LEVEL=INFO` AND `A365_OBSERVABILITY_LOG_LEVEL=info|warn|error` in `.env`. **Both** are required to see `[Agent365Exporter]` activity — the exporter uses a wrapped logger that defaults to silent.
   - Grep for `exported successfully` / `export-group succeeded` to confirm spans are flowing; `Partitioned into 0 identity groups (N spans skipped)` for spans outside an active baggage scope is **expected** (early framework / middleware / health-ping spans) — not an error.
   3. [If authMode = obo] Confirm the workload (MCP / Graph) OBO token exchange works. Telemetry does not use it — it uses the app-only resolver.
      - Signed-in user sub-type: verify the signed-in user's token is passed correctly.
        → OBO flow docs: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
      - Agentic identity sub-type: ensure the agentic user identity has been provisioned in Azure AD.
        → Identity docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/identity
   4. [If authMode = agentic-user] Confirm the agentic-user M365 license and identity are provisioned.
      → Identity docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/identity
   5. [If authMode = s2s] No user token required — verify agent blueprint credentials and the agent identity (`AgentId`) are configured.
      → Auth flow docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/authentication-flow
   6. [If delegated telemetry wiring was migrated] List each replaced call (per-turn refresh / token registration / delegated resolver) so the user can review the diff.

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
- Skip code edits only if observability is already wired **the current way**. Marker comments must be present, the S2S route flag must be set (`useS2SEndpoint: true` / `a365_use_s2s_endpoint=True` / `o.Agent365.UseS2SEndpoint = true`), and no delegated-telemetry signal may remain: `refreshObservabilityToken(..., authorization)`, `AgenticTokenCacheInstance.getObservabilityToken`, `AgenticTokenStruct` / `RegisterObservability(..., AgenticTokenStruct)`, `exchange_token(...)` for the observability scope, `cache_agentic_token`, or an `AgenticTokenCache` resolver. Marker comments alone are not enough — code written by earlier versions of this skill carries them on the delegated wiring. If any delegated signal is present or the route flag is missing, run "Migrating delegated telemetry" (Phase 3) instead of skipping.
- Update configuration only if values are missing
- Always revalidate the build

---

## Observability Known Issues and Workarounds

### Authorization — registration, not OtelWrite

Telemetry is exported over the S2S route with an app-only token for the agent identity. Registered agent instances are authorized on that route **without** `Agent365.Observability.OtelWrite` or admin consent (subject to service policy). `a365 setup all` no longer requests Observability API permissions for blueprint agents, and a failed or unverifiable registration now fails setup.

- **403 `insufficient_scope` on export** → the agent instance is not registered and has no `OtelWrite` application role. Blueprint agents: run `a365 setup all --agent-registration-only` (idempotent), then retry. AI Teammates: that flag does not apply — complete the Observability API S2S app-role action item `a365 setup all --aiteammate` prints (the application role below).
- **Application role (AI Teammates, and fallback for blueprint agents):** a Global Administrator can grant the `Agent365.Observability.OtelWrite` **application** role on the Blueprint, which agent identities inherit. The S2S route accepts it. Use the PowerShell steps that `a365 setup all` prints, or the Entra portal: App registrations > Blueprint > API permissions > APIs my organization uses > `9b975845-388f-4429-889e-eab1ef63949c` > **Application** `Agent365.Observability.OtelWrite` > Grant admin consent.
- **Do not** add the delegated `OtelWrite` scope or run a delegated consent flow for telemetry. Delegated tokens are rejected by the S2S route. Only agents still on an old SDK that exports over the delegated route need that grant, and they should migrate instead (see "Migrating delegated telemetry" in Phase 3).

### Node.js and .NET SDK `/otlp/` URL Path Bug

The Node.js SDK (`@microsoft/agents-a365-observability@0.2.0-preview.5`) and .NET SDK (`0.3.4-beta`) include `/otlp/` in the S2S export URL path. The Power Platform PFAT gateway returns `401 MSAuth10AuthenticatorTypeUnknown` on this path. Python SDK `0.1.0` does NOT include `/otlp/` and works correctly.

**Status:** Awaiting SDK fix. No workaround should be applied in generated code — this is an SDK-level issue.

### S2S Endpoint Path — Set the Route Flag in Every Auth Mode

The distros default to the delegated route (`/observability/tenants/{tenantId}/otlp/agents/{agentId}/traces`), which rejects app-only tokens. Every agent — `agentic-user`, `obo`, and `s2s` — must select the S2S route (`/observabilityService/...`) explicitly:

**Node.js (`@microsoft/opentelemetry` 1.0+):**
```typescript
useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
    useS2SEndpoint: true,   // required in every auth mode
    tokenResolver: appTokenResolver,  // or the s2s token-cache resolver
  },
});
```
The old `AGENT365_USE_S2S_ENDPOINT` env var workaround and custom `spanProcessors` workarounds are no longer needed.

**Python (`microsoft-opentelemetry` 1.1+):** pass `a365_use_s2s_endpoint=True` to `use_microsoft_opentelemetry(...)`.

**.NET (`Microsoft.OpenTelemetry` 1.0.x GA):**

The `UseMicrosoftOpenTelemetry()` builder extension does NOT set `UseS2SEndpoint = true`. Without it, the exporter posts to `/observability/` instead of `/observabilityService/`, causing HTTP 401. Set it explicitly. On 1.0.3+ the options live on `o.Agent365`; on 1.0.2 and earlier, use `o.Agent365.Exporter` instead:
```csharp
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Exporters = ExportTarget.Agent365 | ExportTarget.Console;
    o.Agent365.UseS2SEndpoint = true;  // ← Required in every auth mode
    // obo / agentic-user: AgentAppTokenResolver; s2s: the ServiceTokenCache read shown in the reference.
    o.Agent365.TokenResolver = (agentId, tenantId) =>
        obsTokens?.ResolveAsync(agentId, tenantId) ?? Task.FromResult<string?>(null);
});
```

**URL paths:**
- Legacy delegated route (do not use): `observability/tenants/{tenantId}/otlp/agents/{agentId}/traces`
- S2S route (all agents): `observabilityService/tenants/{tenantId}/otlp/agents/{agentId}/traces`

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
