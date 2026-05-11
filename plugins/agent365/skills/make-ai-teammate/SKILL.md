---
name: make-ai-teammate
version: 1.6.0
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
        Before ending, verify based on the detected language:

        Node.js:
        1. src/index.ts has Express + CloudAdapter + /api/health + /api/messages pattern.
        2. src/agent.ts has AgentApplication subclass with message, notification, InstallationUpdate handlers.
        3. src/client.ts has getClient() factory wrapping the user's LLM code.
        4. ToolingManifest.json exists with Calendar and Mail MCP servers pre-populated.
        5. .env / .env.example has all required A365 variables.
        6. tsconfig.json has module: "node16" and moduleResolution: "node16".
        7. All required @microsoft/agents-* packages are in package.json.
        8. Build succeeds (npm run build or tsc --noEmit).

        .NET:
        1. Program.cs has AddAgent<T>, /api/messages, /api/health.
        2. Agent class (MyAgent.cs or equivalent) extends AgentApplication with message, InstallationUpdate handlers.
        3. .csproj has Microsoft.Agents.A365.Notifications.
        4. ToolingManifest.json exists.
        5. appsettings.json has AgentApplication, TokenValidation, Connections sections.
        6. Build succeeds (dotnet build).

        Python:
        1. host_agent_server.py has CloudAdapterAiohttp, /api/messages, /api/health, on_notification.
        2. agent.py implements AgentInterface with process_user_message and handle_agent_notification_activity.
        3. agent_interface.py exists with AgentInterface ABC.
        4. pyproject.toml has all microsoft_agents_a365_* dependencies.
        5. ToolingManifest.json exists.
        6. .env / .env.template has all required A365 variables.

        Phase 9.7 (Register, Publish, Teams Dev Portal):
        7. a365 setup all --aiteammate (with or without --m365) completed without fatal errors.
        8. Blueprint ID was read from a365.generated.config.json after setup all completed.
        9. manifest.json was reviewed and updated (or user confirmed Teams Toolkit manages it).
        10. a365 publish ran (or sideload fallback was offered if auth failed).
        11. Teams Developer Portal bot endpoint was confirmed.
        12. Agentic User UPN was confirmed from a365.generated.config.json or setup output.
        13. Smoke test was completed (Teams or AgentsPlayground).

        Also verify for all languages:
        - instrument-observability was offered and either invoked or explicitly skipped by user.
        - add-workiq-tools was offered and either invoked or explicitly skipped by user.

        If any item failed or was incomplete, return {"ok": false, "reason": "<specific item>"}.
        If all items completed (or were explicitly skipped by the user), return {"ok": true}.
      timeout: 45000
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

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

*Python:* **Glob** `**/*.py` and **Grep** for `ChatAgent`, `AzureOpenAIChatClient`, `CloudAdapterAiohttp`, or `AgentInterface`.

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

*DotNet:*
- `AgentApplication` in `**/*.cs` → `hasAgentApp`
- `adapter.ProcessAsync` or `IAgentHttpAdapter` in `**/*.cs` → `hasHosting`
- `OnConversationUpdate` or `InstallationUpdate` in `**/*.cs` → `hasNotifications`
- `ToolingManifest.json` exists → `hasManifest`

*Python:*
- `AgentInterface` in `**/*.py` → `hasAgentApp`
- `CloudAdapterAiohttp` in `**/*.py` → `hasHosting`
- `on_agent_notification` in `**/*.py` → `hasNotifications`
- `ToolingManifest.json` exists → `hasManifest`

---

## Phase 0B — Confirm and Create Task List

Present all detections in one message:

```
Language: {language}  |  Framework: {agentStack}  |  Existing code: {existingFiles.join(', ')}

Already present:
  • Hosting layer:   {hasHosting ? "✅" : "❌"}
  • Agent class:     {hasAgentApp ? "✅" : "❌"}
  • Notifications:   {hasNotifications ? "✅" : "❌"}

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
TaskCreate: "Add Observability (optional)"
TaskCreate: "Add WorkIQ Tools (optional)"
TaskCreate: "Register, publish, deploy, and configure in Teams Dev Portal"
```

