---
name: make-ai-teammate
description: >
  Transforms a non-M365 agent (Node.js LangChain/OpenAI/Claude, .NET AgentFramework, or Python
  AgentFramework) into a Microsoft Agent 365 AI Teammate. Adds the hosting layer
  (Express/CloudAdapter for Node.js, ASP.NET Core for .NET, aiohttp for Python), AgentApplication
  class with message routing and typing indicators, email notifications, and all required packages
  and env vars. Wraps existing LLM code — does not replace it.
  Requires a365-setup to have been run first.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: language/framework override (langchain | openai | claude | dotnet | python)"
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
        4. ToolingManifest.json exists (even if empty mcpServers array).
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

        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
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
> **Supported languages:** Node.js (LangChain, OpenAI Agents SDK, Claude SDK) · .NET AgentFramework · Python AgentFramework

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

*NodeJS:* **Glob** `src/**/*.ts` and **Grep** for LLM instantiation (`ChatOpenAI`, `AzureChatOpenAI`, `OpenAI`, `Anthropic`), chain/agent creation, or existing HTTP server.

*DotNet:* **Glob** `**/*.cs` and **Grep** for `AddAgent<`, `AgentApplication`, `IChatClient`, or `WebApplication.CreateBuilder`. Store `Program.cs` and agent `.cs` files.

*Python:* **Glob** `**/*.py` and **Grep** for `ChatAgent`, `AzureOpenAIChatClient`, `CloudAdapterAiohttp`, or `AgentInterface`.

Store the main source file(s) as `existingFiles`.

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
> "This skill supports LangChain/OpenAI/Claude (Node.js), AgentFramework (Node.js/.NET/Python),
> and SemanticKernel (.NET). For other frameworks, I'll add the hosting layer and agent class,
> but you'll need to integrate your LLM calls manually."

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
```

**.NET tasks (only create if not already present):**
```
TaskCreate: "Add Microsoft.Agents.A365.* NuGet packages"
TaskCreate: "Update Program.cs — A365 services + /api/messages + /api/health"  [skip if hasHosting]
TaskCreate: "Add Agent/MyAgent.cs — AgentApplication subclass"                  [skip if hasAgentApp]
TaskCreate: "Update appsettings.json with A365 auth and connection config"
TaskCreate: "Add ToolingManifest.json"                                           [skip if hasManifest]
TaskCreate: "Validate build (dotnet build)"
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

**Glob** `ToolingManifest.json`. If it does not exist, **Write** an empty manifest:

```json
{
  "mcpServers": []
}
```

Tell the user:
> "ToolingManifest.json created. To add WorkIQ tools (Mail, Calendar, Teams, etc.), run the `add-workiq-tools` skill."

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
- `IChatClient` not found → ensure `Microsoft.Extensions.AI.OpenAI` is installed
- `IAgentHttpAdapter` not found → ensure `Microsoft.Agents.Hosting.AspNetCore` is installed

### Python
```bash
uv sync
# or: pip install -e .
python -c "import host_agent_server; import agent; print('imports OK')"
```
Fix errors:
- `ModuleNotFoundError` for `microsoft_agents_a365_*` → run `uv add <package>` or `pip install <package>`
- `requires-python` mismatch → ensure Python 3.11+ is active

Do NOT revert changes on build failure — fix forward.

**Mark task complete.**

---

## Phase 10 — Final Summary and Next Steps

**TaskList** — show all completed tasks, then tell the user:

```
✅ AI Teammate code is ready!

Your agent now has:
  • Hosting layer       (/api/health + /api/messages)
  • Agent routing       (message, notification, InstallationUpdate handlers)
  • Email notifications + install/uninstall lifecycle
  • ToolingManifest.json (empty — add WorkIQ tools with add-workiq-tools skill)

Suggested next steps:
  1. Test locally:       run the test-local skill
  2. Add WorkIQ tools:   run the add-workiq-tools skill
  3. Add observability:  run the instrument-observability skill
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
| `IChatClient` not found | .NET | Ensure `Microsoft.Extensions.AI.OpenAI` is installed |
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
