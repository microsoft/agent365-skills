---
name: a365-setup
description: >
  Entry point for general Agent 365 (A365) registration and CLI setup — use this skill whenever
  the user wants to "set up A365", "register agent", "create blueprint", or general A365 onboarding
  for non-AI-Teammate agents (Discoverability, Observability paths). Verifies and installs the CLI,
  validates Azure prerequisites, then delegates to make-a365-agent or make-ai-teammate at Step 3.
  Does NOT run a365 setup all inline — setup is run by the delegated skill. Supports .NET AgentFramework,
  Node.js LangChain, and Python agents.
compatibility:
  - claude-code
  - vscode-copilot
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
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-setup.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. a365 CLI is installed and the version was confirmed.
        2. Azure CLI login was validated.
        3. a365 setup all completed without fatal errors (or was confirmed skipped/cancelled).
        4. User was shown the blueprint ID or setup summary.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If no setup ran this session, or all items are complete, return {"ok": true}.
      timeout: 30000
---

# Agent 365 CLI Setup

> **Trigger phrases** — any of these will activate this skill automatically:
> "run a365 setup", "create blueprint", "register agent", "setup agent blueprint",
> "onboard agent", "provision agent", "deploy agent", "publish agent", "a365 full setup",
> "make this an a365 agent", "make this agent an a365 agent", "set up a365",
> "add a365", "configure a365", "a365 setup", "connect to a365", "integrate with a365",
> "make this agent work with a365", "set up agent 365", "agent 365 setup"

---

> **YOUR FIRST AND ONLY ACTION RIGHT NOW:** Detect the agent stack and code, then ask validation questions. Do NOT create todos, run commands, or read further until all validations are complete. After all answers are received, create all todos for the determined path and mark Todo 1 in-progress.

**RULE 1 — DETECT AGENT STACK AND CODE, ASK VALIDATION QUESTIONS, THEN CREATE ALL TODOS.**

### Phase 1A: Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.json` if it exists. If `detectedAt` is within the last 60 minutes, load `agentStack`, `programmingLanguage`, and `usesTeamsOrCopilot` from it and skip the detection steps below — go straight to Phase 1B.

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
- `teamsapp.yml` or `teamsapp.local.yml` exists (Teams Toolkit project)
- `appPackage/manifest.json` or `manifest/manifest.json` exists (Teams app package)
- `a365.config.json` or `a365.generated.config.json` exists (already A365-registered)
- `@microsoft/teams-ai` in package.json (Teams AI SDK — Node.js specific)
- `Microsoft.Teams.AI` in .csproj (.NET Teams AI SDK)
- `teams-ai` in requirements.txt or pyproject.toml (Python Teams AI SDK)

*Paired signals — CEA only if also matched by a structural file signal above:*
- `"botbuilder"` in package.json + structural marker → CEA (generic Bot Framework; standalone = channel bot risk)
- `Microsoft.Bot.Builder` in .csproj + structural marker → CEA
- `botbuilder-core` in requirements.txt or pyproject.toml + structural marker → CEA
- `BOT_ID`, `MicrosoftAppId`, or `TEAMS_APP_ID` in .env/appsettings.json + structural marker → CEA

If no strong standalone signal and no valid pairing → `0` (Standard Agent / Non-M365 Agent)

### Phase 1B: User Validation Questions

Present **all three detections in a single message** and wait for ONE response:

```
Here's what we detected about your agent:
  • Stack:         {agentStack}
  • Language:      {programmingLanguage}
  • Agent type:    {usesTeamsOrCopilot == 1
                     ? "Custom Engine Agent (CEA) — has Teams/Copilot integration"
                     : "Standard Agent — no Teams/Copilot integration (Non-M365)"}

Reply **yes** to confirm, or describe any corrections.
Examples: "language is NodeJS", "it's a Custom Engine Agent", "it's not Teams".
```

- If the user replies **yes / y**: accept all values and proceed to the final capabilities question below.
- If the user says it's a CEA / Custom Engine Agent: set `usesTeamsOrCopilot = 1` and proceed to the final capabilities question below.
- If the user says it's Standard / Non-M365: set `usesTeamsOrCopilot = 0` and proceed to the final capabilities question below.
- If the user describes other corrections: update the relevant variable(s) and proceed to the final capabilities question below.

