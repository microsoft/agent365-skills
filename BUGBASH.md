# Agent 365 Skills — Bug Bash

**Version:** 1.4.2  
**Skills:** make-ai-teammate · a365-setup · make-a365-agent · add-workiq-tools · instrument-observability · test-local

Use the sample repos from [Agent365-Samples](https://github.com/microsoft/Agent365-Samples) as starting points. Mark each scenario **✅ Pass**, **❌ Fail**, or **⚠️ Partial** and note issues.

---

## Scenario 1 — `a365-setup` entry point delegates correctly

**Skill:** `a365-setup`  
**Framework:** Node.js LangChain  
**Goal:** Verify the entry-point skill installs prerequisites, detects the stack, asks capability questions, and delegates to the right downstream skill.

### Setup
- Clone a Node.js LangChain sample agent:
  ```bash
  git clone https://github.com/microsoft/Agent365-Samples
  cd Agent365-Samples/nodejs/langchain/sample-agent
  npm install
  ```
- Do **not** pre-install a365 CLI (test the install flow)

### Steps
1. Open the project in VS Code or Claude Code
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
- Clone the Node.js OpenAI Agents SDK sample:
  ```bash
  git clone https://github.com/microsoft/Agent365-Samples
  cd Agent365-Samples/nodejs/openai/sample-agent
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
- Clone the .NET AgentFramework sample:
  ```bash
  git clone https://github.com/microsoft/Agent365-Samples
  cd Agent365-Samples/dotnet/agent-framework/sample-agent
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
- Skill prompts for `a365 setup admin --blueprint-id <id>` or PowerShell handoff to GA
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
- Clone the Python LangChain sample:
  ```bash
  git clone https://github.com/microsoft/Agent365-Samples
  cd Agent365-Samples/python/langchain/sample-agent
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
- Use the .NET sample from Scenario 2 or clone fresh:
  ```bash
  git clone https://github.com/microsoft/Agent365-Samples
  cd Agent365-Samples/dotnet/agent-framework/sample-agent
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
- GA handoff instructions shown: `a365 setup permissions mcp` or `a365 setup admin --blueprint-id <id>`
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
- Use the Node.js LangChain sample from Scenario 1 or Scenario 2:
  ```bash
  git clone https://github.com/microsoft/Agent365-Samples
  cd Agent365-Samples/nodejs/langchain/sample-agent
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

## VS Code Setup (Fresh Machine — No GitHub CLI or Claude Code)

### 1. Install prerequisites
```powershell
winget install Microsoft.VisualStudioCode
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Microsoft.DotNet.SDK.8   # only needed for .NET scenarios
# Restart terminal after installs
```

### 2. Install GitHub Copilot Chat in VS Code
1. Open VS Code → `Ctrl+Shift+X` → search **GitHub Copilot Chat** → Install
2. Sign in with a GitHub account that has a Copilot subscription
3. Open Copilot Chat with `Ctrl+Shift+I` and confirm it works

### 3. Clone both repos side by side
```bash
# Pick a working folder, e.g. C:\bugbash
mkdir C:\bugbash
cd C:\bugbash

# Clone the skills repo
git clone https://github.com/microsoft/agent365-skills

# Clone the sample agents
git clone https://github.com/microsoft/Agent365-Samples
```

### 4. Install skills into your sample agent project
```bash
# Navigate to the sample agent you want to test (e.g. Node.js LangChain)
cd C:\bugbash\Agent365-Samples\nodejs\langchain\sample-agent
npm install

# Run the installer — use the ACTUAL path to the cloned skills repo
node C:\bugbash\agent365-skills\scripts\install.js
```
This copies all 6 skills into `.agents/skills/` in the sample agent folder. VS Code discovers them automatically.

### 5. Open the sample agent in VS Code
```bash
code C:\bugbash\Agent365-Samples\nodejs\langchain\sample-agent
```

### 6. Verify skills are loaded
1. Open Copilot Chat (`Ctrl+Shift+I`)
2. Switch to **Agent** mode — click the model dropdown → select **Agent**
3. Type `/` — the 6 skills should appear: `make-ai-teammate`, `a365-setup`, `make-a365-agent`, `add-workiq-tools`, `instrument-observability`, `test-local`
4. If skills don't appear: `Ctrl+Shift+P` → **Chat: Open Chat Customizations** → Skills tab

### 7. Run a scenario
Type a trigger phrase in agent mode, e.g.:
```
Run a365 setup
```
The skill walks you through interactively. The a365 CLI and Azure CLI will be offered for install if missing.
