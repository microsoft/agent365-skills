---
name: make-ai-teammate
description: >
  Transforms a non-M365 agent into a Microsoft Agent 365 AI Teammate. Supports all major
  frameworks across .NET (AgentFramework, Semantic Kernel), Node.js (LangChain, OpenAI Agents
  SDK, Claude SDK, Semantic Kernel, Google ADK), and Python (AgentFramework, LangChain, OpenAI,
  Claude, Semantic Kernel, Google ADK). Adds the hosting layer (Express/CloudAdapter for Node.js,
  ASP.NET Core for .NET, aiohttp for Python), AgentApplication class with message routing and
  typing indicators, email notifications, and all required packages and env vars. Wraps existing
  LLM code — does not replace it. Requires a365-setup to have been run first.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: language/framework override (langchain | openai | claude | semantickernel | googleadk | dotnet | dotnet-sk | python)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-make-ai-teammate.js
      timeout: 30000
    - type: prompt
      prompt: |
        Code-generation artifacts (hosting layer, agent class, packages, build)
        are validated by validate-make-ai-teammate.js. This prompt covers only
        the deploy-pipeline checks the JS validator can't see.

        Read .a365-workspace-detection.json for runTarget, has_setup, has_obs,
        has_workiq. Treat a skip-gated step as satisfied when its flag was
        already true at session entry.

        Verify ALL that apply:
        1. Phase 9.7.1 — a365 setup all --aiteammate ran, OR has_setup was true.
           a365.generated.config.json has a non-empty agentBlueprintId.
        2. Phase 9.7.2 — runTarget is recorded ("prod" or "local"). For prod,
           runTargetHosting ("devtunnel" or "cloud") and chosenEndpoint are
           recorded, and messagingEndpoint was reconciled to chosenEndpoint
           via a365 setup blueprint --update-endpoint when they differed.
        3. Phase 9.7.2d — required env vars present in .env / appsettings.json.
           For prod: completed=true AND resourceConsents non-empty (else GA
           handoff message shown), cloud-platform env vars set, platform state
           Running/Ready.
        4. Phase 9.5 — instrument-observability ran OR has_obs was true.
        5. Phase 9.6 — add-workiq-tools was offered (or has_workiq true).
        6. For runTarget = "prod": manifest.json reviewed (CLI owns it),
           a365 publish ran, user was told to upload manifest.zip via M365
           Admin Center, Teams Developer Portal was configured (Agent Type =
           API Based, Notification URL = messagingEndpoint), instance was
           requested with the admin-approval URL surfaced.
        7. For runTarget = "local": steps 10a–10d explicitly skipped; this is
           a valid completion state.
        8. Smoke test was completed.

        Row 8 (has_obs && has_workiq && has_setup): if user chose "Verify only"
        in Phase 0C, all Phase 9.x checks collapse to verified. If they chose
        "Re-publish", checks 2, 6, 8 still apply.

        If any required item is incomplete and was not a valid skip, return
        {"ok": false, "reason": "<specific item>"}. Otherwise {"ok": true}.
      timeout: 45000
---

# Make AI Teammate

> **Trigger phrases** — any of these will activate this skill:
> - "make this agent an ai teammate"
> - "transform this agent into an ai teammate"
> - "publish this agent to teams"
> - "make this agent available in microsoft teams"
> - "publish this agent to microsoft copilot"
> - "add teams support to this agent"
> - "set up ai teammate hosting for this agent"
> - "convert this agent to a teams agent"
> - "make this agent work with microsoft 365"

> **What this skill does:** It wraps your existing LLM logic with the Microsoft Agent 365
> AI Teammate layer — hosting, routing, and notifications. Your existing LLM code (models,
> prompts, tools, business logic) is preserved and integrated into the new structure. Nothing is deleted.
>
> **Prerequisite:** Run `a365-setup` first — it registers the agent with Agent 365 and writes
> the detection cache that this skill reads.
>
> **Supported languages:** Node.js (LangChain, OpenAI Agents SDK, Claude SDK, Semantic Kernel, Google ADK) · .NET (AgentFramework, Semantic Kernel) · Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK)

---

## Phase 0A — Load Detection Cache

**Read** `.a365-workspace-detection.json`.

If the file is missing or `detectedAt` is older than 60 minutes:
> "`a365-setup` must be run before this skill — it registers your agent with Agent 365 and writes
> the project detection cache this skill depends on. Run `a365-setup` now, then return here."

Stop until the user confirms `a365-setup` has been run.

Load from cache:
- `programmingLanguage` → use as `language`
- `agentStack`

**Find existing LLM entry point** (not stored by a365-setup — still required):

*NodeJS:* **Glob** `src/**/*.ts` and **Grep** for LLM instantiation (`ChatOpenAI`, `AzureChatOpenAI`, `OpenAI`, `Anthropic`, `Kernel`, `@google/generative-ai`, `@google/adk`), chain/agent creation, or existing HTTP server.

