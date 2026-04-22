---
name: add-workiq-tools
description: >
  Adds WorkIQ MCP tool servers to an existing .NET AgentFramework or Node.js LangChain agent
  using the A365 CLI. Runs a365 develop list-available to show the catalog, adds selected servers
  via a365 develop add-mcp-servers (which writes ToolingManifest.json), wires GetMcpToolsAsync
  in the agent code, and guides the user through the permissions handoff. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: WorkIQ tool names to add (e.g. 'Work IQ Mail Work IQ Calendar'), or 'all' for full suite"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-add-workiq-tools.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was correctly detected (.NET AgentFramework or Node.js LangChain).
        2. a365 develop list-available was run and results were shown to the user.
        3. a365 develop add-mcp-servers was run for the selected WorkIQ servers.
        4. ToolingManifest.json now contains the selected WorkIQ server entries.
        5. GetMcpToolsAsync (or equivalent) is wired in the agent code.
        6. User was informed about the permissions step (a365 setup permissions mcp or a365 setup all).
        7. User was shown how to get a dev token with a365 develop get-token.
        8. Build/compile succeeds.
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 30000
---

# Add WorkIQ Tools (A365 CLI + SDK)

> **Trigger phrases** — any of these will activate this skill automatically:
> - "add workiq tools"
> - "add a365 tools"
> - "add work intelligence tools"
> - "add microsoft 365 tools"
> - "wire up workiq"
> - "add mcp tools to this agent"

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

## Phase 0A — Initial Detection and User Validation

**TaskCreate** — "Detect agent stack, programming language, and validate with user"

### Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.json` if it exists. If `detectedAt` is within the last 60 minutes, load `agentStack`, `programmingLanguage`, and `usesTeamsOrCopilot` from it and skip the detection steps below — go straight to User Validation.

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

### User Validation

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
   - **Glob** `**/package.json` + **Grep** `@langchain` or `langchain` → Node.js LangChain

3. Load reference patterns:
   - If .NET: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/dotnet-workiq.md`
   - If Node.js: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md`

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

> ⚠️ This command **only updates `ToolingManifest.json`** — it does NOT grant permissions.
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

If missing:
```bash
dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease
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
var workIQTools = await _toolService.GetMcpToolsAsync(
    agentId,
    UserAuthorization,
    handlerForMcp,
    context
).ConfigureAwait(false);
// Pass workIQTools to your AI chat client / function calling pipeline
```

Do NOT pass a `tokenOverride` parameter — the SDK resolves tokens automatically.

Mark all new lines: `// A365 WorkIQ — added by add-workiq-tools skill`

### For Node.js LangChain

#### 4A — Install tooling packages (if not present)

**Grep** `agents-a365-tooling-extensions-langchain` in `**/package.json`. If missing:
```bash
npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-langchain
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
let agentWithTools = personalizedAgent;
try {
  agentWithTools = await toolService.addToolServersToAgent(
    personalizedAgent,
    authorization,
    authHandlerName,
    turnContext,
    process.env.BEARER_TOKEN ?? '',
  );
} catch (error) {
  console.error('Error adding MCP tool servers:', error);
  // falls back to agent without tools
}
```

Mark all new lines: `// A365 WorkIQ — added by add-workiq-tools skill`

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

Tell the user: tokens expire — re-run `a365 develop get-token` to refresh.

**Mark task complete: "Set up dev token for testing"**

---

## Phase 7 — Validate Build

**Mark task in progress: "Validate build"**

### For .NET AgentFramework

```bash
dotnet build
```

### For Node.js LangChain

```bash
npm install
npm run build || npm run compile || echo "No build script — skipping compile check"
```

If build fails, present error output with suggested fixes. Do not revert changes.

**Mark task complete: "Validate build"**

---

## Phase 8 — Final Summary

1. **TaskList** — Show all completed tasks.

2. Present summary:

```
✅ WorkIQ tools added!

**Agent type:** [.NET AgentFramework | Node.js LangChain]
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
| Server name not found in catalog | Show user the `list-available` output and ask to re-select |
| `add-mcp-servers` fails | Run `a365 develop list-available` again to verify exact server name spelling |
| Tooling package install fails | Check NuGet/npm registry access; verify .NET SDK is installed |
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
- **CLI Reference:** https://learn.microsoft.com/en-us/microsoft-agent-365/developer/reference/cli/develop
