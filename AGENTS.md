# Agent 365 Plugin — Development Guidelines

This file documents conventions for contributors working on the `agent365` plugin skills.
Read this before making any changes to skill files.

---

## Plugin Purpose

This plugin instruments and configures A365 agents. It contains six skills:

| Skill | Command | Trigger |
|-------|---------|---------|
| `make-ai-teammate` | `/agent365:make-ai-teammate` | "make this agent an AI Teammate", "add AI Teammate hosting", "transform agent to Teams agent" |
| `a365-setup` | `/agent365:a365-setup` | "run a365 setup", "create blueprint", "register agent" |
| `make-a365-agent` | `/agent365:make-a365-agent` | "provision agent with a365", "Registration setup", "observability setup", "register this agent" |
| `add-workiq-tools` | `/agent365:add-workiq-tools` | "add workiq tools", "add MCP servers to this agent" |
| `instrument-observability` | `/agent365:instrument-observability` | "instrument observability", "add a365 observability" |
| `test-local` | `/agent365:test-local` | "test this agent locally", "open agentsplayground" |

**Supported languages for `make-ai-teammate`:** .NET (AgentFramework · Semantic Kernel) · Node.js (LangChain · OpenAI Agents SDK · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

**Supported languages for `instrument-observability`:** .NET AgentFramework · Node.js (LangChain · OpenAI · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

**Supported agent stacks for `add-workiq-tools`:** .NET (AgentFramework · Semantic Kernel) · Node.js (LangChain · OpenAI · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

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

test-local  (no prerequisite)
```
`make-ai-teammate` is **idempotent and state-aware**. Phase 0B detects three primary skill-state flags from the project — `has_obs` (observability wired), `has_workiq` (ToolingManifest.json has a non-empty mcpServers array), `has_setup` (blueprint already registered, from `.a365-workspace-detection.local.json` / `a365.generated.config.json`). Phase 0C routes through an **8-row state matrix** (rows 1–8 over those flags): full flow → skip-obs → skip-workiq → register-only → no-re-register variants → "everything wired" confirmation (row 8 — sub-question: re-publish or verify-only). The skill creates the hosting layer, agent class, notification handling, full `a365.config.json`, and runs `a365 setup all --aiteammate` only when `has_setup = false` (the `--m365` flag is **auto-added** when `usesTeamsOrCopilot = 1` from CEA detection — no user question; only asks the user when CEA markers were NOT detected. Never pass `--authmode` with `--aiteammate` — AI Teammate uses the Agentic User identity). It then asks **Phase 9.7.2 Run Target** (Prod vs Local), persisted to `.a365-workspace-detection.local.json` with remember-with-confirm on re-runs. For `runTarget = "prod"`: a **Phase 9.7.2b hosting sub-question** follows — *dev tunnel* (Microsoft Dev Tunnel exposing localhost — for in-Teams testing before deploying to a cloud) or *cloud endpoint* (Azure App Service / Container Apps / Functions; AWS App Runner / Lambda + API Gateway / ECS; Google Cloud Run / App Engine / Cloud Functions). The user supplies (or the skill derives) the HTTPS messaging endpoint URL, stored as `chosenEndpoint`. Phase 9.7.2c then reconciles `chosenEndpoint` against the blueprint's `messagingEndpoint` via `a365 setup blueprint --update-endpoint <chosenEndpoint>` if they differ. After reconciliation: **verifies** (read-only) the Teams manifest, runs `a365 publish` (packages `manifest.zip` — does NOT upload, does NOT touch the bot endpoint), then walks the user through **two required manual steps**: (a) configure the agent in Teams Developer Portal at `https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration` — Agent Type=API Based, Notification URL = the reconciled `chosenEndpoint`/`messagingEndpoint` (required for Teams message delivery; the CLI does NOT do this); and (b) request an agent instance from Teams Apps and wait for admin approval at admin.cloud.microsoft. For `runTarget = "local"`: agent runs at `http://localhost:3978/api/messages` (Node.js/Python default) — all publish/Dev-Portal/MAC-upload/instance steps are skipped — the skill routes directly to AgentsPlayground for smoke testing.

**Phase 9.7.2d** validates environment configuration before either path proceeds. For prod: confirms `a365.generated.config.json` has `completed: true` and non-empty `resourceConsents` (else GA consent handoff is pending); confirms `.env`/`appsettings.json` has agentic-auth + LLM + observability vars; reminds the user that cloud env vars must be set at the cloud platform (`az webapp config appsettings set` / `eb setenv` / `gcloud run services update --set-env-vars`), not just locally; confirms HTTPS messaging endpoint. For local: confirms AgentsPlayground is installed and `.m365agentsplayground.yml` is configured when using agentic auth. Authoritative Microsoft Learn refs: [test-with-devtunnels](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels), [testing](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing), [deploy-agent-azure](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-azure), [deploy-agent-aws](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-aws), [deploy-agent-gcp](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-gcp). **Automatically** runs `instrument-observability` (only when `has_obs = false`) and **optionally** offers `add-workiq-tools` (only when `has_workiq = false`). The skill does NOT hand-edit `manifest.json`. Reference: [Create agent instance — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance).
`a365-setup` outputs a mandatory intro message, detects stack/language/CEA/`hasBlueprintConfig`, and the three skill-state flags **`has_aiteammate_structure`**, **`has_obs`**, **`has_workiq`** (the same primary flags that drive `make-ai-teammate` Phase 0C's 8-row matrix). Always updates the a365 CLI to latest (explicit exception to the ✅-skip rule), checks for an existing Azure CLI session before logging in, shows a ✅/❌ prerequisite summary and only processes ❌ missing tools. Asks the blueprint question (reuse vs fresh) then asks **capabilities first** — capability options are auto-filtered: Observability is hidden if `has_obs = true`, WorkIQ is hidden if `has_workiq = true`, the menu collapses to Register + WorkIQ when `(has_aiteammate_structure && has_obs)` (legacy "already an AI Teammate" route, computed inline — the legacy `hasAITeammateChanges` field is **derived, no longer stored**). If AI Teammate is selected, auth mode is skipped (always `agentic-user`); if non-AI Teammate, asks `obo` or `s2s`. Delegates: AI Teammate path → `make-ai-teammate`; all other paths → `make-a365-agent`.
`make-a365-agent` checks for an existing blueprint config before collecting inputs — if found, asks the developer whether to reuse (skips `a365 setup all`) or create fresh. Runs `a365 setup all --authmode obo|s2s` for non-AI Teammate paths; add `--m365` for CEA agents and follow with `a365 setup permissions bot`. `Agent365.Observability.OtelWrite` is auto-granted at provisioning, but other permission grants (Graph, Bot API, custom resources) require Global Administrator consent — when the developer isn't a GA, `a365 setup all` automatically prints next-steps (typically a PowerShell script) for a GA to complete. There is no separate `setup admin` subcommand. Then conditionally invokes `instrument-observability` and `add-workiq-tools`.
`add-workiq-tools` and `instrument-observability` read `.a365-workspace-detection.local.json` to skip re-detection and verify prerequisites.

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
│   │   ├── SKILL.md              # Hosting layer, agent class, notifications, pre-populated ToolingManifest.json
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

## Code Style

- All validator scripts: plain Node.js (no dependencies, no TypeScript).
- All reference docs: Markdown with code fences showing complete, runnable snippets.
- All SKILL.md phases: numbered, with `TaskCreate/TaskUpdate` calls at start/end.
- No hardcoded tenant IDs, subscription IDs, or secrets anywhere in this repo.