*DotNet:* **Glob** `**/*.cs` and **Grep** for `AddAgent<`, `AgentApplication`, `IChatClient`, `Microsoft.SemanticKernel`, or `WebApplication.CreateBuilder`. Store `Program.cs` and agent `.cs` files.

*Python:* **Glob** `**/*.py` and **Grep** for `ChatAgent`, `AzureOpenAIChatClient`, `CloudAdapter` (or legacy `CloudAdapterAiohttp`), or `AgentInterface`.

Store the main source file(s) as `existingFiles`.

---

## Phase 0A.5 — New Agent Path (no source files found)

**Check for empty directory:** If `existingFiles` is empty AND no `.csproj`, `package.json`, or `requirements.txt` exists anywhere in the working directory, the user is starting fresh with no existing agent code.

In this case, **do NOT fail** — offer to scaffold from an official sample:

```
No agent code found in this directory. Would you like to start from an official
Agent365-Samples project?

Pick a framework and I'll clone the sample, then continue with the AI Teammate setup:

  .NET
    1. Agent Framework  — classic AgentApplication pattern with IChatClient
       https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent
    2. Semantic Kernel   — Kernel + IChatCompletionService pattern
       https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/semantic-kernel/sample-agent

  Node.js
    3. LangChain         — ReactAgent with AzureChatOpenAI / ChatOpenAI
       https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/langchain/sample-agent
    4. OpenAI Agents SDK — @openai/agents with run()
       https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/openai/sample-agent

  Python
    5. Agent Framework   — ChatAgent with AzureOpenAIChatClient
       https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework/sample-agent
    6. Claude SDK        — ClaudeSDKClient with ClaudeAgentOptions
       https://github.com/microsoft/Agent365-Samples/tree/main/python/claude/sample-agent
    7. Google ADK        — google.adk Agent + Runner
       https://github.com/microsoft/Agent365-Samples/tree/main/python/google-adk/sample-agent

  0. I'll bring my own code — skip cloning
```

**If the user picks a sample (1–7), run prerequisite checks BEFORE cloning:**

### Step 1 — Verify git is installed

```bash
git --version
```

If the command fails:
> "**git is not installed.** Please install it from https://git-scm.com/downloads and restart your terminal, then try again."

Stop until the user confirms git is installed.

### Step 2 — Verify GitHub CLI is installed

```bash
gh --version
```

If the command fails:
> "**GitHub CLI (gh) is not installed.** Install it from https://cli.github.com/ and restart
> your terminal. The CLI is used to authenticate with GitHub before cloning the sample."

Stop until the user confirms `gh` is installed.

### Step 3 — Verify GitHub authentication

```bash
gh auth status
```

Check the output:
- If output contains `Logged in to github.com` → authenticated, proceed.
- If output contains `not logged in` or exits non-zero:

> "You are not logged in to GitHub. Run the following command to authenticate:
>
> ```
> gh auth login
> ```
>
> Choose **GitHub.com**, then **HTTPS**, then **Login with a web browser**.
> Follow the prompts, then come back here."

Stop until `gh auth status` succeeds.

### Step 4 — Verify language-specific toolchain (pre-clone)

Run the relevant check for the chosen sample:

| Sample | Check command | Install URL if missing |
|--------|--------------|------------------------|
| .NET (1, 2) | `dotnet --version` | https://dotnet.microsoft.com/download (requires .NET 8+) |
| Node.js (3, 4) | `node --version && npm --version` | https://nodejs.org (requires Node.js 18+) |
| Python (5, 6, 7) | `python --version` or `python3 --version` | https://www.python.org/downloads (requires 3.11+) |

If the check fails:
> "**{tool} is not installed or is below the minimum version.** Please install it from
> {install URL} and restart your terminal."

Stop until the check passes.

### Step 5 — Clone the sample

Once all checks pass, clone and copy the chosen sample into the current directory:

```bash
# Pattern — replace {path} with the framework subfolder
git clone --depth 1 https://github.com/microsoft/Agent365-Samples.git _tmp_a365samples
```

Then copy only the chosen sample subfolder:

| Option | Source path inside clone |
|--------|--------------------------|
| 1 — .NET Agent Framework | `dotnet/agent-framework/sample-agent` |
| 2 — .NET Semantic Kernel | `dotnet/semantic-kernel/sample-agent` |
| 3 — Node.js LangChain | `nodejs/langchain/sample-agent` |
| 4 — Node.js OpenAI Agents SDK | `nodejs/openai/sample-agent` |
| 5 — Python Agent Framework | `python/agent-framework/sample-agent` |
| 6 — Python Claude SDK | `python/claude/sample-agent` |
| 7 — Python Google ADK | `python/google-adk/sample-agent` |

```bash
# Example for option 3 (Node.js LangChain):
cp -r _tmp_a365samples/nodejs/langchain/sample-agent/. .
rm -rf _tmp_a365samples
```

Tell the user:
> "✅ Sample cloned into the current directory. Continuing with AI Teammate setup…"

