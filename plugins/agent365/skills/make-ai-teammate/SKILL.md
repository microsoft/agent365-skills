---
name: make-ai-teammate
description: >
  Transforms a non-M365 agent (Node.js LangChain/OpenAI/Claude, .NET AgentFramework, or Python
  AgentFramework) into a fully-featured Microsoft Agent 365 AI Teammate. Adds the hosting layer
  (Express/CloudAdapter for Node.js, ASP.NET Core for .NET, aiohttp for Python), AgentApplication
  class with message routing and typing indicators, token cache, A365 observability, email
  notifications, WorkIQ MCP tools, and all required packages and env vars.
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
        3. src/client.ts has ObservabilityManager.configure().start() and McpToolRegistrationService.
        4. src/token-cache.ts exists with createAgenticTokenCacheKey, tokenResolver, and default export.
        5. ToolingManifest.json exists (even if empty mcpServers array).
        6. .env / .env.example has all required A365 variables.
        7. tsconfig.json has module: "node16" and moduleResolution: "node16".
        8. All required @microsoft/agents-* packages are in package.json.
        9. Build succeeds (npm run build or tsc --noEmit).

        .NET:
        1. Program.cs has AddAgenticTracingExporter, AddA365Tracing, AddAgent<T>, /api/messages, /api/health.
        2. Agent class (MyAgent.cs or equivalent) extends AgentApplication with message, InstallationUpdate handlers.
        3. .csproj has Microsoft.Agents.A365.Notifications, Microsoft.Agents.A365.Tooling.Extensions.AgentFramework, Microsoft.Agents.A365.Observability.Extensions.AgentFramework.
        4. ToolingManifest.json exists.
        5. appsettings.json has AgentApplication, TokenValidation, Connections sections.
        6. Build succeeds (dotnet build).

        Python:
        1. host_agent_server.py has CloudAdapterAiohttp, /api/messages, /api/health, on_notification.
        2. agent.py implements AgentInterface with process_user_message, setup_mcp_servers.
        3. token_cache.py exists with cache_agentic_token and get_cached_agentic_token.
        4. agent_interface.py exists with AgentInterface ABC.
        5. pyproject.toml has all microsoft_agents_a365_* dependencies.
        6. ToolingManifest.json exists.
        7. .env / .env.template has all required A365 variables.

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
- `ObservabilityManager` in `src/**/*.ts` → `hasObservability`
- `onAgentNotification` in `src/**/*.ts` → `hasNotifications`
- `McpToolRegistrationService` in `src/**/*.ts` → `hasWorkIQ`
- `ToolingManifest.json` exists → `hasManifest`

*DotNet — Grep in parallel:*
- `AgentApplication` in `**/*.cs` → `hasAgentApp`
- `adapter.ProcessAsync` or `IAgentHttpAdapter` in `**/*.cs` → `hasHosting`
- `AddAgenticTracingExporter` in `**/*.cs` → `hasObservability`
- `OnConversationUpdate` or `InstallationUpdate` in `**/*.cs` → `hasNotifications`
- `IMcpToolRegistrationService` in `**/*.cs` → `hasWorkIQ`
- `ToolingManifest.json` exists → `hasManifest`

