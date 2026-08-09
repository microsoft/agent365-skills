# Agent 365 Plugin — Development Guidelines

This file documents conventions for contributors working on the `agent365` plugin skills.
Read this before making any changes to skill files.

---

## Plugin Purpose

This plugin instruments and configures A365 agents. It contains eight skills:

| Skill | Command | Trigger |
|-------|---------|---------|
| `make-ai-teammate` | `/agent365:make-ai-teammate` | "make this agent an AI Teammate", "add AI Teammate hosting", "transform agent to Teams agent" |
| `a365-setup` | `/agent365:a365-setup` | "run a365 setup", "create blueprint", "register agent" |
| `make-a365-agent` | `/agent365:make-a365-agent` | "provision agent with a365", "Registration setup", "observability setup", "register this agent" |
| `add-workiq-tools` | `/agent365:add-workiq-tools` | "add workiq tools", "add MCP servers to this agent" |
| `instrument-observability` | `/agent365:instrument-observability` | "instrument observability", "add a365 observability" |
| `instrument-security` | `/agent365:instrument-security` | "instrument security", "add defender prevention", "block malicious tool calls" |
| `a365-code-validator` | `/agent365:a365-code-validator` | "validate a365 code", "debug MAC activity", "check A365 exporter flags" |
| `test-local` | `/agent365:test-local` | "test this agent locally", "open agentsplayground" |

