---
name: a365-setup
description: >
  Entry point for general Agent 365 (A365) registration and CLI setup — use this skill whenever
  the user wants to "set up A365", "register agent", "create blueprint", or general A365 onboarding
  for non-AI-Teammate agents (Register, Observability paths). Verifies and installs the CLI,
  validates Azure prerequisites, then delegates to make-a365-agent or make-ai-teammate at Step 3.
  Does NOT run a365 setup all inline — setup is run by the delegated skill. Supports .NET AgentFramework,
  Node.js LangChain, and Python agents.
compatibility:
  - claude-code
  - vscode-copilot
  - github-copilot-cli
user-invocable: true
argument-hint: "Optional: agent project path"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-a365-setup.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. All required system prerequisites were checked: .NET SDK 8+, a365 CLI, PowerShell 7+, Azure CLI, Az PowerShell module, Git, and language-specific tools (Node.js/npm or Python/uv as applicable).
        2. a365 CLI is installed and confirmed with a365 -h.
        3. Azure CLI login was validated using az login --allow-no-subscriptions; az account show confirmed correct account and tenant.
        4. Capabilities were selected first; authMode (obo/s2s) was then collected only for non-AI Teammate agents and written to .a365-workspace-detection.local.json (authMode="agentic-user" for AI Teammate — agent's own M365 identity, not the caller's token).
        5. Delegation to make-ai-teammate (AI Teammate path) or make-a365-agent (all other paths) was initiated.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If no setup ran this session, or all items are complete, return {"ok": true}.
      timeout: 30000
---

# Agent 365 CLI Setup

> **Trigger phrases** — any of these will activate this skill automatically:
> - "set up agent 365 for this agent"
> - "run a365 setup"
> - "onboard this agent to agent 365"
> - "register this agent with agent 365"
> - "provision this agent with agent 365"
> - "add agent 365 to this agent"
> - "connect this agent to agent 365"
> - "make this agent an a365 agent"
> - "make this agent discoverable in Agent 365"
> - "create a365 blueprint"
> - "start agent 365 setup"

---

> **YOUR VERY FIRST ACTION:** Output the intro message below to the user, then silently detect the agent stack. Do NOT create todos, run setup commands, or read further until all Phase 1 questions are answered.

**MANDATORY INTRO MESSAGE — output this before doing anything else:**

```
I'll help you set up Agent 365 for this agent. Here's what I'll do:

  1. Detect your agent type, stack, and language (silently, takes a few seconds)
  2. Ask you to confirm what I found — or correct anything I got wrong
  3. Ask how your agent authenticates (OBO / S2S)
  4. Ask which capabilities you want (Register, Observability, WorkIQ, AI Teammate)

After those answers, I'll install any missing prerequisites, validate your Azure
environment, and hand off to the right skill for the rest of setup.

Detecting your agent now…
```

**RULE 1 — DETECT AGENT STACK AND CODE, ASK VALIDATION QUESTIONS, THEN CREATE ALL TODOS.**

### Phase 1A: Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.local.json` if it exists. If `detectedAt` is within the last 60 minutes, load `agentStack`, `programmingLanguage`, and `usesTeamsOrCopilot` from it and skip the detection steps below — go straight to Phase 1B.

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

**Step 3: Detect Agent Type** → Store as `usesTeamsOrCopilot`

Check the following signals **in parallel** (Glob + Grep).

*Strong standalone signals — any one → CEA:*
- Grep `"copilotAgents"` AND `"customEngineAgents"` in `manifest.json` / `appPackage/manifest.json` / `manifest/manifest.json` (definitive — Teams v1.22+ AI Teammate marker; see `shared/agent-detection.md` for the example block)
- `teamsapp.yml` or `teamsapp.local.yml` exists (Teams Toolkit project)
- `@microsoft/teams-ai` in package.json (Teams AI SDK — Node.js specific)
- `Microsoft.Teams.AI` in .csproj (.NET Teams AI SDK)
- `teams-ai` in requirements.txt or pyproject.toml (Python Teams AI SDK)

*Paired signals — CEA only if also matched by a structural file signal above:*
- `"botbuilder"` in package.json + structural marker → CEA (generic Bot Framework; standalone = channel bot risk)
- `Microsoft.Bot.Builder` in .csproj + structural marker → CEA
- `botbuilder-core` in requirements.txt or pyproject.toml + structural marker → CEA
- `BOT_ID`, `MicrosoftAppId`, or `TEAMS_APP_ID` in .env/appsettings.json + structural marker → CEA

If no strong standalone signal and no valid pairing → `0` (Agent (Non AI Teammate), no M365 integration detected — may be a non-M365 CEA or other Agent (Non AI Teammate) type)

**Step 4: Detect Existing Blueprint** → Store as `hasBlueprintConfig`

Check **in parallel**:
- `a365.config.json` exists in the project root
- `a365.generated.config.json` exists in the project root

If either file exists → `hasBlueprintConfig = 1`. Read the blueprint ID using the correct field name for each file:
- `a365.config.json` → read `blueprintId`
- `a365.generated.config.json` → read `agentBlueprintId`