*Python — Grep in parallel:*
- `AgentInterface` or `AgentFrameworkAgent` in `**/*.py` → `hasAgentApp`
- `CloudAdapterAiohttp` in `**/*.py` → `hasHosting`
- `configure_observability` or `microsoft_agents_a365_observability` in `**/*.py` → `hasObservability`
- `on_agent_notification` in `**/*.py` → `hasNotifications`
- `McpToolRegistrationService` in `**/*.py` → `hasWorkIQ`
- `ToolingManifest.json` exists → `hasManifest`

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
  • Observability:      {hasObservability ? "✅" : "❌"}
  • Notifications:      {hasNotifications ? "✅" : "❌"}
  • WorkIQ tools:       {hasWorkIQ ? "✅" : "❌"}

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
TaskCreate: "Add src/client.ts — client factory with observability" [skip if hasObservability]
TaskCreate: "Add ToolingManifest.json"                             [skip if hasManifest]
TaskCreate: "Update .env / .env.example with A365 variables"
TaskCreate: "Validate build (npm run build)"
```

**.NET tasks (only create if not already present):**
```
TaskCreate: "Add Microsoft.Agents.A365.* NuGet packages"
TaskCreate: "Update Program.cs — A365 services + /api/messages + /api/health" [skip if hasHosting]
TaskCreate: "Add Agent/MyAgent.cs — AgentApplication subclass"                 [skip if hasAgentApp]
TaskCreate: "Update appsettings.json with A365 auth and connection config"
TaskCreate: "Add ToolingManifest.json"                                          [skip if hasManifest]
TaskCreate: "Validate build (dotnet build)"
```

**Python tasks (only create if not already present):**
```
TaskCreate: "Add microsoft_agents_a365_* to pyproject.toml"
TaskCreate: "Add token_cache.py"                                    [skip if exists]
TaskCreate: "Add agent_interface.py"                                [skip if exists]
TaskCreate: "Add host_agent_server.py — aiohttp server + A365 routing" [skip if hasHosting]
TaskCreate: "Update agent.py — AgentInterface implementation with MCP and notifications" [skip if hasAgentApp]
TaskCreate: "Add ToolingManifest.json"                             [skip if hasManifest]
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
npm install @microsoft/agents-hosting @microsoft/agents-a365-observability \
  @microsoft/agents-a365-observability-hosting @microsoft/agents-a365-notifications \
  @microsoft/agents-a365-tooling-extensions-langchain  # (or -openai / -claude)
```

Also install dev dependencies if missing: `typescript`, `ts-node`, `@types/express`, `@types/node`.

### .NET

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/dotnet-ai-teammate.md`
for the full package list.

**Read** the `.csproj` file. Add only missing packages:

```bash
dotnet add package Microsoft.Agents.A365.Notifications --prerelease
dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease
dotnet add package Microsoft.Agents.A365.Observability.Extensions.AgentFramework --prerelease
dotnet add package Microsoft.Agents.AI --prerelease
dotnet add package Microsoft.Agents.Authentication.Msal
dotnet add package Microsoft.Agents.Hosting.AspNetCore
dotnet add package Microsoft.Extensions.AI.OpenAI --prerelease
dotnet add package Azure.AI.OpenAI --prerelease
dotnet add package Azure.Identity
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
dotnet add package OpenTelemetry.Instrumentation.Runtime
```

### Python

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/python-ai-teammate.md`
for the full dependency list.

**Read** `pyproject.toml`. Add only missing `microsoft_agents_a365_*` dependencies, then sync:

```bash
uv add microsoft_agents_a365_tooling microsoft_agents_a365_tooling_extensions_agentframework \
  microsoft_agents_a365_observability_core microsoft_agents_a365_observability_extensions_agent_framework \
  microsoft_agents_a365_runtime microsoft_agents_a365_notifications \
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
1. `builder.Services.AddAgenticTracingExporter(clusterCategory: "production")` — A365 exporter
2. `builder.AddA365Tracing(config => config.WithAgentFramework())` — tracing provider
3. `builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>()` — WorkIQ tooling
4. `builder.Services.AddSingleton<IMcpToolServerConfigurationService, McpToolServerConfigurationService>()` — manifest reader
5. `app.MapPost("/api/messages", ...)` using `adapter.ProcessAsync()`
6. `app.MapGet("/api/health", () => Results.Ok(...))` — health check endpoint, NO auth required

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
- `GetClientAgent()` calling `toolService.GetMcpToolsAsync()`

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
- `setup_mcp_servers()` calling `McpToolRegistrationService().add_tool_servers_to_agent()`
- `handle_agent_notification_activity()` handling `NotificationType.EMAIL_NOTIFICATION`
- `token_resolver()` method using `get_cached_agentic_token()`

