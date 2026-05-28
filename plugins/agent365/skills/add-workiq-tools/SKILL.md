---
name: add-workiq-tools
description: >
  Adds WorkIQ MCP tool servers to an existing .NET AgentFramework, Node.js, or Python agent
  using the A365 CLI. Runs a365 develop list-available to show the catalog, adds selected servers
  via a365 develop add-mcp-servers (which writes ToolingManifest.json), wires McpToolRegistrationService
  in the agent code, and guides the user through the permissions handoff. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
  - github-copilot-cli
user-invocable: true
argument-hint: "Optional: exact mcpServerName values from `a365 develop list-available` (e.g. 'mcp_MailTools mcp_CalendarTools'), or 'all' for full suite"
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
        2. a365 develop list-available was run, results were shown to the user, and the selection options were populated from the CLI output (not a hardcoded list).
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
> - "wire up workiq MCP servers"

---

## Overview

This skill adds WorkIQ MCP tool servers to an existing A365 agent using the A365 CLI.

**WorkIQ tools** give your agent pre-built access to M365 work data via MCP. The capability categories below describe what each catalog server does — but **always pull the exact CLI argument names from `a365 develop list-available`**. V2 catalog names look like `mcp_MailTools`, `mcp_CalendarTools`, etc., and they evolve over time.

- **Mail** — Read, send, and manage email
- **Calendar** — Read/create events, check availability
- **Teams** — Read channel messages, list teams
- **SharePoint** — Search documents, read files, list sites
- **OneDrive** — Manage OneDrive files
- **Word** — Read and write Word documents
- **User/Presence** — Get user profile and presence
- **Copilot** — Chat with Microsoft 365 Copilot
- **Dataverse and Dynamics 365** — CRUD and domain actions

**How it works:**
1. `a365 develop list-available` — shows the catalog of available MCP servers
2. `a365 develop add-mcp-servers` — adds selected servers to `ToolingManifest.json`
3. Agent code is wired to load those tools at runtime via `GetMcpToolsAsync`
4. Permissions are applied separately by a developer or Global Administrator

All changes are **additive** and **idempotent** — rerunning is safe.

---

## Phase 0A — Workspace Triage and Detection Cache

### Step 1 — Triage the workspace

Run in parallel:

- **Glob** `**/*.csproj`, `package.json`, `requirements.txt`, `pyproject.toml`, `src/**/*.ts`, `**/*.cs`, `**/*.py` → `hasProjectFiles`.
- **Read** `.a365-workspace-detection.local.json` → `cacheState` (`fresh` if `detectedAt` < 60 min, `stale` if older, `missing` if absent).

Decide:

| `cacheState` | `hasProjectFiles` | Action |
|--------------|-------------------|--------|
| `fresh`      | —                 | Continue to Step 2 below. |
| `missing` / `stale` | false       | **Hard stop with a useful message:** *"WorkIQ tools wire MCP servers into an existing agent — there's no agent code in this workspace yet. Run `/agent365:make-ai-teammate` (recommended — WorkIQ requires an AI Teammate or OBO agent) first to scaffold and register the agent, then come back here."* Do not proceed. |
| `missing` / `stale` | true        | Tell the user: *"Found existing agent code but no fresh Agent 365 registration. I'll run `a365-setup` now to register it and write the detection cache, then continue here automatically."* **Read** `${CLAUDE_PLUGIN_ROOT}/skills/a365-setup/SKILL.md` and follow it to completion, then continue to Step 2. |

### Step 2 — Load from cache

**🛑 STOP — `.a365-workspace-detection.local.json` MUST exist before this step.** Read the file path `.a365-workspace-detection.local.json` in the working directory. If it does not exist, you arrived at Step 2 by skipping Step 1's triage routing. Do NOT proceed. Do NOT invent default cache values. Do NOT run any further phase (no `a365 develop` command, no file edits). Instead:

1. Tell the user verbatim: *"I skipped the Step 1 triage and the detection cache wasn't written. Running `a365-setup` now to fix that, then I'll return here."*
2. **Read** `${CLAUDE_PLUGIN_ROOT}/skills/a365-setup/SKILL.md` and follow it to completion.
3. Re-verify the file now exists, then continue below.

The stop hook (`validate-add-workiq-tools.js`) will fail the session at end if the cache file is missing — this guard exists so the model halts immediately rather than wiring half-detected MCP servers.

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