**.NET tasks (only create if not already present):**
```
TaskCreate: "Add Microsoft.Agents.A365.* NuGet packages"
TaskCreate: "Update Program.cs — A365 services + /api/messages + /api/health"  [skip if hasHosting]
TaskCreate: "Add Agent/MyAgent.cs — AgentApplication subclass"                  [skip if hasAgentApp]
TaskCreate: "Update appsettings.json with A365 auth and connection config"
TaskCreate: "Add ToolingManifest.json"                                           [skip if hasManifest]
TaskCreate: "Validate build (dotnet build)"
TaskCreate: "Add Observability (optional)"
TaskCreate: "Add WorkIQ Tools (optional)"
TaskCreate: "Register, publish, deploy, and configure in Teams Dev Portal"
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
TaskCreate: "Add Observability (optional)"
TaskCreate: "Add WorkIQ Tools (optional)"
TaskCreate: "Register, publish, deploy, and configure in Teams Dev Portal"
```

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

**Glob** `host_agent_server.py`. If it exists, check for `CloudAdapterAiohttp`, `/api/messages`, `/api/health`, and `on_agent_notification`.

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

## Phase 9.5 — Offer Observability (Optional)

**Mark task in progress: "Add Observability (optional)"**

Ask the user:

```
Your AI Teammate code is ready. Observability lets you track every message, LLM call,
and tool invocation in the Agent 365 portal and Microsoft Defender.

  Would you like to add observability now?
    • yes  — I'll run the instrument-observability skill now
    • skip — you can add it later by running the instrument-observability skill
```

**If yes:** **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/SKILL.md` and follow it.

**If skip:** Note that the user can run the `instrument-observability` skill at any time.

**Mark task complete: "Add Observability (optional)"**

---

## Phase 9.6 — Offer WorkIQ Tools (Optional)

**Mark task in progress: "Add WorkIQ Tools (optional)"**

Ask the user:

```
Would you like to add WorkIQ tools? These give your agent access to Microsoft 365 data —
email, calendar, Teams messages, SharePoint files, OneDrive, and more.

Note: WorkIQ MCP calls use OAuth On-Behalf-Of (OBO) tokens. Users will be prompted to
consent the first time the agent accesses their data.

  • yes  — I'll run the add-workiq-tools skill now
  • skip — you can add it later by running the add-workiq-tools skill
```

**If yes:** **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/SKILL.md` and follow it.

**If skip:** Note that the user can run the `add-workiq-tools` skill at any time.

**Mark task complete: "Add WorkIQ Tools (optional)"**

---

## Phase 9.7 — Register, Publish, Deploy, and Configure in Teams Dev Portal

**Mark task in progress: "Register, publish, deploy, and configure in Teams Dev Portal"**

This phase runs the full AI Teammate registration and publishing pipeline:
`a365 setup all` → manifest update → `a365 publish` → Teams Dev Portal → Agentic User confirmation → smoke test.

---

### Step 9.7.1 — Register the Blueprint (`a365 setup all`)

Ask the user for the **agent name** (reuse from session context if available, otherwise ask). Then show a dry-run first:

```bash
# Dry-run preview (required before applying)
a365 setup all --agent-name <name> --aiteammate --dry-run
```

Show the full dry-run output and ask:
> "Here's what `a365 setup all` will create. Does this look correct? Type **yes** to proceed or **no** to abort."

**If yes**, ask: "Will this agent be accessible directly from Microsoft Teams or Microsoft Copilot (M365-integrated)?" Store as `isM365 = true/false`. Then apply:

```bash
# Standard AI Teammate (no Teams/Copilot catalog integration)
a365 setup all --agent-name <name> --aiteammate

# M365-registered AI Teammate (Teams / Microsoft Copilot integration)
a365 setup all --agent-name <name> --aiteammate --m365
```

