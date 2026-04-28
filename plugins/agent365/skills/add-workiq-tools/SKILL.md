---
name: add-workiq-tools
version: 1.4.2
description: >
  Adds WorkIQ MCP tool servers to an existing .NET AgentFramework, Node.js, or Python agent
  using the A365 CLI. Runs a365 develop list-available to show the catalog, adds selected servers
  via a365 develop add-mcp-servers (which writes ToolingManifest.json), wires McpToolRegistrationService
  in the agent code, and guides the user through the permissions handoff. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: WorkIQ tool names to add (e.g. 'Work IQ Mail Work IQ Calendar'), or 'all' for full suite"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-add-workiq-tools.js
      timeout: 30000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was correctly detected (.NET AgentFramework, Node.js, or Python).
        2. a365 develop list-available was run and results were shown to the user.
        3. a365 develop add-mcp-servers was run for the selected WorkIQ servers.
        4. ToolingManifest.json now contains the selected WorkIQ server entries.
        5. McpToolRegistrationService (or equivalent) is wired in the agent code.
        6. User was informed about the permissions step (a365 setup permissions mcp or a365 setup all).
        7. User was shown how to get a dev token with a365 develop get-token.
        8. Build/compile succeeds (dotnet build, npm run build, or pip install check).
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 30000
---

# Add WorkIQ Tools (A365 CLI + SDK)

> **Trigger phrases** — any of these will activate this skill automatically:
> - "add workiq tools to this agent"
> - "add work intelligence tools"
> - "give this agent access to m365 data"
> - "give my agent access to email and calendar"
> - "add sharepoint access to this agent"
> - "add work iq mail to this agent"
> - "add work iq calendar to this agent"
> - "let this agent read emails and calendar events"
> - "wire up workiq mcp tools"

---

## Overview

This skill adds WorkIQ MCP tool servers to an existing A365 agent using the A365 CLI.

**WorkIQ tools** give your agent pre-built access to M365 work data via MCP:
- **Work IQ Mail** — Read, send, and manage email
- **Work IQ Calendar** — Read/create events, check availability
- **Work IQ Teams** — Read channel messages, list teams
- **Work IQ SharePoint** — Search documents, read files, list sites
- **Work IQ OneDrive** — Manage OneDrive files
- **Work IQ Word** — Read and write Word documents
- **Work IQ User** — Get user profile and presence
- **Work IQ Copilot** — Chat with Microsoft 365 Copilot
- **Dataverse and Dynamics 365** — CRUD and domain actions

**How it works:**
1. `a365 develop list-available` — shows the catalog of available MCP servers
2. `a365 develop add-mcp-servers` — adds selected servers to `ToolingManifest.json`
3. Agent code is wired to load those tools at runtime via `GetMcpToolsAsync`
4. Permissions are applied separately by a developer or Global Administrator

All changes are **additive** and **idempotent** — rerunning is safe.

---

## Phase 0A — Load Detection Cache

**Read** `.a365-workspace-detection.json`.

If the file is missing or `detectedAt` is older than 60 minutes:
> "`a365-setup` must be run before this skill — it registers your agent with Agent 365 and writes
> the project detection cache this skill depends on. Run `a365-setup` now, then return here."

Stop until the user confirms `a365-setup` has been run.

Load from cache: `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `agentType`, `authMode` (if previously stored).

Present the loaded values in one message and wait for confirmation:

```
Here's what we detected about your agent:
  • Stack:    {agentStack}
  • Language: {programmingLanguage}

Reply **yes** to confirm, or describe any corrections.
```

---

## Phase 0B — Agent Type and Authentication Mode

**Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` — section **"Agent Type and Auth Mode Detection"** — and follow it exactly.

If `agentType` and `authMode` are already present in the detection cache (from a prior skill run in this session), confirm the values with the user and skip the questions.

Store `agentType` (`ai-teammate` or `system-agent`) and `authMode` (`user-delegated`, `agentic-identity`, or `S2S`).