If `agentType` and `authMode` are already present in the detection cache (from a prior skill run in this session OR pre-populated by a parent skill like make-ai-teammate), the confirmation behavior depends on `agentType`:
- **`agentType = "ai-teammate"`** — skip the confirmation prompt entirely. The AI Teammate identity model is unambiguous (`authMode = agentic-user`, no obo/s2s decision exists), so a confirm prompt adds friction without catching drift. Proceed silently.
- **`agentType = "system-agent"`** — confirm the cached values with the user before proceeding, since the obo/s2s choice is meaningful and a stale value would silently route to the wrong token path.

Read `authMode` case-insensitively (`S2S` = `s2s`, `OBO` = `obo`); always write back the canonical lowercase value.

Store `agentType` (`ai-teammate` or `system-agent`) and `authMode` (`obo`, `s2s`, or `agentic-user`).

**Update `.a365-workspace-detection.local.json`** — merge `agentType` and `authMode` into the existing cache file, preserving all other fields. Use the **Write** tool to write the merged object back.

**If `authMode = s2s`, stop immediately and exit:**

```
❌  WorkIQ tools are not available for S2S agents.
    WorkIQ requires a delegated user token (OBO) at runtime — S2S client credentials
    cannot be used for WorkIQ API calls.

    To use WorkIQ, switch your agent to On-Behalf-Of mode (`obo`)
    and re-run this skill.
```

Do **not** proceed to Phase 0C or any further phases. Mark all tasks cancelled and end the session.

### Framework support guard

WorkIQ extension adapters are only published by Microsoft for a subset of frameworks per language. Verified against `Agent365-{dotnet,python,nodejs}` on 2026-05-21. If the cache's `agentStack` falls on the ❌ row for the agent's `programmingLanguage`, hard-stop and end the session.

| `programmingLanguage` | `agentStack` | Status |
|----------------------|--------------|--------|
| `DotNet` | `Agent Framework`, `Semantic Kernel` | ✅ Supported (verified samples) |
| `DotNet` | `Azure AI Foundry` | ✅ Package exists; best-effort wiring (no published sample) |
| `NodeJS` | `LangChain`, `OpenAI`, `Claude` | ✅ Supported (verified samples) |
| `NodeJS` | `Semantic Kernel`, `Google ADK` | ❌ Hard-stop — no Microsoft package |
| `Python` | `Agent Framework`, `OpenAI`, `Google ADK` | ✅ Supported (verified samples) |
| `Python` | `Semantic Kernel`, `Azure AI Foundry` | ✅ Package exists; best-effort wiring (no published sample) |
| `Python` | `LangChain` | ❌ Hard-stop — no package, no sample |
| `Python` | `Claude`, `CrewAI` | ❌ Hard-stop in this skill — samples ship a local DIY scaffold (~165–600 lines), out of scope here |

When hard-stopping, show this message (substitute the values and list the supported stacks for that language):

```
❌  WorkIQ tools do not have a Microsoft-published adapter for ({programmingLanguage}, {agentStack}).

    Supported in {programmingLanguage}:
      <list the ✅ agentStacks from the matrix above for that language>

    Options:
      1. Switch the agent to a supported framework via /agent365:make-ai-teammate.
      2. (Advanced) Author your own MCP wrapper modeled on the Claude SDK sample's DIY scaffold:
         https://github.com/microsoft/Agent365-Samples/blob/main/python/claude/sample-agent/mcp_tool_registration_service.py
         — out of scope for this skill.
```

Mark all tasks cancelled and end the session. Do **not** proceed to Phase 0C.

---

## Phase 0C — Create and Display Task List

**Show this checklist to the user BEFORE running Phase 1.** Use whichever mechanism the runtime supports — the user must see the list before any CLI command or code edit happens, and items must be updated as work progresses:

- **Claude Code:** call `TaskCreate` for each item below; it's already in `allowed-tools` and renders natively as a checklist with status icons. Use `TaskUpdate` to mark in_progress / completed.
- **VS Code Copilot Chat / GitHub Copilot CLI:** `allowed-tools` is ignored — emit a markdown checklist directly in chat (`- [ ] Detect agent type…`) and edit the list to flip items to `- [x]` as each phase completes.

**Either way: exactly one task in_progress at a time; complete it before moving on.**