Store whichever is present as `existingBlueprintId` (may be empty if not yet set).
Otherwise → `hasBlueprintConfig = 0`

**Step 5: Detect skill-state signals** → store as `has_aiteammate_structure`, `has_obs`, `has_workiq`

Run all checks **in parallel** (Glob + Grep). These three primary flags are written to the detection cache. `hasAITeammateChanges` is no longer stored — it is **derived inline** as `has_aiteammate_structure && has_obs` wherever the legacy concept is needed.

*AI Teammate structure signals (from `make-ai-teammate`) — `has_aiteammate_structure = 1` if any one matches:*
- `AgentApplication` in `src/**/*.ts`, `**/*.cs`, or `**/*.py`
- `CloudAdapter` in `src/**/*.ts` or `CloudAdapterAiohttp` in `**/*.py`
- `@microsoft/agents-a365-notifications` in `package.json`
- `Microsoft.Agents.A365.Notifications` in `**/*.csproj`
- `ToolingManifest.json` exists

*Observability signals (from `instrument-observability`) — `has_obs = 1` ONLY when the new **Microsoft.OpenTelemetry distro API call** is present in source. Package presence alone is NOT enough — legacy `Microsoft.Agents.A365.Observability.*` / `@microsoft/agents-a365-observability` / `microsoft-agents-a365-observability-*` packages might exist without the distro being wired (or the package was added but never called). The source-call check ensures `instrument-observability` re-runs and upgrades partial / legacy wiring onto the current distro. `has_obs = 1` if any one matches:*

- `UseMicrosoftOpenTelemetry` in any `**/*.cs` (.NET)
- `useMicrosoftOpenTelemetry` in any `src/**/*.ts` (Node.js)
- `use_microsoft_opentelemetry` in any `**/*.py` (Python)

Do NOT count: package-name-only matches (the legacy or new distro package could be installed without the API being called); `A365 Observability` source comments (they outlive the code they reference). If only those weak signals match, treat `has_obs = 0` and let `instrument-observability` run to bring the agent onto the current distro.

*WorkIQ signal — `has_workiq = 1` if:*
- `ToolingManifest.json` exists AND its top-level `mcpServers` (or `servers` in legacy v1 schema) array is non-empty. Parse the JSON; at least one entry → `has_workiq = 1`.

These three flags drive the 8-row state matrix used by `make-ai-teammate` Phase 0C and by the `a365-setup` capabilities menu / auth-mode question below.

**Derived (computed inline, not stored):**

```
hasAITeammateChanges = has_aiteammate_structure && has_obs
```

This is the legacy flag that controlled "auto-detect already-an-AI-Teammate" routing. Compute it on demand wherever needed.

### Phase 1B: User Validation Questions

Present **all detections in a single message** and wait for ONE response:

```
Here's what we detected about your agent:
  • Stack:             {agentStack}
  • Language:          {programmingLanguage}
  • Agent type:        {usesTeamsOrCopilot == 1
                         ? "M365 Custom Engine Agent (CEA) — has Teams/Copilot integration"
                         : "Agent (Non AI Teammate) — no Teams/Copilot markers detected"}
  • AI Teammate setup: {(has_aiteammate_structure && has_obs)
                         ? "already configured (make-ai-teammate + observability detected)"
                         : "not yet configured"}
  • Observability:     {has_obs ? "already wired" : "not yet wired"}
  • WorkIQ tools:      {has_workiq ? "already wired" : "not yet wired"}
  • Blueprint:         {hasBlueprintConfig == 1
                         ? "existing config found" + (existingBlueprintId ? " (ID: " + existingBlueprintId + ")" : "")
                         : "none found — will create new"}

Reply **yes** to confirm, or describe any corrections.
Examples: "language is NodeJS", "it's a Custom Engine Agent", "it's not Teams".
```

- If the user replies **yes / y**: accept all values and proceed to the blueprint question (if applicable), then the capabilities question.
- If the user says it's a CEA / Custom Engine Agent: set `usesTeamsOrCopilot = 1` and proceed.
- If the user says it's Non-M365 / no Teams integration: set `usesTeamsOrCopilot = 0` and proceed.
- If the user describes other corrections: update the relevant variable(s) and proceed.

**Blueprint question (ask only when `hasBlueprintConfig = 1`):**

```
I found an existing Agent 365 config in this project. What would you like to do?

  1. Reuse the existing blueprint — provide your blueprint ID and I'll skip setup all
  2. Create a fresh blueprint — runs a365 setup all and overwrites the existing config
```

Wait for the answer:
- If **1 (reuse)**: ask "What is your blueprint ID?" if `existingBlueprintId` is empty. Store as `existingBlueprintId`. Set `reuseBlueprint = true`. Downstream skills will skip `a365 setup all` and use this ID directly.
  > **Compatibility check:** Blueprints created before May 2025 may lack the required `managerApplications` field — the platform now rejects them. If any downstream call (`a365 query-entra`, `a365 publish`, instance provisioning) reports a `managerApplications` error, fall back to fresh provisioning by re-running `a365 setup all` (or patch the blueprint via the Graph API).
- If **2 (fresh)**: set `reuseBlueprint = false`. Proceed normally — `a365 setup all` will run as usual.