After confirming, write `.a365-workspace-detection.json` (see `agent-detection.md` cache format).

**Final question: What capabilities do you want to enable?**

Present these four options:

  1. Discoverability — make the agent findable in the M365 catalog
  2. Observability — end-to-end activity tracing for every message, LLM call, and tool use, visible in the Agent 365 portal and Microsoft Defender
  3. Tools — add WorkIQ MCP tools (M365 data: email, calendar, Teams, SharePoint, OneDrive)
  4. AI Teammate — full Teams/Copilot integration with hosting layer, registration, and publish

Wait for the answer. Store as `capabilities`.

> **Note:** Options can be combined — e.g. a user can say "1 and 2" for Discoverability + Observability.

### Phase 1C: Determine Path and Create Todos

After the capabilities question is answered (and the detection/confirmation above is complete):

1. Set `isAITeammate = true` if the user selected **AI Teammate**, else `isAITeammate = false`.
2. Derive `registrationType` from Phase 1A signals (do not ask the user):
   - `registrationType = 1` if `usesTeamsOrCopilot = 1` (CEA — Entra app ID path)
   - `registrationType = 3` if `usesTeamsOrCopilot = 0` (Standard agent path)
   - (`registrationType = 2` — Blueprint already exists — is set by make-ai-teammate, not here)

Then create all todos for the path and mark Todo 1 in-progress:

**AI Teammate path** — `isAITeammate = true` (3 todos total):
- Todo 1: `Step 1: Verify and Install/Update the Agent 365 CLI`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Run the make-ai-teammate skill`

**Standard path** — `registrationType = 3, isAITeammate = false` (3 todos total):
- Todo 1: `Step 1: Verify and Install/Update the Agent 365 CLI`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Run the make-a365-agent skill`

**Entra app ID path** — `registrationType = 1, isAITeammate = false` (3 todos total):
- Todo 1: `Step 1: Verify and Install/Update the Agent 365 CLI`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Run the make-a365-agent skill`

**RULE 2 — ALWAYS BEGIN FROM STEP 1.** No step is optional within your path. Even if the CLI appears installed or Azure appears logged in, you MUST run the validation commands in each step. Step 3 is always the final step — it delegates to the appropriate skill based on `isAITeammate`.

**RULE 3 — SUB-SECTIONS ARE NOT SEPARATE TODOS.** Each `## Step` has internal sub-sections — these are tasks WITHIN that step, NOT separate todos.

**RULE 4 — ONE STEP AT A TIME.** Complete each step fully. Mark its todo in-progress when starting, complete when done. The detection confirmation and final capabilities question were already answered before Step 1.

**RULE 5 — SILENT EXECUTION.** Work silently. Do NOT narrate what you are about to do, announce step transitions ("Proceeding to Step 2", "CLI installed, moving on"), print todo state, emoji checklists, or step completion summaries. Only speak to the user when you need input, have an error to report, or need confirmation before a destructive action.

**RULE 6 — SKILL DELEGATION.** After Steps 1 and 2, all paths delegate to a specialized skill at Step 3 — do not run setup or publish inline here:
- **AI Teammate path** (`isAITeammate = true`): delegate to `make-ai-teammate` (code generation, a365.config.json, setup all, publish, Teams Dev Portal).
- **Standard paths** (`isAITeammate = false`): delegate to `make-a365-agent` (setup all + optional observability/WorkIQ).

---

## Context

You are an AI coding agent with access to execute shell commands, read the Agent365-devTools repository (code and docs), and browse the web for documentation or GitHub issues. Your task is to set up, configure, and deploy all prerequisite components for a Microsoft Agent 365–compliant agent using the Agent 365 CLI. You must handle this end-to-end: from installation and configuration to deployment. Work step-by-step, and adapt to any issues or differences in CLI versions along the way.

> **CRITICAL BLOCKING PREREQUISITE:** Before running ANY `a365` CLI commands (including `config init`, `setup`, `publish`, or `deploy`), you MUST validate that the custom client app registration exists in Entra ID with all required permissions and admin consent. This is validated in Step 2. Failure to validate this will cause all CLI commands to fail. Do NOT skip this validation step.

