---
name: test-local
description: >
  Runs an Agent 365 AI Teammate agent locally and opens AgentsPlayground for interactive
  local testing. Works with any AI Teammate stack — .NET (AgentFramework, Semantic Kernel),
  Node.js (LangChain, OpenAI, Claude SDK, Semantic Kernel, Google ADK), or
  Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK).
  Checks prerequisites (agentsplayground CLI, build tools), builds the agent, starts it in
  the background, and launches the playground UI pointed at the local endpoint.
  AgentsPlayground connects to /api/messages over HTTP — the LLM framework does not matter.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: port number (default: 3978 for Node.js/Python, 5000 for .NET)"
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: haiku
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-test-local.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was detected (.NET, Node.js, or Python — any AI Teammate stack).
        2. agentsplayground CLI was verified as installed (or installed if missing).
        3. Agent project built successfully (dotnet build, npm install, or pip install).
        4. User was shown the launch commands for agent + AgentsPlayground.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If all items are complete, or the user declined to launch, return {"ok": true}.
      timeout: 30000
---

# Test Agent Locally (AgentsPlayground)

> **Trigger phrases** — any of these will activate this skill automatically:
> - "test this agent locally"
> - "run my agent locally"
> - "open agentsplayground"
> - "launch agentsplayground"
> - "start a local test session"
> - "debug this agent locally"
> - "test my agent without deploying to teams"
> - "spin up a local test"

---

## Overview

This skill starts your agent on localhost and opens **AgentsPlayground** — a local web UI that
simulates a Teams-like chat interface without requiring a deployment or Bot Framework auth.

**What it does:**
1. Detects agent language and framework (.NET, Node.js, or Python)
2. Checks agentsplayground is installed — installs if missing
3. Builds the agent to confirm there are no compile errors
4. Starts the agent in the background
5. Launches AgentsPlayground pointed at the local endpoint
6. Guides a local test and confirms observability logs are flowing (if instrumented)

**Why AgentsPlayground works for all AI Teammate stacks:**
- Web UI that matches the Teams message format
- Connects to `/api/messages` over HTTP — the LLM framework on the server side does not matter
- The `-c emulator` flag bypasses Bot Framework auth — no extra config needed for any stack
- `requireAuth: false` in `MapAgentApplicationEndpoints` is the only .NET-specific prerequisite

All actions are **read-only against your codebase** — no code is modified.

---

## Phase 0 — Create Task List

```
TaskCreate: "Detect agent type and verify build tools"
TaskCreate: "Install agentsplayground"
TaskCreate: "Build agent"
TaskCreate: "Launch agent and AgentsPlayground"
TaskCreate: "Guide local test"
```

---

## Phase 1 — Detect Agent Type

**Mark task in progress: "Detect agent type and verify build tools"**

