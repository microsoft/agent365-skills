---
name: add-cli
description: >
  Adds a local CLI runner to an existing .NET AgentFramework or Node.js LangChain agent,
  enabling developers to chat with the agent from the terminal without deploying to Teams
  or a messaging endpoint. Scaffolds a CLI entry point, wires up the bot adapter in console
  mode, and adds npm/dotnet run scripts. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: CLI runner name or 'interactive' for REPL mode"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: haiku
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-add-cli.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was correctly detected (.NET AgentFramework or Node.js LangChain).
        2. A CLI entry point file was created or verified (cli.ts, cli.js, or ConsoleCli.cs).
        3. A run script or launch profile was added for the CLI.
        4. Build/compile succeeds (dotnet build or npm run build).
        5. All scaffolded code is marked with: // A365 CLI — added by add-cli skill
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 30000
---

# Add CLI to Agent

> **Trigger phrases** — any of these will activate this skill automatically:
> - "add cli to this agent"
> - "add a console runner"
> - "add terminal interface"
> - "run agent from command line"
> - "add local chat cli"
> - "add cli runner"

---

## Overview

This skill adds a local CLI (command-line interface) to an existing A365 agent so developers can
test it interactively from the terminal. It scaffolds a console-mode bot adapter, a REPL loop,
and a run script.

**What the CLI provides:**
- An interactive REPL that sends messages to the agent and prints responses
- Reads configuration from the same `.env` / `appsettings.json` as production
- No Teams deployment or messaging endpoint required
- Ctrl+C to exit cleanly

All changes are **additive** and **idempotent** — rerunning the skill is safe.

---

## Phase 0A — Initial Detection and User Validation

**TaskCreate** — "Detect agent stack, programming language, and validate with user"

### Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.json` if it exists. If `detectedAt` is within the last 60 minutes, load `agentStack`, `programmingLanguage`, and `usesTeamsOrCopilot` from it and skip the detection steps below — go straight to User Validation Questions.

Run all three detection steps **in parallel** (single tool call with multiple Glob/Grep):

**Step 1: Detect Agent Stack** → Store as `agentStack`
- Check for .csproj + Microsoft.Agents.* → `Agent Framework`
- Check for package.json + @langchain → `LangChain`  
- Check for package.json + "openai" (no LangChain) → `OpenAI`
- Check for requirements.txt + langchain → `LangChain`
- Check for requirements.txt + openai → `OpenAI`

**Step 2: Detect Programming Language** → Store as `programmingLanguage`
- .csproj exists → `DotNet`
- package.json exists → `NodeJS`
- requirements.txt OR .py files → `Python`

**Step 3: Detect Custom Engine Agent** → Store as `usesTeamsOrCopilot`
- M365 signals (Teams/Copilot references) AND (a365.config.json OR a365.generated.config.json exists) → `1`
- Otherwise → `0`

### User Validation Questions

Present **all three detections in a single message** and wait for ONE response:

```
Here's what we detected about your agent:
  • Stack:          {agentStack}
  • Language:       {programmingLanguage}
  • Teams/Copilot:  {usesTeamsOrCopilot == 1 ? "Yes" : "No"}

Reply **yes** to confirm, or describe any corrections (e.g. "language is NodeJS" or "it's not Teams").
```

- If the user replies **yes / y**: accept all three values.
- If the user describes corrections: update the relevant variable(s).

After confirming, write `.a365-workspace-detection.json` (see `agent-detection.md` cache format).

**TaskUpdate** — Mark complete: "Detect agent stack, programming language, and validate with user"

---

## Phase 0B — Create Task List

```
TaskCreate: "Detect agent type"
TaskCreate: "Check for existing CLI"
TaskCreate: "Scaffold CLI entry point"
TaskCreate: "Add run script or launch profile"
TaskCreate: "Validate build and test CLI start"
```

---

## Phase 1 — Detect Agent Type

**Mark task in progress: "Detect agent type"**

1. **Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` for detection heuristics.

2. Run detection following the rules in `agent-detection.md`:
   - **Glob** `**/*.csproj` → .NET indicator
   - **Grep** `AgentApplication` in `**/*.cs` → .NET AgentFramework
   - **Glob** `**/package.json` → Node.js indicator
   - **Grep** `@langchain` or `langchain` in `**/package.json` → Node.js LangChain

3. Load reference patterns:
   - If .NET: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-cli/references/dotnet-cli.md`
   - If Node.js: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-cli/references/nodejs-cli.md`

**Mark task complete: "Detect agent type"**

---

## Phase 2 — Check for Existing CLI

**Mark task in progress: "Check for existing CLI"**

### For .NET AgentFramework

- **Glob** `**/ConsoleCli.cs`, `**/CliRunner.cs`, `**/ConsoleAdapter.cs`
- **Grep** `ConsoleAdapter`, `ConsoleBotAdapter` in `**/*.cs`

If found, inform user and skip Phase 3 (go to Phase 4 to verify run script).

### For Node.js LangChain

- **Glob** `**/cli.ts`, `**/cli.js`, `src/cli.ts`
- **Grep** `"cli"` in `package.json` scripts section

If found, inform user and skip Phase 3.

**Mark task complete: "Check for existing CLI"**

---

## Phase 3 — Scaffold CLI Entry Point

**Mark task in progress: "Scaffold CLI entry point"**

### For .NET AgentFramework

1. **Read** the detected agent class (AgentApplication subclass) to understand the message handler signature.

2. **Write** `ConsoleCli.cs` in the project root following the reference pattern:
   - Create a `ConsoleCli` class with a `RunAsync()` static method
   - Instantiate the agent class directly (no HTTP stack)
   - Implement a `while(true)` REPL loop:
     - Read a line from `Console.ReadLine()`
     - Build a minimal `ITurnContext` with the message
     - Call `agent.OnMessageActivityAsync(context, cancellationToken)`
     - Print the response to console
   - Handle Ctrl+C (`CancellationToken`) for clean exit
   - Mark all lines: `// A365 CLI — added by add-cli skill`

