# Contributing to Agent 365 Skills

Thank you for your interest in contributing to the Agent 365 Skills project! This document provides guidelines and best practices for contributors.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Adding or Modifying Skills](#adding-or-modifying-skills)
- [Writing Evaluations](#writing-evaluations)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)

---

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

---

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/agent365-skills.git
   cd agent365-skills
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/microsoft/agent365-skills.git
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

---

## Development Workflow

### Local Testing

1. **Test skills locally** with Claude Code or GitHub Copilot CLI:
   ```bash
   cd /path/to/test-agent-project
   claude --plugin-dir /path/to/agent365-skills/plugins/agent365
   ```

2. **Run validator scripts** directly:
   ```bash
   node plugins/agent365/hooks/stop/validate-instrument-observability.js
   node plugins/agent365/hooks/stop/validate-a365-setup.js
   ```

3. **Test against real projects**:
   - Use actual .NET AgentFramework projects
   - Use actual Node.js LangChain projects
   - Test both happy paths and error cases

### Pre-commit Checklist

- [ ] All new code is documented with clear comments
- [ ] SKILL.md files are updated if workflow changes
- [ ] Reference docs are updated if SDK versions change
- [ ] Evals are added or updated for new features
- [ ] Validator scripts pass
- [ ] No hardcoded secrets, tenant IDs, or subscription IDs
- [ ] All file paths use forward slashes `/` (not backslashes)
- [ ] Marker comments are present on all instrumented code

---

## Adding or Modifying Skills

### Creating a New Skill

1. **Create the skill directory structure**:
   ```
   plugins/agent365/skills/your-skill/
   ├── SKILL.md
   └── references/
   ```

2. **Write the SKILL.md file** with:
   - YAML frontmatter (name, description, allowed-tools, model, hooks)
   - Clear phase-by-phase instructions
   - Error handling guidance
   - Idempotency considerations

3. **Add reference documentation** in `references/`:
   - Code patterns and examples
   - Package versions
   - API surface documentation

4. **Create a validator script** in `plugins/agent365/scripts/`:
   - Exit 0 with `{"ok": true}` on success
   - Exit 1 with `{"ok": false, "reason": "..."}` on failure
   - Complete within 15 seconds
   - Check local files only (no network I/O)

5. **Register the skill** in `plugins/agent365/.claude-plugin/plugin.json`

6. **Update marketplace** description if needed in `.claude-plugin/marketplace.json`

### Modifying an Existing Skill

1. **Update SKILL.md** if the workflow changes
2. **Update reference docs** if SDK versions or patterns change
3. **Update validator scripts** if validation logic changes
4. **Update or add evals** for the modified behavior
5. **Test thoroughly** against both .NET and Node.js agents

### Skills Design Principles

- **Non-destructive**: Never delete or restructure existing agent code
- **Additive**: Only add new code, preserve all existing functionality
- **Idempotent**: Safe to run multiple times without breaking
- **Informative**: Ask before making changes, explain what's happening
- **Phase-based**: Break work into clear, trackable phases
- **Marker-based**: Mark all instrumented code with comments for traceability

---

## Writing Evaluations

### Eval Structure

Each skill should have an `evals.json` file in `evals/agent365/<skill-name>/`:

```json
{
  "skill_name": "skill-name",
  "eval_instructions": "Special instructions for running these evals",
  "evals": [
    {
      "id": 1,
      "prompt": "User prompt that triggers the skill",
      "description": "What this eval tests",
      "expected_output": "High-level expected behavior",
      "files": [],
      "expectations": [
        "Detailed assertion 1",
        "Detailed assertion 2",
        ...
      ]
    }
  ]
}
```

### Eval Coverage

Each skill should have evals for:
- **Happy path** (.NET AgentFramework)
- **Happy path** (Node.js LangChain)
- **Idempotency** (running on already-instrumented/configured agent)
- **Error handling** (missing dependencies, unsupported projects)
- **Edge cases** (partial configurations, Global Admin workflows, etc.)

### Expectation Guidelines

- Start each expectation with the phase name (e.g., "Phase 1:", "Phase 2:")
- Be specific about commands, files, and interactions
- Include both positive (should happen) and negative (should NOT happen) assertions
- Check marker comments, file existence, build success, error messages
- Verify workflow-log.md captures all phases

See [evals/README.md](evals/README.md) for detailed eval documentation.

---

## Testing

### Manual Testing

1. **Run all evals** for modified skills
2. **Test on real projects** in both .NET and Node.js
3. **Document test results** in your PR description
4. **Verify validator scripts** pass

### Automated Testing

> **Coming soon**: Automated eval runner and CI/CD integration

---

## Pull Request Process

1. **Sync with upstream** before creating your PR:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your branch** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create a Pull Request** on GitHub with:
   - Clear title describing the change
   - Detailed description of what changed and why
   - List of evals run and results
   - Screenshots or logs if applicable
   - Reference to any related issues

4. **Address review feedback**:
   - Make requested changes
   - Push updates to your branch
   - Respond to comments

5. **Squash commits** if requested before merging

---

## Style Guidelines

### SKILL.md Files

- Use Markdown with clear headers and numbered phases
- Include YAML frontmatter with all required fields
- Write instructions for AI agents (precise, unambiguous, actionable)
- Use `${CLAUDE_PLUGIN_ROOT}` for relative paths
- Include error handling and exit strategies
- Document idempotency behavior

### Reference Documentation

- Keep code snippets complete and runnable
- Show actual package names and versions
- Use marker comments consistently
- Document breaking changes in SDK updates

### Validator Scripts

- Plain Node.js (no dependencies)
- Exit 0 with `{"ok": true}` on success
- Exit 1 with `{"ok": false, "reason": "..."}` on failure
- Complete within 15 seconds
- No network I/O or blocking operations

### Code Comments

- Mark all instrumented code with:
  ```
  // A365 Observability — best-effort instrumentation (verify against official sample)
  ```
- Use clear, descriptive comments
- Explain "why" not just "what"

### Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit first line to 72 characters
- Reference issues and PRs liberally

---

## Questions?

If you have questions:
- **Check the docs**: [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [README.md](README.md)
- **Review evals**: [evals/README.md](evals/README.md)
- **Open an issue**: https://github.com/microsoft/agent365-skills/issues
- **Start a discussion**: https://github.com/microsoft/agent365-skills/discussions

---

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

See [LICENSE](LICENSE) for details.