```
TaskCreate: "Detect agent type and check prerequisites"
TaskCreate: "Show available WorkIQ tools catalog"
TaskCreate: "Add WorkIQ MCP servers via CLI"
TaskCreate: "Wire MCP tool service in agent code"
TaskCreate: "Offer Word @mention handler (if applicable)"
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
dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli
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

> **Note:** `a365 develop list-available` does not require `a365.config.json` — it reads the environment from `A365_ENVIRONMENT` env var (defaults to `prod`). The output now includes a `Version` column showing `V1` or `V2` for each server.

Show the output to the user. The catalog includes WorkIQ servers (mail, calendar, Teams, SharePoint,
OneDrive, Word, user/presence, Copilot) and Dataverse/Dynamics 365.

### 2.2 Ask which tools to add

If the user provided specific tool names as the skill argument, use those and skip the question.

Otherwise, parse the `a365 develop list-available` output to extract the server names, then present them as numbered options. Also check `a365 develop list-configured` output (from Phase 1.2) to mark already-installed servers so the developer can see what's new vs already present.

```
AskUserQuestion:
  question: |
    Which WorkIQ tool servers would you like to add?
    (Servers already in ToolingManifest.json are marked ✅)

    <list every server name from a365 develop list-available output, numbered>
    <N+1>. All of the above
    <N+2>. Let me type specific names
  options: <dynamically built from CLI output — one entry per server name>
```

For each option: if the server name appears in the `a365 develop list-configured` output, append ` (✅ already configured)` to the label. Include it in the list anyway — user may want to re-add or upgrade version.

**Mark task complete: "Show available WorkIQ tools catalog"**

---

## Phase 3 — Add WorkIQ MCP Servers via CLI

**Mark task in progress: "Add WorkIQ MCP servers via CLI"**

### 3.1 Add selected servers

Run `a365 develop add-mcp-servers` with the selected server names.
Run the command **once** with all selected names space-separated:

```bash
# Substitute the exact mcpServerName values from your `list-available` output.
# Example shown using the current V2 catalog names — yours may differ if the catalog evolved.
a365 develop add-mcp-servers "mcp_MailTools" "mcp_CalendarTools"

# If running from a different directory, use --project-path:
a365 develop add-mcp-servers "mcp_MailTools" "mcp_CalendarTools" --project-path "<project_dir>"
```

(Adjust the server names to match whichever servers the user selected from the live catalog. The CLI does case-insensitive trim-comparison, but the names must otherwise match the catalog's `mcpServerName` exactly.)

This command creates `ToolingManifest.json` if it does not exist, or adds the selected servers to it if it does.

> ⚠️ This command **only writes `ToolingManifest.json`** — it does NOT grant permissions.
> Permissions are handled separately in Phase 5.

### 3.2 Verify the manifest was updated

```bash
a365 develop list-configured
```

Confirm each selected server now appears in the output. The `Version` column shows `V1` or `V2` based on the server's scope pattern.

If a server was already configured, that is expected — the CLI is idempotent.

**Mark task complete: "Add WorkIQ MCP servers via CLI"**

---

## Phase 4 — Wire MCP Tool Service in Agent Code

**Mark task in progress: "Wire MCP tool service in agent code"**

The wiring pattern depends on **both** `programmingLanguage` and `agentStack` from the detection cache (loaded in Phase 0A Step 2; framework support guard in Phase 0B has already hard-stopped any unsupported pair). Pick the branch from the routing table:

| `programmingLanguage` | `agentStack` | Branch |
|----------------------|--------------|--------|
| `DotNet` | `Agent Framework` | §4.1 — .NET Agent Framework |
| `DotNet` | `Semantic Kernel` | §4.2 — .NET Semantic Kernel |
| `DotNet` | `Azure AI Foundry` | §4.3 — .NET Azure AI Foundry (best-effort; no published sample) |
| `NodeJS` | `LangChain` | §4.4 — Node.js LangChain |
| `NodeJS` | `OpenAI` | §4.5 — Node.js OpenAI |
| `NodeJS` | `Claude` | §4.6 — Node.js Claude SDK |
| `Python` | `Agent Framework` | §4.7 — Python Agent Framework |
| `Python` | `OpenAI` | §4.8 — Python OpenAI |
| `Python` | `Google ADK` | §4.9 — Python Google ADK |
| `Python` | `Semantic Kernel` | §4.10 — Python Semantic Kernel (best-effort; no published sample) |
| `Python` | `Azure AI Foundry` | §4.11 — Python Azure AI Foundry (best-effort; no published sample) |

> Detailed code patterns for each branch live in the language-specific reference docs:
> - .NET: `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/dotnet-workiq.md`
> - Node.js: `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md`
> - Python: `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/python-workiq.md`

For every branch:
1. Mark new code with `// A365 WorkIQ — added by add-workiq-tools skill` (.NET / Node.js) or `# A365 WorkIQ — added by add-workiq-tools skill` (Python). For **best-effort** branches use `… best-effort wiring (verify against SDK source before production)` instead.
2. **Grep** for the framework's wiring symbol (`GetMcpToolsAsync` / `AddToolServersToAgentAsync` / `addToolServersToAgent` / `add_tool_servers_to_agent` / `McpToolRegistrationService`) before editing — skip the wiring step if already present.

