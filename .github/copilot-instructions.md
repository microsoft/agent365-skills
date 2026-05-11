# Agent 365 Skills — GitHub Copilot Instructions

This repository contains six skills for instrumenting and registering Microsoft Agent 365 agents.
When a user asks for any of the trigger phrases below, follow the corresponding SKILL.md exactly.

---

## Skill: make-ai-teammate

**Full instructions:** [plugins/agent365/skills/make-ai-teammate/SKILL.md](../plugins/agent365/skills/make-ai-teammate/SKILL.md)

**Trigger phrases:**
- "make this agent an ai teammate"
- "transform this agent into an ai teammate"
- "publish this agent to teams"
- "make this agent available in microsoft teams"
- "publish this agent to microsoft copilot"
- "add teams support to this agent"
- "set up ai teammate hosting for this agent"
- "convert this agent to a teams agent"
- "make this agent work with microsoft 365"

**Summary of what this skill does:**
1. Detects the agent language/framework across all supported stacks: .NET (AgentFramework, Semantic Kernel), Node.js (LangChain, OpenAI Agents SDK, Claude SDK, Semantic Kernel, Google ADK), Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK). If no agent is found in the folder, offers to clone a sample agent from Agent365-Samples and continues from there.
2. Adds the hosting layer — Express + CloudAdapter (Node.js), ASP.NET Core (.NET), or aiohttp (Python)
3. Creates the AgentApplication subclass with message routing, typing indicators, and email notification handling
4. Writes a `ToolingManifest.json` pre-populated with Calendar and Mail WorkIQ servers, and all required environment variables
5. Runs `a365 setup all --aiteammate` — creates the Blueprint and Agentic User identity in Entra ID (use `--m365` too for M365-registered AI Teammates with Teams/Copilot integration)
6. Updates `manifest.json` with the correct Bot ID, App ID, and valid domains, then runs `a365 publish` to upload to the Teams App Catalog and `a365 deploy` to make the agent live; configures the bot endpoint in Teams Developer Portal and runs `a365 create-instance` to create the Agentic User UPN; guides a smoke test in Teams or AgentsPlayground
7. Offers `instrument-observability` (Strongly Recommended) — if yes, reads and follows instrument-observability/SKILL.md
8. Offers `add-workiq-tools` (Optional) — if yes, reads and follows add-workiq-tools/SKILL.md
   Both offers are mandatory checkpoints: skill does not end until each is either invoked or explicitly skipped by the user.

**Reference patterns:**
- Node.js: [plugins/agent365/skills/make-ai-teammate/references/nodejs-ai-teammate.md](../plugins/agent365/skills/make-ai-teammate/references/nodejs-ai-teammate.md)
- Node.js notifications: [plugins/agent365/skills/make-ai-teammate/references/nodejs-notifications.md](../plugins/agent365/skills/make-ai-teammate/references/nodejs-notifications.md)
- .NET: [plugins/agent365/skills/make-ai-teammate/references/dotnet-ai-teammate.md](../plugins/agent365/skills/make-ai-teammate/references/dotnet-ai-teammate.md)
- Python: [plugins/agent365/skills/make-ai-teammate/references/python-ai-teammate.md](../plugins/agent365/skills/make-ai-teammate/references/python-ai-teammate.md)

---

## Skill: a365-setup

**Full instructions:** [plugins/agent365/skills/a365-setup/SKILL.md](../plugins/agent365/skills/a365-setup/SKILL.md)

**Trigger phrases:**
- "run a365 setup"
- "create blueprint"
- "register agent"
- "setup agent blueprint"
- "onboard agent"
- "create agent blueprint"
- "run cli setup"
- "run a365 register"
- "register blueprint"
- "provision agent"
- "publish agent"

