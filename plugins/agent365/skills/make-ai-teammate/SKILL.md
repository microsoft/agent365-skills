---
name: make-ai-teammate
description: >
  Transforms a non-M365 agent (Node.js LangChain/OpenAI/Claude, .NET AgentFramework, or Python
  AgentFramework) into a Microsoft Agent 365 AI Teammate hosting skeleton. Adds the hosting layer
  (Express/CloudAdapter for Node.js, ASP.NET Core for .NET, aiohttp for Python), AgentApplication
  class with message routing and typing indicators, token cache, email notifications, and all
  required packages and env vars. Observability is added by the instrument-observability skill;
  WorkIQ MCP tools (and ToolingManifest.json) are added by the add-workiq-tools skill.
  Wraps existing LLM code — does not replace it.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: language/framework override (langchain | openai | claude | dotnet | python)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-make-ai-teammate.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify based on the detected language:

        Node.js:
        1. src/index.ts has Express + CloudAdapter + /api/health + /api/messages pattern.
        2. src/agent.ts has AgentApplication subclass with message, notification, InstallationUpdate handlers.
        3. src/client.ts exists with getClient() factory wrapping the existing LLM invocation.
        4. src/token-cache.ts exists with createAgenticTokenCacheKey, tokenResolver, and default export.
        5. .env / .env.example has all required A365 variables.
        6. tsconfig.json has module: "node16" and moduleResolution: "node16".
        7. All required @microsoft/agents-* packages are in package.json.
        8. Build succeeds (npm run build or tsc --noEmit).

        .NET:
        1. Program.cs has AddAgent<T>, /api/messages, /api/health.
        2. Agent class (MyAgent.cs or equivalent) extends AgentApplication with message, InstallationUpdate handlers.
        3. .csproj has Microsoft.Agents.A365.Notifications, Microsoft.Agents.Authentication.Msal, Microsoft.Agents.Hosting.AspNetCore.
        4. appsettings.json has AgentApplication, TokenValidation, Connections sections.
        5. Build succeeds (dotnet build).

        Python:
        1. host_agent_server.py has CloudAdapterAiohttp, /api/messages, /api/health, on_notification.
        2. agent.py implements AgentInterface with process_user_message and handle_agent_notification_activity.
        3. token_cache.py exists with cache_agentic_token and get_cached_agentic_token.
        4. agent_interface.py exists with AgentInterface ABC.
        5. pyproject.toml has microsoft_agents_a365_notifications, microsoft_agents_a365_runtime, and hosting dependencies.
        6. .env / .env.template has all required A365 variables.

        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 45000
---

# Make AI Teammate

> **Trigger phrases** — any of these will activate this skill:
> - "make this agent an ai teammate"
> - "transform agent to ai teammate"
> - "add ai teammate hosting"
> - "wire up m365 hosting"
> - "add agent365 hosting layer"
> - "convert agent to teams agent"
> - "add cloudadapter to this agent"
> - "make this agent work with teams"

> **What this skill does:** It wraps your existing LLM logic with the full Microsoft Agent 365
> AI Teammate layer — hosting, routing, observability, notifications, and WorkIQ tools. Your
> existing LLM code (models, prompts, tools, business logic) is preserved and integrated into
> the new structure. Nothing is deleted.
>
> **Supported languages:** Node.js (LangChain, OpenAI Agents SDK, Claude SDK) · .NET AgentFramework · Python AgentFramework

---

## Phase 0A — Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.json` if it exists.
If `detectedAt` is within the last 60 minutes, load cached values and skip to Phase 0B.

Run all detection steps **in parallel**:

**Step 1: Detect Programming Language** → Store as `language`
- `package.json` exists (and no `.csproj`, no `pyproject.toml`) → `NodeJS`
- `*.csproj` file exists → `DotNet`
- `pyproject.toml` exists → `Python`
- Multiple markers found → prefer the most specific (`.csproj` > `pyproject.toml` > `package.json`)
- None found → ask the user

**Step 2: Detect LLM Framework** → Store as `agentStack`

*NodeJS:*
- `package.json` contains `@langchain` or `langchain` → `LangChain`
- `package.json` contains `@openai/agents` → `OpenAI`
- `package.json` contains `@anthropic-ai/sdk` → `Claude`
- None found → ask the user

*DotNet:*
- `*.csproj` contains `Microsoft.Agents.AI` or `Microsoft.Extensions.AI` → `AgentFramework`
- `*.csproj` contains `Microsoft.SemanticKernel` → `SemanticKernel`
- Default → `AgentFramework`