Set `language` and `agentStack` from the chosen option, re-run the LLM entry point detection
above, then continue to Phase 0B as normal.

### Step 6 — Install sample dependencies (post-clone)

Before continuing, install the sample's dependencies so subsequent build steps succeed:

| Language | Command |
|----------|---------|
| Node.js | `npm install` |
| .NET | `dotnet restore` |
| Python | `uv sync` (preferred) or `pip install -e .` |

If `uv` is not installed for Python:
```bash
pip3 install uv 2>/dev/null || pip install uv
uv sync
```

**If the user picks 0 (bring own code):**
Ask: "What language and framework are you using?" and set `language` and `agentStack` accordingly, then continue to Phase 0B.

---

**Check what's already present** (parallel Grep):

*NodeJS:*
- `AgentApplication` in `src/**/*.ts` → `hasAgentApp`
- `CloudAdapter` in `src/**/*.ts` → `hasHosting`
- `onAgentNotification` in `src/**/*.ts` → `hasNotifications`
- `ToolingManifest.json` exists → `hasManifest`
- `useMicrosoftOpenTelemetry` in `src/**/*.ts` → `has_obs`

*DotNet:*
- `AgentApplication` in `**/*.cs` → `hasAgentApp`
- `adapter.ProcessAsync` or `IAgentHttpAdapter` in `**/*.cs` → `hasHosting`
- `OnConversationUpdate` or `InstallationUpdate` in `**/*.cs` → `hasNotifications`
- `ToolingManifest.json` exists → `hasManifest`
- `UseMicrosoftOpenTelemetry` in `**/*.cs` → `has_obs`

*Python:*
- `AgentInterface` in `**/*.py` → `hasAgentApp`
- `CloudAdapter` or legacy `CloudAdapterAiohttp` in `**/*.py` → `hasHosting`
- `on_agent_notification` in `**/*.py` → `hasNotifications`
- `ToolingManifest.json` exists → `hasManifest`
- `use_microsoft_opentelemetry` in `**/*.py` → `has_obs`

**Skill-state signals** (language-agnostic):

- **`has_workiq`** — `ToolingManifest.json` exists AND its top-level `mcpServers` array (or `servers` in legacy v1 schema) is non-empty. Parse the file; if the array contains at least one entry, `has_workiq = true`.
- **`has_setup`** — read from `.a365-workspace-detection.json` field `hasBlueprintConfig` (set by `a365-setup`). Equivalently: `a365.generated.config.json` exists with a non-empty `agentBlueprintId`.

These three flags (`has_obs`, `has_workiq`, `has_setup`) drive the 8-row state matrix in Phase 0C.

---

## Phase 0B — Confirm and Create Task List

Present all detections in one message:

```
Language: {language}  |  Framework: {agentStack}  |  Existing code: {existingFiles.join(', ')}

AI Teammate scaffolding:
  • Hosting layer:    {hasHosting ? "✅" : "❌"}
  • Agent class:      {hasAgentApp ? "✅" : "❌"}
  • Notifications:    {hasNotifications ? "✅" : "❌"}
  • ToolingManifest:  {hasManifest ? "✅" : "❌"}

Agent 365 capabilities:
  • Observability:    {has_obs ? "✅ already wired" : "❌ will be added"}
  • WorkIQ tools:     {has_workiq ? "✅ already wired" : "❌ will be offered"}
  • Blueprint setup:  {has_setup ? "✅ registered (Blueprint ID: " + existingBlueprintId + ")" : "❌ will run a365 setup all"}

Reply **yes** to confirm, or describe corrections.
```

If `agentStack` is still unknown, ask which LLM framework the agent uses.

If `agentStack` is unrecognized, tell the user:
> "This skill supports all major frameworks: .NET (AgentFramework, Semantic Kernel),
> Node.js (LangChain, OpenAI Agents SDK, Claude SDK, Semantic Kernel, Google ADK), and
> Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK).
> For other frameworks, I'll add the hosting layer and agent class, but you'll need to
> integrate your LLM calls manually."

**NodeJS tasks (only create if not already present):**
```
TaskCreate: "Install required @microsoft/agents-* npm packages"
TaskCreate: "Configure tsconfig.json for node16 module resolution"  [skip if already correct]
TaskCreate: "Add src/index.ts — Express + CloudAdapter hosting"     [skip if hasHosting]
TaskCreate: "Add src/agent.ts — AgentApplication class"             [skip if hasAgentApp]
TaskCreate: "Add src/client.ts — LLM client factory"               [skip if exists]
TaskCreate: "Add ToolingManifest.json"                              [skip if hasManifest]
TaskCreate: "Update .env / .env.example with A365 variables"
TaskCreate: "Validate build (npm run build)"
TaskCreate: "Add Observability"
TaskCreate: "Add WorkIQ Tools (optional)"
TaskCreate: "Register, publish, and deploy"
```

