# Agent 365 Skills — Bug Bash

**Version:** 1.4.2  
**Skills:** make-ai-teammate · a365-setup · make-a365-agent · add-workiq-tools · instrument-observability · test-local

Use the plain-vanilla agent starters from [Sample-Agents](https://github.com/biswapm/Sample-Agents) as starting points. These repos contain minimal agents with no A365 instrumentation — ideal for testing that the skills add everything from scratch. Mark each scenario **✅ Pass**, **❌ Fail**, or **⚠️ Partial** and note issues.

---

## Scenario 1 — `a365-setup` entry point delegates correctly

**Skill:** `a365-setup`  
**Framework:** Node.js LangChain  
**Goal:** Verify the entry-point skill installs prerequisites, detects the stack, asks capability questions, and delegates to the right downstream skill.

### Setup
- Clone a plain vanilla Node.js LangChain agent:
  ```bash
  git clone https://github.com/biswapm/Sample-Agents
  cd Sample-Agents/nodejs/langchain
  npm install
  ```
- Do **not** pre-install a365 CLI (test the install flow)

### Steps
1. Open the project in VS Code (Agent mode), GitHub CLI, or Claude Code — see Setup Guide above
2. Say: `"Run a365 setup"`
3. When asked which capabilities to enable, select **Discoverability only**

### Expected
- Skill detects Node.js LangChain
- Runs `a365 setup requirements` — offers to install any missing tools
- Validates Azure CLI login and Entra ID roles
- Delegates to `make-a365-agent` (not `make-ai-teammate`)
- `.a365-workspace-detection.json` written with `agentStack`, `programmingLanguage`, `agentType: "system-agent"`

### Actual
> _Fill in during bug bash_

### Result
- [ ] ✅ Pass  
- [ ] ❌ Fail — Issue: ___  
- [ ] ⚠️ Partial — Notes: ___

---

## Scenario 2 — `make-ai-teammate` Node.js hosting layer

**Skill:** `make-ai-teammate`  
**Framework:** Node.js OpenAI Agents SDK  
**Auth Mode:** agentic-identity  
**Goal:** Verify the skill adds the Express + CloudAdapter hosting layer to a bare OpenAI Agents SDK project and runs `a365 setup all --aiteammate`.

### Setup
- Clone a plain vanilla Node.js OpenAI Agents SDK agent:
  ```bash
  git clone https://github.com/biswapm/Sample-Agents
  cd Sample-Agents/nodejs/openai-agents
  npm install
  ```
- A365 CLI installed, Azure CLI logged in

### Steps
1. Say: `"Make this agent an AI Teammate"`
2. When asked auth mode, select **agentic-identity**
3. Allow the skill to run `a365 setup all --aiteammate`

### Expected
- `server.ts` (Express + CloudAdapter) created
- `AgentApplication` subclass created with `onMessage`, typing indicators, email notification handling
- `ToolingManifest.json` created with Calendar and Mail WorkIQ servers pre-populated
- `a365 setup all --aiteammate` runs successfully
- Skill offers `instrument-observability` next (Strongly Recommended)

### Actual
> _Fill in during bug bash_

### Result
- [ ] ✅ Pass  
- [ ] ❌ Fail — Issue: ___  
- [ ] ⚠️ Partial — Notes: ___

---

## Scenario 3 — `make-a365-agent` CEA with `--m365`

**Skill:** `make-a365-agent`  
**Framework:** .NET AgentFramework  
**Auth Mode:** agentic-identity  
**Goal:** Verify CEA registration with the `--m365` flag and `setup permissions bot` handoff.

### Setup
- Clone a plain vanilla .NET AgentFramework agent:
  ```bash
  git clone https://github.com/biswapm/Sample-Agents
  cd Sample-Agents/dotnet
  dotnet restore
  ```
- Agent already deployed to Azure (has a public `/api/messages` endpoint)
- A365 CLI installed, Global Administrator available for consent

### Steps
1. Say: `"Make this a custom engine agent"`
2. Confirm dry-run preview
3. Allow `a365 setup all --m365`
4. Follow the `a365 setup permissions bot` step

### Expected
- Dry-run preview shown before any changes
- `a365 setup all --m365` completes — Blueprint created, MCP Platform endpoint registered
- Skill prompts with Entra portal consent steps or PowerShell handoff to GA
- CEA guard fires if AI Teammate path is selected (blocks with clear error)

### Actual
> _Fill in during bug bash_

### Result
- [ ] ✅ Pass  
- [ ] ❌ Fail — Issue: ___  
- [ ] ⚠️ Partial — Notes: ___

---

## Scenario 4 — `instrument-observability` Python S2S autonomous agent

**Skill:** `instrument-observability`  
**Framework:** Python LangChain  
**Auth Mode:** S2S (Autonomous)  
**Goal:** Verify S2S scaffold files are created and OTel wiring is correct for an autonomous Python agent.

### Setup
- Clone a plain vanilla Python LangChain agent:
  ```bash
  git clone https://github.com/biswapm/Sample-Agents
  cd Sample-Agents/python/langchain
  pip3 install -r requirements.txt 2>/dev/null || pip install -r requirements.txt
  ```
- `a365-setup` already run (`agentType: "system-agent"` in `.a365-workspace-detection.json`)

### Steps
1. Say: `"Add A365 observability to this agent"`
2. When asked agent kind → **Standard Agent (Non Digital Worker)**
3. When asked auth mode → **Autonomous (S2S)**

### Expected
- `microsoft-agents-a365-runtime` and `microsoft-agents-a365-observability-core` installed with `--pre` flag
- `observability/observability_token_service.py` created — acquires token for `api://9b975845-388f-4429-889e-eab1ef63949c/.default` via MSAL
- `use_s2s_endpoint=True` set in `Agent365ExporterOptions`
- `asyncio.create_task(start_observability_token_service())` scheduled before configure
- Build passes
- All added code marked `# A365 Observability — best-effort instrumentation (verify against official sample)`

### Actual
> _Fill in during bug bash_

### Result
- [ ] ✅ Pass  
- [ ] ❌ Fail — Issue: ___  
- [ ] ⚠️ Partial — Notes: ___

---

## Scenario 5 — `add-workiq-tools` .NET AI Teammate with Mail + Calendar

**Skill:** `add-workiq-tools`  
**Framework:** .NET AgentFramework  
**Auth Mode:** user-delegated  
**Goal:** Verify MCP server selection, `ToolingManifest.json` update, and `McpToolRegistrationService` wiring.

### Setup
- Use the .NET agent from Scenario 3, or clone fresh:
  ```bash
  git clone https://github.com/biswapm/Sample-Agents
  cd Sample-Agents/dotnet
  dotnet restore
  ```
- Blueprint exists, `a365-setup` run previously

### Steps
1. Say: `"Add WorkIQ Mail and Calendar to this agent"`
2. Select Mail and Calendar from the MCP server catalog
3. Follow the `setup permissions mcp` handoff instructions

### Expected
- `a365 develop list-available` output shown
- `a365 develop add-mcp-servers` run — `ToolingManifest.json` updated with Mail + Calendar servers
- `McpToolRegistrationService` registered in DI and `GetMcpToolsAsync()` wired in the agent turn handler
- GA handoff instructions shown: `a365 setup permissions mcp` with Entra portal consent steps
- All added code marked `// A365 WorkIQ — added by add-workiq-tools skill`

### Actual
> _Fill in during bug bash_

### Result
- [ ] ✅ Pass  
- [ ] ❌ Fail — Issue: ___  
- [ ] ⚠️ Partial — Notes: ___

---

## Scenario 6 — `test-local` Node.js agent end-to-end

**Skill:** `test-local`  
**Framework:** Node.js LangChain  
**Goal:** Verify the skill builds the agent, starts it, launches AgentsPlayground, and guides through a test conversation.

### Setup
- Use the Node.js LangChain agent from Scenario 1 or 2, or clone fresh:
  ```bash
  git clone https://github.com/biswapm/Sample-Agents
  cd Sample-Agents/nodejs/langchain
  npm install
  ```
- `agentsplayground` CLI not yet installed (test the install flow)

### Steps
1. Say: `"Test this agent locally"`
2. Allow the skill to install `agentsplayground` if missing
3. Confirm before launch

### Expected
- `agentsplayground` CLI installed if missing
- `npm run build` runs — no compile errors
- Agent started on port 3978
- AgentsPlayground opens connected to `http://localhost:3978/api/messages`
- If observability was instrumented: skill tells user which log lines to watch for (span output)
- `Ctrl+C` guidance shown to stop

### Actual
> _Fill in during bug bash_

### Result
- [ ] ✅ Pass  
- [ ] ❌ Fail — Issue: ___  
- [ ] ⚠️ Partial — Notes: ___

---

## Bug Log

| # | Skill | Framework | Auth Mode | Description | Severity | Status |
|---|-------|-----------|-----------|-------------|----------|--------|
| 1 | | | | | | |

---

## Notes

- File bugs in [GitHub Issues](https://github.com/microsoft/agent365-skills/issues) using the **Bug Report** template
- P2 frameworks (OpenAI Agents SDK, Claude SDK, Google ADK, Semantic Kernel) are best-effort — mark instrumented lines for verification against official samples
- CEA + AI Teammate path is blocked at GA — expected behavior is a hard stop with clear error message

---

## Setup Guide

Pick the client you want to test with. All three clients share the same prerequisite install and repo clone steps.

---

### Common Prerequisites (all clients)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Microsoft.DotNet.SDK.8   # only needed for .NET scenarios
# Restart terminal after installs
```

### Clone repos side by side

```bash
# Pick a working folder, e.g. C:\bugbash
mkdir C:\bugbash
cd C:\bugbash

# Clone the skills repo
git clone https://github.com/microsoft/agent365-skills

# Clone the plain-vanilla sample agents
git clone https://github.com/biswapm/Sample-Agents
```

### Install skills into your agent project

```bash
# Navigate to the agent you want to test (adjust path to match the Sample-Agents folder structure)
cd C:\bugbash\Sample-Agents\nodejs\langchain
npm install   # (or: dotnet restore / pip install -r requirements.txt)

# Run the skills installer — use the ACTUAL path to the cloned skills repo
node C:\bugbash\agent365-skills\scripts\install.js
```

This copies all 6 skills into `.agents/skills/` inside the agent folder. All three clients pick them up from there automatically.

---

## Option A — VS Code + GitHub Copilot Chat (Agent Mode)

### 1. Install VS Code and Copilot Chat
```powershell
winget install Microsoft.VisualStudioCode
```
1. Open VS Code → `Ctrl+Shift+X` → search **GitHub Copilot Chat** → Install
2. Sign in with a GitHub account that has a Copilot subscription
3. Confirm Copilot Chat opens with `Ctrl+Shift+I`

### 2. Open the agent project
```bash
code C:\bugbash\Sample-Agents\nodejs\langchain
```

### 3. Verify skills are loaded
1. Open Copilot Chat (`Ctrl+Shift+I`)
2. Switch to **Agent** mode — click the model dropdown → select **Agent**
3. Type `/` — the 6 skills should appear:
   `make-ai-teammate` · `a365-setup` · `make-a365-agent` · `add-workiq-tools` · `instrument-observability` · `test-local`
4. If skills don't appear: `Ctrl+Shift+P` → **Chat: Open Chat Customizations** → Skills tab → confirm `.agents/skills/` entries are listed

### 4. Run a scenario
In **Agent** mode, type a trigger phrase, e.g.:
```
Run a365 setup
```
The skill walks you through interactively. The a365 CLI and Azure CLI will be offered for install if missing.

---

## Option B — GitHub CLI (Copilot on the Command Line)

### 1. Install GitHub CLI and sign in
```powershell
winget install GitHub.cli
```
```bash
gh auth login           # sign in with your GitHub account
gh extension install github/gh-copilot   # install the Copilot CLI extension
gh copilot --version    # confirm it's installed
```

### 2. Navigate to the agent project
```bash
cd C:\bugbash\Sample-Agents\nodejs\langchain
```

### 3. Run a scenario
Skills are triggered via `gh copilot suggest` with a natural-language prompt:
```bash
gh copilot suggest "Run a365 setup"
gh copilot suggest "Make this agent an AI Teammate"
gh copilot suggest "Instrument observability for this agent"
```

> **Note:** GitHub Copilot CLI reads `.agents/skills/` in the current folder. Ensure `node C:\bugbash\agent365-skills\scripts\install.js` was run first.

---

## Option C — Claude Code (Plugin Mode)

### 1. Install Claude Code
```powershell
npm install -g @anthropic-ai/claude-code
claude --version    # confirm install
```

### 2. Launch Claude Code with the skills plugin
```bash
cd C:\bugbash\Sample-Agents\nodejs\langchain

claude --plugin-dir C:\bugbash\agent365-skills\plugins\agent365
```

> This registers all 6 skills as slash commands inside the Claude Code session.

### 3. Verify skills are loaded
Inside the Claude Code session, type:
```
/help
```
You should see the 6 skill commands listed:
`/agent365:make-ai-teammate` · `/agent365:a365-setup` · `/agent365:make-a365-agent` · `/agent365:add-workiq-tools` · `/agent365:instrument-observability` · `/agent365:test-local`

### 4. Run a scenario
Use either the slash command or a natural-language trigger phrase:
```
/agent365:a365-setup
```
or simply:
```
Run a365 setup
```
Stop hooks run automatically at session end and will block if required steps were skipped.

---

## Folder Structure Reference — Sample-Agents

| Framework | Path |
|-----------|------|
| Node.js LangChain | `Sample-Agents/nodejs/langchain` |
| Node.js OpenAI Agents SDK | `Sample-Agents/nodejs/openai-agents` |
| Node.js Claude SDK | `Sample-Agents/nodejs/claude` |
| .NET AgentFramework | `Sample-Agents/dotnet` |
| Python LangChain | `Sample-Agents/python/langchain` |
| Python OpenAI | `Sample-Agents/python/openai` |

> Adjust paths to match the actual folder names in [biswapm/Sample-Agents](https://github.com/biswapm/Sample-Agents).