*Python:*
- `pyproject.toml` contains `agent-framework-azure-ai` → `AgentFramework`
- `pyproject.toml` contains `openai` → `OpenAI`
- `pyproject.toml` contains `anthropic` → `Claude`
- Default → `AgentFramework`

**Step 3: Find existing LLM entry point**

*NodeJS:* **Glob** `src/**/*.ts` and **Grep** for LLM instantiation (`ChatOpenAI`, `AzureChatOpenAI`, `OpenAI`, `Anthropic`), chain/agent creation, or existing HTTP server.

*DotNet:* **Glob** `**/*.cs` and **Grep** for `AddAgent<`, `AgentApplication`, `IChatClient`, or `WebApplication.CreateBuilder`. Store `Program.cs` and agent `.cs` files.

*Python:* **Glob** `**/*.py` and **Grep** for `ChatAgent`, `AzureOpenAIChatClient`, `CloudAdapterAiohttp`, or `AgentInterface`.

Store the main source file(s) as `existingFiles`.

**Step 4: Check what's already present**

*NodeJS — Grep in parallel:*
- `AgentApplication` in `src/**/*.ts` → `hasAgentApp`
- `CloudAdapter` in `src/**/*.ts` → `hasHosting`
- `onAgentNotification` in `src/**/*.ts` → `hasNotifications`
- `getClient` in `src/**/*.ts` → `hasClientFactory`

*DotNet — Grep in parallel:*
- `AgentApplication` in `**/*.cs` → `hasAgentApp`
- `adapter.ProcessAsync` or `IAgentHttpAdapter` in `**/*.cs` → `hasHosting`
- `OnConversationUpdate` or `InstallationUpdate` in `**/*.cs` → `hasNotifications`

*Python — Grep in parallel:*
- `AgentInterface` or `AgentFrameworkAgent` in `**/*.py` → `hasAgentApp`
- `CloudAdapterAiohttp` in `**/*.py` → `hasHosting`
- `on_agent_notification` in `**/*.py` → `hasNotifications`

---

## Phase 0B — User Validation

Present all detections in one message:

```
Here's what we detected:
  • Language:           {language}
  • LLM Framework:      {agentStack ?? "not detected"}
  • Existing LLM code:  {existingFiles.join(', ') || "not found"}

Already present:
  • Hosting layer:      {hasHosting ? "✅" : "❌"}
  • Agent class:        {hasAgentApp ? "✅" : "❌"}
  • Client factory:     {hasClientFactory ? "✅" : "❌"}
  • Notifications:      {hasNotifications ? "✅" : "❌"}

Reply **yes** to confirm, or describe corrections (e.g. "it's Python not .NET").
```

After confirmation, write `.a365-workspace-detection.json`.

If `agentStack` is still unknown, ask:
> "Which LLM framework does this agent use?"

If `agentStack` is unrecognized, tell the user:
> "This skill supports LangChain/OpenAI/Claude (Node.js), AgentFramework (Node.js/.NET/Python),
> and SemanticKernel (.NET). For other frameworks, I'll add the hosting layer and agent class,
> but you'll need to integrate your LLM calls manually."

---

## Phase 0C — Create Task List

**NodeJS tasks (only create if not already present):**
```
TaskCreate: "Install required @microsoft/agents-* npm packages"
TaskCreate: "Configure tsconfig.json for node16 module resolution"  [skip if already correct]
TaskCreate: "Add src/token-cache.ts"                               [skip if exists]
TaskCreate: "Add src/index.ts — Express + CloudAdapter hosting"    [skip if hasHosting]
TaskCreate: "Add src/agent.ts — AgentApplication class"            [skip if hasAgentApp]
TaskCreate: "Add src/client.ts — client factory"                   [skip if hasClientFactory]
TaskCreate: "Update .env / .env.example with A365 variables"
TaskCreate: "Validate build (npm run build)"
```

**.NET tasks (only create if not already present):**
```
TaskCreate: "Add Microsoft.Agents.A365.Notifications and hosting NuGet packages"
TaskCreate: "Update Program.cs — AddAgent<T> + /api/messages + /api/health" [skip if hasHosting]
TaskCreate: "Add Agent/MyAgent.cs — AgentApplication subclass"               [skip if hasAgentApp]
TaskCreate: "Update appsettings.json with A365 auth and connection config"
TaskCreate: "Validate build (dotnet build)"
```