**.NET tasks (only create if not already present):**
```
TaskCreate: "Add Microsoft.Agents.A365.* NuGet packages"
TaskCreate: "Update Program.cs — A365 services + /api/messages + /api/health"  [skip if hasHosting]
TaskCreate: "Add Agent/MyAgent.cs — AgentApplication subclass"                  [skip if hasAgentApp]
TaskCreate: "Update appsettings.json with A365 auth and connection config"
TaskCreate: "Add ToolingManifest.json"                                           [skip if hasManifest]
TaskCreate: "Validate build (dotnet build)"
TaskCreate: "Add Observability"
TaskCreate: "Add WorkIQ Tools (optional)"
TaskCreate: "Register, publish, and deploy"
```

**Python tasks (only create if not already present):**
```
TaskCreate: "Add microsoft_agents_a365_* to pyproject.toml"
TaskCreate: "Add agent_interface.py"                                             [skip if exists]
TaskCreate: "Add host_agent_server.py — aiohttp server + A365 routing"          [skip if hasHosting]
TaskCreate: "Update agent.py — AgentInterface implementation"                   [skip if hasAgentApp]
TaskCreate: "Add ToolingManifest.json"                                           [skip if hasManifest]
TaskCreate: "Update .env / .env.template with A365 variables"
TaskCreate: "Validate setup (uv sync or pip install)"
TaskCreate: "Add Observability"
TaskCreate: "Add WorkIQ Tools (optional)"
TaskCreate: "Register, publish, and deploy"
```

---

## Phase 0C — Resolve State and Route

The 8-row state matrix below decides what runs vs skips vs short-circuits based on `(has_obs, has_workiq, has_setup)`. Compute the row, print the resolved plan to the user, and route accordingly.

| # | Obs | WorkIQ | Setup | What runs | Note |
|---|-----|--------|-------|-----------|------|
| 1 | F | F | F | obs → workiq? → setup | Full flow |
| 2 | T | F | F | ~~obs~~ → workiq? → setup | Skip obs, rest normal |
| 3 | F | T | F | obs → ~~workiq~~ → setup | Skip workiq, rest normal |
| 4 | T | T | F | ~~obs~~ → ~~workiq~~ → setup | Register only |
| 5 | F | F | T | obs → workiq? → ~~setup~~ | No re-register |
| 6 | T | F | T | ~~obs~~ → workiq? → ~~setup~~ | WorkIQ only (if wanted) |
| 7 | F | T | T | obs → ~~workiq~~ → ~~setup~~ | Observability only, no re-register |
| 8 | T | T | T | ~~obs~~ → ~~workiq~~ → ~~setup~~ | Confirmation only — sub-question below |

**Print the resolved state to the user**, verbatim, before any work runs:

```
Resolved state (row {N}): has_obs={T/F}, has_workiq={T/F}, has_setup={T/F}

Plan:
  • Observability:   {run | skip — already wired}
  • WorkIQ:          {ask user | skip — already wired | skip — guard (row 4/8)}
  • Setup (register): {run a365 setup all --aiteammate | skip — blueprint exists}
  • Run Target:      asked at Phase 9.7.2 (Prod vs Local). For Prod, a hosting
                     sub-question (Phase 9.7.2b) follows: dev tunnel or cloud
                     endpoint (Azure / AWS / Google Cloud). For Local, agent
                     runs at http://localhost:3978/api/messages and only
                     AgentsPlayground is launched — no Teams reachability.
```

**Row 8 sub-question — only if row 8 (T/T/T):**

```
Everything is already wired and registered:
  • Blueprint ID:  {existingBlueprintId}
  • Observability: present
  • WorkIQ:        present

What would you like to do?

  1. Re-publish — repackage manifest (a365 publish), re-upload zip, refresh Dev Portal
     config. Useful after code changes.
  2. Verify only — print the resolved state and exit. No CLI commands run.
```

- If **1 (Re-publish)**: skip Phases 1–9.6, jump to Phase 9.7.2 (Run Target). For Prod, run publish + Dev Portal + instance flow. For Local, jump to smoke test only.
- If **2 (Verify)**: print the final summary (Phase 10) and exit.

**Routing for rows 1–7:** continue with Phase 1 (Install Packages). The skip-gates in Phases 9.5 / 9.6 / 9.7.1 enforce the row-specific behavior.

---

## Phase 1 — Install Required Packages

**Mark task in progress.**

**Read** the language-appropriate reference file for the full package list, then install only missing packages:

- **NodeJS** — `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-ai-teammate.md` (see "Required Packages" for the `{agentStack}` variant, and "Dev dependencies")
- **.NET** — `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/dotnet-ai-teammate.md` (see "Required NuGet Packages")
- **Python** — `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/python-ai-teammate.md` (see "Required Dependencies")

**Mark task complete.**

---

## Phase 2 — Language Setup

**Mark task in progress.**

### NodeJS — Configure tsconfig.json

**Read** `tsconfig.json` if it exists. Check `"module": "node16"` and `"moduleResolution": "node16"` are both present.