---

**Capabilities question — ask first, before auth mode:**

If `usesTeamsOrCopilot = 1` (CEA), **do not ask** — automatically set `capabilities = [Register, Observability, WorkIQ, AI Teammate]` and tell the user:

> "Custom Engine Agents can only be configured as AI Teammates. **Register**, **Observability**, **WorkIQ**, and **AI Teammate** have been selected automatically."

Otherwise, compute `hasAITeammateChanges = has_aiteammate_structure && has_obs` and filter the menu:

- **If `hasAITeammateChanges = true`** (already an AI Teammate): only present these options (Observability and AI Teammate are already configured):

  1. Register — make the agent findable in the Agent 365 catalog
  2. WorkIQ — add WorkIQ MCP servers (M365 data: email, calendar, Teams, SharePoint, OneDrive) — **hide this row if `has_workiq = true`**

- **Otherwise**, present all options:

  1. Register — make the agent findable in the Agent 365 catalog
  2. Observability — end-to-end activity tracing for every message, LLM call, and tool use, visible in the Agent 365 portal and Microsoft Defender — **hide this row if `has_obs = true`**
  3. WorkIQ — add WorkIQ MCP servers (M365 data: email, calendar, Teams, SharePoint, OneDrive) — **hide this row if `has_workiq = true`**
  4. AI Teammate — agent gets a first-class M365 identity (Agentic User with UPN). AI Teammates interact with productivity workflows using their own identity

Wait for the answer. Store as `capabilities`.

**Auth mode question — ask only if AI Teammate is NOT in capabilities AND `hasAITeammateChanges` (derived) is false:**

- If `hasAITeammateChanges = true` (derived = `has_aiteammate_structure && has_obs`): set `authMode = "agentic-user"` — the agent is already an AI Teammate (existing structure detected); skip the auth mode question.

- If `capabilities` includes **AI Teammate**: set `authMode = "agentic-user"` — AI Teammate uses the Agentic User identity (the agent's own M365 identity, not the caller's token). `--authmode` is not used with `--aiteammate`.

- Otherwise (no AI Teammate in capabilities AND `hasAITeammateChanges` derived = false), ask:

```
How will your agent authenticate when calling downstream APIs?

  1. On-behalf-of (OBO) — agent acts as the signed-in user (delegated permissions)
     e.g. reading a user's calendar, sending mail on their behalf

  2. Service-to-service (S2S) — agent acts as its own identity (application permissions)
     e.g. unattended background processing, tenant-wide access without a signed-in user
```

  Wait for the answer:
  - If 1 → `authMode = "obo"`
  - If 2 → `authMode = "s2s"`. If `capabilities` includes WorkIQ, warn the user and remove it:
    > "⚠️ WorkIQ requires a delegated user token (OBO) and is not available for S2S agents. WorkIQ has been removed from your selected capabilities."

> **Note:** Options can be combined — e.g. a user can say "1 and 2" for Register + Observability.

> **AI Teammate auto-select:** If the user selects option 4 (AI Teammate), automatically include options 1 (Register) and 2 (Observability) — set `capabilities = [Register, Observability, AI Teammate]` and inform the user: "AI Teammate includes Register and Observability automatically. WorkIQ tools are optional and will be offered during make-ai-teammate."

### Phase 1C: Determine Path and Create Todos

After the capabilities question is answered (and the detection/confirmation above is complete):

1. Set `isAITeammate = true` if **AI Teammate** is in `capabilities` (whether auto-set or user-selected) **OR** `(has_aiteammate_structure && has_obs)` (existing AI Teammate structure detected — already configured). Else `isAITeammate = false`.

2. **Write `.a365-workspace-detection.local.json`** now (see `agent-detection.md` cache format). Include `agentType` derived from `isAITeammate` and `authMode` collected above:
   - `isAITeammate = true` → `agentType: "ai-teammate"`
   - `isAITeammate = false` → `agentType: "system-agent"`
   - Write `authMode` as collected (`"obo"` or `"s2s"` for non-AI Teammate; `"agentic-user"` for AI Teammate).
   - Write the three primary state flags from Phase 1A Step 5: `has_aiteammate_structure` (`1`/`0`), `has_obs` (`1`/`0`), `has_workiq` (`1`/`0`). **Do NOT write `hasAITeammateChanges`** — it is derived inline (`has_aiteammate_structure && has_obs`) at read sites.
   - Write `hasBlueprintConfig`, `existingBlueprintId`, and `reuseBlueprint` as determined above. **These are point-in-time snapshots from this skill's run** — downstream skills (make-ai-teammate, instrument-observability) re-derive `disk_blueprint_present` from `a365.generated.config.json` at read-time, and require session-level verification (Step 9.7.1a in make-ai-teammate's three-way prompt) before treating the blueprint claim as authoritative. The cached values exist for debugging and this skill's own end-of-run summary — they will go stale if the user runs `a365 setup all` or `a365 cleanup` between skill invocations.

