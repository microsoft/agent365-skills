# Agent 365 Skills — Coding Agent Context

This repository is a **Claude Code / GitHub Copilot CLI plugin marketplace** containing
skills for the Microsoft Agent 365 platform. Read this file before making any changes.

---

## What's in this repo

```
agent365-skills/
├── .claude-plugin/marketplace.json    # Marketplace manifest — lists all plugins
├── plugins/
│   └── agent365/                      # The core plugin
│       ├── .claude-plugin/plugin.json # Skill declarations and triggers
│       ├── skills/
│       │   ├── a365-setup/SKILL.md                   # Entry point — CLI install, Azure prereqs, delegates
│       │   ├── make-a365-agent/SKILL.md               # Blueprint provisioning (Register / Observability paths)
│       │   ├── make-ai-teammate/SKILL.md              # AI Teammate transformation + publish pipeline
│       │   ├── instrument-observability/SKILL.md      # OTel + A365 tracing exporter instrumentation
│       │   ├── add-workiq-tools/SKILL.md              # WorkIQ MCP server wiring
│       │   └── test-local/SKILL.md                    # Local testing with AgentsPlayground
│       ├── hooks/
│       │   ├── preToolUse/path-guard.js               # Blocks writes outside project root
│       │   └── stop/                                  # Stop hook validators (plain Node.js, no deps)
│       │       ├── validate-a365-setup.js
│       │       ├── validate-make-a365-agent.js
│       │       ├── validate-make-ai-teammate.js
│       │       ├── validate-instrument-observability.js
│       │       ├── validate-add-workiq-tools.js
│       │       └── validate-test-local.js
│       └── shared/agent-detection.md  # Shared heuristics for detecting agent type and authMode
├── tests/                             # Unit tests for stop hook validators
│   ├── helpers.js
│   ├── validate-a365-setup.test.js
│   ├── validate-make-a365-agent.test.js
│   ├── validate-observability.test.js
│   └── validate-workiq.test.js
├── evals/
│   └── agent365/                      # Evaluation test cases (one per skill)
│       ├── a365-setup/evals.json
│       ├── make-a365-agent/evals.json
│       ├── make-ai-teammate/evals.json
│       ├── instrument-observability/evals.json
│       ├── add-workiq-tools/evals.json
│       └── test-local/evals.json
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

6. **authMode canonical values** are `obo`, `s2s`, and `agentic-user`. Read case-insensitively, write lowercase.

7. **`tenantReady` is deprecated and must not be used as a setup gate.**
   Do not read or write `tenantReady` in `.a365-workspace-detection.local.json`.
   Setup flow decisions should rely on explicit runtime checks and user-confirmed steps.

8. **WorkIQ is not available for `authMode = s2s`** — never offer or invoke `add-workiq-tools`
   for S2S agents. The guard exists at three layers: `a365-setup`, `make-a365-agent` Phase 4,
   and `add-workiq-tools` Phase 0B.

9. **Run task lists to completion in one turn.** When a skill creates a task list, execute
   every task and mark each complete (`TaskUpdate` or `- [ ]` → `- [x]`) the moment its phase
   finishes. Only pause at the explicit interaction points each SKILL.md documents
   (capabilities menu, run-target, blueprint Reuse/Re-run/Fresh, WorkIQ offer, MCP server
   selection, Word @mention offer when `mcp_WordServer` is selected on Node.js LangChain,
   launch confirmation). CLI permission prompts and manual browser steps
   (Teams Dev Portal, M365 Admin Center, GA consent) are not stopping conditions — surface
   them with URL + action and continue.

---

## Testing

```bash
# Run all validator unit tests
npm test

# Run a specific validator test suite
node --test tests/validate-a365-setup.test.js
node --test tests/validate-make-a365-agent.test.js
node --test tests/validate-observability.test.js
node --test tests/validate-workiq.test.js

# Validate stop hooks directly against the current directory
node plugins/agent365/hooks/stop/validate-a365-setup.js
node plugins/agent365/hooks/stop/validate-instrument-observability.js
node plugins/agent365/hooks/stop/validate-make-a365-agent.js

# Test skill against a real agent project
cd /path/to/dotnet-agent
claude --plugin-dir /path/to/agent365-skills/plugins/agent365
# Say: "instrument observability for this agent"

# Run evals manually
# See evals/README.md for detailed testing instructions
```

For comprehensive eval test cases, see [evals/README.md](evals/README.md).

---

## Allowed commands

`dotnet *`, `npm *`, `node *`, `python *`, `python3 *`, `pip *`, `pip3 *`, `uv *`, `a365 *`, `az *`, `devtunnel *`, `agentsplayground *`, `git *`, `grep *`, `find *`, `cat *`, `ls *`