**Supported languages for `make-ai-teammate`:** .NET (AgentFramework · Semantic Kernel) · Node.js (LangChain · OpenAI Agents SDK · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

**Supported languages for `instrument-observability`:** .NET AgentFramework · Node.js (LangChain · OpenAI · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

**Supported platforms for `instrument-security`:** Google ADK (Vertex AI Agent Engine) ✅ verified end-to-end. .NET and Node.js ship best-effort adapters — protocol and auth layers are ports of the verified flow, hook wiring is unverified. Other platforms hard-stop at Phase 1; the platform-agnostic core (config, Entra auth, AISession builders, webhook client) is reusable, only the adapter under `security/adapters/` is missing.

**Supported agent stacks for `add-workiq-tools`** (verified against Agent365-{dotnet,python,nodejs}):
- **.NET:** Agent Framework · Semantic Kernel (different API: `AddToolServersToAgentAsync`, not `GetMcpToolsAsync`) · Azure AI Foundry (best-effort — package published, no Microsoft sample)
- **Node.js:** LangChain (returns new agent — capture return) · OpenAI Agents SDK (mutates in place) · Claude SDK (first arg is `Options`, mutates in place) · ⚠ Semantic Kernel and Google ADK **hard-stop** (no Microsoft adapter — skill exits at Phase 0B)
- **Python:** Agent Framework (uses `turn_context=` kwarg, requires `initial_tools=[]`) · OpenAI Agents SDK (uses `context=` kwarg, no `agentic_app_id`) · Google ADK (passes `agentic_app_id`, wraps in `asyncio.wait_for`) · Semantic Kernel and Azure AI Foundry (best-effort — package published, no Microsoft sample) · ⚠ LangChain / Claude SDK / CrewAI **hard-stop** (no Microsoft adapter; Claude and CrewAI samples ship a local DIY `mcp_tool_registration_service.py` scaffold — out of scope for this skill)

**Skill dependency chain:**
```
make-ai-teammate  ─────────────────────────────────→  instrument-observability  (automatic)
      │                                            →  add-workiq-tools          (optional)
      └→  a365-setup (CLI install + Azure prereqs
            when isAITeammate = true, delegates back to make-ai-teammate)

a365-setup  →  make-ai-teammate    (AI Teammate path)
            →  make-a365-agent     (Registration / Observability / WorkIQ paths)

make-a365-agent  →  instrument-observability  (Observability paths)
                 →  add-workiq-tools          (WorkIQ paths)

a365-code-validator  (report-first; optional safe fixes after confirmation; no prerequisite)
instrument-security  (runtime Defender prevention; requires a Blueprint + Agent Identity)
test-local  (no prerequisite)
```
`make-ai-teammate` is **idempotent and state-aware**. Phase 0B detects three primary skill-state flags from the project — `has_obs` (observability wired), `has_workiq` (ToolingManifest.json has a non-empty mcpServers array), `disk_blueprint_present` (blueprint already registered, from `.a365-workspace-detection.local.json` / `a365.generated.config.json`). Phase 0C routes through an **8-row state matrix** (rows 1–8 over those flags): full flow → skip-obs → skip-workiq → register-only → no-re-register variants → "everything wired" confirmation (row 8 — sub-question: re-publish or verify-only). The skill creates the hosting layer, agent class, notification handling, full `a365.config.json`. **Phase 9.7.1a is the verification gate** — disk presence (`disk_blueprint_present`) is advisory only; the user is always asked explicitly whether the disk-side blueprint is the intended one before any skip/reuse decision (handles cases where disk lies about tenant state: deleted in Entra, file from another project, agent-name mismatch). If an existing blueprint is found, the skill asks the user explicitly: **Reuse** (skip setup-all), **Re-run** (idempotent — CLI reuses the blueprint ID but refreshes permissions and project settings), or **Fresh** (`a365 cleanup` first, then re-provision — destructive). When no blueprint exists, `a365 setup all --aiteammate --m365` runs unconditionally. (`--m365` is **always passed** for AI Teammate — no user question. Never pass `--authmode` with `--aiteammate` — AI Teammate uses the Agentic User identity.) It then asks **Phase 9.7.2 Run Target** (Prod vs Local), persisted to `.a365-workspace-detection.local.json` with remember-with-confirm on re-runs. For `runTarget = "prod"`: a **Phase 9.7.2b hosting sub-question** follows — *dev tunnel* (Microsoft Dev Tunnel exposing localhost — for in-Teams testing before deploying to a cloud) or *cloud endpoint* (Azure App Service / Container Apps / Functions; AWS App Runner / Lambda + API Gateway / ECS; Google Cloud Run / App Engine / Cloud Functions). The user supplies (or the skill derives) the HTTPS messaging endpoint URL, stored as `chosenEndpoint`. Phase 9.7.2c then **always** re-asserts `chosenEndpoint` on the blueprint via `a365 setup blueprint --update-endpoint <chosenEndpoint> --m365` — run **unconditionally** for AI Teammate prod (mandatory, NOT gated on a config/endpoint diff: the disk `messagingEndpoint` can be stale — dev-tunnel URL rotation, a non-persisted Teams Graph re-registration, or a reused/copied blueprint). Skipped only for `runTarget = "local"` or an empty/placeholder `chosenEndpoint`. (`--m365` is required — without it the CLI silently skips Teams Graph re-registration.) After reconciliation: **verifies** (read-only) the Teams manifest, runs `a365 publish` (packages `manifest.zip` — does NOT upload, does NOT touch the bot endpoint), then walks the user through **two required manual steps**: (a) verify the agent in Teams Developer Portal at `https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration` — Agent Type=API Based, Notification URL = the reconciled `chosenEndpoint`/`messagingEndpoint` (required for Teams message delivery; the Notification URL is auto-registered by `--update-endpoint --m365` via the Teams Graph proxy on supported tenants — verify it, and set it by hand only as a fallback when the CLI reports automated registration isn't available for the tenant); and (b) request an agent instance from Teams Apps and wait for admin approval at admin.cloud.microsoft. For `runTarget = "local"`: agent runs at `http://localhost:3978/api/messages` (Node.js/Python default) — all publish/Dev-Portal/MAC-upload/instance steps are skipped — the skill routes directly to AgentsPlayground for smoke testing.

**Phase 9.7.2d** validates environment configuration before either path proceeds. For prod: confirms `a365.generated.config.json` has `completed: true` and non-empty `resourceConsents` (else GA consent handoff is pending); confirms `.env`/`appsettings.json` has agentic-auth + LLM + observability vars; reminds the user that cloud env vars must be set at the cloud platform (`az webapp config appsettings set` / `eb setenv` / `gcloud run services update --set-env-vars`), not just locally; confirms HTTPS messaging endpoint. For local: confirms AgentsPlayground is installed and `.m365agentsplayground.yml` is configured when using agentic auth. Authoritative Microsoft Learn refs: [test-with-devtunnels](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels), [testing](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing), [deploy-agent-azure](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-azure), [deploy-agent-aws](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-aws), [deploy-agent-gcp](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-gcp). **Automatically** runs `instrument-observability` (only when `has_obs = false`) and **optionally** offers `add-workiq-tools` (only when `has_workiq = false`). The skill does NOT hand-edit `manifest.json`. Reference: [Create agent instance — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance).
`a365-setup` outputs a mandatory intro message, detects stack/language/CEA/`hasBlueprintConfig`, and the three skill-state flags **`has_aiteammate_structure`**, **`has_obs`**, **`has_workiq`** (the same primary flags that drive `make-ai-teammate` Phase 0C's 8-row matrix). Always updates the a365 CLI to latest (explicit exception to the ✅-skip rule), checks for an existing Azure CLI session before logging in, shows a ✅/❌ prerequisite summary and only processes ❌ missing tools. Asks the blueprint question (reuse vs fresh) then asks **capabilities first** — capability options are auto-filtered: Observability is hidden if `has_obs = true`, WorkIQ is hidden if `has_workiq = true`, the menu collapses to Register + WorkIQ when `(has_aiteammate_structure && has_obs)` (legacy "already an AI Teammate" route, computed inline — the legacy `hasAITeammateChanges` field is **derived, no longer stored**). If AI Teammate is selected, auth mode is skipped (always `agentic-user`); if non-AI Teammate, asks `obo` or `s2s`. Cache fields written: `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `hasBlueprintConfig`, `has_aiteammate_structure`, `has_obs`, `has_workiq`, `agentType`, `authMode`, `reuseBlueprint`, `existingBlueprintId`. Delegates: AI Teammate path → `make-ai-teammate`; all other paths → `make-a365-agent`.
`make-a365-agent` checks for an existing blueprint config before collecting inputs — if found, asks the developer whether to reuse (skips `a365 setup all`) or create fresh. Runs `a365 setup all --authmode obo|s2s` for non-AI Teammate paths; add `--m365` for CEA agents and follow with `a365 setup permissions bot`. `Agent365.Observability.OtelWrite` is auto-granted at provisioning, but other permission grants (Graph, Bot API, custom resources) require Global Administrator consent — when the developer isn't a GA, `a365 setup all` automatically prints next-steps (typically a PowerShell script) for a GA to complete. There is no separate `setup admin` subcommand. Then conditionally invokes `instrument-observability` and `add-workiq-tools`.
`add-workiq-tools` and `instrument-observability` read `.a365-workspace-detection.local.json` to skip re-detection and verify prerequisites. `add-workiq-tools` Phase 0B includes a **framework support guard** that hard-stops on unsupported `(programmingLanguage, agentStack)` pairs (Python LangChain / Claude / CrewAI; Node.js Semantic Kernel / Google ADK) before any CLI command runs. Phase 4 branches on the cached `agentStack` into 11 framework-specific sub-sections (§4.1 .NET Agent Framework through §4.11 Python Azure AI Foundry); the stop-hook validator (`validate-add-workiq-tools.js`) is also framework-aware and requires the framework-matching symbol (e.g., `AddToolServersToAgentAsync` for .NET SK, `add_tool_servers_to_agent` for Python). **Phase 4.5 (gated)** offers the Word `@mention` notification handler when *both* gates pass: `programmingLanguage = NodeJS && agentStack = LangChain`, AND `mcp_WordServer` is in `ToolingManifest.json`. Wires `proactive: {}`, per-user conversation index, and a `NotificationType.WpxComment` branch — best-effort because no Microsoft Node.js sample is published yet. Best-effort branches (Python SK, Python/.NET Azure AI Foundry, and the Phase 4.5 @mention handler) mark all generated lines with `// A365 WorkIQ — best-effort wiring (verify against SDK source before production)`.

The skills are designed to be **non-destructive**, **idempotent**, and **additive**.
They read before writing, ask before doing anything risky, and leave the codebase
in a better state than they found it.

---

## Directory Structure

```
plugins/agent365/
├── .claude-plugin/
│   └── plugin.json               # Skill registry (skills directory path)
├── skills/
│   ├── make-ai-teammate/
│   │   ├── SKILL.md              # Hosting layer, agent class, notifications (does NOT write ToolingManifest.json — owned by add-workiq-tools)
│   │   └── references/
│   │       ├── nodejs-ai-teammate.md     # Complete hosting + agent + client patterns (Node.js LangChain/OpenAI/Claude)
│   │       ├── nodejs-notifications.md  # Notification + lifecycle event patterns (Node.js)
│   │       ├── dotnet-ai-teammate.md    # Complete patterns for .NET AgentFramework
│   │       └── python-ai-teammate.md   # Complete patterns for Python AgentFramework
│   ├── a365-setup/
│   │   └── SKILL.md              # Entry point: CLI + prereqs, then delegates to make-ai-teammate or make-a365-agent
│   ├── make-a365-agent/
│   │   └── SKILL.md              # Non-AI Teammate provisioning: a365 setup all + optional observability/WorkIQ
│   ├── instrument-observability/
│   │   ├── SKILL.md              # OTel + A365 exporter instrumentation
│   │   └── references/
│   │       ├── dotnet-observability.md   # Authoritative .NET code patterns
│   │       ├── nodejs-observability.md  # Authoritative Node.js code patterns
│   │       └── python-observability.md  # Authoritative Python code patterns
│   ├── a365-code-validator/
│   │   ├── SKILL.md              # Observability/MAC Activity validator + guided fixes
│   │   └── references/
│   │       └── validation-checklist.md
│   ├── instrument-security/
│   │   ├── SKILL.md              # Defender prevention hooks (inspect + block at runtime)
│   │   └── references/
│   │       ├── defender-webhook.md   # Endpoint contract, identity model, AISession mapping
│   │       ├── python-security.md    # Python (Google ADK verified; others best-effort)
│   │       ├── dotnet-security.md    # .NET patterns (best-effort adapter)
│   │       └── nodejs-security.md    # Node.js patterns (best-effort adapter)
│   ├── add-workiq-tools/
│   │   ├── SKILL.md              # WorkIQ MCP tool wiring
│   │   └── references/
│   │       ├── dotnet-workiq.md  # .NET MCP tool patterns
│   │       ├── nodejs-workiq.md  # Node.js MCP tool patterns
│   │       └── python-workiq.md  # Python MCP tool patterns
│   └── test-local/
│       └── SKILL.md              # AgentsPlayground local testing
├── shared/
│   └── agent-detection.md        # Shared heuristics for detecting agent type
├── hooks/
│   ├── preToolUse/
│   │   └── path-guard.js         # Blocks Write/Edit outside the agent project directory
│   └── stop/
│       ├── validate-make-ai-teammate.js  # Stop hook validator — build check included
│       ├── validate-a365-setup.js        # Stop hook validator for a365-setup
│       ├── validate-make-a365-agent.js   # Stop hook validator for make-a365-agent
│       ├── validate-instrument-observability.js  # Stop hook validator — build check included
│       ├── validate-instrument-security.js  # Stop hook validator — hook coverage + build check
│       ├── validate-add-workiq-tools.js  # Stop hook validator — build check included
│       └── validate-test-local.js
└── AGENTS.md                     # This file
```

**Evals** (in repository root):
```
evals/
└── agent365/
    ├── make-ai-teammate/
    │   └── evals.json
    ├── a365-setup/
    │   └── evals.json
    ├── make-a365-agent/
    │   └── evals.json
    ├── instrument-observability/
    │   └── evals.json
    ├── instrument-security/
    │   └── evals.json
    ├── add-workiq-tools/
    │   └── evals.json
    └── test-local/
        └── evals.json
```

See [evals/README.md](../evals/README.md) for testing documentation.

---

## SKILL.md Format

Each `SKILL.md` must have the following frontmatter. Fields marked **Claude Code** are
ignored by VS Code Copilot; fields marked **VS Code** are ignored by Claude Code.
All other fields are honoured by both.

```markdown
---
name: <skill-name>
description: >
  One paragraph description used for skill matching.

# ── Both platforms ──────────────────────────────────────────────────────────
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional hint shown to the user"

# ── Claude Code only ────────────────────────────────────────────────────────
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/<validator>.js
      timeout: 15000
    - type: prompt
      prompt: |
        Checklist prompt for the AI to self-verify completion.
      timeout: 30000
---

# <Skill Title>

> **Trigger phrases** — ...
```

### Platform behaviour summary

| Feature | Claude Code | VS Code Copilot Chat |
|---------|-------------|----------------------|
| Trigger phrases | `plugin.json` triggers + natural language | `.github/copilot-instructions.md` |
| Tool allowlist | `allowed-tools` in frontmatter | Ignored (Copilot uses its own tool set) |
| Stop hooks | `hooks.stop` in frontmatter | Not supported |
| Model selection | `model: sonnet` | Ignored (Copilot uses its own model) |
| Install path | `--plugin-dir` or `/plugin install` | Copy `.github/copilot-instructions.md` |

---

## Adding a New Skill

1. Create `skills/<skill-name>/SKILL.md` with the YAML frontmatter above.
2. Add any reference docs to `skills/<skill-name>/references/`.
3. Add a validator script to `hooks/stop/validate-<skill-name>.js`.
4. Skills are auto-discovered from the `skills/` directory — no changes to `plugin.json` needed.
5. Add eval cases to `evals/agent365/<skill-name>/evals.json`.
6. Test with: `claude --plugin-dir /path/to/plugins/agent365`

---

## Editing Reference Docs

Reference docs in `references/` are the **source of truth** for code patterns.
When the A365 SDK releases new versions:

1. Update the package names/versions in the reference doc.
2. Update code snippets to match the new API surface.
3. Do NOT change the SKILL.md logic — only the reference data changes.

---

## Hooks

All hooks live in `hooks/` under two subfolders by event type.

### `hooks/preToolUse/path-guard.js`

Runs before every `Write` or `Edit` tool call. Reads the pending tool payload from stdin (JSON) and exits `2` (block) if the target path is outside the agent project directory or inside `CLAUDE_PLUGIN_ROOT`. Exits `0` (allow) for all other tools and safe paths. Must complete within 5 seconds.

### `hooks/stop/validate-*.js`

Run by each skill's stop hook before the session ends. They must:
- Exit `0` and print `{"ok": true}` on success.
- Exit `1` and print `{"ok": false, "reason": "..."}` on failure.
- Complete within the timeout (15–30 seconds depending on skill).
- Never block on network I/O — check local files only.

`validate-instrument-observability.js`, `validate-make-ai-teammate.js`, and `validate-add-workiq-tools.js` also run a lightweight build check (`dotnet build --no-restore` for .NET, `tsc --noEmit` for Node.js) and block the session if compilation fails.

---

## DRY Principle

If two skills share logic (e.g., agent detection), extract it to `shared/`.
Skills reference shared docs via `Read ${CLAUDE_PLUGIN_ROOT}/shared/<file>.md`.

### Shared: Agent Type and Auth Mode Detection

`shared/agent-detection.md` contains the **Agent Type and Auth Mode Detection** section used by both `instrument-observability` and `add-workiq-tools`. It implements a two-stage question flow:

- **Stage 1 — Agent kind:** AI Teammate or Agent (Non AI Teammate) (pre-filled from `usesTeamsOrCopilot` cache if available).
- **Stage 2 — Auth mode:** depends on agent kind:
  - AI Teammate → `obo` (signed-in user OBO) or `agentic-user` (agent's own Azure AD user — persistent M365 identity)
  - Agent (Non AI Teammate) → `obo` (On-Behalf-Of) or `s2s` (Service Principal, no user token)

All three `authMode` values use an auth handler reference in SDK code — the difference is Azure AD provisioning. For OBO paths: .NET reads `authHandlerName` from config (`AgentApplication:AgenticAuthHandlerName`); Node.js passes `agentApplication.authorization` (the auth object) to `RefreshObservabilityToken`; Python uses `auth_handler_id=self.auth_handler_name` (from config) in `exchange_token()` — never hardcode `"AGENTIC"`. Agent IDs are always resolved dynamically from TurnContext — .NET: `turnContext.Activity.GetAgenticInstanceId()` (service principal object ID); Node.js/Python: `recipient.agenticAppId` / `agentic_app_id`. Results are cached in `.a365-workspace-detection.local.json` under `agentType` and `authMode` fields so subsequent skill invocations skip re-questioning. If `authMode = s2s` and the skill is `add-workiq-tools`, the skill exits immediately — WorkIQ is not available for s2s agents (requires a delegated OBO token).

**S2S scaffold requirement:** When `authMode = s2s`, `instrument-observability` creates a scaffold token-service file per language: .NET creates `Observability/ObservabilityServiceExtensions.cs` + `Observability/ObservabilityTokenService.cs`, Node.js creates `observability/observability-token-service.ts`, Python creates `observability/observability_token_service.py`. Each acquires and refreshes the Observability API token via MSAL client credentials targeting `api://9b975845-388f-4429-889e-eab1ef63949c/.default`. The .NET files additionally provide the `AddAgent365Observability()` / `Agent365ObservabilityContext` DI extensions that replace `AddAgenticTracingExporter()` and per-turn `RegisterObservability()`. The validator (`validate-instrument-observability.js`) accepts either the OBO signal (`BaggageBuilder` / `BaggageTurnMiddleware`) or the S2S signal to pass the context check.

---

## Testing Skills

```bash
# Transform a plain Node.js LangChain agent into an AI Teammate
cd /path/to/nodejs-langchain-project
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Then: "make this agent an AI Teammate"

# Test instrument-observability in a .NET project
cd /path/to/dotnet-agent-project
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Then: "instrument observability for this agent"

# Test in a Node.js project
cd /path/to/nodejs-langchain-project
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Then: "add a365 observability"

# Test in a Python project
cd /path/to/python-agent-project
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Then: "add a365 observability to this Python agent"

# Test a365-setup
cd /path/to/agent-project
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Then: "run a365 setup"

# Run the make-ai-teammate validator directly
cd /path/to/your-agent-project
node /path/to/agent365-skills/plugins/agent365/hooks/stop/validate-make-ai-teammate.js
```

---

## Task Execution Discipline

Skills with task lists must run every task to completion in one turn. Mark each task
complete (`TaskUpdate` in Claude Code, `- [ ]` → `- [x]` in Copilot) the moment its
phase finishes — never leave a finished phase as ⭕.

Only pause at the explicit interaction points each SKILL.md documents (capabilities menu,
run-target, Reuse/Re-run/Fresh, WorkIQ offer, MCP server selection, Word @mention offer
when `mcp_WordServer` is selected on a Node.js LangChain stack, launch confirmation).
CLI `Allow / Skip` prompts and manual browser steps (Teams Dev Portal, M365 Admin Center,
GA consent) are not stopping conditions — surface them with URL + action and continue.
When adding a new interaction point to a SKILL.md, mirror it in [CLAUDE.md](CLAUDE.md)
and [.github/copilot-instructions.md](.github/copilot-instructions.md) so all three stay in sync.

**`has_obs` and `has_workiq` are composite signals.** `has_obs = true` requires the
entry-point call (`useMicrosoftOpenTelemetry` / `UseMicrosoftOpenTelemetry` /
`use_microsoft_opentelemetry`) AND a token resolver AND a handler-side baggage / scope
anchor (`BaggageBuilder` / `InvokeAgentScope`). `has_workiq = true` requires non-empty
`ToolingManifest.json` AND the framework's MCP wiring symbol in agent code
(`addToolServersToAgent` / `GetMcpToolsAsync` / `AddToolServersToAgentAsync` /
`add_tool_servers_to_agent`) AND — for Node.js LangChain + `mcp_WordServer` — the Word
`@mention` wiring (`WpxComment` + `proactive` + `userKeyToConversationId`). Anything less
is `has_obs_partial` / `has_workiq_partial` (read-time only, never persisted).
`make-ai-teammate` Phase 9.5 / 9.6 must re-enter the sub-skill on partial — not silently
skip. `add-workiq-tools` Phase 4 must preserve the observability anchors when editing
files that overlap with the obs wrapping (.NET `OnMessageAsync`, Python
`process_user_message`, Node.js Claude SDK `src/client.ts`);
`validate-add-workiq-tools.js` will fail the session if the entry-point obs anchor is
present but the handler-side anchors disappeared after WorkIQ ran.

**`.a365-workspace-detection.local.json` MUST exist before any code-edit phase.** Every
skill's Phase 0A Step 1 triage is responsible for writing this file via `a365-setup`
when missing on a project with code. Phase 0A Step 2 (the "load from cache" step) opens
with a hard STOP guard that refuses to proceed if the file is absent — the model must
NOT invent default values; instead it must run `a365-setup` to completion, then return.
The stop-hook validators (`validate-make-ai-teammate.js`, `validate-instrument-observability.js`,
`validate-add-workiq-tools.js`) fail the session at end if the cache wasn't written,
catching cases where the model bypassed the SKILL.md guard. This rule fixes the silent
"detect → edit code → never write cache" failure mode that left agents partially wired
with no detection metadata.

---

## CLI output buffering under chat-tool execution

The `a365` CLI is a .NET tool. When invoked from Claude Code's Bash tool, VS Code Copilot Chat,
or GitHub Copilot CLI, stdout is captured (not a TTY), so the .NET runtime switches to
**block-buffered** output. Long-running commands (`a365 publish`, `a365 setup all`,
`a365 setup requirements` when configuring a tenant) appear hung — output stalls until the
buffer fills. Users have reported *"the pipe is buffering output, killing and re-running
without the pipe"* as a workaround.

Three remediations, in order of preference. Any skill invoking a long-running `a365` command
should pick one:

1. **Run in background mode** — Claude Code Bash tool with `run_in_background: true`. The
   harness streams stdout line-by-line via `BashOutput` polling instead of waiting for the
   buffer flush. Best UX; works on all platforms.
2. **Prefix with `stdbuf -oL`** (Linux / macOS / WSL) to force line-buffered stdout:
   ```bash
   stdbuf -oL a365 publish
   ```
   Not natively available on Windows — use `unbuffer` from the `expect` package, or fall
   through to option 3.
3. **Hand off to a separate terminal.** Tell the user verbatim: *"`<command>` buffers under
   chat-tool execution. Please open a new terminal in this project directory, run `<command>`
   there, then paste the final output back here."* Foolproof — works on every platform.

Skill SKILL.md files that run long `a365` commands should reference this section rather than
duplicating the remediation block: see [deploy-pipeline.md § Step 9.7.4](plugins/agent365/skills/make-ai-teammate/references/deploy-pipeline.md) for the canonical inline use.

---

## Code Style

- All validator scripts: plain Node.js (no dependencies, no TypeScript).
- All reference docs: Markdown with code fences showing complete, runnable snippets.
- All SKILL.md phases: numbered, with `TaskCreate/TaskUpdate` calls at start/end.
- **Visible TODO checklist requirement:** every skill must show the user its task list **before** Phase 1 work begins, using whichever mechanism the runtime supports — **Claude Code:** call `TaskCreate` for each item (already in `allowed-tools`); **VS Code Copilot Chat / GitHub Copilot CLI:** `allowed-tools` is ignored, so the AI must emit a markdown checklist in chat (`- [ ] Detect agent type…`) and update items to `- [x]` as phases complete. Exactly one task in_progress at a time; complete before moving on.
- No hardcoded tenant IDs, subscription IDs, or secrets anywhere in this repo.