3. Derive `registrationType` from Phase 1A signals (do not ask the user):
   - `registrationType = 1` if `usesTeamsOrCopilot = 1` (CEA — Entra app ID path)
   - `registrationType = 3` if `usesTeamsOrCopilot = 0` (Agent (Non AI Teammate) / no M365 integration path)
   - (`registrationType = 2` — Blueprint already exists — is set by make-ai-teammate, not here)

Then create all todos for the path and mark Todo 1 in-progress:

**AI Teammate path** — `isAITeammate = true` (3 todos total):
- Todo 1: `Step 1: Install and Verify All Prerequisites`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Run the make-ai-teammate skill`

**Agent (Non AI Teammate) path** — `registrationType = 3, isAITeammate = false` (3 todos total):
- Todo 1: `Step 1: Install and Verify All Prerequisites`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Run the make-a365-agent skill`

**Entra app ID path** — `registrationType = 1, isAITeammate = false` (3 todos total):
- Todo 1: `Step 1: Install and Verify All Prerequisites`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Run the make-a365-agent skill`

**RULE 2 — ALWAYS BEGIN FROM STEP 1.** Run the quick scan version checks in every session. After the quick scan, **only process sections for tools marked ❌ (missing or outdated)** — skip every section whose tool shows ✅ and meets the minimum version. Do NOT re-prompt or reinstall tools that are already present. Step 3 is always the final step — it delegates to the appropriate skill based on `isAITeammate`.

**RULE 3 — SUB-SECTIONS ARE NOT SEPARATE TODOS.** Each `## Step` has internal sub-sections — these are tasks WITHIN that step, NOT separate todos.

**RULE 4 — ONE STEP AT A TIME.** Complete each step fully. Mark its todo in-progress when starting, complete when done. The detection confirmation and final capabilities question were already answered before Step 1.

**RULE 5 — SILENT EXECUTION.** After the mandatory intro message, work silently. Do NOT narrate what you are about to do, announce step transitions ("Proceeding to Step 2", "CLI installed, moving on"), print todo state, emoji checklists, or step completion summaries. Only speak to the user when you need input, have an error to report, or need confirmation before a destructive action. Exception: the mandatory intro message at the top of this skill is always shown — it is orientation, not narration.

**RULE 6 — CLI ERROR SURFACING.** When any `a365`, `az`, `dotnet`, or `npm` command exits with a non-zero exit code or prints a warning/error line, **always show the complete output verbatim** to the user before attempting any fix. Do NOT abstract, paraphrase, or silently discard CLI output. If the CLI prints a multi-line error or warning block, display it in a fenced code block exactly as printed. Only after showing the raw output should you cross-reference the error table and suggest a resolution. If the error is not in the table, show it and ask the user how to proceed.

**RULE 7 — SKILL DELEGATION.** After Steps 1 and 2, all paths delegate to a specialized skill at Step 3 — do not run setup or publish inline here:
- **AI Teammate path** (`isAITeammate = true`): delegate to `make-ai-teammate` (code generation, a365.config.json, setup all, publish, guided manual Teams Dev Portal config, instance request).
- **Agent (Non AI Teammate) paths** (`isAITeammate = false`): delegate to `make-a365-agent` (setup all + optional observability/WorkIQ).

---

## Context

You are an AI coding agent with access to execute shell commands, read the Agent365-devTools repository (code and docs), and browse the web for documentation or GitHub issues. Your task is to set up, configure, and deploy all prerequisite components for a Microsoft Agent 365–compliant agent using the Agent 365 CLI. You must handle this end-to-end: from installation and configuration to deployment. Work step-by-step, and adapt to any issues or differences in CLI versions along the way.

> **CRITICAL BLOCKING PREREQUISITE:** Before running ANY `a365` CLI commands (including `setup`, `publish`, or `query-entra`), you MUST validate that the custom client app registration exists in Entra ID with all required permissions and admin consent. This is validated in Step 2. Failure to validate this will cause all CLI commands to fail. Do NOT skip this validation step.

---

## Step 1: Install and Verify All Prerequisites

> **Show the user a visible task checklist BEFORE Step 1 work begins.** This skill has no explicit `TaskCreate` calls in the body — derive the checklist from the Step headers (`## Step 1: Install and Verify All Prerequisites`, `## Step 2: ...`, etc.) so the user can track progress. Exactly one item in_progress at a time; complete before moving on.
> - **Claude Code:** call `TaskCreate` once per Step header (already in `allowed-tools`); the list renders natively. Use `TaskUpdate` to flip statuses.
> - **VS Code Copilot Chat / GitHub Copilot CLI:** `allowed-tools` is ignored — emit a markdown checklist directly in chat (`- [ ] Install and verify prerequisites…`, etc.) and edit items to `- [x]` as each step completes.

> **DO NOT SKIP THIS STEP.** Run all checks even on a machine that seems configured — a fresh laptop may be missing several tools. Mark this todo in-progress now.

### Quick scan — run all version checks in one pass