**Update `.a365-workspace-detection.json`** — merge `agentType` and `authMode` into the existing cache file, preserving all other fields. Use the **Write** tool to write the merged object back.

The `authMode` value is used in Phase 4 to annotate which identity is used for M365 tool access. **If `authMode = S2S`, the WorkIQ guard in the shared section must be surfaced before proceeding to Phase 4.**

---

## Phase 0C — Create Task List

```
TaskCreate: "Detect agent type and check prerequisites"
TaskCreate: "Show available WorkIQ tools catalog"
TaskCreate: "Add WorkIQ MCP servers via CLI"
TaskCreate: "Wire GetMcpToolsAsync in agent code"
TaskCreate: "Guide permissions handoff"
TaskCreate: "Set up dev token for testing"
TaskCreate: "Validate build"
```

---

## Phase 1 — Detect Agent Type and Check Prerequisites

**Mark task in progress: "Detect agent type and check prerequisites"**

### 1.1 Detect agent type

1. **Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` for detection heuristics.

2. Run detection:
   - **Glob** `**/*.csproj` + **Grep** `AgentApplication` in `**/*.cs` → .NET AgentFramework
   - **Glob** `**/package.json` + `.ts`/`.js` files present → Node.js
   - **Glob** `**/*.py` or `requirements.txt` / `pyproject.toml` → Python

3. Load reference patterns:
   - If .NET: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/dotnet-workiq.md`
   - If Node.js: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md`
   - If Python: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/python-workiq.md`

### 1.2 Check prerequisites

Run both checks in one step:

```bash
a365 --version; a365 develop list-configured 2>/dev/null || echo "a365 CLI not found — will install"
```

If `a365` is missing:
```bash
dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease
a365 --version; a365 develop list-configured
```

Report the current state to the user — which servers are already in `ToolingManifest.json`.

### 1.3 Check for AGENTIC_APP_ID

Following `agent-detection.md` AGENTIC_APP_ID detection order:
- Check `.env` / `.env.example` for `AGENTIC_APP_ID=`
- Check `appsettings.json` for `AgenticAppId`
- Check `a365.generated.config.json` for `agentBlueprintId`

If not found, note this — user will need to run `a365 setup` at some point. Do not block.

**Mark task complete: "Detect agent type and check prerequisites"**

---

## Phase 2 — Show Available WorkIQ Tools Catalog

**Mark task in progress: "Show available WorkIQ tools catalog"**

### 2.1 List available servers

```bash
a365 develop list-available
```

Show the output to the user. The catalog includes WorkIQ servers (mail, calendar, Teams, SharePoint,
OneDrive, Word, user/presence, Copilot) and Dataverse/Dynamics 365.

### 2.2 Ask which tools to add

If the user provided specific tool names as the skill argument, use those.
Otherwise:

```
AskUserQuestion:
  question: "Which WorkIQ tool servers would you like to add? (See catalog above)"
  options:
    - Work IQ Mail
    - Work IQ Calendar
    - Work IQ Teams
    - Work IQ SharePoint
    - Work IQ OneDrive
    - Work IQ Word
    - Work IQ User
    - Work IQ Copilot
    - Dataverse and Dynamics 365
    - All of the above
    - Let me type specific names from the catalog
```

**Mark task complete: "Show available WorkIQ tools catalog"**

---

## Phase 3 — Add WorkIQ MCP Servers via CLI

**Mark task in progress: "Add WorkIQ MCP servers via CLI"**

### 3.1 Add selected servers

Run `a365 develop add-mcp-servers` with the selected server names.
Run the command **once** with all selected names space-separated:

```bash
a365 develop add-mcp-servers "Work IQ Mail" "Work IQ Calendar"
```

(Adjust to include whichever servers the user selected.)

This command creates `ToolingManifest.json` if it does not exist, or adds the selected servers to it if it does.

> ⚠️ This command **only writes `ToolingManifest.json`** — it does NOT grant permissions.
> Permissions are handled separately in Phase 5.

### 3.2 Verify the manifest was updated

```bash
a365 develop list-configured
```

Confirm each selected server now appears in the output.

If a server was already configured, that is expected — the CLI is idempotent.

**Mark task complete: "Add WorkIQ MCP servers via CLI"**

---

## Phase 4 — Wire GetMcpToolsAsync in Agent Code

**Mark task in progress: "Wire GetMcpToolsAsync in agent code"**

Follow the patterns in the reference doc for the detected agent type.

### For .NET AgentFramework

#### 4A — Install tooling package (if not present)

Check `.csproj` for `Microsoft.Agents.A365.Tooling`:

**Grep** `Microsoft.Agents.A365.Tooling` in `**/*.csproj`

If missing, install core + the adapter for the detected framework:
```bash
dotnet add package Microsoft.Agents.A365.Tooling --prerelease
dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease
# or for Semantic Kernel:
# dotnet add package Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel --prerelease
```

#### 4B — Register services in Program.cs

**Read** `Program.cs`. **Grep** for `IMcpToolRegistrationService`.

If not registered, **Edit** `Program.cs`:
```csharp
// A365 WorkIQ — added by add-workiq-tools skill
builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>();
```

#### 4C — Call GetMcpToolsAsync in the agent class

**Glob** `**/*.cs` and find the AgentApplication subclass (the message handler).
**Grep** `GetMcpToolsAsync` — if already present, skip this step.

If missing, **Edit** the agent class to add inside `OnMessageActivityAsync` (or equivalent):
```csharp
// A365 WorkIQ — added by add-workiq-tools skill
// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
var workIQTools = await _toolService.GetMcpToolsAsync(
    agentId,
    UserAuthorization,  // "AGENTIC" handler for all authMode values; identity (user-delegated, agentic-identity, or S2S) is determined by Azure AD
    handlerForMcp,
    context
).ConfigureAwait(false);
// Pass workIQTools to your AI chat client / function calling pipeline
```

Do NOT pass a `tokenOverride` parameter — the SDK resolves tokens automatically.

Mark all new lines: `// A365 WorkIQ — added by add-workiq-tools skill`

### For Node.js LangChain

#### 4A — Install tooling packages (if not present)

**Grep** `agents-a365-tooling` in `**/package.json`. If missing, install core + the adapter for the detected framework:
```bash
npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-langchain
# or for OpenAI:
# npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-openai
# or for Semantic Kernel:
# npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-semantic-kernel
```

#### 4B — Wire McpToolRegistrationService in client.ts

**Read** `src/client.ts` (or the file containing the LangChain `getClient` factory).
**Grep** `McpToolRegistrationService` — if already present, skip.

If missing, **Edit** the client file to add:

1. Module-level singleton (outside any function, at the top of the file):
```typescript
// A365 WorkIQ — added by add-workiq-tools skill
import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-langchain';
const toolService = new McpToolRegistrationService();
```

2. Inside the per-turn `getClient()` factory, after creating the base agent and before
   returning the client:
```typescript
// A365 WorkIQ — added by add-workiq-tools skill
// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
let agentWithTools = personalizedAgent;
try {
  agentWithTools = await toolService.addToolServersToAgent(
    personalizedAgent,
    authorization,
    authHandlerName,  // "AGENTIC" for all authMode values; identity (user-delegated, agentic-identity, or S2S) is determined by Azure AD
    turnContext,
    process.env.BEARER_TOKEN ?? '',
  );
} catch (error) {
  console.error('Error adding MCP tool servers:', error);
  // falls back to agent without tools
}
```

Mark all new lines: `// A365 WorkIQ — added by add-workiq-tools skill`