**Mark task complete.**

---

## Phase 6 — Client Factory / Observability Integration

**Mark task in progress: "Add client factory with observability"**

### NodeJS — Add src/client.ts

This is the most important integration step — it wraps the user's existing LLM code.

**6.1 Read existing LLM code**

**Read** all files in `existingFiles`. Identify:
- How the LLM model is instantiated (constructor, env vars used)
- How agents/chains are created
- How the LLM is invoked (method name, input/output format)
- Any existing tools or system prompts

**6.2 If client.ts does NOT exist:**
**Write** `src/client.ts` using the `{agentStack}` variant from `nodejs-ai-teammate.md`.
- Preserve the user's existing model instantiation and env vars
- Preserve the user's existing system prompt if one exists
- Preserve any existing tools or LangGraph configurations

**6.3 If client.ts already exists:**
Check for each required element and add what is missing:
- `ObservabilityManager.configure().start()` at module level before other imports
- `Agent365ExporterOptions` with `maxQueueSize: 10` and `withExporterOptions()`
- Token resolver using `AgenticTokenCacheInstance.getObservabilityToken`
- `McpToolRegistrationService` module-level singleton
- `getClient()` factory calling `toolService.addToolServersToAgent()`
- `invokeInferenceScope()` using `InferenceScope.start()` with `withActiveSpanAsync`,
  `recordInputMessages`, `recordOutputMessages`, `recordFinishReasons`, and `scope.dispose()` in `finally`

**6.4 Wire existing LLM invocation:**
The user's existing LLM invocation goes INSIDE `invokeInferenceScope()`. Show the user a diff summary.

### .NET — Verify Program.cs observability wiring

The observability services are registered in `Program.cs` (Phase 4). Verify:
- `AddAgenticTracingExporter` is before `AddA365Tracing`
- `IChatClient` uses `.UseOpenTelemetry()` on the builder chain
- `IExporterTokenCache<AgenticTokenStruct>` is injected into the agent constructor

If any are missing, **Edit** `Program.cs` to add them.

The user's existing LLM invocation is preserved inside `GetClientAgent()` in `MyAgent.cs`.
Wrap it with `AgentMetrics.InvokeObservedAgentOperation()` if not already present.

### Python — Verify observability in host_agent_server.py

The observability is configured via `configure_observability()` in `start_server()` (Phase 4).
Verify in `agent.py`:
- `token_resolver()` method is implemented using `get_cached_agentic_token()`
- `setup_mcp_servers()` calls `McpToolRegistrationService().add_tool_servers_to_agent()`
- `process_user_message()` calls `setup_mcp_servers()` before running the LLM

The user's existing LLM invocation (e.g., `self._agent.run(message)`) is preserved inside
`process_user_message()`. Wrap with observability spans if the `microsoft_agents_a365_observability_core`
package provides an inference scope.

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
> "ToolingManifest.json created with no MCP servers. To add WorkIQ tools (Mail, Calendar, Teams, etc.),
> run the `add-workiq-tools` skill."

If it already exists, leave it unchanged.

**Mark task complete.**

---

## Phase 8 — Update Environment Configuration

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

> **Build passed — proceed immediately to Phase 10.**

---

## Phase 10 — Register with Agent 365

**Mark task in progress: "Register agent with Agent 365 (a365 setup all)"**

The code is ready. Now register the agent as an AI Teammate with Microsoft Agent 365.

**Step 1 — Collect registration inputs.**

Ask all three questions in a single message:

```
The agent code is ready. To register it with Agent 365 I need three things:

  1. Agent Name — display name in Microsoft Teams (e.g. "Contoso HR Bot")
  2. Manager Email — the account that will own the Blueprint in the A365 tenant
  3. Messaging Endpoint — the HTTPS URL where Agent 365 will deliver messages
       (devtunnel, e.g. https://abc123.devtunnels.ms, or your custom HTTPS hostname)
```

Wait for the user to supply all three values.

