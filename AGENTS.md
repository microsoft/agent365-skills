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
| `make-a365-agent` | `/agent365:make-a365-agent` | "provision agent with a365", "discoverability setup", "observability setup", "register agent for discoverability" |
| `add-workiq-tools` | `/agent365:add-workiq-tools` | "add workiq tools", "add mcp tools to this agent" |
| `instrument-observability` | `/agent365:instrument-observability` | "instrument observability", "add a365 observability" |
| `test-local` | `/agent365:test-local` | "test this agent locally", "open agentsplayground" |

**Supported languages for `make-ai-teammate`:** Node.js (LangChain · OpenAI Agents SDK · Claude SDK) · .NET AgentFramework · Python AgentFramework

**Supported languages for `instrument-observability`:** .NET AgentFramework · Node.js (LangChain · OpenAI · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

**Supported agent stacks for `add-workiq-tools`:** .NET (AgentFramework · Semantic Kernel) · Node.js (LangChain · OpenAI · Claude SDK · Semantic Kernel · Google ADK) · Python (AgentFramework · LangChain · OpenAI · Claude · Semantic Kernel · Google ADK)

**Skill dependency chain:**
```
make-ai-teammate  ─────────────────────────────────→  add-workiq-tools
      │                                            →  instrument-observability
      └→  a365-setup (CLI install + Azure prereqs
            when isAITeammate = true, delegates back to make-ai-teammate)

a365-setup  →  make-ai-teammate    (AI Teammate path)
            →  make-a365-agent     (Discoverability / Observability / WorkIQ paths)

make-a365-agent  →  instrument-observability  (Observability paths)
                 →  add-workiq-tools          (WorkIQ paths)

test-local  (no prerequisite)
```
`make-ai-teammate` creates the hosting layer, agent class, notification handling, full `a365.config.json`, runs `a365 setup all`, reviews/publishes the manifest, and registers in the Teams Developer Portal. It then offers `instrument-observability` (Strongly Recommended) and `add-workiq-tools` (Optional) as follow-on steps.
`a365-setup` verifies the CLI and Azure prerequisites (Steps 1–2), then delegates: AI Teammate path → `make-ai-teammate`; all other paths → `make-a365-agent`.
`make-a365-agent` runs `a365 setup all` for non-AI Teammate paths (Discoverability, Observability, WorkIQ), then conditionally invokes `instrument-observability` and `add-workiq-tools`.
`add-workiq-tools` and `instrument-observability` read `.a365-workspace-detection.json` to skip re-detection and verify prerequisites.

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
│   │   ├── SKILL.md              # Hosting layer, agent class, notifications, empty ToolingManifest.json
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
├── scripts/
│   ├── validate-make-ai-teammate.js  # Stop hook validator for make-ai-teammate
│   ├── validate-setup.js             # Stop hook validator for a365-setup
│   ├── validate-make-a365-agent.js   # Stop hook validator for make-a365-agent
│   ├── validate-observability.js     # Stop hook validator for instrument-observability
│   ├── validate-add-workiq-tools.js
│   └── validate-test-local.js
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
3. Add a validator script to `scripts/validate-<skill-name>.js`.
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

## Validator Scripts

Validators are run by the stop hook before the session ends. They must:
- Exit `0` and print `{"ok": true}` on success.
- Exit `1` and print `{"ok": false, "reason": "..."}` on failure.
- Complete within the timeout (15 seconds).
- Never block on network I/O — check local files only.

---

## DRY Principle

If two skills share logic (e.g., agent detection), extract it to `shared/`.
Skills reference shared docs via `Read ${CLAUDE_PLUGIN_ROOT}/shared/<file>.md`.

### Shared: Agent Type and Auth Mode Detection

`shared/agent-detection.md` contains the **Agent Type and Auth Mode Detection** section used by both `instrument-observability` and `add-workiq-tools`. It implements a two-stage question flow:

- **Stage 1 — Agent kind:** AI Teammate or System Agent (pre-filled from `usesTeamsOrCopilot` cache if available).
- **Stage 2 — Auth mode:** depends on agent kind:
  - AI Teammate → `user-delegated` (signed-in user OBO) or `agentic-identity` (agent's own Azure AD user)
  - System Agent → `agentic-identity` (assistive) or `S2S` (autonomous, no user token)

All three `authMode` values use `authHandlerName: "AGENTIC"` in SDK code — the difference is Azure AD provisioning. Results are cached in `.a365-workspace-detection.json` under `agentType` and `authMode` fields so subsequent skill invocations skip re-questioning. If `authMode = S2S` and the skill is `add-workiq-tools`, a compatibility warning is surfaced before Phase 4 (WorkIQ requires a user token).

**S2S .NET scaffold requirement:** When `authMode = S2S` and the language is .NET, `instrument-observability` must create two scaffold files (`Observability/ObservabilityServiceExtensions.cs` and `Observability/ObservabilityTokenService.cs`) before wiring `Program.cs`. These files provide the 3-hop FMI token chain (`ObservabilityTokenService`) and the `AddAgent365Observability()` / `Agent365ObservabilityContext` DI extensions that replace `AddAgenticTracingExporter()` and per-turn `RegisterObservability()` in the OBO path. The validator (`validate-observability.js`) accepts either the OBO signal (`BaggageBuilder` / `BaggageTurnMiddleware`) or the S2S signal (`ObservabilityTokenService` / `Agent365ObservabilityContext`) to pass the context check.

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
node /path/to/agent365-skills/plugins/agent365/scripts/validate-make-ai-teammate.js
```

---

## Code Style

- All validator scripts: plain Node.js (no dependencies, no TypeScript).
- All reference docs: Markdown with code fences showing complete, runnable snippets.
- All SKILL.md phases: numbered, with `TaskCreate/TaskUpdate` calls at start/end.
- No hardcoded tenant IDs, subscription IDs, or secrets anywhere in this repo.