### For Python

#### 4A — Install tooling packages (if not present)

**Grep** `microsoft-agents-a365-tooling` in `requirements.txt` or `pyproject.toml`. If missing:
```bash
pip3 install microsoft-agents-a365-tooling 2>/dev/null || pip install microsoft-agents-a365-tooling
```

Then install the extension for the detected framework:
```bash
# AgentFramework
pip3 install microsoft-agents-a365-tooling-extensions-agent-framework 2>/dev/null || pip install microsoft-agents-a365-tooling-extensions-agent-framework
# LangChain
pip3 install microsoft-agents-a365-tooling-extensions-langchain 2>/dev/null || pip install microsoft-agents-a365-tooling-extensions-langchain
# OpenAI Agents SDK
pip3 install microsoft-agents-a365-tooling-extensions-openai 2>/dev/null || pip install microsoft-agents-a365-tooling-extensions-openai
# Semantic Kernel
pip3 install microsoft-agents-a365-tooling-extensions-semantic-kernel 2>/dev/null || pip install microsoft-agents-a365-tooling-extensions-semantic-kernel
```

Update `requirements.txt` or `pyproject.toml` to record the installed packages.

#### 4B — Wire McpToolRegistrationService in agent code

**Grep** `McpToolRegistrationService` or `get_mcp_tools_async` — if already present, skip.

