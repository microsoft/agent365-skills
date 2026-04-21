# Agent 365 Plugin — Development Guidelines

This file documents conventions for contributors working on the `agent365` plugin skills.
Read this before making any changes to skill files.

---

## Plugin Purpose

This plugin instruments and configures A365 agents. It contains two skills:

| Skill | Command | Trigger |
|-------|---------|---------|
| `instrument-observability` | `/agent365:instrument-observability` | "instrument observability", "add a365 observability" |
| `a365-setup` | `/agent365:a365-setup` | "run a365 setup", "create blueprint", "register agent" |

The skills are designed to be **non-destructive**, **idempotent**, and **additive**.
They read before writing, ask before doing anything risky, and leave the codebase
in a better state than they found it.

---

## Directory Structure

```
plugins/agent365/
├── .claude-plugin/
│   └── plugin.json               # Skill registry (names, triggers, file paths)
├── skills/
│   ├── instrument-observability/
│   │   ├── SKILL.md              # Main skill — the AI reads and follows this
│   │   └── references/
│   │       ├── dotnet-observability.md   # Authoritative .NET code patterns
│   │       └── nodejs-observability.md  # Authoritative Node.js code patterns
│   └── a365-setup/
│       ├── SKILL.md              # Main skill
│       └── references/           # (placeholder for future CLI reference docs)
├── shared/
│   └── agent-detection.md        # Shared heuristics for detecting agent type
├── scripts/
│   ├── validate-observability.js # Stop hook validator for instrument-observability
│   └── validate-setup.js         # Stop hook validator for a365-setup
└── AGENTS.md                     # This file
```

**Evals** (in repository root):
```
evals/
└── agent365/
    ├── instrument-observability/
    │   └── evals.json            # Test cases for observability skill
    └── a365-setup/
        └── evals.json            # Test cases for setup skill
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
4. Register the skill in `.claude-plugin/plugin.json` under `skills[]`.
5. Update `marketplace.json` description if needed.
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
```

---

## Code Style

- All validator scripts: plain Node.js (no dependencies, no TypeScript).
- All reference docs: Markdown with code fences showing complete, runnable snippets.
- All SKILL.md phases: numbered, with `TaskCreate/TaskUpdate` calls at start/end.
- No hardcoded tenant IDs, subscription IDs, or secrets anywhere in this repo.