**Summary of what this skill does:**
0. Outputs a mandatory intro message first — describes the 4-step flow (detect → confirm → auth mode → capabilities) so the developer knows what to expect before any commands run
1. Detects agent stack, language, CEA status (`usesTeamsOrCopilot`), and whether an existing blueprint config is present (`hasBlueprintConfig` from `a365.config.json` / `a365.generated.config.json`); shows all detections in a single summary message
   - **Blueprint question:** if `hasBlueprintConfig = 1`, asks the developer whether to reuse the existing blueprint (provide ID, skip `setup all`) or create a fresh one — never assumes
2. Asks `authMode` (`obo` / `agentic-user` or `s2s` (autonomous)) **before** presenting capabilities — WorkIQ is hidden from the menu when `authMode = "s2s"` (WorkIQ requires a user token); then asks which capabilities to enable: Register, Observability, WorkIQ, or AI Teammate
   - **CEA auto-route:** if `usesTeamsOrCopilot = 1` (Custom Engine Agent), automatically sets all 4 capabilities (Register, Observability, WorkIQ, AI Teammate) without presenting a menu — CEA agents are always AI Teammates
3. Derives `agentType` from the selection (`isAITeammate = true` → `"ai-teammate"`, else `"system-agent"`); writes `.a365-workspace-detection.json` with `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `hasBlueprintConfig`, `hasAITeammateChanges`, `agentType`, `authMode`, `reuseBlueprint`, and `existingBlueprintId` — downstream skills (`instrument-observability`, `add-workiq-tools`) read this to skip re-asking
4. Runs a full system prerequisite scan (parallel version checks) and shows a ✅/❌ summary — **only processes sections for ❌ missing or outdated tools; skips ✅ tools entirely (no reinstall, no re-prompt)**. Each install is offered with a platform-specific command (Windows: winget, macOS: brew, Linux: apt) and requires user confirmation. Runs `a365 setup requirements` after all tools are confirmed.
5. Validates Azure CLI login using `az login --allow-no-subscriptions` (plain `az login` fails for accounts with no Azure subscription) and validates Entra ID roles
6. Delegates to `make-ai-teammate` for the AI Teammate path, or to `make-a365-agent` for all other paths — passes `reuseBlueprint` and `existingBlueprintId` when the developer chose to reuse an existing blueprint

**This skill does NOT:** run `a365 setup all` itself — it delegates that to `make-ai-teammate` or `make-a365-agent`.

---

## Skill: make-a365-agent

**Full instructions:** [plugins/agent365/skills/make-a365-agent/SKILL.md](../plugins/agent365/skills/make-a365-agent/SKILL.md)

**Trigger phrases:**
- "provision agent with a365"
- "run a365 setup all"
- "create a365 blueprint"
- "Registration setup"
- "observability setup"
- "register this agent"
- "set up agent for observability"
- "add workiq to this agent"
- "make this a custom engine agent"

**Summary of what this skill does:**
0. Checks for an existing blueprint config (`a365.config.json` / `a365.generated.config.json`) **before collecting any inputs** — if found, asks the developer whether to reuse the existing blueprint (skips `a365 setup all`) or create a fresh one
1. Collects agent name (supports `default` → `developer` fallback; passes name verbatim — no case normalization) and project directory; asks whether the agent is cloud-hosted or local/dev-tunnel (guides through `devtunnel create/host` if local)
2. Shows a dry-run preview of all `a365` operations before applying anything
3. Runs `a365 setup all` — creates the Blueprint and Entra ID permissions (add `--m365` for CEA agents; run `a365 setup permissions bot` after for Messaging Bot API grants). Supports `--authmode obo|s2s` to control permission type. Skipped entirely when `reuseBlueprint = true`. Handles Windows Account Manager (WAM) prompts — if a native sign-in dialog appears, instructs user to complete it without killing the process. Auto-falls back to device code flow if blocked by Conditional Access Policy.
4. After setup, always offers `instrument-observability` and `add-workiq-tools` as optional add-ons
5. Guides the Global Administrator consent handoff: Entra portal (App registrations > Blueprint app > API permissions > Grant admin consent) or PowerShell script from `a365 setup all` output

**Normally delegated to from `a365-setup`** after CLI and Azure prerequisites are confirmed. Can also be invoked directly.

---

## Skill: add-workiq-tools

**Full instructions:** [plugins/agent365/skills/add-workiq-tools/SKILL.md](../plugins/agent365/skills/add-workiq-tools/SKILL.md)

**Trigger phrases:**
- "add workiq tools"
- "add a365 tools"
- "add work intelligence tools"
- "add microsoft 365 tools"
- "wire up workiq"
- "add MCP servers to this agent"
- "add work iq mail"
- "add work iq calendar"

**Summary of what this skill does:**
1. Loads detection cache (`agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `agentType`, `authMode`); asks agent kind + auth mode if not cached; writes `agentType`+`authMode` back to `.a365-workspace-detection.json` so subsequent skills skip re-asking
   - **S2S block:** if `authMode = s2s`, the skill exits immediately — WorkIQ is not available for s2s (autonomous) agents (requires a delegated OBO token at runtime)