Follow the pattern for the detected framework in `python-workiq.md`:

**AgentFramework** — add a module-level singleton and call `get_mcp_tools_async` inside the message handler:
```python
# A365 WorkIQ — added by add-workiq-tools skill
from microsoft_agents_a365.tooling.extensions.agent_framework import McpToolRegistrationService

_tool_service = McpToolRegistrationService()

# Inside on_message_activity (or equivalent):
# A365 WorkIQ — added by add-workiq-tools skill
# A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
work_iq_tools = await _tool_service.get_mcp_tools_async(
    agent_id,
    turn_context.activity.caller_id,  # "AGENTIC" handler for all authMode values
    "AGENTIC",
    turn_context
)
# Pass work_iq_tools to your LLM/function-calling pipeline
```

**LangChain / other frameworks** — see `python-workiq.md` for the `add_tool_servers_to_agent` pattern. Always catch exceptions and fall back gracefully.

Mark all new lines: `# A365 WorkIQ — added by add-workiq-tools skill`

**Mark task complete: "Wire GetMcpToolsAsync in agent code"**

---

## Phase 5 — Guide Permissions Handoff

**Mark task in progress: "Guide permissions handoff"**

Adding servers to `ToolingManifest.json` does **not** automatically grant permissions.
Determine which path applies:

### Path A — Blueprint does NOT exist yet (a365 setup not yet run)

Tell the user:

> Permissions will be applied automatically when you run `a365 setup all`.
> The setup process reads `ToolingManifest.json` and grants OAuth2 permissions
> for all configured MCP servers as part of blueprint creation.
>
> Run: `a365 setup all`

### Path B — Blueprint already exists (a365.generated.config.json present)

Check if `a365.generated.config.json` exists and has a non-empty `agentBlueprintId`.

If yes, tell the user:

> ⚠️ **Global Administrator action required.**
>
> Your blueprint already exists. MCP permissions must be granted separately.
>
> **Step 1 — Share the updated manifest with your Global Administrator:**
> - Share the file: `ToolingManifest.json` (just updated by the CLI)
> - Or share the whole project folder path
>
> **Step 2 — Admin runs (from the project directory where `a365.config.json` lives):**
> ```bash
> a365 setup permissions mcp  # grants OAuth2 grants for all servers in manifest
> ```
>
> **Step 3 — After admin confirms permissions are granted, continue testing.**
>
> Reference: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/reference/cli/develop

**Mark task complete: "Guide permissions handoff"**

---

## Phase 6 — Set Up Dev Token for Testing

**Mark task in progress: "Set up dev token for testing"**

### 6.1 Get a bearer token for local development

```bash
a365 develop get-token
```

This opens a browser for interactive authentication and returns a token for the MCP resource.

For per-server tokens (V2 pattern):
```bash
a365 develop get-token --resource mcp -o raw
```

### 6.2 Set the token in environment