**Python tasks (only create if not already present):**
```
TaskCreate: "Add microsoft_agents_a365_notifications and hosting deps to pyproject.toml"
TaskCreate: "Add token_cache.py"                                    [skip if exists]
TaskCreate: "Add agent_interface.py"                                [skip if exists]
TaskCreate: "Add host_agent_server.py — aiohttp server + A365 routing" [skip if hasHosting]
TaskCreate: "Update agent.py — AgentInterface implementation with notifications" [skip if hasAgentApp]
TaskCreate: "Update .env / .env.template with A365 variables"
TaskCreate: "Validate setup (uv sync or pip install)"
```

Always include install, env update, and build/sync tasks — they are safe to re-run. Always include the registration, optional capabilities, and testing tasks below — add them for every language:

```
TaskCreate: "Register agent with Agent 365 (a365 setup all)"
TaskCreate: "Create agent instance (a365 create-instance)"
TaskCreate: "Offer additional capabilities (WorkIQ tools / Observability)"
TaskCreate: "Test agent locally with AgentsPlayground"
```

---

## Phase 1 — Install Required Packages

**Mark task in progress.**

### NodeJS

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-ai-teammate.md`
for the package list for `{agentStack}`.

**Grep** `package.json` for `@microsoft/agents-hosting`. Install only missing packages:

```bash
npm install @microsoft/agents-hosting @microsoft/agents-a365-notifications
```

Also install dev dependencies if missing: `typescript`, `ts-node`, `@types/express`, `@types/node`.

### .NET

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/dotnet-ai-teammate.md`
for the full package list.

**Read** the `.csproj` file. Add only missing packages:

```bash
dotnet add package Microsoft.Agents.A365.Notifications --prerelease
dotnet add package Microsoft.Agents.AI --prerelease
dotnet add package Microsoft.Agents.Authentication.Msal
dotnet add package Microsoft.Agents.Hosting.AspNetCore
dotnet add package Microsoft.Extensions.AI.OpenAI --prerelease
dotnet add package Azure.AI.OpenAI --prerelease
dotnet add package Azure.Identity
```

### Python

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/python-ai-teammate.md`
for the full dependency list.

**Read** `pyproject.toml`. Add only missing `microsoft_agents_a365_*` dependencies, then sync:

```bash
uv add microsoft_agents_a365_notifications microsoft_agents_a365_runtime \
  microsoft-agents-hosting-aiohttp microsoft-agents-hosting-core \
  microsoft-agents-authentication-msal python-dotenv aiohttp azure-identity
uv sync
# or: pip install -e .
```

**Mark task complete.**

---

## Phase 2 — Language Setup

**Mark task in progress.**

### NodeJS — Configure tsconfig.json

**Read** `tsconfig.json` if it exists. Check `"module": "node16"` and `"moduleResolution": "node16"` are both present.

If missing or wrong, **Edit** (or **Write** if not present) `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",
    "moduleResolution": "node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```
Do NOT change `rootDir`/`outDir` if the user has customized them — only update `module`/`moduleResolution`.

### .NET — Skip

No tsconfig equivalent needed. Proceed to Phase 3.

### Python — Skip

No tsconfig equivalent needed. Proceed to Phase 3.

**Mark task complete.**

---

## Phase 3 — Token Cache

**Mark task in progress.**

### NodeJS — Add src/token-cache.ts

**Glob** `src/token-cache.ts`. If it exists, **Read** it and check for `createAgenticTokenCacheKey`,
`tokenResolver`, and the default export. Add anything missing.

If it does not exist, **Write** `src/token-cache.ts` using the pattern from `nodejs-ai-teammate.md`.

### .NET — Skip

Token cache is handled by `IExporterTokenCache<AgenticTokenStruct>` injected by the A365 SDK. No file to create.

### Python — Add token_cache.py

**Glob** `token_cache.py`. If it exists, check for `cache_agentic_token` and `get_cached_agentic_token`.

If it does not exist, **Write** `token_cache.py` using the exact pattern from `python-ai-teammate.md`.

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
1. `builder.AddAgent<MyAgent>()` — register agent class
2. `app.MapPost("/api/messages", ...)` using `adapter.ProcessAsync()`
3. `app.MapGet("/api/health", () => Results.Ok(...))` — health check endpoint, NO auth required

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
- `preloadObservabilityToken()`
- `handleAgentNotificationActivity()` dispatching on `NotificationType.EmailNotification`
- `handleEmailNotification()` using `createEmailResponseActivity`
- `handleInstallationUpdateActivity()`
- Typing indicator loop (setInterval every 4000ms) in message handler