If missing or wrong, **Edit** (or **Write** if not present) using the tsconfig template from `nodejs-ai-teammate.md`. Preserve existing `rootDir`/`outDir` — only update `module`/`moduleResolution`.

### .NET — Skip

No tsconfig equivalent needed. Proceed to Phase 4.

### Python — Skip

No tsconfig equivalent needed. Proceed to Phase 4.

**Mark task complete.**

---

## Phase 4 — Hosting Layer

**Mark task in progress.**

### NodeJS — Add src/index.ts

**Read** `src/index.ts` if it exists.

**If index.ts does NOT exist or has no CloudAdapter:**
**Write** `src/index.ts` using the pattern from `nodejs-ai-teammate.md`.

**If index.ts already has an HTTP server (Express or other):**
Migrate it to the CloudAdapter pattern:
1. Add `configDotenv()` as the very first line (before existing imports).
2. Replace or augment the existing server with `CloudAdapter`, `authorizeJWT`, and `loadAuthConfigFromEnv`.
3. Add `/api/health` endpoint BEFORE `authorizeJWT`.
4. Replace the existing message endpoint with `/api/messages` using `adapter.process()`.
5. Replace `server.listen('0.0.0.0', ...)` with the production/dev host detection pattern.
6. Preserve any existing routes or middleware the user has.

> **Non-destructive rule:** Never delete existing routes. Add the A365 routes alongside them.

### .NET — Update Program.cs

**Read** `Program.cs` if it exists.

**If Program.cs does NOT exist:**
**Write** `Program.cs` using the pattern from `dotnet-ai-teammate.md`.

**If Program.cs exists but is missing A365 services:**
**Edit** `Program.cs` to add:
1. `app.MapPost("/api/messages", ...)` using `adapter.ProcessAsync()`
2. `app.MapGet("/api/health", () => Results.Ok(...))` — health check endpoint, NO auth required

> **Non-destructive rule:** Preserve existing services and middleware. Add A365 registrations after existing ones.

### Python — Add host_agent_server.py

**Glob** `host_agent_server.py`. If it exists, check for `CloudAdapter` (or legacy `CloudAdapterAiohttp`), `/api/messages`, `/api/health`, and `on_agent_notification`.

If it does not exist, **Write** `host_agent_server.py` using the pattern from `python-ai-teammate.md`.
Also create `agent_interface.py` using the pattern from `python-ai-teammate.md` if it does not exist.

**Mark task complete.**

---

## Phase 5 — Agent Class

**Mark task in progress.**

### NodeJS — Add src/agent.ts

**Read** `src/agent.ts` if it exists. **Grep** `AgentApplication` in `src/**/*.ts`.

**If agent.ts does NOT exist:**
**Write** `src/agent.ts` using the full pattern from `nodejs-ai-teammate.md`.
- Replace `MyAgent` class name with a name derived from the project.
- Replace placeholder session description with what the agent does.

**If an AgentApplication subclass already exists:**
Check each handler and add only what is missing:
- `onAgentNotification('agents:*', ...)` with priority `1` and `[authHandlerName]`
- `onActivity(ActivityTypes.Message, ...)` with `[authHandlerName]`
- `onActivity(ActivityTypes.InstallationUpdate, ...)`
- `handleAgentNotificationActivity()` dispatching on `NotificationType.EmailNotification`
- `handleEmailNotification()` using `createEmailResponseActivity`
- `handleInstallationUpdateActivity()`
- Typing indicator loop (setInterval every 4000ms) in message handler

> **Critical import:** `import '@microsoft/agents-a365-notifications'` (side-effect form) must be present.
> Without it, notification routing silently breaks at runtime.

### .NET — Add Agent/MyAgent.cs

**Glob** `**/*.cs` and **Grep** for `AgentApplication`.

**If no AgentApplication subclass exists:**
Create `Agent/MyAgent.cs` using the full pattern from `dotnet-ai-teammate.md`.
- Rename `MyAgent` to match the project name (from `.csproj`).
- Register agent in `Program.cs`: `builder.AddAgent<MyAgent>();`

**If an AgentApplication subclass already exists:**
Check each registration and add only what is missing:
- `OnConversationUpdate(ConversationUpdateEvents.MembersAdded, WelcomeMessageAsync)`
- `OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync, isAgenticOnly: true, autoSignInHandlers: agenticHandlers)`
- `OnActivity(ActivityTypes.InstallationUpdate, OnInstallationUpdateAsync, isAgenticOnly: false)`
- `OnActivity(ActivityTypes.Message, OnMessageAsync, isAgenticOnly: true, autoSignInHandlers: agenticHandlers)`
- `OnActivity(ActivityTypes.Message, OnMessageAsync, isAgenticOnly: false, autoSignInHandlers: oboHandlers)`
- Typing indicator loop (4 second interval) in `OnMessageAsync`

> **Prompt injection guard:** `GetAgentInstructions()` must sanitize `Activity.From.Name`
> by stripping control characters (`[\p{Cc}\p{Cf}]`) and capping at 64 characters.