**Windows Account Manager (WAM):** If `"Authenticating via Windows Account Manager..."` appears, a native Windows sign-in dialog appeared. Do NOT kill the process — tell the user: "Please complete the sign-in dialog — setup will continue automatically." If no dialog appears on a headless machine: `Ctrl+C`, run `az login --allow-no-subscriptions`, retry. If blocked by Conditional Access Policy (AADSTS53003), the CLI automatically falls back to device code flow.

After completion:
- Show the **Setup Summary table** verbatim from CLI output.
- Extract and store `blueprintId` from `a365.generated.config.json`:

```bash
node -e "const c=require('./a365.generated.config.json'); console.log('Blueprint ID:', c.agentBlueprintId)"
```

**Global Administrator consent** — if the CLI output includes a "Permission Grants" action item:
> "A Global Administrator must grant consent via the Entra portal:  
> [Entra portal](https://entra.microsoft.com) > App registrations > Blueprint app > API permissions > Grant admin consent.  
> Alternatively, copy and run the PowerShell script shown in the CLI output above."

---

### Step 9.7.2 — Update `manifest.json`

**Glob** for `manifest.json` or `appPackage/manifest.json`.

If found, **read** it and check/update these fields using values from `a365.generated.config.json`:

| Field | Value |
|-------|-------|
| `version` | bump minor (e.g. `1.0.0` → `1.0.1`) |
| `id` | Teams App ID (`teamsAppId` from `a365.generated.config.json`) |
| `bots[0].botId` | Agentic App ID (`agentAppId` from `a365.generated.config.json`) |
| `validDomains` | add the messaging endpoint domain (e.g. `myagent.azurewebsites.net`) |
| `webApplicationInfo.id` | same as `bots[0].botId` |

Do NOT overwrite existing values that are already correct.

If `manifest.json` does **not** exist:
> "No `manifest.json` found. If you're using Teams Toolkit it manages this file automatically. To create one, run `a365 manifest init --agent-name <name>` then return here."

Stop until the user confirms whether to continue.

---

### Step 9.7.3 — Publish (`a365 publish`)

```bash
a365 publish
```

Packages the manifest into `manifest.zip` and uploads the agent to the Teams App Catalog. The CLI prints upload instructions for Microsoft 365 Admin Center (Agents > All agents > Upload custom agent) if direct upload is not possible.

| Output | Action |
|--------|--------|
| `"Published successfully"` / `"Upload complete"` | Proceed to next step |
| `"Manifest validation failed"` | Fix `manifest.json` (common: missing `bots[0].botId`, wrong `validDomains`) then retry |
| `"Authorization denied"` | Account needs **Teams Administrator** role. Offer sideload fallback below |

**Sideload fallback** (if publish authorization fails — installs for current user only):
```bash
a365 manifest package   # produces a .zip app package
```
> "Upload the `.zip` manually: Teams → Apps → Manage your apps → Upload an app → Upload a custom app. Org-wide publish requires a Teams Administrator."

---

### Step 9.7.4 — Configure in Teams Developer Portal

Open **https://dev.teams.microsoft.com** and guide the user:

1. **Sign in** with the same M365 account used during setup.
2. Go to **Apps** → find the app by name or search by App ID (`teamsAppId` from `a365.generated.config.json`).
3. **Basic information** — confirm `App ID` matches `teamsAppId` in `a365.generated.config.json`.
4. **App features → Bot**:
   - Confirm **Bot ID** matches `agentAppId` from `a365.generated.config.json`.
   - Confirm **Messaging endpoint** is set to the live `/api/messages` URL.
   - If the endpoint is wrong or missing — update it and click **Save**.
5. **Permissions** — confirm delegated permissions include `User.Read` (and any WorkIQ scopes if WorkIQ was added).
6. Click **Publish → Publish to your org** (or **Test and distribute** → **Download** for sideload).

> "Once the bot endpoint is confirmed in Developer Portal, your agent is ready to receive messages in Teams."

---

### Step 9.7.5 — Confirm Agentic User

The **Agentic User** (the agent's M365 identity with a UPN) is provisioned automatically by `a365 setup all --aiteammate`. Confirm it was created:

1. Read `a365.generated.config.json` — look for `agentUpn` (e.g. `my-agent@contoso.onmicrosoft.com`).
2. If `agentUpn` is present, show the user:

```
✅ Agentic User provisioned!
  UPN:          <agentUpn>
  Blueprint ID: <agentBlueprintId>
  App ID:       <agentAppId>
```

3. If `agentUpn` is absent from the generated config, check the `a365 setup all` output for UPN details. If GA consent was not yet granted, the Agentic User creation may be pending — instruct the user to complete the GA consent step (Step 9.7.1) and re-run `a365 setup all --aiteammate`.

> To remove an existing Agentic User if needed: `a365 cleanup instance`

---

### Step 9.7.6 — Smoke Test

Guide the user through a quick end-to-end test:

**Option A — Microsoft Teams** (if `--m365` was used):
1. Teams → **Chat** → search for the agent by UPN or display name.
2. Send: `"Hello"` — the agent should respond within a few seconds.
3. Watch terminal/logs for activity handler invocations.

**Option B — AgentsPlayground** (any configuration):
```bash
agentsplayground
```
Connect to `http://localhost:3978/api/messages` (or the dev tunnel URL) and send a test message.

**Terminal log signals to watch for:**
- Node.js: `[A365] Activity received: message`
- .NET: `ActivityHandler: OnMessageActivityAsync called`
- Python: `process_user_message called`
- If observability was added: OTel span lines with `a365.span`

**Troubleshooting:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No response in Teams | Bot endpoint not registered | Re-check Step 9.7.5 — verify messaging endpoint in Dev Portal |
| `401 Unauthorized` in logs | App ID / secret mismatch | Confirm `MICROSOFT_APP_ID` and `MICROSOFT_APP_PASSWORD` in `.env` match the registered app |
| `Connection refused` on tunnel | Tunnel not running | `devtunnel host <name> --port 3978` |
| `404` on `/api/messages` | Agent not started | `npm start` / `dotnet run` / `python host_agent_server.py` |

**Mark task complete: "Register, publish, deploy, and configure in Teams Dev Portal"**

---

## Phase 10 — Final Summary and Next Steps

**TaskList** — show all completed tasks, then tell the user:

```
✅ AI Teammate is live!

Your agent now has:
  • Hosting layer         (/api/health + /api/messages)
  • Agent routing         (message, notification, InstallationUpdate handlers)
  • Email notifications + install/uninstall lifecycle
  • ToolingManifest.json  (pre-populated: Calendar + Mail WorkIQ servers)
  • Blueprint registered  (a365 setup all --aiteammate)
  • Published to Teams    (a365 publish)
  • Agent instance        (Agentic User UPN: <agentUpn>)
  [• Observability:        OpenTelemetry + A365 tracing exporter wired]  (if added)
  [• WorkIQ tools:         M365 data access via MCP]                     (if added)

Useful commands:
  cat a365.generated.config.json            — show Blueprint ID, App ID, and agent details
  a365 cleanup instance                     — remove Agentic User if re-provisioning is needed
  devtunnel host <name> --port 3978         — restart dev tunnel for local testing

Next steps:
  1. If admin consent is still pending: have a Global Admin grant consent via Entra portal
     (App registrations > Blueprint app > API permissions > Grant admin consent)
     or run the PowerShell script from the setup output
  2. Run the test-local skill for guided local testing with AgentsPlayground
  3. Add observability:  run the instrument-observability skill  (if not done)
  4. Add WorkIQ tools:   run the add-workiq-tools skill          (if not done)
```

---

## Error Handling

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
| `Microsoft.Agents.A365.*` not found | .NET | Add `--prerelease` flag; check NuGet source includes prerelease feeds |
| `ModuleNotFoundError` for `microsoft_agents_a365_*` | Python | Run `uv add <package> --prerelease` |
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

**Shared:**
- `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