---

## Step 1: Verify and Install/Update the Agent 365 CLI

> **DO NOT SKIP THIS STEP.** Even if you believe the CLI is already installed, you MUST run the version check and validate. Mark this todo in-progress now.

Check if the Agent 365 CLI is installed and up-to-date:

- Run a version check (e.g. `a365 --version` or `a365 -h`).
- If the CLI is not installed or the command is not found, install it. If installed but outdated, update to the latest preview version.

### Check .NET and CLI in one step

```bash
dotnet --version; a365 --version 2>/dev/null || echo "a365 CLI not found"
```

- If `dotnet` is missing: instruct the user to install .NET 8.0 from https://dotnet.microsoft.com/download.
- If `a365` is not found: install or update in one command:

```bash
dotnet tool install --global Microsoft.Agents.A365.DevTools.Cli --prerelease || dotnet tool update --global Microsoft.Agents.A365.DevTools.Cli --prerelease
```

On Windows, if the above fails, use `scripts/cli/install-cli.ps1` from the devTools repository (after `dotnet tool uninstall -g Microsoft.Agents.A365.DevTools.Cli`).

### Verify installation

```bash
a365 -h
```

This must show usage information, not an error. Confirms the CLI is on PATH.

### Adapt to CLI version differences

The CLI is under active development. If a command referenced later is not recognized, upgrade the CLI. Using the latest version is essential — newer versions include important fixes and new commands (e.g. `create-instance`, `publish`).

> **BEFORE MOVING ON:** Mark Todo 1 (Step 1) as **completed**. Then mark Todo 2 (Step 2) as **in-progress**. Only then proceed to Step 2.

---

## Step 2: Ensure Prerequisites and Environment Configuration

> **DO NOT SKIP THIS STEP.** You MUST validate Azure CLI login, Entra ID roles, the custom client app registration, and language-specific build tools before any `a365` commands will work. Mark this todo in-progress now.

### Azure CLI & Authentication

```bash
az --version
```

If not installed, direct the user to https://learn.microsoft.com/en-us/cli/azure/install-azure-cli.

Ensure you are logged in to the correct Azure account and tenant:

```bash
az login
# If multiple subscriptions:
az account set -s <SubscriptionNameOrID>
```

If interactive login is not possible (headless environment), instruct the user to follow the device-code login URL.

### Microsoft Entra ID roles

The authenticated account must be at minimum an **Agent ID Administrator** or **Agent ID Developer**. Full environment setup requires **Global Administrator + Azure Contributor**. If the logged-in user lacks these roles, prompt them to use an appropriate account or have an admin grant the needed roles.

### Custom client app

The CLI resolves the client app automatically by the well-known display name **"Agent 365 CLI"** registered in the tenant. Do NOT ask the user for a client app ID.

The CLI will validate permissions and prompt for consent at runtime. If the CLI reports that "Agent 365 CLI" cannot be found, inform the user that an admin must register an Entra app with that exact display name and grant admin consent, then retry.

### Validate language-specific prerequisites (REQUIRED)

> **BLOCKING PREREQUISITE:** You MUST validate that language-specific build tools are installed BEFORE proceeding to Step 3.

#### Detect project type

```bash
find . -name "*.csproj" -print -quit 2>/dev/null; \
  test -f "package.json" && echo "Node.js project detected"; \
  { test -f "requirements.txt" || test -f "pyproject.toml"; } && echo "Python project detected"
```

#### Validate required tools based on project type

**For .NET agents:**
```bash
dotnet --version
dotnet --list-sdks
```
Confirm .NET SDK 8.0 or later is installed.

**For Node.js agents:**
```bash
node --version
npm --version
```
Confirm Node.js 18.x or later and npm are available.

**For Python agents:**
```bash
python --version
pip --version
```
Confirm Python 3.10 or later and pip are available.

> **STOP AND CONFIRM before leaving Step 2:**
> - Project type detected (at least one of: .NET, Node.js, or Python)
> - Required build tools installed and verified
> - Azure CLI login confirmed, custom client app validated, permissions checked