**For .NET** — set in `Properties/launchSettings.json` (or `appsettings.Development.json`):
```json
{
  "profiles": {
    "WorkIQ Dev": {
      "commandName": "Project",
      "environmentVariables": {
        "SKIP_TOOLING_ON_ERRORS": "true",
        "BEARER_TOKEN_<SERVERNAME>": "<token-from-get-token>"
      }
    }
  }
}
```

**For Node.js** — add to `.env`:
```dotenv
BEARER_TOKEN=<token-from-get-token>
SKIP_TOOLING_ON_ERRORS=true
```

**For Python** — add to `.env`:
```dotenv
BEARER_TOKEN=<token-from-get-token>
SKIP_TOOLING_ON_ERRORS=true
ENV=development
```

Tell the user: tokens expire — re-run `a365 develop get-token` to refresh.

**Mark task complete: "Set up dev token for testing"**

---

## Phase 7 — Validate Build

**Mark task in progress: "Validate build"**

### For .NET AgentFramework

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
pip3 install -r requirements.txt 2>/dev/null || pip install -r requirements.txt || pip install .
python3 -c "from microsoft_agents_a365.tooling.extensions.agent_framework import McpToolRegistrationService; print('WorkIQ imports OK')" 2>/dev/null || python -c "from microsoft_agents_a365.tooling.extensions.agent_framework import McpToolRegistrationService; print('WorkIQ imports OK')"
```

Adjust the import path to match the installed framework extension (e.g. `.langchain`, `.openai`).

If build fails, present error output with suggested fixes. Do not revert changes.

**Mark task complete: "Validate build"**

---

## Phase 8 — Final Summary

1. **TaskList** — Show all completed tasks.

2. Ask:
```
WorkIQ tools are wired. Want to run a quick local test now?
  1. Yes — run the test-local skill
  2. No  — show me the summary and I'll test later
```
If yes, invoke the `test-local` skill.

3. Present summary:

```
✅ WorkIQ tools added!

**Agent type:** [.NET AgentFramework | Node.js | Python]
**MCP servers added:** [list of server names from a365 develop list-configured]
**ToolingManifest.json:** updated ✅
**Agent code wired:** GetMcpToolsAsync ✅

**Permissions status:**
[Path A: Will be applied by a365 setup all]
  OR
[Path B: ⚠️ Global Administrator must run a365 setup permissions mcp]

**Dev testing:**
  1. Get a token: a365 develop get-token
  2. Set BEARER_TOKEN (or per-server BEARER_TOKEN_<SERVER>) in your .env / launchSettings.json
  3. Set SKIP_TOOLING_ON_ERRORS=true for dev
  4. Start your agent and test a WorkIQ prompt (e.g. "List my Teams channels")
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| `a365` CLI not installed | Install with `dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease` |
| `a365 develop list-available` fails | Check a365 CLI authentication; run `a365 auth login` |
| Need to manage MCP servers in Dataverse | Use `a365 develop-mcp` (not `a365 develop`) — separate command for Dataverse-hosted MCP server management |
| Server name not found in catalog | Show user the `list-available` output and ask to re-select |
| `add-mcp-servers` fails | Run `a365 develop list-available` again to verify exact server name spelling |
| Tooling package install fails | Check NuGet/npm/pip registry access; verify runtime is installed |
| Build fails after wiring | Do not revert; show error and offer to debug |
| Token errors at runtime | Run `a365 develop get-token`; set env vars; enable `SKIP_TOOLING_ON_ERRORS=true` |

---

## Idempotency

On subsequent runs:
- `a365 develop list-configured` will show already-added servers — skip re-adding them
- Skip tooling package install if already in `.csproj` / `package.json`
- Skip `GetMcpToolsAsync` wiring if already present (detect by grep)
- Always revalidate the build

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **.NET Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/dotnet-workiq.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md`
- **Python Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/python-workiq.md`
- **CLI Reference:** https://learn.microsoft.com/en-us/microsoft-agent-365/developer/reference/cli/develop