2. Runs `a365 develop list-available` to show the MCP server catalog
3. Adds selected servers via `a365 develop add-mcp-servers` (updates `ToolingManifest.json`)
4. Wires `McpToolRegistrationService` in the agent code (.NET, Node.js, or Python)
5. Guides the permissions handoff to the Global Administrator (`a365 setup permissions mcp`; supports V1/V2 mixed manifests, use `--remove-legacy-scopes` for V2 migration)

**Prerequisite:** `a365-setup` must be run first. Reads `.a365-workspace-detection.json` to skip re-detection.

**Reference patterns:**
- .NET: [plugins/agent365/skills/add-workiq-tools/references/dotnet-workiq.md](../plugins/agent365/skills/add-workiq-tools/references/dotnet-workiq.md)
- Node.js: [plugins/agent365/skills/add-workiq-tools/references/nodejs-workiq.md](../plugins/agent365/skills/add-workiq-tools/references/nodejs-workiq.md)
- Python: [plugins/agent365/skills/add-workiq-tools/references/python-workiq.md](../plugins/agent365/skills/add-workiq-tools/references/python-workiq.md)

---

## Skill: instrument-observability

**Full instructions:** [plugins/agent365/skills/instrument-observability/SKILL.md](../plugins/agent365/skills/instrument-observability/SKILL.md)

**Trigger phrases:**
- "instrument observability for this agent"
- "add a365 observability"
- "add observability"
- "enable tracing"
- "add otel"
- "instrument agent"
- "add telemetry"
- "observe this agent"
- "set up observability"
- "add tracing"
- "emit traces"
- "instrument for defender"
- "instrument traces"
- "add a365 traces"
- "wire up observability"
- "make my agent a365 compliant"
- "make this agent a365 compliant"
- "make this agent a365 ready"
- "prepare agent for a365"