### Python — Update agent.py

**Read** `agent.py` if it exists.

**If agent.py does NOT implement `AgentInterface`:**
**Write** `agent.py` using the full pattern from `python-ai-teammate.md`.
- Preserve existing LLM client configuration (endpoint, deployment, API key env vars).
- Preserve existing system prompt if one exists.

**If agent.py already implements `AgentInterface`:**
Check and add only what is missing:
- `_sanitize_display_name()` before injecting into system prompt
- `handle_agent_notification_activity()` handling `NotificationType.EMAIL_NOTIFICATION`

**Mark task complete.**

---

## Phase 6 — LLM Client Factory (Node.js only)

**Mark task in progress: "Add src/client.ts — LLM client factory"**

### NodeJS — Add src/client.ts

This wraps the user's existing LLM code behind the `Client` interface called by `agent.ts`.

**6.1 Read existing LLM code**

**Read** all files in `existingFiles`. Identify:
- How the LLM model is instantiated (constructor, env vars used)
- How agents/chains are created and invoked
- Any existing system prompts

**6.2 If client.ts does NOT exist:**
**Write** `src/client.ts` using the `{agentStack}` variant from `nodejs-ai-teammate.md`.
- Preserve the user's existing model instantiation and env vars
- Preserve the user's existing system prompt if one exists

**6.3 If client.ts already exists:**
Check for each required element and add what is missing:
- `getClient()` factory returning a `Client` interface
- `Client` interface with `invoke(prompt: string): Promise<string>`

**6.4 Wire existing LLM invocation:**
The user's existing LLM invocation goes inside the `Client.invoke()` method. Show the user a diff summary.

### .NET — Skip

Agent calls `_chatClient` directly in `OnMessageAsync`. No changes needed.

### Python — Skip

Agent calls `self._agent.run()` directly in `process_user_message()`. No changes needed.

**Mark task complete.**

---

## Phase 7 — Add ToolingManifest.json

**Mark task in progress: "Add ToolingManifest.json"**

**Glob** `ToolingManifest.json`. If it does not exist, **Write** it pre-populated with the Calendar and Mail WorkIQ servers:

```json
{
  "mcpServers": [
    {
      "mcpServerName": "mcp_CalendarTools",
      "mcpServerUniqueName": "mcp_CalendarTools",
      "url": "https://agent365.svc.cloud.microsoft/agents/servers/mcp_CalendarTools",
      "scope": "Tools.ListInvoke.All",
      "audience": "910333d2-47e9-43ca-981f-6df2f4531ef4",
      "publisher": "Microsoft"
    },
    {
      "mcpServerName": "mcp_MailTools",
      "mcpServerUniqueName": "mcp_MailTools",
      "url": "https://agent365.svc.cloud.microsoft/agents/servers/mcp_MailTools",
      "scope": "Tools.ListInvoke.All",
      "audience": "16b1878d-62c7-4009-aa25-68989d63bbad",
      "publisher": "Microsoft"
    }
  ]
}
```

Tell the user:
> "ToolingManifest.json created with Calendar and Mail WorkIQ servers. To add more WorkIQ tools or wire them into agent code, run the `add-workiq-tools` skill."

If it already exists, leave it unchanged.

**Mark task complete.**

---

## Phase 8 — Update Environment Configuration

**Mark task in progress: "Update env config with A365 variables"**

### NodeJS — Update .env / .env.example

**Read** `.env.example` or `.env`. **Read** the `.env` template section from `nodejs-ai-teammate.md`.
Append only the missing variables (LLM vars + A365 connection vars + agentic auth vars).

### .NET — Update appsettings.json

**Read** `appsettings.json` if it exists. Add any missing sections using the pattern from `dotnet-ai-teammate.md`:
- `AgentApplication` section with `AgenticAuthHandlerName` and `UserAuthorization.Handlers.agentic`
- `TokenValidation` section with `Audiences`
- `Connections.ServiceConnection` section
- `ConnectionsMap` array
- `AIServices.AzureOpenAI` section (with placeholder values `""`)

Do NOT overwrite existing values — only add missing keys.

### Python — Update .env / .env.template

**Read** `.env.template` or `.env`. **Read** the `.env template` section from `python-ai-teammate.md`.
Append only the missing variables.

**Mark task complete.**

---

## Phase 9 — Validate Build

**Mark task in progress: "Validate build"**

### NodeJS
```bash
npm install
npm run build || npx tsc --noEmit
```
Fix errors:
- Module resolution errors → check `"module": "node16"` AND `"moduleResolution": "node16"` in tsconfig
- Import path errors → add `.js` extension in imports for `node16` module resolution
- `Cannot find module` → add the missing package

### .NET
```bash
dotnet restore
dotnet build
```
Fix errors:
- `namespace not found` → check the package is installed and using directive is present
- `IChatClient` not found → ensure `Microsoft.Extensions.AI.OpenAI` is installed (AgentFramework)
- `Kernel` / `IChatCompletionService` not found → ensure `Microsoft.SemanticKernel` is installed (Semantic Kernel)
- `IAgentHttpAdapter` not found → ensure `Microsoft.Agents.Hosting.AspNetCore` is installed