> **Critical import:** `import '@microsoft/agents-a365-notifications'` (side-effect form) must be present.
> Without it, notification routing silently breaks at runtime.

> **Inbound vs. proactive notifications:** The handlers above cover *inbound* traffic —
> messages from users, email notifications arriving at the agent, and install/uninstall lifecycle events.
> For *proactive* (agent-initiated) messaging, the agent must store the `ConversationReference`
> from the `members_added` or `InstallationUpdate add` event, then later call
> `adapter.processProactiveActivity(reference, callback)` to send without a user trigger.
> Read `references/nodejs-notifications.md` for the inbound patterns; proactive outbound messaging
> follows the standard Microsoft Agents SDK proactive activity pattern.

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
- `GetClientAgent()` wrapping the existing LLM invocation

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
- `token_resolver()` method using `get_cached_agentic_token()`

**Mark task complete.**

---

## Phase 6 — Client Factory (LLM Integration Scaffold)

**Mark task in progress: "Add src/client.ts — client factory"**

This step wraps the user's existing LLM code in the A365-compatible factory pattern.
Observability (`ObservabilityManager`, `InferenceScope`) is added later by `instrument-observability`.
WorkIQ tooling (`McpToolRegistrationService`) is wired later by `add-workiq-tools`.

**6.1 Read existing LLM code**

**Read** all files in `existingFiles`. Identify:
- How the LLM model is instantiated (constructor, env vars used)
- How agents/chains are created
- How the LLM is invoked (method name, input/output format)
- Any existing tools or system prompts

### NodeJS — Add src/client.ts

**6.2 If client.ts does NOT exist:**
**Write** `src/client.ts` using the `{agentStack}` variant from `nodejs-ai-teammate.md`.
- Preserve the user's existing model instantiation and env vars
- Preserve the user's existing system prompt if one exists
- Preserve any existing tools or LangGraph configurations
- Expose a `getClient()` factory function for use by the agent class

**6.3 If client.ts already exists:**
Check for each required element and add what is missing:
- `getClient()` factory function returning the LLM client/agent for `{agentStack}`
- Token cache key handling via `createAgenticTokenCacheKey`

### .NET — Verify IChatClient wiring

Verify in `Program.cs`:
- `IChatClient` is registered (e.g., via `builder.Services.AddChatClient(...)`)
- `builder.AddAgent<MyAgent>()` is present

Verify in `MyAgent.cs`:
- Existing LLM invocation is preserved inside `GetClientAgent()`
- Prompt injection guard (`GetAgentInstructions()`) strips control characters from `Activity.From.Name`

### Python — Verify process_user_message wiring

Verify in `agent.py`:
- `process_user_message()` calls the existing LLM invocation (e.g., `self._agent.run(message)`)
- `token_resolver()` is implemented using `get_cached_agentic_token()`
- Existing system prompt and model configuration are preserved

**Mark task complete.**

---

## Phase 7 — Update Environment Configuration

**Mark task in progress: "Update env config with A365 variables"**

### NodeJS — Update .env / .env.example

**Read** `.env.example` or `.env`. Append only the missing variables:

```dotenv
ENABLE_A365_OBSERVABILITY_EXPORTER=false
Use_Custom_Resolver=false
A365_OBSERVABILITY_LOG_LEVEL=
SERVICE_NAME=my-agent
BEARER_TOKEN=
NODE_ENV=development
PORT=3978
agentic_type=agentic
agentic_altBlueprintConnectionName=service_connection
agentic_scopes=ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default
connections__service_connection__settings__clientId=
connections__service_connection__settings__clientSecret=
connections__service_connection__settings__tenantId=
connectionsMap__0__serviceUrl=*
connectionsMap__0__connection=service_connection
```

Also add the LLM framework env vars if not already present.

### .NET — Update appsettings.json

**Read** `appsettings.json` if it exists. Add any missing sections using the pattern
from `dotnet-ai-teammate.md`:

- `AgentApplication` section with `AgenticAuthHandlerName` and `UserAuthorization.Handlers.agentic`
- `TokenValidation` section with `Audiences`
- `Connections.ServiceConnection` section
- `ConnectionsMap` array
- `AIServices.AzureOpenAI` section (with placeholder values `""`)

Do NOT overwrite existing values — only add missing keys.

### Python — Update .env / .env.template

**Read** `.env.template` or `.env`. Append only the missing variables from `python-ai-teammate.md`:

```dotenv
AUTH_HANDLER_NAME=
BEARER_TOKEN=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-05-01-preview
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=
CONNECTIONSMAP_0_SERVICEURL=*
CONNECTIONSMAP_0_CONNECTION=SERVICE_CONNECTION
USE_AGENTIC_AUTH=true
OBSERVABILITY_SERVICE_NAME=my-agent
OBSERVABILITY_SERVICE_NAMESPACE=agents
ENABLE_OBSERVABILITY=true
ENABLE_A365_OBSERVABILITY_EXPORTER=false
PORT=3978
PYTHON_ENVIRONMENT=development
```

**Mark task complete.**

---

## Phase 8 — Validate Build

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

> **Build passed — proceed immediately to Phase 9.**

---

## Phase 9 — Configure and Register with Agent 365

**Mark task in progress: "Configure a365.config.json and run a365 setup all"**

The code is ready. Now configure and register the agent as an AI Teammate.

**Step 1 — Verify a365 CLI is available.**

```bash
a365 --version 2>/dev/null || echo "a365 CLI not found"
```

If not found, read `${CLAUDE_PLUGIN_ROOT}/skills/a365-setup/SKILL.md` Step 1 to install it, then return here.

If the command prompts for Azure login, run `az login` first.

**Step 2 — Get tenant ID from Azure.**

```bash
az account show --query "{tenantId:tenantId}" -o json
az ad signed-in-user show --query userPrincipalName -o tsv
```

Extract `{tenantId}` and `{loggedInUser}` for use in the config file.

**Step 3 — Collect agent identity inputs.**

Ask in a single message:

```
The agent code is ready. Please provide two values:

  1. Agent Name — short, unique identifier for your tenant (e.g. "contoso-hr-agent")
     Rules: lowercase letters, numbers, hyphens only. Start with a letter. 3–20 chars.
     This derives the Blueprint name, Agentic User UPN, and identity display name.

  2. Manager Email — M365 account that will own the Blueprint (e.g. {loggedInUser})
```

Wait for both values. Store as `agentBaseName` and `managerEmail`.

**Step 4 — Determine messaging endpoint.**

Ask: **"How is your agent hosted? (devtunnel / custom)"**

- **devtunnel**: Creates a secure tunnel to your local machine. Good for development.
- **custom**: User provides their HTTPS URL (Azure App Service, Container Apps, AWS, GCP, etc.)

**If devtunnel:** set up the tunnel:

```bash
devtunnel --version 2>/dev/null || echo "devtunnel not found"
```

If not installed:
```bash
# Windows
winget install Microsoft.devtunnel
# macOS / Linux
curl -sL https://aka.ms/DevTunnelCliInstall | bash
```

Authenticate (first time only):
```bash
devtunnel user login        # interactive
# or for headless:
devtunnel user login --device-code
```

Start tunnel:
```bash
devtunnel host -p 3978 --allow-anonymous
```

The CLI outputs a URL like `https://abc123-3978.devtunnels.ms`. Set:
```
messagingEndpoint = https://<tunnel-subdomain>.devtunnels.ms/api/messages
```
> Keep this terminal running — the tunnel is active as long as the process is alive.

**If custom:** ask for the full HTTPS URL including `/api/messages`.

**Step 5 — Derive naming values and confirm with user.**

Using `agentBaseName` and domain extracted from `managerEmail`:

| Field | Pattern | Example (`contoso-hr-agent` / `contoso.onmicrosoft.com`) |
|-------|---------|----------------------------------------------------------|
| `agentIdentityDisplayName` | `{baseName} Identity` | `contoso-hr-agent Identity` |
| `agentBlueprintDisplayName` | `{baseName} Blueprint` | `contoso-hr-agent Blueprint` |
| `agentUserPrincipalName` | `UPN.{baseName}@{domain}` | `UPN.contoso-hr-agent@contoso.onmicrosoft.com` |
| `agentUserDisplayName` | `{baseName} Agent User` | `contoso-hr-agent Agent User` |
| `agentDescription` | `{baseName} - Agent 365 Agent` | `contoso-hr-agent - Agent 365 Agent` |

Present the derived values and ask:
> "Would you like to update any of these, or proceed with the defaults? (update/proceed)"

**Step 6 — Create or update a365.config.json.**

**Glob** `a365.config.json`. If it does not exist, **Write**:

```json
{
  "tenantId": "{tenantId}",
  "environment": "prod",
  "messagingEndpoint": "{messagingEndpoint}",
  "agentIdentityDisplayName": "{agentIdentityDisplayName}",
  "agentBlueprintDisplayName": "{agentBlueprintDisplayName}",
  "agentUserPrincipalName": "{agentUserPrincipalName}",
  "agentUserDisplayName": "{agentUserDisplayName}",
  "managerEmail": "{managerEmail}",
  "agentUserUsageLocation": "US",
  "agentDescription": "{agentDescription}"
}
```