**Summary of what this skill does:**
1. Loads detection cache; asks a two-stage question (agent kind + auth mode) if not already cached; writes `agentType`+`authMode` back to `.a365-workspace-detection.json` so `add-workiq-tools` and future runs skip re-asking
2. Installs the observability packages: unified distros for all paths — `Microsoft.OpenTelemetry` for .NET, `@microsoft/opentelemetry` for Node.js, `microsoft-opentelemetry` for Python. Legacy individual packages (`Microsoft.Agents.A365.Observability.*`, `@microsoft/agents-a365-*`, `microsoft-agents-a365-observability-*`) still accepted by the validator but no longer generated.
3. **OBO path** (`obo` / `agentic-user`): calls `useMicrosoftOpenTelemetry()` (Node.js/Python) or `UseMicrosoftOpenTelemetry()` + `AddAgenticTracingExporter()` (.NET) with token resolver wired to per-turn token refresh
4. **S2S path (all languages)**: Creates a scaffold token-service file that acquires/refreshes the Observability API token (`api://9b975845-388f-4429-889e-eab1ef63949c/.default`) via MSAL with FMI path support every 50 min.
   - **.NET**: creates `Observability/ObservabilityServiceExtensions.cs` + `Observability/ObservabilityTokenService.cs`; uses MSAL `ConfidentialClientApplicationBuilder` with `.WithFmiPath()` for FMI 3-hop chain; wires `UseMicrosoftOpenTelemetry()` + `AddAgent365Observability()`; in the message handler uses `new BaggageBuilder().FromTurnContext(turnContext).Build()` (separate `using var`) and `InvokeAgentScope.Start(request, new InvokeAgentScopeDetails(endpoint: new Uri(...)), agentDetails, callerDetails)` (separate `using var`) — **NOT chained; `FromTurnContext()` is a `BaggageBuilder` extension only**; `CallerDetails` with blueprint sponsor identity is **required** for S2S traces to appear
   - **Node.js**: creates `observability/observability-token-service.ts` (exports `startTokenService()`) + `observability/token-cache.ts` (exports `tokenResolver`); uses MSAL with `fmiPath` for FMI chain; calls `useMicrosoftOpenTelemetry({ spanProcessors: [new BatchSpanProcessor(new Agent365Exporter({ useS2SEndpoint: true, tokenResolver }))] })` — do NOT pass `a365: { enabled: true }` for S2S; also sets `AGENT365_USE_S2S_ENDPOINT=true` and `ENABLE_A365_OBSERVABILITY_EXPORTER=false` in `.env`
   - **Python**: creates `observability/observability_token_service.py` + `observability/token_cache.py`; uses MSAL with `fmi_path` for FMI chain; calls `use_microsoft_opentelemetry(enable_a365=True, a365_token_resolver=...)` from `microsoft.opentelemetry`
5. Updates `appsettings.json` (for .NET) with `Agent365Observability` section; S2S adds `ClientId`, `ClientSecret`, and `UseManagedIdentity: true`; creates `appsettings.Development.json` with exporter disabled. Note: `a365 setup all` (CLI 1.1+) auto-writes placeholder sections — skill checks for existing placeholders before creating from scratch.
6. Validates the build passes

**Auth mode note:** All three `authMode` values use an auth handler reference in SDK code — the difference is Azure AD provisioning, not code structure. For .NET OBO: `authHandlerName` comes from config (`AgentApplication:AgenticAuthHandlerName`), not hardcoded. For Node.js OBO: pass `agentApplication.authorization` (the auth object, not a string) to `AgenticTokenCacheInstance.RefreshObservabilityToken`. For Python OBO: use `auth_handler_id=self.auth_handler_name` (from config) in `exchange_token()` — never hardcode `"AGENTIC"`. Agent IDs are always resolved dynamically from TurnContext (`agenticAppId` / `agentic_app_id`), never from config. S2S is supported for .NET, Node.js, and Python.

**Prerequisite:** `a365-setup` must be run first. Reads `.a365-workspace-detection.json` to skip re-detection.

**Reference patterns:**
- .NET: [plugins/agent365/skills/instrument-observability/references/dotnet-observability.md](../plugins/agent365/skills/instrument-observability/references/dotnet-observability.md)
- Node.js: [plugins/agent365/skills/instrument-observability/references/nodejs-observability.md](../plugins/agent365/skills/instrument-observability/references/nodejs-observability.md)
- Python: [plugins/agent365/skills/instrument-observability/references/python-observability.md](../plugins/agent365/skills/instrument-observability/references/python-observability.md)

---

## Skill: test-local

**Full instructions:** [plugins/agent365/skills/test-local/SKILL.md](../plugins/agent365/skills/test-local/SKILL.md)

**Trigger phrases:**
- "test this agent locally"
- "run agent locally"
- "open agentsplayground"
- "launch local test session"
- "local test this agent"
- "test without deploying"