3. **Edit** `Program.cs` to add a CLI mode check:
   - If `args` contains `--cli` or env var `RUN_MODE=cli` is set, call `await ConsoleCli.RunAsync(args)`
   - Otherwise, continue the normal HTTP host startup
   - Mark new lines: `// A365 CLI — added by add-cli skill`

### For Node.js LangChain

1. **Read** the agent entry point to understand the agent invocation pattern.

2. **Write** `src/cli.ts` following the reference pattern:
   - Import the agent factory (same agent used in production)
   - Implement a readline REPL loop using Node.js `readline` module (no extra deps)
   - Send each line to the agent's `.invoke()` or `.stream()` method
   - Print the response (or stream chunks) to stdout
   - Handle SIGINT (Ctrl+C) for clean exit
   - Mark all lines: `// A365 CLI — added by add-cli skill`

**Mark task complete: "Scaffold CLI entry point"**

---

## Phase 4 — Add Run Script or Launch Profile

**Mark task in progress: "Add run script or launch profile"**

### For .NET AgentFramework

1. **Read** `Properties/launchSettings.json` if it exists.

2. **Edit** (or create) `Properties/launchSettings.json`:
   - Add a `"cli"` profile:
     ```json
     "cli": {
       "commandName": "Project",
       "commandLineArgs": "--cli",
       "environmentVariables": {
         "RUN_MODE": "cli",
         "ASPNETCORE_ENVIRONMENT": "Development"
       }
     }
     ```
   - Mark new section: `// A365 CLI — added by add-cli skill`

3. Tell user: Run with `dotnet run --cli` or select the `cli` launch profile in VS Code.

### For Node.js LangChain

1. **Read** `package.json`.

2. **Edit** `package.json` — add to the `"scripts"` section:
   ```json
   "cli": "ts-node src/cli.ts"
   ```
   Or if using compiled JS:
   ```json
   "cli": "node dist/cli.js"
   ```

3. If `ts-node` is not in `devDependencies`, install it:
   ```bash
   npm install --save-dev ts-node
   ```

4. Tell user: Run with `npm run cli`.

**Mark task complete: "Add run script or launch profile"**

---

## Phase 5 — Validate Build and Test CLI Start

**Mark task in progress: "Validate build and test CLI start"**

### For .NET AgentFramework

1. **Bash** — Build:
   ```bash
   dotnet build
   ```

2. If build passes, tell user how to start:
   > Run `dotnet run --cli` to start the interactive CLI.

### For Node.js LangChain

1. **Bash** — Build and install:
   ```bash
   npm install
   npm run build || npm run compile || echo "No build script — skipping"
   ```

2. If build passes, tell user how to start:
   > Run `npm run cli` to start the interactive CLI.

If build fails, present error output with suggested fixes.

**Mark task complete: "Validate build and test CLI start"**

---

## Phase 6 — Final Summary

1. **TaskList** — Show all completed tasks.

2. Present summary:

```
✅ CLI runner added successfully!

**Agent type:** [.NET AgentFramework | Node.js LangChain]
**CLI entry point:** [ConsoleCli.cs | src/cli.ts]
**Run command:** [dotnet run --cli | npm run cli]

**How to use:**
1. Run the CLI command above.
2. Type a message and press Enter — the agent will respond inline.
3. Press Ctrl+C to exit.

**Note:** The CLI uses the same configuration as your production agent.
Ensure your .env / appsettings.json is set up with valid credentials.

All scaffolded code is marked with:
// A365 CLI — added by add-cli skill
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| CLI already exists | Report to user; skip scaffolding; verify run script |
| Missing agent class import | Ask user to identify the agent class; update import |
| ts-node install fails | Try npx ts-node instead; update script accordingly |
| Build fails | Do not revert; show error and offer to debug |
| No DI container in CLI (Node.js) | Instantiate agent class directly without Express/HTTP |

---

## Idempotency

On subsequent runs:
- Skip file creation if `ConsoleCli.cs` or `src/cli.ts` already exists
- Skip `package.json` script addition if `"cli"` script already present
- Skip `launchSettings.json` addition if `"cli"` profile already present
- Always revalidate the build

---

## Constraints

- **No new runtime dependencies** beyond what the agent already uses (use Node.js built-in `readline`, not `inquirer` or `blessed`).
- **No mock data** — the CLI uses real agent logic and real credentials.
- **No HTTP stack in CLI mode** — bypass Express/Kestrel entirely.
- **Preserve existing entry points** — `Program.cs` and `index.ts` continue to work for production.

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **.NET Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/add-cli/references/dotnet-cli.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/add-cli/references/nodejs-cli.md`