**Step 2 — Create or update a365.config.json.**

**Glob** `a365.config.json`. If it does not exist, **Write**:

```json
{
  "agentName": "{AgentName}",
  "managerEmail": "{ManagerEmail}",
  "messagingEndpoint": "{MessagingEndpoint}/api/messages"
}
```

If it already exists, **Read** it and **Edit** only the keys that are missing or empty.

**Step 3 — Run a365 setup all.**

```bash
a365 setup all
```

This command:
- Creates the Blueprint in your Agent 365 tenant
- Grants the required Entra ID permissions
- Registers the messaging endpoint

If the command prompts for Azure login, guide the user:
> Run `az login` first, then re-run `a365 setup all`.

If `a365 setup all` succeeds, capture the **Blueprint ID** from the output (shown as `blueprintId`
or similar) and note it for Phase 11.

**Mark task complete.**

---

## Phase 11 — Create Agent Instance

**Mark task in progress: "Create agent instance (a365 create-instance)"**

With the Blueprint registered, create a deployable instance of the agent:

```bash
a365 create-instance --name "{AgentName}"
```

If the command accepts additional flags (e.g. `--blueprint-id`), include the Blueprint ID
captured in Phase 10.

On success, tell the user:
> "Agent instance created. The instance is now visible in the Agent 365 management portal
> and ready to receive messages once your server is running."

If `a365 create-instance` is not found or fails with "unknown command", inform the user:
> "The `create-instance` command may require a newer version of the a365 CLI.
> Run `dotnet tool update -g Microsoft.Agents.A365.DevTools.Cli --prerelease` and retry."

**Mark task complete.**

---

## Phase 12 — Offer Additional Capabilities

Ask the user in a single message:

```
The agent is transformed and registered. Would you like to add any of these now?

  1. WorkIQ tools — Mail, Calendar, Teams, SharePoint, OneDrive, and more
     (runs the add-workiq-tools skill)
  2. Additional observability — OTel tracing + Microsoft Defender integration
     (runs the instrument-observability skill)
  3. Both
  4. Neither — skip to local testing
```

**If user selects WorkIQ tools (1 or 3):**

Invoke the `add-workiq-tools` skill inline:
1. Run `a365 develop list-available` to show available MCP server catalog.
2. Ask which servers to add.
3. Run `a365 develop add-mcp-servers --servers "<selected>"` to populate `ToolingManifest.json`.
4. Wire `McpToolRegistrationService` in the agent code if not already done (it is already wired from
   Phase 6 — just confirm `ToolingManifest.json` now has entries).
5. Tell the user what permissions the Global Administrator must grant via `a365 setup permissions mcp`.

**If user selects Observability (2 or 3):**

Invoke the `instrument-observability` skill inline:
1. **Read** the agent entry point (language-appropriate: `src/index.ts`, `Program.cs`, or `host_agent_server.py`).
2. Verify `ObservabilityManager` / `AddAgenticTracingExporter` / `configure_observability` is present
   (it was added in Phase 6). If already complete, tell the user observability is already instrumented.
3. If anything is missing (e.g., `BaggageBuilder` context propagation, `InferenceScope` wrapping),
   add it now following the patterns in `instrument-observability/references/`.

**If user selects Neither (4):** proceed directly to Phase 13.

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
  • Observability:     ObservabilityManager + BaggageBuilder + InferenceScope
  • Notifications:     Email notification handling + install/uninstall lifecycle
  • WorkIQ tools:      McpToolRegistrationService (add tools with add-workiq-tools skill)
  • Token cache:       Built-in AgenticTokenCacheInstance (or custom via Use_Custom_Resolver)
  • A365 registered:   Blueprint created, permissions granted, messaging endpoint set
  • Instance created:  Agent instance ready in the Agent 365 portal

Next steps:
  1. Health check:    curl http://localhost:3978/api/health
  2. Add WorkIQ tools: run the add-workiq-tools skill