**Summary of what this skill does:**
1. Detects agent language (.NET → port 5000, Node.js/Python → port 3978); detects Python command (`python3` on macOS/Linux, `python` on Windows)
2. Checks `agentsplayground` CLI is installed — installs automatically if missing
3. Checks language-specific build tools are present; offers to install any that are missing with platform-specific commands (Windows: winget, macOS: brew, Linux: apt)
4. Builds the agent to confirm there are no compile errors
5. Asks the user before launching — either starts the agent + AgentsPlayground automatically, or shows the commands to run manually in two terminals
6. Guides a local test: what to send, what terminal logs to watch for (observability span lines if instrumented), how to stop (`Ctrl+C`)

**Works for any AI Teammate stack:** AgentsPlayground connects to `/api/messages` over HTTP — the LLM framework on the server is invisible to it.

---

## Agent Detection

When identifying the agent type, follow the heuristics in:
[plugins/agent365/shared/agent-detection.md](../plugins/agent365/shared/agent-detection.md)

Key rules:
- `.csproj` referencing `Microsoft.Agent.*` or `Microsoft.Agents.*` → **.NET AgentFramework**
- `package.json` referencing `@langchain/*` → **Node.js LangChain**
- `package.json` referencing `openai-agents` → **Node.js OpenAI Agents SDK**
- `package.json` referencing `@anthropic-ai/sdk` → **Node.js Claude SDK**
- `.py` files + `pyproject.toml` or `requirements.txt` referencing `microsoft-agents-*` → **Python AgentFramework**
- `.py` files + `langchain` in requirements → **Python LangChain**

---

## Code Conventions

All code added by observability instrumentation must be marked with the language-appropriate comment form:
- C# / JavaScript / TypeScript: `// A365 Observability — best-effort instrumentation (verify against official sample)`
- Python: `# A365 Observability — best-effort instrumentation (verify against official sample)`

**Observability API correctness rules (do not deviate):**
- Node.js `AgentDetails`: field is `agentAUID` (uppercase UID) — `agentAuid` causes a TypeScript compile error
- Node.js `extensions-openai`: requires `@openai/agents ^0.7.0` peer dep — NOT the `openai` npm package or `@azure/openai`
- Python: for the 0.3.x observability API set, always use `pip3 install --pre ... 2>/dev/null || pip install --pre ...` for `microsoft-agents-a365-observability-core`, `microsoft-agents-a365-observability-runtime`, and `microsoft-agents-a365-observability-hosting` — mixing prerelease and stable packages can produce incompatible APIs. Use `pip3` first (macOS/Linux default), fall back to `pip` (Windows)
- .NET S2S: `FromTurnContext()` is only on `BaggageBuilder` — never chain it on `InvokeAgentScope.Start()`
- .NET S2S: `InvokeAgentScopeDetails` has no parameterless constructor — always pass `endpoint: new Uri(...)`
- .NET OBO: `RegisterObservability` takes four args: `agentId, tenantId, AgenticTokenStruct, scopes`

All code added by WorkIQ wiring must be marked with the language-appropriate comment form:
- C# / JavaScript / TypeScript: `// A365 WorkIQ — added by add-workiq-tools skill`
- Python: `# A365 WorkIQ — added by add-workiq-tools skill`

Skills are **additive and idempotent** — never delete or restructure existing agent code.

## Skill Dependency Chain

```
a365-setup  →  make-ai-teammate    (AI Teammate path)
            →  make-a365-agent     (Registration / Observability / WorkIQ paths)

make-ai-teammate  →  instrument-observability  (Strongly Recommended)
                  →  add-workiq-tools          (Optional)

make-a365-agent   →  instrument-observability  (Optional — always offered)
                  →  add-workiq-tools          (Optional — always offered)

test-local  (no prerequisite — works after any step)
```