1. **Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` for detection heuristics.

2. **Check for detection cache.** Read `.a365-workspace-detection.json` if it exists. If `detectedAt` is within the last 60 minutes, load `agentStack` and `programmingLanguage` — skip the globs below and go to step 3.

   If cache is missing or stale, run detection globs **in parallel**:
   - **Glob** `**/*.csproj` → .NET
   - **Glob** `**/package.json` + `.ts`/`.js` source files present → Node.js
   - **Glob** `**/*.py` or `requirements.txt` / `pyproject.toml` → Python

3. Determine default port:
   - **.NET**: `5000` (HTTP, `dotnet run` default)
   - **Node.js**: `3978` (standard Bot Framework port)
   - **Python**: `3978` (aiohttp default in AI Teammate hosting layer)
   - If the user provided a port as the skill argument, use that instead.

4. Determine start command:
   - **.NET**: `dotnet run`
   - **Node.js**: `npm start` (fall back to `npm run dev` if `start` script absent)
   - **Python**: detect entry point — check for `host_agent_server.py`, `app.py`, or `main.py`; run with `python <entry>` (or `uvicorn app:app --port 3978` if an ASGI app is detected)

5. If agent type cannot be determined, stop and ask:

```
AskUserQuestion:
  question: "I couldn't detect the agent type. What are you working with?"
  options:
    - .NET (AgentFramework or Semantic Kernel)
    - Node.js (LangChain, OpenAI, Claude SDK, Semantic Kernel, or Google ADK)
    - Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, or Google ADK)
```

### 1.3 — Check language build tool

After detection, immediately verify the required build tool is installed:

**For .NET** — check `dotnet --version`. If missing:
```
AskUserQuestion:
  question: "dotnet SDK 8.0+ is required but not found. Install it now?"
  options:
    - "Yes — install via winget (Windows) or brew (macOS)"
    - "No — I'll install manually and re-run"
```
If yes, attempt:
```bash
# Windows
winget install Microsoft.DotNet.SDK.8
# macOS
brew install dotnet
```
After install, run `dotnet --version` to confirm. If it still fails, show the download link and stop:
> Download from: https://dotnet.microsoft.com/download — restart your terminal after installing, then re-run this skill.

**For Node.js** — check `node --version`. If missing:
```
AskUserQuestion:
  question: "Node.js 18+ is required but not found. Install it now?"
  options:
    - "Yes — install via winget (Windows) or brew (macOS)"
    - "No — I'll install manually and re-run"
```
If yes, attempt:
```bash
# Windows
winget install OpenJS.NodeJS.LTS
# macOS
brew install node
```
After install, run `node --version` to confirm. If it still fails, show the download link and stop:
> Download from: https://nodejs.org — restart your terminal after installing, then re-run this skill.

**For Python** — check `python --version` (or `python3 --version`). If missing:
```
AskUserQuestion:
  question: "Python 3.11+ is required but not found. Install it now?"
  options:
    - "Yes — install via winget (Windows) or brew (macOS)"
    - "No — I'll install manually and re-run"
```
If yes, attempt:
```bash
# Windows
winget install Python.Python.3.11
# macOS
brew install python@3.11
```
After install, run `python --version` to confirm. If it still fails, show the download link and stop:
> Download from: https://python.org — restart your terminal after installing, then re-run this skill.

**Mark task complete: "Detect agent type and verify build tools"**

---

## Phase 2 — Install agentsplayground

**Mark task in progress: "Install agentsplayground"**

Check if installed:

```bash
agentsplayground --version
```

If found, report the version and continue.

**If not found**, ask the user:

> "AgentsPlayground CLI is not installed. Install it now with `npm install -g @microsoft/agentsplayground`?"
> Options: **Yes, install it** / **No, I'll install it manually**

If the user chooses **Yes**:

```bash
npm install -g @microsoft/agentsplayground
```

Verify the install succeeded:

```bash
agentsplayground --version
```

If installation fails or the user chooses **No**, stop and tell the user:
> "Install agentsplayground manually with: `npm install -g @microsoft/agentsplayground`
> then re-run this skill."

Do NOT continue if agentsplayground cannot be confirmed installed.

**Mark task complete: "Install agentsplayground"**

---

## Phase 3 — Build Agent

**Mark task in progress: "Build agent"**

### For .NET

```bash
dotnet build
```

### For Node.js

```bash
npm install
npm run build || npm run compile || echo "No build script — skipping compile check"
```

### For Python

```bash
pip install -r requirements.txt || pip install .
python -c "import sys; print('Python', sys.version)"
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
  question: "Ready to start the agent and open AgentsPlayground for a local test?"
  options:
    - "Yes — start agent and open playground"
    - "No — show me the commands and I'll run them manually"
```

### 4.2 — If yes: launch

Inform the user:
> Two terminals are needed. Starting both now.

**Start the agent** (terminal 1) — command varies by language:
- **.NET**: `dotnet run`
- **Node.js**: `npm start` (fall back to `npm run dev`)
- **Python**: `python <entry-point>` (e.g. `python host_agent_server.py` or `python app.py`)

> **Note for .NET:** The `-c "emulator"` flag bypasses Bot Framework auth.
> This works because `MapAgentApplicationEndpoints` with `requireAuth: false` skips
> token validation for local traffic. No config changes are needed for Node.js or Python.

Poll until the agent responds (max ~20 s), then launch AgentsPlayground — **same command for all stacks**:

```bash
for i in $(seq 1 20); do curl -s --max-time 1 "http://localhost:<port>/api/messages" > /dev/null 2>&1 && break; sleep 1; done
agentsplayground -e "http://localhost:<port>/api/messages" -c "emulator"
```

### 4.3 — If no: show commands

Present the commands for the user to run in two terminals:

```
Terminal 1 — start your agent:
  .NET:    dotnet run
  Node.js: npm start
  Python:  python host_agent_server.py   (or python app.py / python main.py)

Terminal 2 — open AgentsPlayground (same for all stacks):
  agentsplayground -e "http://localhost:<port>/api/messages" -c "emulator"
```

**Mark task complete: "Launch agent and AgentsPlayground"**

---

## Phase 5 — Guide Local Test

**Mark task in progress: "Guide local test"**

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
> - Node.js / Python: set `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in `.env`
>
> **Stopping the agent:** Press `Ctrl+C` in Terminal 1.

If the user reports the agent is not responding, suggest:
- Confirm the port matches (check the startup log for the listening URL)
- .NET: check `MapAgentApplicationEndpoints` is called with `requireAuth: false`
- Node.js: check the express listener port in `index.ts`
- Python: check the aiohttp port in `host_agent_server.py` or `app.py`

**Mark task complete: "Guide local test"**

---

## Phase 6 — Final Summary

1. **TaskList** — Show all completed tasks.

2. Present summary:

```
✅ Local test session ready!

Agent:              [language + framework, e.g. Python · AgentFramework]
Agent endpoint:     http://localhost:<port>/api/messages
AgentsPlayground:   running (emulator mode — no auth required)

Observability check:
  If instrumented — watch terminal for Microsoft.Agents.A365.Observability log lines.
  To export to A365 service:
    .NET:           set EnableAgent365Exporter: true in appsettings.json
    Node.js/Python: set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env

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
| Python entry point unclear | Check for `host_agent_server.py`, `app.py`, or `main.py`; ask user if ambiguous |
| Python port mismatch | Check aiohttp port in entry point; default is 3978 for AI Teammate hosting |

---

## Prerequisites

| Tool | Required | Install |
|------|----------|---------|
| `agentsplayground` | Yes (all stacks) | `npm install -g @microsoft/agentsplayground` |
| `dotnet` (8.0+) | .NET only | https://dotnet.microsoft.com/download |
| `node` / `npm` | All stacks (required to install/run `agentsplayground`) | https://nodejs.org |
| `python` (3.11+) | Python only | https://python.org |

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