### ⚠️ Preserve-observability rule (applies to ALL §4.x branches that edit the message-handler file)

`instrument-observability` writes anchors into the **same** files §4.x will touch — for .NET / Python the WorkIQ call goes into the same method body that the observability skill wraps with `BaggageBuilder` + `InvokeAgentScope` (.NET `OnMessageAsync`, Python `process_user_message`); for Node.js Claude SDK both skills edit `src/client.ts`. A naïve `Edit` with a too-broad `old_string` will silently delete the observability wrapping. **Before any `Edit` call inside §4.x, follow this checklist:**

1. **Grep the target file for the observability anchor symbols:**
   - **.NET** (`AgentApplication` subclass): `BaggageBuilder`, `InvokeAgentScope`, `InferenceScope`, `Agent365ObservabilityContext`
   - **Node.js** (`src/agent.ts` and `src/client.ts`): `BaggageBuilder`, `BaggageBuilderUtils`, `InvokeAgentScope`, `InferenceScope`, `AgenticTokenCacheInstance`, `preloadObservabilityToken`
   - **Python** (`agent.py`): `BaggageBuilder`, `populate_baggage`, `InvokeAgentScope`, `with builder.build()`, `AgenticTokenCache`

2. **If any of those symbols are present**, scope your `Edit` `old_string` **as narrowly as possible** — anchor on the **single statement immediately before/after** the new line, never a multi-statement block, never the method signature alone, never the full method body. Examples:
   - ✅ Good: anchor on the `var response = await chatClient.GetResponseAsync(...)` line and insert `GetMcpToolsAsync` immediately above it.
   - ❌ Bad: anchor on `protected override async Task OnMessageAsync(...)` plus the entire body — the replacement will obliterate the `using var baggageScope = ...` and `using var invokeScope = ...` blocks observability put there.

3. **After the `Edit` completes, re-grep the file** for the same observability anchors. If any disappeared, the edit clobbered observability — **revert the edit and re-apply with a narrower anchor**. Do not proceed to the next file.

4. If `instrument-observability` has NOT run yet in this project (no anchor symbols anywhere), wire WorkIQ normally — there is nothing to preserve. The composite `has_obs` signal in the parent skill (`make-ai-teammate` Phase 0A.3) is what tells you which case you're in; the cache reflects it.

This rule is enforced by `validate-add-workiq-tools.js` at session end: if `has_obs = true` was in the cache at session start, the validator re-checks for the observability anchors and **fails the session** if they were removed.

---

### §4.1 .NET Agent Framework

1. **Grep** `Microsoft.Agents.A365.Tooling` in `**/*.csproj`. If missing:
   ```bash
   dotnet add package Microsoft.Agents.A365.Tooling
   dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework
   ```
