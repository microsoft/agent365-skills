# Agent 365 Skills — Evaluations

This directory contains evaluation test cases for Agent 365 skills. Each skill has a set of evals designed to verify that the skill performs correctly across different scenarios, edge cases, and error conditions.

---

## Structure

```
evals/
├── README.md                         # This file
└── agent365/
    ├── instrument-observability/
    │   └── evals.json                # 5 test cases
    └── a365-setup/
        └── evals.json                # 7 test cases
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

## Running Evaluations

### Manual Testing

To manually test a skill against an eval:

1. **Prepare a test environment**:
   - For `instrument-observability`: Use a real .NET AgentFramework or Node.js LangChain agent project
   - For `a365-setup`: Use an agent project with a365 CLI and Azure CLI installed

2. **Start the agent** with the plugin loaded:
   ```bash
   cd /path/to/test-agent-project
   claude --plugin-dir /path/to/agent365-skills/plugins/agent365
   ```

3. **Run the eval prompt**:
   ```
   # Example for instrument-observability eval #1
   "Instrument observability for this agent"
   ```

4. **Verify expectations**:
   - Check that a `workflow-log.md` was created
   - Go through each expectation in the eval and verify it was met
   - Check files, commands run, outputs, and error handling

5. **Document results**:
   - Note which expectations passed/failed
   - Record any issues or unexpected behavior
   - Update the eval if the expected behavior has changed

### Automated Testing

> **Note**: Automated eval runner coming soon. For now, use manual testing.

In the future, we plan to add an automated eval runner that:
- Spins up test environments for each eval
- Runs the skill with the eval prompt
- Parses `workflow-log.md` and tool outputs
- Validates expectations automatically
- Generates a test report

---

## Eval Categories

### `instrument-observability` Evals

| ID | Scenario | Purpose |
|----|----------|---------|
| 1 | .NET AgentFramework | Verify full instrumentation flow for .NET agents |
| 2 | Node.js LangChain | Verify full instrumentation flow for Node.js agents |
| 3 | Already instrumented (.NET) | Test idempotency on a pre-instrumented agent |
| 4 | Already instrumented (Node.js) | Test idempotency on a pre-instrumented agent |
| 5 | Unknown agent type | Test error handling for unsupported projects |

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

1. **Test on real projects**: Use actual .NET AgentFramework and Node.js LangChain projects, not mock data
2. **Start from clean state**: Reset test environments between evals to avoid contamination
3. **Check the workflow log**: Verify that `workflow-log.md` captures all phases and decisions
4. **Validate marker comments**: Ensure all instrumented code has the A365 marker comment
5. **Test error paths**: Don't just test the happy path — verify error handling and recovery
6. **Verify idempotency**: Skills should be safe to run multiple times without breaking
7. **Document deviations**: If actual behavior differs from expectations, update the eval or fix the skill

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