```bash
echo "--- .NET SDK ---"    && dotnet --version       2>/dev/null || echo "NOT FOUND"
echo "--- a365 CLI ---"    && a365 --version          2>/dev/null || echo "NOT FOUND"
echo "--- PowerShell ---"  && pwsh --version          2>/dev/null || echo "NOT FOUND"
echo "--- Azure CLI ---"   && az version              2>/dev/null | head -2 || echo "NOT FOUND"
echo "--- Git ---"         && git --version           2>/dev/null || echo "NOT FOUND"
echo "--- GitHub CLI ---"  && gh --version            2>/dev/null | head -1 || echo "NOT FOUND"
echo "--- Node.js ---"     && node --version          2>/dev/null || echo "NOT FOUND"
echo "--- npm ---"         && npm --version           2>/dev/null || echo "NOT FOUND"
echo "--- Python ---"      && python --version        2>/dev/null || echo "NOT FOUND"
echo "--- uv ---"          && uv --version            2>/dev/null || echo "NOT FOUND"
```

Also check the Az PowerShell module (requires pwsh to be installed):

```powershell
pwsh -Command "Get-Module -ListAvailable Az.Accounts | Select-Object -First 1 -ExpandProperty Version"
```

Present the results to the user as a summary table showing ✅ (found / version OK) or ❌ (missing or outdated) for each tool.

**Only process sections below for tools marked ❌.** If a tool shows ✅ and meets the minimum version, skip that entire section — do NOT re-prompt, re-install, or re-verify it. Prompt the user before each install — do not install silently.

---

### 1.1 — .NET SDK 8+

**Required by:** a365 CLI install, all .NET agent builds.

> **Skip this section if the quick scan showed ✅ for .NET SDK at 8.0 or above.**

```bash
dotnet --version
dotnet --list-sdks
```

If missing or below 8.0:

> "**.NET SDK 8.0 or later** is required. Install it now?"
>
> - **Windows:** `winget install Microsoft.DotNet.SDK.8`
> - **macOS:** `brew install --cask dotnet-sdk` or download from https://dotnet.microsoft.com/download
> - **Linux:** follow https://learn.microsoft.com/en-us/dotnet/core/install/linux

After install, open a new terminal and run `dotnet --version` to confirm. Report back when ready.

---

### 1.2 — Agent 365 CLI

**Required by:** all `a365` commands.

> **Always run this section** — check current version and update to latest regardless of whether a365 is already installed. This is an explicit exception to the Step 1 "skip ✅ tools" rule.

```bash
a365 --version 2>/dev/null || echo "NOT FOUND"
dotnet tool list -g 2>/dev/null
```
(Look for `microsoft.agents.a365.devtools.cli` in the `dotnet tool list` output.)

**If NOT FOUND — install:**

```bash
dotnet tool install --global Microsoft.Agents.A365.DevTools.Cli
```

**If already installed — always update to latest:**

```bash
dotnet tool update --global Microsoft.Agents.A365.DevTools.Cli
```

Run `a365 --version` after install or update and show the version to the user so they can confirm they are on the latest release.

If `a365` is still not found after install, the dotnet tools directory is not on PATH:

- **Windows:** add `%USERPROFILE%\.dotnet\tools` to the system PATH, then restart the terminal.
- **macOS/Linux:** add `$HOME/.dotnet/tools` to `$PATH` in `.bashrc` / `.zshrc`, then `source` it.

Verify:

```bash
a365 -h
```

This must show usage information, not an error.

---

### 1.3 — PowerShell 7+ (pwsh)

**Required by:** `a365 setup requirements`, Az module, admin consent scripts.

> **Skip this section if the quick scan showed ✅ for PowerShell (pwsh) at 7.0 or above.**

```bash
pwsh --version 2>/dev/null || echo "NOT FOUND"
```

If missing:

> "**PowerShell 7+** is required for `a365 setup requirements` and the Az module. Install it now?"
>
> - **Windows:** `winget install Microsoft.PowerShell`  (or download MSI from https://aka.ms/PSWindows)
> - **macOS:** `brew install --cask powershell`
> - **Linux:** follow https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux

After install, verify with `pwsh --version`.

---

### 1.4 — Azure CLI

**Required by:** `az login`, Entra ID queries, subscription management.

> **Skip this section if the quick scan showed ✅ for Azure CLI.**

```bash
az version 2>/dev/null | head -2 || echo "NOT FOUND"
```

If missing:

> "**Azure CLI** is required. Install it now?"
>
> - **Windows:** `winget install Microsoft.AzureCLI`  (or download from https://aka.ms/installazurecliwindows)
> - **macOS:** `brew update && brew install azure-cli`
> - **Linux:** `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash`

After install, verify with `az --version`.

---

### 1.5 — Az PowerShell Module

**Required by:** `a365 setup requirements --category PowerShell`, admin consent scripts that use `Connect-AzAccount`.

> **Skip this section if the quick scan showed ✅ for Az PowerShell module at 2.x or above.**

```powershell
pwsh -Command "Get-Module -ListAvailable Az.Accounts | Select-Object -First 1 -ExpandProperty Version"
```

If missing or below version 2.x:

> "**Az PowerShell module** is required. Install it now? (This may take a few minutes.)"

```powershell
pwsh -Command "Install-Module -Name Az -AllowClobber -Scope CurrentUser -Force -Repository PSGallery"
```

If the PSGallery is untrusted, run first:

```powershell
pwsh -Command "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted"
```

Verify:

```powershell
pwsh -Command "Get-Module -ListAvailable Az.Accounts | Select-Object -First 1 Version"
```

---

### 1.6 — Git

**Required by:** cloning Agent365-Samples when creating a new AI Teammate agent from scratch.

> **Skip this section if the quick scan showed ✅ for Git.**

```bash
git --version 2>/dev/null || echo "NOT FOUND"
```

If missing:

> "**Git** is required. Install it now?"
>
> - **Windows:** `winget install Git.Git`  (or download from https://git-scm.com/downloads)
> - **macOS:** `brew install git`  (or `xcode-select --install` for the system git)
> - **Linux:** `sudo apt install git` / `sudo dnf install git`

Verify with `git --version`.

---

### 1.7 — GitHub CLI (gh)

**Required by:** AI Teammate new-agent path (cloning a sample from Agent365-Samples with `gh auth login`). Skip this check if the user is working with an existing agent and does not need a new-agent clone.

> **Skip this section if the quick scan showed ✅ for GitHub CLI.**

```bash
gh --version 2>/dev/null | head -1 || echo "NOT FOUND"
```

If missing and the user may need it:

> "**GitHub CLI** is needed if you want to clone a sample agent to start from. Install it now?"
>
> - **Windows:** `winget install GitHub.cli`
> - **macOS:** `brew install gh`
> - **Linux:** follow https://cli.github.com/manual/installation

After install, authenticate:

```bash
gh auth login
```

Select "GitHub.com" → "HTTPS" → "Login with a web browser".

Verify: `gh auth status`

---

### 1.8 — Language-specific build tools

Check the tools required for the **detected project type** (`programmingLanguage` from Phase 1A).

#### Node.js agents

```bash
node --version
npm --version
```

Requires Node.js **18.x or later** and npm.

If missing:

> "**Node.js 18+** is required. Install it now?"
>
> - **Windows:** `winget install OpenJS.NodeJS.LTS`
> - **macOS:** `brew install node`
> - **Linux/all:** download from https://nodejs.org (LTS recommended)

#### Python agents

```bash
python3 --version 2>/dev/null || python --version
uv --version 2>/dev/null || echo "uv not found (optional but recommended)"
```

Requires Python **3.11 or later**. `uv` is the recommended package manager for Python A365 agents.

If Python is missing:

> "**Python 3.11+** is required. Install it now?"
>
> - **Windows:** `winget install Python.Python.3.11`
> - **macOS:** `brew install python@3.11`
> - **Linux:** `sudo apt install python3.11 python3.11-venv python3.11-pip`

If `uv` is missing:

> "**uv** (Python package manager) is recommended for A365 Python agents. Install it now?"
>
> - **Windows (PowerShell):** `pwsh -Command "irm https://astral.sh/uv/install.ps1 | iex"`
> - **macOS/Linux:** `curl -LsSf https://astral.sh/uv/install.sh | sh`

#### .NET agents

.NET SDK was already verified in section 1.1.

```bash
dotnet --list-sdks
```

Confirm at least one SDK entry at 8.0 or above is listed.

---

> **BEFORE MOVING ON:** Mark Todo 1 (Step 1) as **completed**. Mark Todo 2 (Step 2) as **in-progress**.

---

## Step 2: Configure Azure Identity and Validate Access

> **DO NOT SKIP THIS STEP.** You MUST validate Azure CLI login, Entra ID roles, and the custom client app before any `a365` commands will work. Mark this todo in-progress now.

### Azure CLI login

First, check whether a valid Azure CLI session already exists:

```bash
az account show --query "{user:user.name, tenantId:tenantId, name:name}" -o json 2>/dev/null || echo "NO_SESSION"
```

**If an active session is found**, present the current account and tenant to the user and ask:

```
Found an existing Azure CLI session:
  Signed in as: <user.name>
  Tenant ID:    <tenantId>
  Subscription: <name>  (may be empty if no Azure subscription)

How would you like to proceed?

  1. Use existing session as-is  (recommended — no new login, fastest)
     I'll use the cached token. Pick this if you've used `a365` or `az`
     successfully in the last hour.

  2. Same tenant — new login  (different user, different subscription,
     or refresh expired credentials)
     Stay on tenant <tenantId> but log in again. Pick this to switch
     to a different user account in the same tenant, pick a different
     subscription, or refresh an expired token.

  3. Connect to a new tenant  (cross-tenant work)
     I'll ask for the new tenant ID or domain. Pick this if your A365
     workspace is in a tenant other than the one you're currently
     signed into.
```

- **Option 1 — use existing:** confirm `az account show` returns the correct account and proceed. No new CLI command runs.
- **Option 2 — same tenant, new login:** run with the **existing** tenant ID so Azure CLI keeps the user on the same tenant but starts a fresh interactive login (different user, different subscription, or just refresh):
  ```bash
  az login --allow-no-subscriptions --tenant <existingTenantId>
  ```
- **Option 3 — connect to new tenant:** ask "What is the new tenant ID or domain?" then run with the **new** tenant ID:
  ```bash
  az login --allow-no-subscriptions --tenant <newTenantId>
  ```

**If no session exists (NO_SESSION)**, ask: "Would you like to log in to a specific tenant or to your default tenant?" then run the appropriate command:

```bash
# Default tenant:
az login --allow-no-subscriptions
# Specific tenant:
az login --allow-no-subscriptions --tenant <tenantId>
```

> **CRITICAL:** Always use `--allow-no-subscriptions` — the A365 setup flow does not require an Azure subscription, and plain `az login` fails for users who have none.

After login, confirm the active account:

```bash
az account show --query "{user:user.name, tenantId:tenantId}" -o json
```

STOP and do not proceed until `az account show` returns a valid account. If no valid account is returned, ask the user to complete the login in their terminal and confirm back.

If interactive login is not possible (headless / CI environment), use device-code flow:

```bash
az login --allow-no-subscriptions --use-device-code
```

### Microsoft Entra ID roles

The authenticated account needs roles based on which setup steps will run:

- **Agent ID Developer** — required to run `a365 setup blueprint` (and the blueprint phase of `setup all`).
- **Application Administrator** *(recommended — lightest privilege)*, **Cloud Application Administrator**, or **Global Administrator** — required to complete `a365 setup requirements` (creates the `Agent 365 CLI` app registration and grants admin consent) and `a365 setup permissions {mcp, bot, custom, copilotstudio}` (per-MCP OAuth2 consent). GA is heaviest but not required — Application Admin works. Reference: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/custom-client-app-registration
- **Azure Subscription Contributor** — required when the CLI provisions Azure resources (App Service Plan, Web App).

If the developer is not an admin (Application Admin / Cloud App Admin / GA), `a365 setup all` runs as far as it can and **prints PowerShell next-steps for an admin** to complete the consent grants. There is no separate `setup admin` subcommand — the admin reads the printed instructions and runs them.

> **Note:** The CLI detects admin role via the `wids` claim in the access token. If `wids` isn't configured on your app registration (step 5 of [custom-client-app-registration](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/custom-client-app-registration)), the CLI shows handoff scripts even when you ARE an admin — add the claim once to fix.

If the logged-in user lacks the minimum roles, prompt them to switch accounts or to ask an admin to grant the role.

### Windows Account Manager (WAM) — what to expect

On Windows machines, `a365 setup all` may authenticate via **Windows Account Manager (WAM)**, the OS-level broker.

- **Normal WAM prompt:** A native Windows sign-in dialog appears on the user's screen. Do NOT kill the process. Tell the user: "A Windows sign-in dialog has appeared — please complete it in the dialog. Setup will continue automatically after you authenticate."
- **WAM dialog not appearing (headless or no desktop):** The `a365 CLI` will hang waiting for a dialog that can never be shown. Fix: ensure `az login --allow-no-subscriptions` has already populated the Azure CLI token cache before running `a365 setup all` — the CLI will then use the cached token and skip WAM.
- **WAM hangs with no dialog:** Kill the process (`Ctrl+C`), run `az login --allow-no-subscriptions --tenant <tenant-id>` to refresh the cache, then retry.
- **WAM error "no_accounts_found" or similar:** Run `az login --allow-no-subscriptions` again, confirm `az account show` returns the correct account, then retry.
- **Conditional Access Policy (CAP):** If WAM or browser auth is blocked by CAP (AADSTS53003, AADSTS53000), the CLI automatically falls back to device code flow — no user action is needed.



### Custom client app

The CLI resolves the client app automatically by the well-known display name **"Agent 365 CLI"** registered in the tenant. Do NOT ask the user for a client app ID.

If the CLI reports that "Agent 365 CLI" cannot be found, inform the user that an admin must register an Entra app with that exact display name and grant admin consent, then retry.

To validate the app and check consent status before running setup:

```bash
a365 query-entra --help
```

This surfaces scope grants, permission status, and consent state — useful for diagnosing `Authorization_RequestDenied` errors before they block `setup all`.

> **STOP AND CONFIRM before leaving Step 2:**
> - Azure CLI login confirmed with correct account and tenant
> - Entra ID roles confirmed (Agent ID Admin/Developer or Global Admin)
> - Custom client app "Agent 365 CLI" validated in the tenant

> **BEFORE MOVING ON:** Mark Todo 2 (Step 2) as **completed**. Mark Todo 3 in-progress → proceed to Step 3.

---

## Step 3: Delegate to the Appropriate Skill

The CLI is verified and Azure prerequisites are confirmed. All remaining work is handled by a specialized skill.

**AI Teammate path** (`isAITeammate = true`):

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/SKILL.md` and follow it from the beginning.

The `make-ai-teammate` skill handles everything: code generation, a365.config.json, `a365 setup all`, manifest review, `a365 publish`, the **Teams Developer Portal verification** (Agent Type=API Based, Notification URL=messagingEndpoint at `https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration` — the Notification URL is auto-registered via `a365 setup blueprint --update-endpoint --m365` on supported tenants; manual fallback only when the CLI reports automated registration isn't available), the agent-instance request, and downstream capability offers (Observability, WorkIQ, local testing). Reference: [Create agent instance — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance).

> The `make-ai-teammate` skill will detect that the CLI is already installed (Phase 9 Step 1) and that Azure prerequisites are met. It will proceed directly to collecting agent identity inputs.

---

**Agent (Non AI Teammate) paths** (`isAITeammate = false` — Register, Observability, WorkIQ):

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-a365-agent/SKILL.md` and follow it from the beginning.

Pass the session context to the skill: `capabilities`, `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`.

The `make-a365-agent` skill handles: `a365 setup all` (Blueprint + permissions), and optionally invokes `instrument-observability` (Observability paths) and `add-workiq-tools` (WorkIQ paths).

---

Mark Todo 3 as completed when the delegated skill finishes.

---

## Steps 4-5 (Reference Only) — CLI commands for re-running setup or re-publishing

The full setup-all / publish / endpoint-register flow is owned by Step 3's
delegated skill (`make-a365-agent` or `make-ai-teammate`). The blocks below are
quick-reference CLI snippets for the case where the user just wants to re-run
one piece without the full skill flow.

`a365 setup all` is idempotent — safe to re-run after fixing any issue.

```bash
# Agent (Non AI Teammate)
a365 setup all --agent-name <name> --dry-run                # preview
a365 setup all --agent-name <name>                          # apply
a365 setup all --agent-name <name> --authmode s2s           # S2S
a365 setup all --agent-name <name> --agent-registration-only  # re-register only

# Custom Engine Agent (Teams / Copilot integration)
a365 setup all --agent-name <name> --m365
a365 setup permissions bot                                  # required after --m365

# AI Teammate — --m365 is always required (registers the agent in M365 admin center)
a365 setup all --agent-name <name> --aiteammate --m365
```

Blueprint-only and permissions subcommands:

```bash
a365 setup blueprint --agent-name <name>                              # create blueprint + endpoint
a365 setup blueprint --agent-name <name> --update-endpoint <new-url>  # replace messaging endpoint (add --m365 for M365 agents — else Teams Graph re-registration is skipped silently)
a365 setup blueprint --agent-name <name> --show-secret                # print stored client secret
                                                                       # (Windows: same machine + user that created it)
a365 setup permissions mcp                                            # MCP grants — always first
a365 setup permissions copilotstudio                                  # CopilotStudio.Copilots.Invoke
a365 setup permissions custom --resource-app-id <guid> --scopes Mail.Read,User.Read
```

**Admin handoff (developer is not Global Admin):** `a365 setup all` completes
everything it can, then prints a PowerShell snippet in the setup summary for a
GA to run. Equivalent path: Entra portal → App registrations → Blueprint app
→ API permissions → Grant admin consent. Read the Blueprint ID any time with:

```bash
node -e "console.log(require('./a365.generated.config.json').agentBlueprintId)"
```

There is no `a365 setup admin` subcommand — the CLI handles the handoff via the
setup summary.

**Re-publishing an AI Teammate (manifest verify → `a365 publish` → manual zip
upload at M365 Admin Center → Teams Developer Portal configuration → instance
request → admin approval at `admin.cloud.microsoft/#/agents/all/requested`):**
follow `make-ai-teammate` Phase 9.7. The CLI owns `manifest.json` and the bot
endpoint registration; do not hand-edit either. For non-AI-Teammate agents
already registered via `a365 setup all`, use `a365 publish --use-blueprint`
(only valid when `--aiteammate` was not passed).

---

## Error Handling and Troubleshooting

For detailed guidance, refer to:
- [Agent 365 Troubleshooting Guide](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/troubleshooting)
- [Agent 365 CLI Reference](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/agent-365-cli)
- [GitHub Issues](https://github.com/microsoft/Agent365-devTools/issues)

### Quick tips

- Run failing commands with `-v` / `--verbose` for detailed logs.
- Manage and locate CLI diagnostic logs via `a365 logs --help`. Log files live at Windows `%APPDATA%/a365/logs/`, Linux/Mac `~/.config/a365/logs/`.
- Most `a365` commands are idempotent — safe to re-run after fixing an issue.
- For a full cleanup of a config-free agent: `a365 cleanup --agent-name <name>` (reads resource IDs from the generated config). For granular cleanup: `a365 cleanup blueprint`, `a365 cleanup azure`, or `a365 cleanup instance`. Use only as a last resort.

### Dev tunnel issues

| Issue | Resolution |
|-------|-----------|
| Dev tunnel CLI not found | Restart terminal or add install directory to PATH |
| Auth failure in headless env | `devtunnel user login --device-code` |
| Tunnel not receiving messages | Verify tunnel is running, correct port, `--allow-anonymous` was used |
| Tunnel URL changed | `a365 setup blueprint --update-endpoint https://<new-url>/api/messages --m365` (omit `--m365` only for non-M365 agents — Teams reachability via tunnel implies M365) |
| Port already in use | Delete old port, create new: `devtunnel port delete/create` |
| Cannot access from Teams | Ensure `--allow-anonymous`; firewall allows `*.devtunnels.ms`; path includes `/api/messages` |

### Escalating to GitHub

If the issue appears to be a CLI bug, draft an issue with: CLI version (`a365 --version`), OS/shell, exact steps to reproduce, error output, and expected vs actual behavior. Present the draft to the user — do not create the issue unless authorized.
