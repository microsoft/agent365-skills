# Agent 365 Skills — Evaluations

This directory contains evaluation test cases for Agent 365 skills. Each skill has a set of evals designed to verify that the skill performs correctly across different scenarios, edge cases, and error conditions.

---

## Structure

```
evals/
├── README.md                         # This file
└── agent365/
    ├── make-ai-teammate/
    │   └── evals.json                # 10 test cases
    ├── a365-setup/
    │   └── evals.json                # 7 test cases
    ├── add-workiq-tools/
    │   └── evals.json                # 5 test cases
    ├── instrument-observability/
    │   └── evals.json                # 5 test cases
    ├── a365-code-validator/
    │   └── evals.json                # 10 test cases
    └── test-local/
        └── evals.json                # 5 test cases
```

Each `evals.json` file contains:
- **skill_name**: The name of the skill being tested
- **eval_instructions**: Special instructions for running the evaluations
- **evals**: An array of test cases, each with:
  - **id**: Unique test case identifier
  - **prompt**: The user prompt that triggers the skill
  - **description**: Context about what this test case validates
  - **expected_output**: High-level description of expected behavior
  - **files**: Array of files needed for the test (if any)
  - **expectations**: Detailed assertions to verify

---

## Prerequisites

Most code-editing skills require `.a365-workspace-detection.local.json` to be present in the
project directory. This file is written by `a365-setup` and contains `agentStack`,
`programmingLanguage`, and `detectedAt`. Skills read from this cache instead of running their
own detection.

Exceptions:
- `test-local` can run without the cache.
- `a365-code-validator` can run without the cache because it is read-only and performs its own
  static inspection.

---

## Running Evaluations

### Manual Testing

To manually test a skill against an eval:

1. **Prepare a test environment** — use a real agent project for the target language:
   - `make-ai-teammate`: A plain Node.js/Python/dotnet LLM agent with no M365 integration
   - `a365-setup`: Any agent project with a365 CLI and Azure CLI installed
   - `add-workiq-tools`: An agent already transformed by `make-ai-teammate` (has `.a365-workspace-detection.local.json`)
   - `instrument-observability`: An agent already transformed by `make-ai-teammate`
   - `a365-code-validator`: Any existing agent project; no setup prerequisite, read-only
   - `test-local`: Any agent with a build script or `dotnet run` / `uv run`

2. **Start Claude** with the plugin loaded:
   ```bash
   cd /path/to/test-agent-project
   claude --plugin-dir /path/to/agent365-skills/plugins/agent365
   ```

3. **Run the eval prompt**, e.g.:
   ```
   "Make this agent an AI Teammate"
   "Add WorkIQ tools"
   "Instrument observability for this agent"
   ```

4. **Verify expectations**:
   - Go through each expectation in the eval and verify it was met
   - Check files created/modified, commands run, and user interactions
   - Verify idempotency by running the skill a second time

5. **Document results**:
   - Note which expectations passed/failed
   - Update the eval if expected behavior has legitimately changed

---

## Eval Categories

### `make-ai-teammate` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | Node.js LangChain — full | Full transformation from plain LangChain agent |
| 2 | Node.js OpenAI SDK — partial | Hosting present; adds agent class + notifications |
| 3 | Node.js Claude SDK | Claude-specific transformation path |
| 4 | Node.js — fully configured | Idempotency: all components already present |
| 5 | Node.js — existing Express | Migrates non-CloudAdapter server |
| 6 | Node.js — unknown framework | Stub path with manual LLM wiring |
| 7 | .NET AgentFramework — full | Full transformation for .NET agents |
| 8 | .NET AgentFramework — partial | Hosting present; adds missing handlers |
| 9 | Python AgentFramework — full | Full transformation for Python agents |
| 10 | Python — partial (idempotent) | Hosting + agent class present; adds manifest + env |

### `a365-setup` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | Full setup (.NET) | Verify complete setup lifecycle for .NET agents |
| 2 | Full setup (Node.js) | Verify complete setup lifecycle for Node.js agents |
| 3 | Existing config | Test resuming setup with existing a365.config.json |
| 4 | Missing a365 CLI | Test error handling when CLI is not installed |
| 5 | Not authenticated | Test error handling when Azure CLI is not authenticated |
| 6 | Global Admin handoff | Test GA consent workflow explanation |
| 7 | Already configured | Test idempotency on a fully configured agent |

