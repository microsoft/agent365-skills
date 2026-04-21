# Agent 365 Skills — Coding Agent Context

This repository is a **Claude Code / GitHub Copilot CLI plugin marketplace** containing
skills for the Microsoft Agent 365 platform. Read this file before making any changes.

---

## What's in this repo

```
agent365-skills/
├── .claude-plugin/marketplace.json    # Marketplace manifest — lists all plugins
├── .claude/settings.json              # Auto-allowed tools for skill execution
├── plugins/
│   └── agent365/                      # The core plugin
│       ├── .claude-plugin/plugin.json # Skill declarations and triggers
│       ├── skills/
│       │   ├── instrument-observability/SKILL.md  # OTel + A365 exporter instrumentation
│       │   └── a365-setup/SKILL.md                # Blueprint setup & permissions
│       ├── shared/agent-detection.md  # Shared heuristics for detecting agent type
│       └── scripts/                   # Stop hook validators (plain Node.js)
├── evals/
│   └── agent365/                      # Evaluation test cases
│       ├── instrument-observability/evals.json
│       └── a365-setup/evals.json
├── scripts/install.js                 # One-liner installer for Claude Code + Copilot CLI
├── AGENTS.md                          # Top-level contributor guidelines
└── README.md                          # User-facing documentation
```

---

## Key rules

1. **SKILL.md files are instructions for the AI, not code.** They are read at skill
   invocation time. Keep them precise, phase-by-phase, and unambiguous.

2. **Validator scripts are plain Node.js.** No dependencies allowed. They run in 15 seconds.

3. **Reference docs are the source of truth for code patterns.** When the A365 SDK updates,
   update `references/` — not `SKILL.md`.

4. **Never commit secrets.** The `.gitignore` excludes `a365.generated.config.json`, `.env`,
   and `appsettings.*.json`.

5. **Skills are additive.** They never delete or restructure existing agent code.

---

## Testing

```bash
# Test skill against a real .NET agent project
cd /path/to/dotnet-agent
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Say: "instrument observability for this agent"

# Test skill against a Node.js LangChain project
cd /path/to/nodejs-langchain-agent
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Say: "add a365 observability"

# Validate stop hooks directly
node plugins/agent365/scripts/validate-observability.js
node plugins/agent365/scripts/validate-setup.js

# Run evals manually
# See evals/README.md for detailed testing instructions
```

For comprehensive eval test cases, see [evals/README.md](evals/README.md).

---

## Allowed commands (auto-approved in .claude/settings.json)

`dotnet *`, `npm *`, `node *`, `a365 *`, `az *`, `git *`, `grep *`, `find *`, `cat *`, `ls *`