### Python
```bash
uv sync
# or: pip3 install -e . 2>/dev/null || pip install -e .
python3 -c "import host_agent_server; import agent; print('imports OK')" 2>/dev/null || python -c "import host_agent_server; import agent; print('imports OK')"
```
Fix errors:
- `ModuleNotFoundError` for `microsoft_agents_a365_*` → run `uv add <package>` or `pip install <package>`
- `requires-python` mismatch → ensure Python 3.11+ is active

Do NOT revert changes on build failure — fix forward.

**Mark task complete.**

---

## Phase 9.5 — Add Observability

**Mark task in progress: "Add Observability"**

**Skip-gate (from Phase 0C `has_obs`):**

- **If `has_obs = true`** (rows 2, 4, 6, 8): tell the user verbatim *"Observability already wired — skipping. Run `/agent365:instrument-observability` to reconfigure."* and mark the task complete. Do NOT invoke the sub-skill.
- **If `has_obs = false`** (rows 1, 3, 5, 7): **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/SKILL.md` and follow it now. Observability is part of the AI Teammate package — do not ask whether to add it.

**Mark task complete: "Add Observability"**

---

## Phase 9.6 — Offer WorkIQ Tools (optional)

**Mark task in progress: "Add WorkIQ Tools (optional)"**

**Skip-gate (from Phase 0C `has_workiq`):**

- **If `has_workiq = true`** (rows 3, 4, 7, 8): tell the user verbatim *"WorkIQ tools already wired (ToolingManifest has non-empty servers list) — skipping. Run `/agent365:add-workiq-tools` to add more or reconfigure."* and mark the task complete. Do NOT ask, do NOT invoke the sub-skill.
- **If `has_workiq = false`** (rows 1, 2, 5, 6): ask the user:

  > "Would you like to add WorkIQ MCP tools now? WorkIQ lets your AI Teammate use Calendar, Mail, and other M365 tools via MCP servers."
  >
  > - **Yes** → **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/SKILL.md` and follow it in full.
  > - **Skip** → inform the user they can run `/agent365:add-workiq-tools` later.

**Mark task complete: "Add WorkIQ Tools (optional)"**

---

## Phase 9.7 — Register, Publish, and Deploy

**Mark task in progress: "Register, publish, and deploy"**

This is the full registration + publish + Teams Developer Portal + instance-request
pipeline — about 370 lines of step-by-step guidance. It lives in its own reference
file because the steps are largely language-agnostic and would dominate the SKILL.md
otherwise.

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/deploy-pipeline.md`
and follow it in full. The step numbering matches Phase 9.7 (9.7.1 through 9.7.7)
so this skill's stop-hook prompt, the eval expectations, and the README all keep
pointing at the same places. Inside the deploy pipeline you'll go through:

- **9.7.1** — `a365 setup all --aiteammate` (skip-gated when `has_setup = true`),
  with the CEA / `--m365` auto-decision based on `usesTeamsOrCopilot`.
- **9.7.2 / 9.7.2a / 9.7.2b / 9.7.2c / 9.7.2d** — choose Run Target (prod vs local),
  collect the production hosting sub-question (dev tunnel vs cloud), reconcile
  `chosenEndpoint` against the blueprint's `messagingEndpoint`, and validate the
  environment-config table (per-language `.env` / `appsettings.json` keys plus
  cloud-platform env-var checks).
- **9.7.3 → 9.7.6** — manifest verify (read-only — CLI owns the file),
  `a365 publish` to produce `manifest.zip`, manual upload at M365 Admin Center,
  Teams Developer Portal config (Agent Type = API Based, Notification URL =
  `messagingEndpoint`), and the agent-instance request + admin approval.
  Skipped entirely when `runTarget = "local"`.
- **9.7.7** — smoke test (Teams for prod, AgentsPlayground for local).

When you return from the reference, mark the task complete and continue to
Phase 10.

**Mark task complete: "Register, publish, and deploy"**

---

## Phase 10 — Final Summary and Next Steps

**TaskList** — show all completed tasks, then build a **state-aware summary**. Adapt each bullet to whether the step ran, was skipped because already wired, or was skipped because of `runTarget = "local"`:

```
✅ AI Teammate flow complete!

Resolved state at entry: has_obs={T/F}, has_workiq={T/F}, has_setup={T/F}
Run Target: {prod | local}{runTarget = "prod" ? " — hosting: " + runTargetHosting + " (" + chosenEndpoint + ")" : ""}

