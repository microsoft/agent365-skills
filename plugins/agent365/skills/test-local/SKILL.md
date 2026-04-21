---
name: test-local
description: >
  Runs an Agent 365 agent locally and opens AgentsPlayground for interactive smoke testing.
  Checks prerequisites (agentsplayground CLI, build tools), builds the agent, starts it in
  the background, and launches the playground UI pointed at the local endpoint.
  Supports .NET AgentFramework and Node.js LangChain agents.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: port number (default: 5000 for .NET, 3978 for Node.js)"
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-test-local.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was detected (.NET AgentFramework or Node.js LangChain).
        2. agentsplayground CLI was verified as installed (or installed if missing).
        3. Agent project built successfully (dotnet build or npm install).
        4. User was shown the launch commands for agent + AgentsPlayground.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If all items are complete, or the user declined to launch, return {"ok": true}.
      timeout: 30000
---

# Test Agent Locally (AgentsPlayground)

> **Trigger phrases** — any of these will activate this skill automatically:
> - "test this agent locally"
> - "run agent locally"
> - "open agentsplayground"
> - "launch local test session"
> - "smoke test this agent"
> - "test without deploying"

---

## Overview

This skill starts your agent on localhost and opens **AgentsPlayground** — a local web UI that
simulates a Teams-like chat interface without requiring a deployment or Bot Framework auth.

**What it does:**
1. Detects agent type (.NET AgentFramework or Node.js LangChain)
2. Checks agentsplayground is installed — installs if missing
3. Builds the agent to confirm there are no compile errors
4. Starts the agent in the background
5. Launches AgentsPlayground pointed at the local endpoint
6. Guides a smoke test and confirms observability logs are flowing (if instrumented)

**Why AgentsPlayground over the CLI runner:**
- Web UI that matches the Teams message format
- Works with both .NET and Node.js without any code changes
- The `-c emulator` flag bypasses Bot Framework auth — no extra config needed
- `requireAuth: false` in `MapAgentApplicationEndpoints` is the only prerequisite for .NET

All actions are **read-only against your codebase** — no code is modified.

---

## Phase 0 — Create Task List

```
TaskCreate: "Detect agent type"
TaskCreate: "Check and install agentsplayground"
TaskCreate: "Build agent"
TaskCreate: "Launch agent and AgentsPlayground"
TaskCreate: "Guide smoke test"
```

---

## Phase 1 — Detect Agent Type

**Mark task in progress: "Detect agent type"**

