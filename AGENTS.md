# Agent 365 Plugin — Development Guidelines

This file documents conventions for contributors working on the `agent365` plugin skills.
Read this before making any changes to skill files.

---

## Plugin Purpose

This plugin instruments and configures A365 agents. It contains five skills:

| Skill | Command | Trigger |
|-------|---------|---------|
| `make-ai-teammate` | `/agent365:make-ai-teammate` | "make this agent an AI Teammate", "add AI Teammate hosting", "transform agent to Teams agent" |
| `a365-setup` | `/agent365:a365-setup` | "run a365 setup", "create blueprint", "register agent" |
| `add-workiq-tools` | `/agent365:add-workiq-tools` | "add workiq tools", "add mcp tools to this agent" |
| `instrument-observability` | `/agent365:instrument-observability` | "instrument observability", "add a365 observability" |
| `test-local` | `/agent365:test-local` | "test this agent locally", "open agentsplayground" |

**Supported languages for `make-ai-teammate`:** Node.js (LangChain · OpenAI Agents SDK · Claude SDK) · .NET AgentFramework · Python AgentFramework

**Skill dependency chain:**
```
make-ai-teammate  →  a365-setup  →  add-workiq-tools
                                 →  instrument-observability
test-local  (no prerequisite)
```
`make-ai-teammate` creates the hosting layer, agent class, notification handling, and an empty `ToolingManifest.json`. It does **not** run `a365 setup`, wire WorkIQ tools, or instrument observability — those are handled by the downstream skills.
`a365-setup` writes `.a365-workspace-detection.json`; `add-workiq-tools` and `instrument-observability` read this file to skip re-detection and verify prerequisites.

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
│   │   └── SKILL.md              # Full A365 CLI lifecycle
│   ├── instrument-observability/
│   │   ├── SKILL.md              # OTel + A365 exporter instrumentation
│   │   └── references/
│   │       ├── dotnet-observability.md   # Authoritative .NET code patterns
│   │       └── nodejs-observability.md  # Authoritative Node.js code patterns
│   ├── add-workiq-tools/
│   │   ├── SKILL.md              # WorkIQ MCP tool wiring
│   │   └── references/
│   │       ├── dotnet-workiq.md  # .NET MCP tool patterns
│   │       └── nodejs-workiq.md  # Node.js MCP tool patterns
│   └── test-local/
│       └── SKILL.md              # AgentsPlayground local testing
├── shared/
│   └── agent-detection.md        # Shared heuristics for detecting agent type
├── scripts/
│   ├── validate-make-ai-teammate.js  # Stop hook validator for make-ai-teammate
│   ├── validate-setup.js             # Stop hook validator for a365-setup
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