### `add-workiq-tools` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | .NET — blueprint not yet created | Full flow; permissions path A (a365 setup all) |
| 2 | Node.js — blueprint already exists | Full flow; permissions path B (admin runs add-mcp-servers) |
| 3 | Selective install — user picks specific servers | Verifies partial server selection works |
| 4 | Idempotency — servers already in manifest | Skip re-adding; skip code wiring; revalidate build |
| 5 | Error — a365 CLI missing | Install CLI automatically and retry |

### `instrument-observability` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | .NET AgentFramework — full | Full instrumentation including BaggageBuilder and token resolver |
| 2 | Node.js LangChain — full | Full instrumentation with ObservabilityManager |
| 3 | Already instrumented (.NET) | Idempotency: skip if marker comments present |
| 4 | Already instrumented (Node.js) | Idempotency: skip if marker comments present |
| 5 | Unknown agent type | Write `.a365setup-unknown-agent` marker and exit with clear error |

### `test-local` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | .NET — agentsplayground installed | Happy path: build + launch |
| 2 | Node.js — agentsplayground installed | Happy path: build + launch |
| 3 | agentsplayground not installed | Auto-install via npm then launch |
| 4 | User declines launch | Show manual commands and exit cleanly |
| 5 | Build fails | Stop before launch; surface error output |

### `a365-code-validator` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | Python exporter flag missing | Catches `enable_a365=True` without actual exporter activation |
| 2 | Blueprint used as agent ID | Catches background/queue paths that set `gen_ai.agent.id` to blueprint |
| 3 | Missing semantic spans | Catches baggage-only implementations that won't populate MAC Activity |
| 4 | Node exporter flag missing | Catches `a365.enabled` without `enableObservabilityExporter` |
| 5 | S2S token shape wrong | Catches bare `ClientSecretCredential`/MI token instead of the 3-hop FMI exchange (`AADSTS82001`) |
| 6 | S2S endpoint via env only | Catches reliance on `A365_USE_S2S_ENDPOINT` env instead of the `a365_use_s2s_endpoint` code flag |
| 7 | Caller identity wrong | Catches `user.id` set to the agent's own user / blank instead of the human caller OID |
| 8 | Code clean, Activity empty | Branches to tenant-side causes (license assigned, Frontier enrollment, resource SP, lag) instead of a false code bug |
| 9 | No `invoke_agent` root | Catches child-span-only runs / identity-less spans ("0 identity groups") that never land in MAC |
| 10 | Guided remediation | Verifies `apply_safe_fixes` applies only the deterministic exporter fix and asks before design changes |

---

## Writing New Evals

When adding a new eval test case:

1. **Choose a unique ID**: Increment from the last eval in the file
2. **Write a clear prompt**: Use natural language that a user would actually type
3. **Describe the scenario**: Explain what this test validates (edge case, error, etc.)
4. **Define expected output**: High-level summary of what should happen
5. **List expectations**: Detailed, phase-by-phase assertions to check
6. **Use consistent structure**: Follow the pattern of existing evals

### Expectation Guidelines

- Start each expectation with the phase name (e.g., "Phase 1:", "Phase 2:")
- Be specific about commands run, files read/written, and user interactions
- Include both positive assertions (what should happen) and negative assertions (what should NOT happen)
- Check for marker comments, file existence, build success, error messages, etc.
- Verify idempotency and error handling

---

## Best Practices

1. **Test on real projects**: Use actual agent projects, not mock data — skills interact with the filesystem and CLI tools
2. **Start from clean state**: Reset test environments between evals to avoid contamination
3. **Test error paths**: Don't just test the happy path — verify error handling and recovery
4. **Verify idempotency**: Every skill should be safe to run multiple times without breaking
5. **Check prerequisite state**: Skills except `test-local` require `.a365-workspace-detection.local.json` — ensure it exists before testing
6. **Document deviations**: If actual behavior differs from expectations, update the eval or fix the skill

---

## Updating Evals

When updating skills, remember to:

1. Review all evals for that skill
2. Update expectations if the workflow changes
3. Add new evals for new features or edge cases
4. Remove obsolete expectations
5. Test all evals after making changes

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

When submitting a skill change, include:
- Updated or new evals covering the change
- Manual test results showing all evals pass
- Notes on any expectation changes and why

---

## License

This project is licensed under the MIT License — see [LICENSE](../LICENSE) for details.