2. **Read** `dotnet-workiq.md` — sections "Program.cs — Service Registration" and "Agent Class — GetMcpToolsAsync (Agent Framework)".
3. **Edit** `Program.cs`: add the two-line `AddSingleton<IMcpToolRegistrationService, ...>` + `AddSingleton<IMcpToolServerConfigurationService, ...>` form (matches the verified `Agent365-Samples` AF sample). `builder.Services.AddMcpServices()` exists as a one-liner alternative but registers both as **Scoped** — the AF sample uses Singleton lifetimes to match `AgentApplication`'s singleton agent host and avoid captive-dependency issues. Skip if already present.
4. **Edit** the `AgentApplication` subclass: add the `GetMcpToolsAsync` call inside **`OnMessageAsync`** (Agent Framework's per-turn handler) — **not** `OnMessageActivityAsync` (older docs in this repo had that wrong; the verified sample uses `OnMessageAsync`).

### §4.2 .NET Semantic Kernel

> **SK API differs from AF.** SK uses `AddToolServersToAgentAsync` (mutates `Kernel`, void return), called **during agent initialization** — not per-message. Do not copy the AF pattern.

1. Install:
   ```bash
   dotnet add package Microsoft.Agents.A365.Tooling
   dotnet add package Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel
   ```
2. **Read** `dotnet-workiq.md` — section "Agent Class — AddToolServersToAgentAsync (Semantic Kernel)".
3. **Edit** the agent-initialization code: call `AddToolServersToAgentAsync(kernel, userAuthorization, authHandlerName, turnContext, bearerToken?)` after the `Kernel` is built and before the first run.

### §4.3 .NET Azure AI Foundry (BEST-EFFORT — no published sample)

Tell the user verbatim: *"Microsoft publishes the `Microsoft.Agents.A365.Tooling.Extensions.AzureAIFoundry` package but no sample exists for it. Skill installs the package and stops — wire the call manually after reading the SDK source."*

1. Install:
   ```bash
   dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AzureAIFoundry
   ```
2. Direct the user to the SDK source: https://github.com/microsoft/Agent365-dotnet/tree/main/src/Tooling/Extensions/AzureAIFoundry
3. Do **not** generate wiring code. Mark this branch complete with a best-effort note in the final summary.

### §4.4 Node.js LangChain

1. **Grep** `agents-a365-tooling` in `**/package.json`. If missing:
   ```bash
   npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-langchain
   ```
2. **Read** `nodejs-workiq.md` — section "LangChain — Wiring (VERIFIED)".
3. **Edit** `src/client.ts` (or wherever the `getClient` factory lives). Add module-level `toolService = new McpToolRegistrationService()` singleton and the per-turn call inside `getClient`. **Capture the return value** — LangChain rebuilds the agent because `createAgent`'s tools are immutable.
4. After this branch finishes, **fall through to Phase 4.5** — its two gates decide whether the Word `@mention` offer fires or no-ops. Phase 4.5 is not optional; do not jump to Phase 5 from here.

### §4.5 Node.js OpenAI

1. Install:
   ```bash
   npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-openai
   ```
2. **Read** `nodejs-workiq.md` — section "OpenAI Agents SDK — Wiring (VERIFIED)".
3. **Edit** the `getClient` factory. OpenAI extension **mutates `agent.mcpServers` in place** — do not assign the return to a new variable (that's the LangChain pattern). Sample uses variable name `agent`, not `personalizedAgent`.

### §4.6 Node.js Claude SDK

1. Install:
   ```bash
   npm install @microsoft/agents-a365-tooling @microsoft/agents-a365-tooling-extensions-claude
   ```
2. **Read** `nodejs-workiq.md` — section "Claude SDK — Wiring (VERIFIED)".
3. **Edit** the `getClient` factory. First arg to `addToolServersToAgent` is the `Options` object from `@anthropic-ai/claude-agent-sdk`, **not** an Agent. Mutates `options.allowedTools` and `options.mcpServers`; return type is `Promise<void>`.

### §4.7 Python Agent Framework

1. **Grep** `microsoft-agents-a365-tooling` in `requirements.txt` / `pyproject.toml`. If missing:
   ```bash
   pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-agentframework 2>/dev/null \
     || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-agentframework
   ```
   **Edit** `requirements.txt` or `[project.dependencies]` in `pyproject.toml` to add both package names — `pip install` alone does NOT update either file, and the validator requires their presence.

   > Package suffix is **`agentframework`** (single word, no internal dash). `…-agent-framework` is not a valid PyPI name and will fail `pip install`.
2. **Read** `python-workiq.md` — section "Python Agent Framework — Wiring (VERIFIED)".
3. **Edit** `agent.py` to add the `tool_service` singleton, `mcp_servers_initialized` flag, the `setup_mcp_servers` method, and the call from `process_user_message`. **AF kwarg is `turn_context=`**, not `context=`. **`initial_tools=[]` is required** (positional, no default).

### §4.8 Python OpenAI

1. Install:
   ```bash
   pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-openai 2>/dev/null \
     || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-openai
   ```
   Edit `requirements.txt` / `pyproject.toml` to add both package names.
2. **Read** `python-workiq.md` — section "Python OpenAI Agents SDK — Wiring (VERIFIED)".
3. **Edit** `agent.py` with the sample's 3-priority ladder (USE_AGENTIC_AUTH → bearer-token → handler-only). Kwarg is `context=` (not `turn_context=`). No `agentic_app_id`, no `initial_tools` (OpenAI extension doesn't require it).

### §4.9 Python Google ADK

1. Install:
   ```bash
   pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-googleadk 2>/dev/null \
     || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-googleadk
   ```
   Edit `requirements.txt` / `pyproject.toml`.
2. **Read** `python-workiq.md` — section "Python Google ADK — Wiring (VERIFIED, with sample-vs-PyPI divergence)".
3. **Decide between two paths** (the published ADK sample diverges from the PyPI extension's signature):
   - **Path A — PyPI extension (default, smaller scope):** import `McpToolRegistrationService` from `microsoft_agents_a365.tooling.extensions.googleadk.services.mcp_tool_registration_service` and call `add_tool_servers_to_agent(agent=..., auth=..., auth_handler_name=..., context=turn_context, auth_token=...)`. **Do NOT pass `agentic_app_id`** — the PyPI extension's signature has no such kwarg and will `TypeError`. Wrap in `asyncio.wait_for(timeout=10.0)`.
   - **Path B — DIY scaffold (matches sample exactly):** ask the user *"Do you want the sample's exact behavior (AGENTIC_APP_ID env-var override + ~165-line local file)? Or the simpler PyPI-extension path?"* — if they pick Path B, copy `mcp_tool_registration_service.py` from `Agent365-Samples/python/google-adk/sample-agent/` into the project and import locally.
4. Pre-skip the call if neither bearer token nor auth handler is available (Playground scenario).

### §4.10 Python Semantic Kernel (BEST-EFFORT — no published sample)

Tell the user verbatim: *"No Microsoft sample exists for Python Semantic Kernel. Wiring shape is inferred from the SDK signature — verify against the SDK source before production deployment."*

1. Install:
   ```bash
   pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-semantickernel 2>/dev/null \
     || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-semantickernel
   ```
   Edit `requirements.txt` / `pyproject.toml`.
2. **Read** `python-workiq.md` — section "Python Semantic Kernel — Wiring (BEST-EFFORT — no published sample)".
3. **Edit** the agent code with the best-effort call shown there. Mark every new line with `# A365 WorkIQ — best-effort wiring (verify against SDK source before production)`.

### §4.11 Python Azure AI Foundry (BEST-EFFORT — no published sample)

Tell the user verbatim: *"No Microsoft sample exists for Python Azure AI Foundry. The exact import path is not independently verified. Skill installs the package and stops — wire the call manually after reading the SDK source."*

1. Install:
   ```bash
   pip3 install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-azureaifoundry 2>/dev/null \
     || pip install microsoft-agents-a365-tooling microsoft-agents-a365-tooling-extensions-azureaifoundry
   ```
   Edit `requirements.txt` / `pyproject.toml`.
2. Direct the user to the SDK source: https://github.com/microsoft/Agent365-python/tree/main/libraries/microsoft-agents-a365-tooling-extensions-azureaifoundry
3. Do **not** generate wiring code. Mark this branch complete with a best-effort note.

**Mark task complete: "Wire MCP tool service in agent code"**

---

## Phase 4.5 — Offer Word `@mention` handler (gated)

**Mark task in progress: "Offer Word @mention handler (if applicable)"**

**Always enter this phase after Phase 4 completes — regardless of which §4.x branch ran.** The two gates below decide whether the offer fires or the phase no-ops; the decision belongs to the gates, not to the LLM's intuition. Do not skip ahead to Phase 5 without running BOTH gates — the gate tables below each specify the exact task-completion note to write when they fail.

Read `programmingLanguage` and `agentStack` from `.a365-workspace-detection.local.json` **case-insensitively** — accept `nodejs` / `NodeJS` / `Node.js` and `langchain` / `LangChain` as equivalent. If `agentStack` is the combined string `"Node.js LangChain"`, treat it as LangChain.

**Gate 1 — Framework check.** Read `programmingLanguage` and `agentStack` from `.a365-workspace-detection.local.json`:

| programmingLanguage | agentStack | Apply? |
|---|---|---|
| `NodeJS` | `LangChain` | ✅ continue to Gate 2 |
| anything else | anything else | ❌ skip phase — mark task complete with note: *"N/A — only Node.js LangChain has a verified proactive `@mention` pattern in this repo today."* |

**Gate 2 — `mcp_WordServer` presence.** The user only sees the offer if WordServer was actually added. Read `ToolingManifest.json` (or whichever path Phase 3 wrote) and check:

```bash
grep -i '"mcpServerName":\s*"mcp_WordServer"' ToolingManifest.json
```

- Match found → continue to the offer below.
- No match → skip phase — mark task complete with note: *"N/A — `mcp_WordServer` was not in the selected servers."*

**Both gates passed — ask via `AskUserQuestion`:**

> *"You added `mcp_WordServer`. Do you want this AI Teammate to also notify and reply when someone `@mentions` it on a Word comment? It will read the document, post a reply on the same comment thread (not a new top-level comment), and DM the user in Teams with the reply text. The pattern is best-effort — no Microsoft Node.js sample is published yet, but the underlying SDK APIs are verified."*
>
> Options: **Yes — wire @mention handling** / **No — Word read/write only**

**On Yes:**

> ⚠️ **Preserve existing observability wiring.** If `instrument-observability` already ran, the message handler (`handleAgentMessageActivity`) is wrapped in an outer `baggageScope.run(...)` (the canonical pattern from Phase 5.5 of that skill). The new `case NotificationType.WpxComment` branch lives inside `handleAgentNotificationActivity` — a structurally separate handler — so it does NOT need to share the baggage scope. **Do NOT modify or remove the existing `baggageScope.run` wrapping in `handleAgentMessageActivity`** while adding the @mention code; removing it would silently break observability for regular messages.

1. **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md` — section "Optional: Word @mention notification handling (LangChain — BEST-EFFORT)".
2. **Edit** `src/agent.ts`:
   - Pre-check the `AgentApplication` `super(...)` call for `proactive: {}`. **Add it if missing** — required for proactive Teams DMs.
   - Add the per-user conversation index (`userKeyToConversationId: Map<string, string>` + `userKeysFor` helper).
   - Add the `trackConversationForProactive` private method. Call it from BOTH the message handler AND the `installationUpdate(add)` handler.
   - Add the `case NotificationType.WpxComment` branch + `handleWpxCommentNotification` method.
3. **Edit** `src/client.ts` (optional but recommended): wire LangGraph `MemorySaver` checkpointer keyed on `conversation.id` so multi-turn @mention threads keep tool-call history.
4. Mark all generated lines with: `// A365 WorkIQ — best-effort wiring (verify against SDK source before production)`
5. Tell the user the gotchas verbatim:
   - "The document URL is on `activity.attachments[*].contentUrl`, NOT on `wpxCommentNotification`."
   - "Proactive DM requires the user to have spoken to the bot at least once (or had it installed). If `userKeyToConversationId.get(...)` returns undefined on first @mention, the agent surfaces a *'DM me once to enable Word notifications'* message instead of failing silently."
   - "Tell the LLM explicitly to use the **reply** tool — without that instruction, models default to `AddComment` which creates a new top-level thread."

**On No:**

1. Tell the user verbatim: *"Skipped. Word tools still work for direct user prompts; only the proactive @mention path is omitted. You can re-enable later by re-running `/agent365:add-workiq-tools` — the skill is idempotent."*
2. **Record the decision in the cache** so the stop-hook validator honours it instead of failing the session at end:
   - **Read** `.a365-workspace-detection.local.json`, merge `{ "wordMentionDeclined": true }` into it, **Write** it back.
   - Without this marker, `validate-add-workiq-tools.js` will treat the missing `WpxComment` / `proactive` / `userKeyToConversationId` symbols as evidence of a silent skip (Phase 4.5 silently bypassed) and hard-fail the session. The marker is the machine-readable signal that "user declined" is the legitimate completion state.

**Mark task complete: "Offer Word @mention handler (if applicable)"**

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
> a365 setup permissions mcp  # grants OAuth2 grants for all servers in manifest (handles V1 + V2 mixed manifests)
> ```
>
> **MCP V1/V2 migration:** If migrating from V1 to V2 servers and the admin wants to remove legacy shared-audience scopes:
> ```bash
> a365 setup permissions mcp --remove-legacy-scopes --dry-run  # preview what would be removed
> a365 setup permissions mcp --remove-legacy-scopes            # apply
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

## MCP CLI Commands Reference

All commands the skill uses — show this table to the user on request.

| Command | What it does | Who |
|---------|-------------|-----|
| `a365 develop list-available` | Full WorkIQ server catalog with V1/V2 labels | Developer |
| `a365 develop add-mcp-servers "mcp_MailTools" "mcp_CalendarTools"` | Writes selected servers to `ToolingManifest.json` — no permissions yet. Names must match exact `mcpServerName` from `list-available`. | Developer |
| `a365 develop list-configured` | Shows servers currently in `ToolingManifest.json` | Developer |
| `a365 develop get-token` | Browser auth → bearer token for local testing | Developer |
| `a365 develop get-token --resource mcp -o raw` | Raw token string (pipe to clipboard or `.env`) | Developer |
| `a365 setup permissions mcp` | Grants OAuth2 delegated scopes for all servers in manifest | **Global Admin** |
| `a365 setup permissions mcp --remove-legacy-scopes --dry-run` | Preview removal of V1 shared-audience scopes (V1→V2 migration) | **Global Admin** |
| `a365 setup permissions mcp --remove-legacy-scopes` | Apply V1 scope removal | **Global Admin** |
| `a365 develop add-permissions` | Grant permissions for a custom client app (not blueprint) | Developer (`Application.ReadWrite.All`) |
| `a365 setup all` | Provision blueprint AND grant MCP permissions in one step | Developer |
| `a365 develop-mcp` | Manage Dataverse-hosted MCP servers (separate command) | Developer |

---

## MCP Permissions by Server

All WorkIQ servers require **delegated (OBO) permissions** — this is why `authMode = s2s` blocks WorkIQ entirely. The agent code wires the unified scope `Tools.ListInvoke.All`; the Graph scopes below are granted at the Entra app level by `a365 setup permissions mcp`.

The OAuth2 scopes that `a365 setup permissions mcp` grants are fetched from the live catalog — see `a365 develop list-available` to inspect what each server requires. We don't reproduce the scope mapping here because the catalog can evolve; the CLI's grant step uses live data, not this doc.

> **agentic-user path:** The Agentic User identity (AI Teammate) satisfies the "signed-in user" requirement — `a365 setup all --aiteammate` provisions the Agentic User and grants all delegated scopes to it. WorkIQ calls are made on behalf of the Agentic User, not the human caller.

---

## Permissions Workflow

```
Developer                                  Global Administrator
─────────────────────────────────          ──────────────────────────────────────
1. a365 develop list-available
   (browse catalog)

2. a365 develop add-mcp-servers
   "mcp_MailTools" "mcp_CalendarTools"   (exact names from list-available)
   → writes ToolingManifest.json
   → NO permissions granted yet

3a. No blueprint yet:
    a365 setup all
    → provisions blueprint
    → grants MCP permissions ✅

3b. Blueprint already exists:
    Share ToolingManifest.json ───────→   a365 setup permissions mcp
    with admin                             (grants OAuth2 delegated scopes)
                                           → permissions granted ✅

4. a365 develop get-token
   set BEARER_TOKEN in .env
   set SKIP_TOOLING_ON_ERRORS=true
   → test locally ✅
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| `a365` CLI not installed | Install with `dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli` |
| `a365 develop list-available` fails | Check a365 CLI authentication; run `a365 auth login` |
| Need to manage MCP servers in Dataverse | Use `a365 develop-mcp` (not `a365 develop`) — separate command for Dataverse-hosted MCP server management |
| Server name not found in catalog | Show user the `list-available` output and ask to re-select |
| `add-mcp-servers` fails | Run `a365 develop list-available` again to verify exact server name spelling |
| Tooling package install fails | Check NuGet/npm/pip registry access; verify runtime is installed |
| Build fails after wiring | Do not revert; show error and offer to debug |
| 403 from WorkIQ at runtime | GA has not run `a365 setup permissions mcp` — share `ToolingManifest.json` with admin |
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