> **BEFORE MOVING ON:** Mark Todo 2 (Step 2) as **completed**. Mark Todo 3 in-progress → proceed to Step 3.

---

## Step 3: Delegate to the Appropriate Skill

The CLI is verified and Azure prerequisites are confirmed. All remaining work is handled by a specialized skill.

**AI Teammate path** (`isAITeammate = true`):

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/SKILL.md` and follow it from the beginning.

The `make-ai-teammate` skill handles everything: code generation, a365.config.json, `a365 setup all`, manifest review, `a365 publish`, Teams Dev Portal registration, and downstream capability offers (Observability, WorkIQ, local testing).

> The `make-ai-teammate` skill will detect that the CLI is already installed (Phase 9 Step 1) and that Azure prerequisites are met. It will proceed directly to collecting agent identity inputs.

---

**Standard paths** (`isAITeammate = false` — Discoverability, Observability, WorkIQ):

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-a365-agent/SKILL.md` and follow it from the beginning.

Pass the session context to the skill: `capabilities`, `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`.

The `make-a365-agent` skill handles: `a365 setup all` (Blueprint + permissions), and optionally invokes `instrument-observability` (Observability paths) and `add-workiq-tools` (WorkIQ paths).

---

Mark Todo 3 as completed when the delegated skill finishes.

---

## Step 4 (Reference Only)

> **This step is now handled by the `make-a365-agent` skill (Step 3 above).** Kept as a reference for re-running setup without the full skill flow.

If you need to re-run `a365 setup all` on a non-AI Teammate agent without going through the full skill:

```bash
a365 setup all --agent-name <agent_name> --dry-run   # preview
a365 setup all --agent-name <agent_name>              # apply
```

`a365 setup all` is idempotent — safe to re-run after fixing any issue.

---

## Step 5: Review, Publish, and Register Endpoint

> **This step is handled by the `make-ai-teammate` skill (Step 3 above).** This section is kept as a reference for standalone re-registration scenarios only.

If you need to re-publish or re-register an existing AI Teammate agent without re-running the full `make-ai-teammate` flow, the steps are in `make-ai-teammate` Phase 10:
- Manifest review (`manifest/manifest.json`)
- `a365 publish`
- Teams Developer Portal configuration (`a365 config display -g --field agentBlueprintId`)
- Create agent instance via Teams > Apps > Request Instance
- Admin approval at [admin.cloud.microsoft/#/agents/all/requested](https://admin.cloud.microsoft/#/agents/all/requested)

To re-run just this phase: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/SKILL.md` and jump to Phase 10.

---

## Error Handling and Troubleshooting

For detailed guidance, refer to:
- [Agent 365 Troubleshooting Guide](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/troubleshooting)
- [Agent 365 CLI Reference](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/agent-365-cli)
- [GitHub Issues](https://github.com/microsoft/Agent365-devTools/issues)

### Quick tips

- Run failing commands with `-v` / `--verbose` for detailed logs.
- Check log files: Windows `%APPDATA%/a365/logs/`, Linux/Mac `~/.config/a365/logs/`.
- Most `a365` commands are idempotent — safe to re-run after fixing an issue.
- Use `a365 cleanup azure` or `a365 cleanup blueprint` only as a last resort.

### Dev tunnel issues

| Issue | Resolution |
|-------|-----------|
| Dev tunnel CLI not found | Restart terminal or add install directory to PATH |
| Auth failure in headless env | `devtunnel user login --device-code` |
| Tunnel not receiving messages | Verify tunnel is running, correct port, `--allow-anonymous` was used |
| Tunnel URL changed | `a365 setup blueprint --update-endpoint https://<new-url>/api/messages` |
| Port already in use | Delete old port, create new: `devtunnel port delete/create` |
| Cannot access from Teams | Ensure `--allow-anonymous`; firewall allows `*.devtunnels.ms`; path includes `/api/messages` |

### Escalating to GitHub

If the issue appears to be a CLI bug, draft an issue with: CLI version (`a365 --version`), OS/shell, exact steps to reproduce, error output, and expected vs actual behavior. Present the draft to the user — do not create the issue unless authorized.