If it already exists, **Read** it and **Edit** only the keys that are missing or empty.

> Do NOT include `subscriptionId`, `resourceGroup`, `location`, or `webAppName` — the CLI no longer manages Azure hosting.

**Step 7 — Import config into the a365 CLI.**

```bash
a365 config init -c ./a365.config.json
```

If the command returns "already initialized", the existing config is used — no action needed.
If validation fails (app not found, missing permissions), fix `a365.config.json` and re-run.

**Step 8 — Preview changes with a dry-run.**

```bash
a365 setup all --dry-run
```

Show the full dry-run output to the user and confirm:
> "Here's what `a365 setup all` will create: Blueprint, Agentic User (UPN), Entra ID permissions, and messaging endpoint registration. Does this look correct? Type `yes` to proceed or `no` to abort."

Wait for the user's confirmation before continuing.

**Step 9 — Run a365 setup all.**

```bash
a365 setup all
```

This command:
- Creates the Blueprint in your Agent 365 tenant and provisions the Agentic User (UPN)
- Grants the required Entra ID permissions
- Registers the messaging endpoint from `a365.config.json`

After it completes, show the user:
1. The **Setup Summary** table from CLI output — verbatim.
2. If the CLI printed an **admin consent action item (Permission Grants)**: show both options (Entra portal + PowerShell script) verbatim and tell the user:
   > "If admin consent is required, have a Global Admin run the PowerShell script above."
3. Skip the client secret action item entirely.

`a365 setup all` is idempotent — safe to re-run after fixing an issue.

**Mark task complete.**

---

## Phase 10 — Review Manifest, Publish, and Register in Teams

**Mark task in progress: "Review manifest, publish agent, register in Teams Dev Portal"**

With the Blueprint registered, complete the deployment: review the manifest, publish to M365 Admin Center, register in Teams Dev Portal, and create the agent instance.

**Step 1 — Review and update manifest/manifest.json (required before publishing).**

**Glob** `manifest/manifest.json`. If it exists, **Read** it and verify these fields are filled in (not placeholder values):

| Field | What to update |
|-------|----------------|
| `name.short` (max 30 chars) | Agent display name in Teams |
| `name.full` (max 100 chars) | Descriptive full name |
| `description.short` (max 80 chars) | One-line summary of what the agent does |
| `description.full` (max 4000 chars) | What it does, data accessed, how to interact |
| `developer.name` | Your organization name |
| `developer.websiteUrl` | Org website URL |
| `developer.privacyUrl` | Privacy policy URL (required for production) |
| `developer.termsOfUseUrl` | Terms of use URL (required for production) |
| `icons.color` | Ensure `color.png` (192×192) exists in the manifest folder |
| `icons.outline` | Ensure `outline.png` (32×32) exists in the manifest folder |
| `version` | Semantic version, e.g. `"1.0.0"` |

Example of a complete manifest:
```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/vdevPreview/MicrosoftTeams.schema.json",
  "id": "<auto-generated-by-cli>",
  "name": { "short": "Contoso HR Bot", "full": "Contoso Human Resources Assistant" },
  "description": {
    "short": "Get answers to HR questions and submit time-off requests.",
    "full": "The Contoso HR Assistant helps with HR tasks. Ask about policies, check PTO balance, and submit requests."
  },
  "icons": { "outline": "outline.png", "color": "color.png" },
  "accentColor": "#0078D4",
  "version": "1.0.0",
  "manifestVersion": "devPreview",
  "developer": {
    "name": "Contoso Ltd",
    "websiteUrl": "https://www.contoso.com",
    "privacyUrl": "https://www.contoso.com/privacy",
    "termsOfUseUrl": "https://www.contoso.com/terms"
  },
  "agenticUserTemplates": [{ "id": "<auto-generated>", "file": "agenticUserTemplateManifest.json" }]
}
```
> The `id` and `agenticUserTemplates[].id` fields are auto-populated by the CLI — do not set them manually.

Ask the user: **"Have you updated the manifest with your agent's name, description, and developer information? (yes/no)"**

Wait for **yes** before publishing.

**Step 2 — Publish the agent manifest.**

```bash
a365 publish
```