Your agent now has:
  • Hosting layer         (/api/health + /api/messages)
  • Agent routing         (message, notification, InstallationUpdate handlers)
  • Email notifications + install/uninstall lifecycle
  • ToolingManifest.json  (pre-populated: Calendar + Mail WorkIQ servers)
  • Blueprint              {has_setup-at-entry
                              ? "reused (Blueprint ID: " + existingBlueprintId + ")"
                              : "registered (a365 setup all --aiteammate" + (--m365 ? ", --m365" : "") + ")"}
  • Observability          {has_obs-at-entry
                              ? "already wired — skipped"
                              : "OpenTelemetry + A365 tracing exporter wired"}
  • WorkIQ tools           {has_workiq-at-entry
                              ? "already wired — skipped"
                              : (user picked yes
                                   ? "M365 data access via MCP wired"
                                   : "offered, user skipped — run /agent365:add-workiq-tools later")}

{If runTarget = "prod":}
  • Hosting               {runTargetHosting = "devtunnel"
                              ? "Dev tunnel — " + chosenEndpoint
                              : "Cloud (Azure / AWS / GCP) — " + chosenEndpoint}
  • Manifest packaged     (a365 publish → manifest.zip; uploaded manually to M365 Admin Center)
  • Dev Portal configured (Agent Type=API Based, Notification URL={chosenEndpoint})
  • Instance requested    (request from Teams Apps; admin approves at admin.cloud.microsoft/#/agents/all/requested)

{If runTarget = "local":}
  • Run mode: Local       Agent runs at http://localhost:3978/api/messages.
                          (publish, Dev Portal config, MAC upload, instance request all SKIPPED)
                          When you're ready for production, re-run /agent365:make-ai-teammate
                          and choose Prod at Step 9.7.2 (then dev tunnel or cloud at 9.7.2b).

Useful commands:
  cat a365.generated.config.json            — show Blueprint ID, App ID, and agent details
  a365 cleanup instance                     — remove Agentic User if re-provisioning is needed
  devtunnel host <name> --port 3978         — restart dev tunnel for local testing

Next steps:
  1. {runTarget = "local"
       ? "Run the test-local skill for guided AgentsPlayground testing — your agent isn't deployed yet."
       : "Wait for tenant admin to approve the instance request at admin.cloud.microsoft, then test in Teams."}
  2. Re-run this skill any time — it's idempotent and detects what's already wired.
```

**Row 8 Verify-only sub-case:** if the Phase 0C sub-question resolved to "Verify only", skip the deployment bullets entirely and show just the resolved state + a confirmation line:

```
✅ Everything is already wired. Nothing to do.

  • has_obs:       true (Observability is wired)
  • has_workiq:    true (WorkIQ is wired)
  • has_setup:     true (Blueprint ID: {existingBlueprintId})

If you want to push a code change, re-run /agent365:make-ai-teammate and pick "Re-publish" at the row 8 sub-question.
```

---

## Error Handling

**CLI error surfacing:** When any CLI command (`a365`, `az`, `dotnet build`, `npm`, etc.) exits non-zero or prints a warning or error line, **show the complete output verbatim** in a fenced code block before suggesting a fix. Do not abstract, paraphrase, or discard CLI output — the exact error message is always more useful than a summary. If the error is not in the table below, display it and ask the user how to proceed.

| Situation | Language | Action |
|-----------|----------|--------|
| Detection cache missing or stale | Any | Run `a365-setup` first |
| `agentStack` not in cache | Any | Ask the user; default to AgentFramework patterns |
| Existing `index.ts` has complex custom middleware | NodeJS | Preserve it; add A365 routes alongside existing ones |
| `client.ts` uses unrecognized framework | NodeJS | Stub `Client.invoke()`; tell user what to fill in |
| Build fails with `module` errors | NodeJS | Ensure both `"module": "node16"` AND `"moduleResolution": "node16"` in tsconfig |
| `AgentApplication` import not found | NodeJS | Check `@microsoft/agents-hosting` is installed |
| `IAgentHttpAdapter` not found | .NET | Ensure `Microsoft.Agents.Hosting.AspNetCore` is referenced |
| `IChatClient` not found | .NET (AgentFramework) | Ensure `Microsoft.Extensions.AI.OpenAI` is installed |
| `Kernel` / `IChatCompletionService` not found | .NET (Semantic Kernel) | Ensure `Microsoft.SemanticKernel` NuGet package is installed |
| `Microsoft.Agents.A365.*` not found | .NET | check NuGet source includes prerelease feeds |
| `ModuleNotFoundError` for `microsoft_agents_a365_*` | Python | Run `uv add <package>` |
| `requires-python` version mismatch | Python | Ensure Python 3.11+ is active in the virtual environment |

---

## Idempotency

On re-runs, read the detection cache (Phase 0A) and skip phases where patterns are already present.
Never overwrite a file that already has the required pattern — only add what is missing.

---

## References

**Node.js patterns:**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-ai-teammate.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-notifications.md`

**.NET patterns:**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/dotnet-ai-teammate.md`

**Python patterns:**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/python-ai-teammate.md`

**Deploy pipeline (Phase 9.7 — language-agnostic):**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/deploy-pipeline.md`

**Shared:**
- `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