```

### .NET summary:
```
✅ AI Teammate fully set up and registered!

Your agent now has:
  • Hosting layer:     ASP.NET Core + IAgentHttpAdapter + /api/health + /api/messages
  • Agent class:       AgentApplication subclass with message, InstallationUpdate handlers
  • Observability:     AddAgenticTracingExporter + AddA365Tracing + UseOpenTelemetry on IChatClient
  • WorkIQ tools:      IMcpToolRegistrationService + IMcpToolServerConfigurationService
  • Auth:              AgenticAuthHandlerName (production) + OboAuthHandlerName (Playground)
  • A365 registered:   Blueprint created, permissions granted, messaging endpoint set
  • Instance created:  Agent instance ready in the Agent 365 portal

Next steps:
  1. Set appsettings.json ClientId, BOT_ID, BOT_TENANT_ID placeholders
  2. Health check:    curl http://localhost:3978/api/health
  3. Add WorkIQ tools: run the add-workiq-tools skill
```

### Python summary:
```
✅ AI Teammate fully set up and registered!

Your agent now has:
  • Hosting layer:     aiohttp server + CloudAdapterAiohttp + /api/health + /api/messages
  • Agent class:       AgentInterface implementation with MCP tooling and notification handling
  • Observability:     configure_observability() with token resolver
  • WorkIQ tools:      McpToolRegistrationService.add_tool_servers_to_agent()
  • Token cache:       token_cache.py with cache_agentic_token / get_cached_agentic_token
  • A365 registered:   Blueprint created, permissions granted, messaging endpoint set
  • Instance created:  Agent instance ready in the Agent 365 portal

Next steps:
  1. Fill .env with Azure OpenAI credentials and connection settings
  2. Health check:    curl http://localhost:3978/api/health
  3. Add WorkIQ tools: run the add-workiq-tools skill
```

---

## Error Handling

| Situation | Language | Action |
|-----------|----------|--------|
| `agentStack` not detected | Any | Ask the user; default to AgentFramework patterns |
| Existing `index.ts` has complex custom middleware | NodeJS | Preserve it; add A365 routes alongside existing ones |
| `client.ts` uses unrecognized framework (e.g., LlamaIndex) | NodeJS | Add hosting + agent layers; stub `invokeInferenceScope`; tell user what to fill in |
| Build fails with `module` errors | NodeJS | Ensure both `"module": "node16"` AND `"moduleResolution": "node16"` in tsconfig |
| `AgentApplication` import not found | NodeJS | Check `@microsoft/agents-hosting` is installed |
| `IAgentHttpAdapter` not found | .NET | Ensure `Microsoft.Agents.Hosting.AspNetCore` is referenced |
| `IChatClient` not found | .NET | Ensure `Microsoft.Extensions.AI.OpenAI` is installed |
| `Microsoft.Agents.A365.*` not found after dotnet add | .NET | Add `--prerelease` flag; check NuGet source includes prerelease feeds |
| `ModuleNotFoundError` for `microsoft_agents_a365_*` | Python | Run `uv add <package> --prerelease` or ensure PyPI prerelease index is configured |
| `requires-python` version mismatch | Python | Ensure Python 3.11+ is active in the virtual environment |
| `USE_AGENTIC_AUTH=false` — MCP tools not loading | Python | Expected in dev mode; set to `true` and provide `BEARER_TOKEN` for production testing |

---

## Idempotency

On re-runs, detect what is already present (Phase 0A checks) and skip completed phases.
Never overwrite a file that already has the required pattern — only add what is missing.

---

## References

**Node.js patterns:**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-ai-teammate.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-notifications.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md`

**.NET patterns:**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/dotnet-ai-teammate.md`

**Python patterns:**
- `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/python-ai-teammate.md`

**Shared:**
- `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **Blueprint registration:** handled inline in Phase 10 (`a365 setup all`) and Phase 11 (`a365 create-instance`).
  Run the standalone `a365-setup` skill only if you need to re-register or change the endpoint.