This updates manifest identifiers and publishes the agent package to the tenant's M365 Admin Center catalog. If the CLI cannot reach the admin center, verify the account has `Application.ReadWrite.All` and that connectivity is good.

Tell the user:
> "Agent published to M365 Admin Center. A tenant admin may need to approve it before it appears in Teams."

**Step 3 — Configure agent in Teams Developer Portal (manual steps).**

Tell the user these manual browser steps are required:

> "Open the Teams Developer Portal to finish configuration:
>
> 1. Get your Blueprint ID:
>    ```bash
>    a365 config display -g --field agentBlueprintId
>    ```
>
> 2. Navigate to:
>    ```
>    https://dev.teams.microsoft.com/tools/agent-blueprint/<your-blueprint-id>/configuration
>    ```
>
> 3. In the Developer Portal:
>    - Set **Agent Type** to `API Based`
>    - Set **Notification URL** to your messaging endpoint:
>      ```bash
>      a365 config display -g --field messagingEndpoint
>      ```
>    - Click **Save**"

**Step 4 — Create agent instance (manual, via Teams).**

Tell the user:
> "To create an instance:
>
> 1. Open **Teams > Apps** and search for your agent name.
> 2. Select your agent and click **Request Instance** (or **Create Instance**).
> 3. Teams sends the request to your tenant admin for approval.
>
> Admins approve from the [Microsoft admin center — Requested Agents](https://admin.cloud.microsoft/#/agents/all/requested).
> After approval, the agent instance is created and available.
>
> Note: Agent user creation is asynchronous — it can take minutes to hours to become searchable in Teams.
>
> The user needs to be part of the [Frontier preview program](https://adoption.microsoft.com/copilot/frontier-program/)
> to create agent instances while Agent 365 is in preview."

**Step 5 — Verify deployment.**

Once the agent is running at the messaging endpoint, guide the user to test:
1. Health check: `curl http://localhost:3978/api/health` (if running locally)
2. Search for the new agent user in Teams
3. Start a new chat and send a test message (e.g., "Hello!")
4. Check application logs in the hosting provider's dashboard

View the agent in the [Microsoft 365 admin center — Agents](https://admin.cloud.microsoft/#/agents/all).

**Mark task complete.**

---

## Phase 11 — Add Observability (Strongly Recommended)

Ask the user:

```
Your agent is registered and ready. Observability lets you track every message, LLM call,
and tool invocation in the Agent 365 portal and Microsoft Defender — highly recommended
before going to production.

  Would you like to add observability now?
    • yes — I'll run the instrument-observability skill now
    • no  — skip for now (you can add it later by running the instrument-observability skill)
```

**If yes:** invoke the `instrument-observability` skill inline:
1. **Read** the agent entry point (`src/index.ts`, `Program.cs`, or `host_agent_server.py`).
2. Add `ObservabilityManager` / `AddAgenticTracingExporter` / `configure_observability` following the patterns in `instrument-observability/references/`.
3. Add `BaggageBuilder` context propagation and `InferenceScope` wrapping to the message handler.

**If no:** proceed to Phase 12.

---

## Phase 12 — Add WorkIQ Tools (Optional)

Ask the user:

```
Would you like to add WorkIQ tools? These give your agent access to Microsoft 365 data —
email, calendar, Teams messages, SharePoint files, OneDrive, and more.

Note: WorkIQ MCP calls use OAuth On-Behalf-Of (OBO) tokens. Users will be prompted to
consent the first time the agent accesses their data.

  • yes — I'll run the add-workiq-tools skill now
  • no  — skip for now (you can add it later by running the add-workiq-tools skill)
```

**If yes:** invoke the `add-workiq-tools` skill inline:
1. Run `a365 develop list-available` to show available MCP server catalog.
2. Ask which servers to add.
3. Run `a365 develop add-mcp-servers "<selected>"` — this creates `ToolingManifest.json` and adds the selected servers.
4. Wire `McpToolRegistrationService` in the agent code following the `add-workiq-tools` patterns.
5. Tell the user what permissions the Global Administrator must grant via `a365 setup permissions mcp`.

**If no:** proceed to Phase 13.

---

## Phase 13 — Offer Local Testing

Ask the user in a single message:

```
Ready to test. Would you like to test this agent locally with AgentsPlayground now?

  • yes — I'll start the agent and open AgentsPlayground pointed at your local endpoint
  • no  — I'll show you the final summary and you can test when ready
```

**If yes:** invoke the `test-local` skill inline:
- Check `agentsplayground` CLI is installed (`agentsplayground --version`).
  If missing, tell the user: `dotnet tool install -g Microsoft.Agents.AgentsPlayground --prerelease`
- Start the agent in the background on port 3978 (use the correct start command for the language).
- Run `agentsplayground --endpoint http://localhost:3978/api/messages`.

**If no:** proceed directly to Phase 14.

---

## Phase 14 — Final Summary

**TaskList** — show all completed tasks.

### NodeJS summary:
```
✅ AI Teammate fully set up and registered!

Your agent now has:
  • Hosting layer:     Express + CloudAdapter + JWT auth (/api/health, /api/messages)
  • Agent routing:     AgentApplication with message, notification, lifecycle handlers
  • Client factory:    getClient() wrapping your existing LLM invocation
  • Notifications:     Email notification handling + install/uninstall lifecycle
  • Token cache:       src/token-cache.ts with createAgenticTokenCacheKey / tokenResolver
  • A365 registered:   Blueprint created, permissions granted, messaging endpoint set
  • Instance created:  Agent instance ready in the Agent 365 portal

Next steps:
  1. Health check:         curl http://localhost:3978/api/health
  2. Add WorkIQ tools:     run the add-workiq-tools skill
  3. Add observability:    run the instrument-observability skill
```

### .NET summary:
```
✅ AI Teammate fully set up and registered!

Your agent now has:
  • Hosting layer:     ASP.NET Core + IAgentHttpAdapter + /api/health + /api/messages
  • Agent class:       AgentApplication subclass with message, InstallationUpdate handlers
  • Client agent:      GetClientAgent() wrapping your existing IChatClient invocation
  • Auth:              AgenticAuthHandlerName (production) + OboAuthHandlerName (Playground)
  • A365 registered:   Blueprint created, permissions granted, messaging endpoint set
  • Instance created:  Agent instance ready in the Agent 365 portal

Next steps:
  1. Set appsettings.json ClientId, BOT_ID, BOT_TENANT_ID placeholders
  2. Health check:         curl http://localhost:3978/api/health
  3. Add WorkIQ tools:     run the add-workiq-tools skill
  4. Add observability:    run the instrument-observability skill
```

### Python summary:
```
✅ AI Teammate fully set up and registered!

Your agent now has:
  • Hosting layer:     aiohttp server + CloudAdapterAiohttp + /api/health + /api/messages
  • Agent class:       AgentInterface implementation with notification handling
  • Token cache:       token_cache.py with cache_agentic_token / get_cached_agentic_token
  • A365 registered:   Blueprint created, permissions granted, messaging endpoint set
  • Instance created:  Agent instance ready in the Agent 365 portal

Next steps:
  1. Fill .env with Azure OpenAI credentials and connection settings
  2. Health check:         curl http://localhost:3978/api/health
  3. Add WorkIQ tools:     run the add-workiq-tools skill
  4. Add observability:    run the instrument-observability skill
```

---

## Error Handling

| Situation | Language | Action |
|-----------|----------|--------|
| `agentStack` not detected | Any | Ask the user; default to AgentFramework patterns |
| Existing `index.ts` has complex custom middleware | NodeJS | Preserve it; add A365 routes alongside existing ones |
| `client.ts` uses unrecognized framework (e.g., LlamaIndex) | NodeJS | Add hosting + agent layers; stub `getClient()`; tell user what to fill in |
| Build fails with `module` errors | NodeJS | Ensure both `"module": "node16"` AND `"moduleResolution": "node16"` in tsconfig |
| `AgentApplication` import not found | NodeJS | Check `@microsoft/agents-hosting` is installed |
| `IAgentHttpAdapter` not found | .NET | Ensure `Microsoft.Agents.Hosting.AspNetCore` is referenced |
| `IChatClient` not found | .NET | Ensure `Microsoft.Extensions.AI.OpenAI` is installed |
| `Microsoft.Agents.A365.*` not found after dotnet add | .NET | Add `--prerelease` flag; check NuGet source includes prerelease feeds |
| `ModuleNotFoundError` for `microsoft_agents_a365_*` | Python | Run `uv add <package>` or ensure PyPI prerelease index is configured |
| `requires-python` version mismatch | Python | Ensure Python 3.11+ is active in the virtual environment |

---

## Idempotency

On re-runs, detect what is already present (Phase 0A checks) and skip completed phases.
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
- **Blueprint registration:** handled inline in Phase 9 (`a365 setup all`) and Phase 10 (`a365 publish` + Teams Dev Portal).
  Run the standalone `a365-setup` skill only if you need to re-register or change the endpoint.