1. **Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` for detection heuristics.

2. Run detection:
   - **Glob** `**/*.csproj` + **Grep** `AgentApplication` in `**/*.cs` → .NET AgentFramework
   - **Glob** `**/package.json` + **Grep** `@langchain` or `langchain` → Node.js LangChain

3. Determine default port:
   - **.NET**: `5000` (HTTP, `dotnet run` default)
   - **Node.js**: `3978` (standard Bot Framework port)
   - If the user provided a port as the skill argument, use that instead.

4. Determine start command:
   - **.NET**: `dotnet run`
   - **Node.js**: `npm start` (fall back to `npm run dev` if `start` script absent)

5. If agent type cannot be determined, stop and ask:

```
AskUserQuestion:
  question: "I couldn't detect the agent type. What are you working with?"
  options:
    - .NET AgentFramework (C#)
    - Node.js LangChain (TypeScript/JavaScript)
```

**Mark task complete: "Detect agent type"**

---

## Phase 2 — Check and Install agentsplayground

**Mark task in progress: "Check and install agentsplayground"**

### 2.1 — Check if installed

```bash
agentsplayground --version
```

If the command succeeds, report the version and continue.

### 2.2 — Install if missing

If not found:

```bash
npm install -g @microsoft/agentsplayground
```

After install, verify:

```bash
agentsplayground --version
```

If installation fails, report the error and tell the user:
> "Install agentsplayground manually with: `npm install -g @microsoft/agentsplayground`
> then re-run this skill."

Do NOT continue if agentsplayground cannot be confirmed installed.

**Mark task complete: "Check and install agentsplayground"**

---

## Phase 3 — Build Agent

**Mark task in progress: "Build agent"**

### For .NET AgentFramework

```bash
dotnet build
```

### For Node.js LangChain

```bash
npm install
npm run build || npm run compile || echo "No build script — skipping compile check"
```

If build fails, show the error output and stop:
> "Fix the build errors above and re-run this skill to continue."

Do NOT attempt to launch a broken build.

**Mark task complete: "Build agent"**

---

## Phase 4 — Launch Agent and AgentsPlayground

**Mark task in progress: "Launch agent and AgentsPlayground"**

### 4.1 — Ask user before launching

```
AskUserQuestion:
  question: "Ready to start the agent and open AgentsPlayground for a local smoke test?"
  options:
    - "Yes — start agent and open playground"
    - "No — show me the commands and I'll run them manually"
```

### 4.2 — If yes: launch

**For .NET AgentFramework:**

Inform the user:
> Two terminals are needed. Starting both now.

Start the agent in the background:

```bash
dotnet run
```

Wait 4 seconds for the agent to initialize, then launch the playground:

```bash
agentsplayground -e "http://localhost:<port>/api/messages" -c "emulator"
```

> **Note:** The `-c "emulator"` flag bypasses Bot Framework auth. This works because
> `MapAgentApplicationEndpoints` with `requireAuth: false` skips token validation for
> local traffic. No additional config changes are needed.

**For Node.js LangChain:**

Start the agent in the background:

```bash
npm start
```

Wait 3 seconds, then launch the playground:

```bash
agentsplayground -e "http://localhost:<port>/api/messages" -c "emulator"
```

### 4.3 — If no: show commands

Present the commands for the user to run in two terminals:

```
Terminal 1 — start your agent:
  .NET:   dotnet run
  Node:   npm start

Terminal 2 — open AgentsPlayground:
  agentsplayground -e "http://localhost:<port>/api/messages" -c "emulator"
```

**Mark task complete: "Launch agent and AgentsPlayground"**

---

## Phase 5 — Guide Smoke Test

**Mark task in progress: "Guide smoke test"**

Tell the user:

> **AgentsPlayground is open.** Send a message in the chat window to test your agent.
>
> **What to watch for:**
>
> - **Agent responds** — confirms the messaging stack is wired correctly.
> - **Terminal logs** — if observability is instrumented, look for lines like:
>   ```
>   [Microsoft.Agents.A365.Observability] Exporting span: ...
>   [OpenTelemetry] Activity started: ...
>   ```
>   These confirm traces are flowing. If you see them, observability is working locally.
>
> **To export traces to the A365 service** (not just console):
> - .NET: set `EnableAgent365Exporter: true` in `appsettings.json`
> - Node.js: set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in `.env`
>
> **Stopping the agent:** Press `Ctrl+C` in Terminal 1.

If the user reports the agent is not responding, suggest:
- Confirm the port matches (`dotnet run` output shows the listening URL)
- For .NET: check `MapAgentApplicationEndpoints` is called with the correct route
- For Node.js: check the express listener port in `index.ts`

**Mark task complete: "Guide smoke test"**

---

## Phase 6 — Final Summary

1. **TaskList** — Show all completed tasks.

2. Present summary:

```
✅ Local test session ready!

Agent type:         [.NET AgentFramework | Node.js LangChain]
Agent endpoint:     http://localhost:<port>/api/messages
AgentsPlayground:   running (emulator mode — no auth required)

Observability check:
  If instrumented — watch terminal for Microsoft.Agents.A365.Observability log lines.
  To export to A365 service — set EnableAgent365Exporter: true (or ENABLE_A365_OBSERVABILITY_EXPORTER=true)

To stop: Ctrl+C in the agent terminal.
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| agentsplayground install fails | Report error; show manual install command; stop |
| Build fails | Show error; do not launch; stop |
| Agent port already in use | Suggest `--port <other>` or kill the existing process |
| Playground cannot connect | Check agent is listening; verify port matches |
| Node.js `npm start` not found | Try `npm run dev`; if neither, ask user for start command |

---

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| `agentsplayground` | Yes | `npm install -g @microsoft/agentsplayground` |
| `dotnet` (8.0+) | .NET only | https://dotnet.microsoft.com/download |
| `node` / `npm` | Node.js only + agentsplayground install | https://nodejs.org |

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
