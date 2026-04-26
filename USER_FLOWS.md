# Agent 365 Skills — End-to-End User Flows

This document describes the complete user journey for each skill in the Agent 365 Skills repository. Each skill transforms or enhances an agent in a specific way.

---

## Table of Contents

1. [a365-setup](#1-a365-setup) — Entry point for A365 registration
2. [make-ai-teammate](#2-make-ai-teammate) — Transform agent into Teams AI Teammate
3. [make-a365-agent](#3-make-a365-agent) — Provision non-AI Teammate agents
4. [instrument-observability](#4-instrument-observability) — Add OpenTelemetry tracing
5. [add-workiq-tools](#5-add-workiq-tools) — Add Microsoft 365 data access
6. [test-local](#6-test-local) — Local testing with AgentsPlayground

---

## 1. a365-setup

### Purpose
Entry point for Agent 365 registration. Installs CLI, validates Azure prerequisites, then delegates to specialized skills based on user's capability choice.

### Trigger Phrases
- "run a365 setup"
- "create blueprint"
- "register agent"
- "setup agent blueprint"
- "onboard agent"

### Prerequisites
- An existing agent project (Node.js, .NET, or Python)
- Azure CLI access
- Entra ID permissions (Agent ID Administrator or higher)

### User Flow

#### Step 1: Agent Detection & Validation
**System Actions:**
- Detects agent stack (LangChain, OpenAI, AgentFramework, etc.)
- Detects programming language (.NET, Node.js, Python)
- Detects agent type (AI Teammate (Digital Worker) vs Standard Agent (Non Digital Worker))
- Caches detection results in `.a365-workspace-detection.json`

**User Interaction:**
```
Here's what we detected about your agent:
  • Stack:         LangChain
  • Language:      NodeJS
  • Agent type:    Custom Engine Agent (CEA) — has Teams/Copilot integration

Reply **yes** to confirm, or describe any corrections.
```

**User Provides:** Confirmation or corrections

#### Step 2: Capability Selection
**User Interaction:**
```
What capabilities do you want to enable?

  1. Discoverability — make the agent findable in the M365 catalog
  2. Observability — end-to-end activity tracing
  3. Tools — add WorkIQ MCP tools (M365 data access)
  4. AI Teammate — full Teams/Copilot integration

Options can be combined (e.g., "1 and 2").
```

**User Provides:** Capability choice(s)

#### Step 3: CLI Installation
**System Actions:**
- Checks if `a365` CLI is installed
- Installs or updates to latest version if needed
- Validates installation with `a365 --version`

**Automatic — No User Input Required**

#### Step 4: Azure Prerequisites
**System Actions:**
- Validates Azure CLI login (`az login`)
- Checks Entra ID roles
- Verifies custom client app "Agent 365 CLI" exists
- Validates language-specific build tools (dotnet/node/python)

**User Interaction (if issues found):**
- May prompt for Azure login
- May request installation of missing build tools
- May ask user to switch to account with proper permissions

#### Step 5: Delegation
**System Actions:**
Based on capability selection:
- **AI Teammate (option 4)** → Delegates to `make-ai-teammate` skill
- **Discoverability/Observability/Tools** → Delegates to `make-a365-agent` skill

**No Further User Input — Flow Continues in Delegated Skill**

### What Gets Created/Modified
- `.a365-workspace-detection.json` — Detection cache
- `a365` CLI globally installed
- No code changes (done by delegated skill)

### Next Steps
Automatically continues in the delegated skill based on capability choice.

---

## 2. make-ai-teammate

### Purpose
Transforms a non-M365 agent into a Microsoft Agent 365 AI Teammate by adding hosting layer, routing, notifications, and Teams/Copilot integration.

### Trigger Phrases
- "make this agent an ai teammate"
- "transform agent to ai teammate"
- "add ai teammate hosting"
- "convert agent to teams agent"

### Prerequisites
- `a365-setup` must be run first (creates `.a365-workspace-detection.json`)
- Existing LLM agent code (Node.js LangChain/OpenAI/Claude, .NET AgentFramework, Python AgentFramework)

### User Flow

#### Phase 0: Load Detection & Confirm
**System Actions:**
- Reads `.a365-workspace-detection.json`
- Scans existing code for LLM entry points
- Checks what's already present (hosting, agent class, notifications)

**User Interaction:**
```
Language: NodeJS  |  Framework: LangChain  |  Existing code: src/chain.ts

Already present:
  • Hosting layer:   ❌
  • Agent class:     ❌
  • Notifications:   ❌

Reply **yes** to confirm, or describe corrections.
```

**User Provides:** Confirmation

#### Phase 1-2: Package Installation & Setup
**System Actions:**
- Installs required `@microsoft/agents-*` packages (Node.js)
- Or adds NuGet packages (`.NET`)
- Or updates `pyproject.toml` (Python)
- Configures `tsconfig.json` for Node16 module resolution (Node.js only)

**Automatic — No User Input**

#### Phase 3-6: Code Generation
**System Actions:**

**For Node.js:**
- Creates `src/index.ts` — Express + CloudAdapter hosting
- Creates `src/agent.ts` — AgentApplication class with message/notification handlers
- Creates `src/client.ts` — Wraps existing LLM code
- Updates environment variables in `.env`

**For .NET:**
- Updates `Program.cs` — A365 services + endpoints
- Creates `Agent/MyAgent.cs` — AgentApplication subclass
- Updates `appsettings.json` with auth config

**For Python:**
- Creates `host_agent_server.py` — aiohttp server
- Creates `agent_interface.py` — Agent interface
- Updates `agent.py` — AgentInterface implementation
- Updates `.env.template`

**User Interaction:**
None during code generation — all automatic

#### Phase 7: Manifest Creation
**System Actions:**
- Creates `ToolingManifest.json` pre-populated with Calendar and Mail WorkIQ servers
- Notifies user that WorkIQ tools can be added via `add-workiq-tools` skill

#### Phase 8-9: Build Validation
**System Actions:**
- Runs build command (`npm run build`, `dotnet build`, or `pip install`)
- Reports any errors that need fixing

**User Interaction (if errors):**
May need to fix build errors and re-run

#### Phase 10: Azure Registration
**System Actions:**
- Collects agent identity info (name, description)
- Creates `a365.config.json` with configuration
- Runs `a365 setup all --dry-run` (preview)

**User Interaction:**
```
Agent Name: (e.g., "contoso-hr-assistant")
Agent Description: (What does your agent do?)
Support Contact Email: (for users who need help)

Here's what `a365 setup all` will create. Does this look correct?
[Shows dry-run output]

Type **yes** to proceed or **no** to abort.
```

**User Provides:** 
- Agent name
- Description
- Email
- Approval

**System Actions After Approval:**
- Runs `a365 setup all` (creates Blueprint in Entra ID)
- Reviews and publishes `manifest/manifest.json`
- Runs `a365 publish` to upload to M365
- Provides Teams Developer Portal registration link

#### Phase 11: Teams Developer Portal
**User Interaction:**
```
To complete registration:
1. Open: https://dev.teams.microsoft.com/agents
2. Click "Request an Agent Instance" 
3. Use Blueprint ID: {agentBlueprintId}
4. Submit for admin approval at: https://admin.cloud.microsoft/#/agents/all/requested
```

**User Actions:**
- Opens Teams Developer Portal
- Requests agent instance
- Admin approves the request

#### Phase 12: Follow-on Capabilities
**User Interaction:**
```
✅ AI Teammate code is ready!

Suggested next steps:
  1. Add observability — track every message and LLM call (Strongly Recommended)
     Reply: "yes" to add now
  
  2. Add WorkIQ tools — M365 data access (Optional)
     Reply: "add workiq" to add now
  
  3. Test locally — run with AgentsPlayground
     Reply: "test local" to launch now
```

**User Provides:** Choice of next action

### What Gets Created/Modified

**Node.js:**
- `src/index.ts` — New hosting layer
- `src/agent.ts` — New agent class
- `src/client.ts` — New LLM wrapper
- `ToolingManifest.json` — Empty manifest
- `.env` / `.env.example` — Updated with A365 vars
- `tsconfig.json` — Updated module resolution
- `package.json` — Added A365 packages

**.NET:**
- `Program.cs` — Updated with A365 services
- `Agent/MyAgent.cs` — New agent class
- `appsettings.json` — Added A365 config
- `ToolingManifest.json` — Empty manifest
- `.csproj` — Added NuGet packages

**Python:**
- `host_agent_server.py` — New server
- `agent_interface.py` — New interface
- `agent.py` — Updated implementation
- `ToolingManifest.json` — Empty manifest
- `.env.template` — Updated vars
- `pyproject.toml` — Added dependencies

**All Languages:**
- `a365.config.json` — Agent configuration
- `a365.generated.config.json` — Blueprint ID from setup
- `manifest/manifest.json` — Teams app manifest

### Next Steps
- Add observability (strongly recommended)
- Add WorkIQ tools (optional)
- Test locally with AgentsPlayground
- Deploy to Azure (user's choice)

---

## 3. make-a365-agent

### Purpose
Provisions non-AI Teammate agents with Agent 365 for Discoverability, Observability, or WorkIQ capabilities. Runs `a365 setup all` and offers optional add-ons.

### Trigger Phrases
- "provision agent with a365"
- "run a365 setup all"
- "discoverability setup"
- "observability setup"

### Prerequisites
- Usually called from `a365-setup` after CLI and prerequisites validated
- Can be invoked directly if `.a365-workspace-detection.json` exists

### User Flow

#### Phase 0: Load Context
**System Actions:**
- Checks if called from `a365-setup` (has session context)
- If direct invocation: reads `.a365-workspace-detection.json`
- If no cache: asks capability selection

**User Interaction (if no session context):**
```
What capabilities would you like to enable?

  1. Discoverability — make the agent findable in the M365 catalog
  2. Observability — end-to-end activity tracing
  3. Tools — add WorkIQ MCP tools
```

**User Provides:** Capability choice (if asked)

#### Phase 1: Collect Inputs
**User Interaction:**
```
To provision your agent with Agent 365, I need:

  1. Agent Name — short, unique identifier (e.g., "contoso-hr-agent")
     Rules: lowercase letters, numbers, hyphens. 3–20 chars.

  2. Project directory — full path to agent code, or "current"
```

**User Provides:**
- Agent name
- Project path

#### Phase 2: Registration

**Step 2.1 — Dry Run Preview**
**System Actions:**
```bash
a365 setup all --agent-name <name> --dry-run
```

**User Interaction:**
```
Here's what `a365 setup all` will create:
[Shows dry-run output with resources to be created]

Does this look correct? Type **yes** to proceed or **no** to abort.
```

**User Provides:** Approval (yes/no)

**Step 2.2 — Apply Setup**
**System Actions (after approval):**
```bash
a365 setup all --agent-name <name>
```

Creates:
- Agent 365 Blueprint in Entra ID
- Agent identity + app registration
- Required Entra ID permissions

**Step 2.3 — Show Results**
**System Actions:**
- Displays Setup Summary table from CLI
- Shows admin consent instructions (if needed)
- Writes `a365.generated.config.json` with Blueprint ID

**User Interaction (if admin consent needed):**
```
If admin consent is required, have a Global Admin run:

Option A: Entra Portal
  [Shows portal steps]

Option B: PowerShell
  [Shows PowerShell script]
```

**User Action (if applicable):**
- Forwards to Global Admin
- Admin grants consent

#### Phase 3: Add Observability (Optional)

**User Interaction:**
```
Your agent is provisioned. Observability lets you track every message,
LLM call, and tool invocation in the Agent 365 portal and Microsoft Defender.

Would you like to add observability now?
  • yes  — I'll run the instrument-observability skill now
  • skip — you can add it later
```

**User Provides:** yes/skip

**System Actions (if yes):**
- Automatically invokes `instrument-observability` skill
- (See instrument-observability flow below)

#### Phase 4: Add WorkIQ Tools (Optional)

**User Interaction:**
```
Would you like to add WorkIQ tools? These give your agent access to
Microsoft 365 data — email, calendar, Teams, SharePoint, OneDrive, and more.

Note: WorkIQ MCP calls use OAuth On-Behalf-Of tokens.

  • yes  — I'll run the add-workiq-tools skill now
  • skip — you can add it later
```

**User Provides:** yes/skip

**System Actions (if yes):**
- Automatically invokes `add-workiq-tools` skill
- (See add-workiq-tools flow below)

#### Phase 5: Final Summary

**System Actions:**
```
✅ Agent provisioned with Agent 365!

Your agent now has:
  • Blueprint:       Created in Entra ID
  • Discoverability: Agent appears in M365 catalog
  [• Observability:  OpenTelemetry + A365 tracing]  (if added)
  [• WorkIQ tools:   M365 data access via MCP]      (if added)

Next steps:
  1. If admin consent was required, ensure Global Admin ran the script
  2. Test discovery: search for your agent in Microsoft 365 apps
  3. Add observability (if not done)
  4. Add WorkIQ tools (if not done)
```

### What Gets Created/Modified
- `a365.generated.config.json` — Blueprint ID and settings
- Entra ID resources — Blueprint, app registration, permissions
- Potentially updates to code (if observability/WorkIQ added)

### Next Steps
- Grant admin consent (if required)
- Add observability (if skipped)
- Add WorkIQ tools (if skipped)
- Test agent functionality

---

## 4. instrument-observability

### Purpose
Adds OpenTelemetry-based observability to agents. Captures every message, LLM call, and tool invocation with traces sent to Agent 365 portal and Microsoft Defender. **Required for store publishing.**

### Trigger Phrases
- "instrument observability for this agent"
- "add a365 observability"
- "enable tracing"
- "add otel"
- "instrument for store publishing"

### Prerequisites
- `a365-setup` must be run first (creates `.a365-workspace-detection.json`)
- Works with .NET, Node.js, Python agents

### User Flow

#### Phase 0: Load Detection & Validate
**System Actions:**
- Reads `.a365-workspace-detection.json`
- Detects agent stack and programming language

**User Interaction:**
```
Here's what we detected about your agent:
  • Stack:    AgentFramework
  • Language: DotNet

Reply **yes** to confirm, or describe corrections.
```

**User Provides:** Confirmation

#### Phase 0.5: Agent Type & Auth Mode

**User Interaction:**
```
To configure observability correctly, I need to know:

1. What kind of agent is this?
   • AI Teammate — works with Teams/Copilot, has Teams UI
   • Standard Agent (Non Digital Worker) — backend service, no Teams UI

2. How does this agent authenticate? (based on your choice above)
   
   For AI Teammate:
     • user-delegated — uses signed-in user's identity (OBO)
     • agentic-identity — agent has its own Azure AD user account
   
   For Standard Agent (Non Digital Worker):
     • agentic-identity — agent as assistive service with user context
     • S2S — autonomous service, no user token
```

**User Provides:**
- Agent kind (AI Teammate (Digital Worker) or Standard Agent (Non Digital Worker))
- Auth mode (user-delegated, agentic-identity, or S2S)

**System Actions:**
- Caches choices to `.a365-workspace-detection.json`
- Determines code pattern to use (OBO vs S2S paths differ)

#### Phase 1: Detect Agent Type
**System Actions:**
- Scans for .csproj, package.json, or requirements.txt
- Identifies entry point file (Program.cs, index.ts, app.py)
- Identifies message handler location
- Loads appropriate reference patterns

**Automatic — No User Input**

#### Phase 2: Install Packages

**System Actions:**

**For .NET:**
```bash
dotnet add package Microsoft.Agents.A365.Observability.Runtime
dotnet add package Microsoft.Agents.A365.Observability.Hosting
```

**For Node.js:**
```bash
npm install @microsoft/agents-a365-observability
npm install @microsoft/agents-a365-runtime
npm install @microsoft/agents-a365-observability-hosting
```

**For Python:**
```bash
pip install microsoft-agents-a365-observability-core
pip install microsoft-agents-a365-runtime
pip install microsoft-agents-a365-observability-hosting
```

**User Interaction (optional):**
```
Which AI framework does your agent use?
  • Semantic Kernel
  • OpenAI
  • Agent Framework
  • LangChain
  • None / Other
```

**System Actions (based on choice):**
Installs optional auto-instrumentation extensions

#### Phase 3: Wire Entry Point

**System Actions:**

**For .NET (OBO path — user-delegated or agentic-identity):**
- Adds `builder.Services.AddAgenticTracingExporter();`
- Adds `builder.AddA365Tracing();`
- Optionally registers `BaggageTurnMiddleware`

**For .NET (S2S path):**
- Creates `Observability/ObservabilityServiceExtensions.cs`
- Creates `Observability/ObservabilityTokenService.cs` (FMI 3-hop token chain)
- Adds `builder.Services.AddAgent365Observability();`
- Adds `builder.AddA365Tracing();`

**For Node.js:**
- Imports `ObservabilityManager`
- Calls `ObservabilityManager.configure().withTokenResolver(...).start()`
- Optionally registers `BaggageMiddleware`

**For Python:**
- Imports `configure` from observability package
- Calls `configure()` with service name and token resolver
- Optionally registers `BaggageMiddleware`

**All marked with:**
```
// A365 Observability — best-effort instrumentation (verify against official sample)
```

#### Phase 4: Add Baggage Context to Handler

**System Actions:**

**For .NET (OBO path):**
- Injects `IExporterTokenCache<AgenticTokenStruct>` in constructor
- Adds `using var baggage = new BaggageBuilder().FromTurnContext(turnContext).Build();`
- Calls `_agentTokenCache.RegisterObservability(new AgenticTokenStruct(..., authHandlerName: "AGENTIC"))`
- Adds inline comment: `// A365 auth mode: user-delegated` (or agentic-identity)

**For .NET (S2S path):**
- Injects `Agent365ObservabilityContext` in constructor
- Uses `InvokeAgentScope.Start(...).FromTurnContext(turnContext)` (no per-turn RegisterObservability)
- Adds inline comment: `// A365 auth mode: S2S — FMI token chain via ObservabilityTokenService`

**For Node.js:**
- Imports `BaggageBuilder`, `AgenticTokenCacheInstance`
- Calls `AgenticTokenCacheInstance.RefreshObservabilityToken(...)`
- Wraps handler in `baggageScope.run(async () => { ... })`
- Adds inline comment: `// A365 auth mode: {authMode}`

**For Python:**
- Imports `BaggageBuilder`, `populate`, `AgenticTokenCache`
- Calls `token_cache.register_observability(...)`
- Wraps handler with baggage context
- Adds inline comment: `# A365 auth mode: {authMode}`

**Note:** All three auth modes use `authHandlerName: "AGENTIC"` in code — the identity in traces is determined by Azure AD provisioning.

#### Phase 5: Token Resolver
**System Actions:**
- For AI Teammate with hosting packages: built-in cache handles this automatically
- For S2S .NET: `ObservabilityTokenService` background service handles FMI token chain
- No custom resolver needed in most cases

#### Phase 5.5: Manual Instrumentation Scopes

**User Interaction:**
```
Do you want to add InvokeAgentScope, InferenceScope, and ExecuteToolScope wrappers?
These are **required for store publishing**.

  • yes — add now (recommended)
  • skip — I'll add manually later
```

**User Provides:** yes/skip

**System Actions (if yes):**
- Wraps message handler with `InvokeAgentScope`
- Wraps LLM calls with `InferenceScope`
- Wraps tool calls with `ExecuteToolScope`
- All following language-specific patterns from reference docs

#### Phase 6: Configuration Files

**System Actions:**

**For .NET:**
- Updates `appsettings.json` with `Agent365Observability` section
- For S2S: adds `ClientId` + `ClientSecret` placeholders
- Creates `appsettings.Development.json` with exporter disabled

**For Node.js:**
- Updates `.env` with observability variables:
  - `OBSERVABILITY_SERVICE_NAME`
  - `OBSERVABILITY_SERVICE_NAMESPACE`
  - `AGENTIC_APP_ID`

**For Python:**
- Updates `.env` or `.env.template` with observability variables

#### Phase 7: Build Validation
**System Actions:**
```bash
# .NET
dotnet build

# Node.js
npm run build

# Python
pip install -e .
python -c "import observability_module"
```

**User Interaction (if errors):**
Shows build errors and asks user to fix

#### Phase 8: Final Summary

**System Actions:**
```
✅ Observability instrumented!

Your agent now has:
  • OpenTelemetry tracing      (/InvokeAgent, /Inference, /ExecuteTool spans)
  • A365 exporter              (sends to Agent 365 portal + Microsoft Defender)
  • Baggage propagation        (conversation_id, user_id, agent_id)
  • Token caching              (reduces auth overhead)
  • Manual scopes              (required for store publishing)

Auth mode: {authMode}
  - user-delegated: Traces attributed to signed-in user
  - agentic-identity: Traces attributed to agent's Azure AD user
  - S2S: Traces show agent service identity (.NET only, FMI 3-hop chain)

Next steps:
  1. Test locally to see traces in console
  2. View traces in Agent 365 portal: https://portal.agent365.microsoft.com
  3. Deploy to see traces in Microsoft Defender
```

### What Gets Created/Modified

**All Languages:**
- Entry point file — Observability configuration added
- Message handler file — Baggage context added
- Package manifest — A365 observability packages added
- Configuration files — Observability settings added
- All new code marked with: `// A365 Observability — best-effort instrumentation`

**.NET Specific (S2S path only):**
- `Observability/ObservabilityServiceExtensions.cs` — DI extension
- `Observability/ObservabilityTokenService.cs` — FMI token service

### Next Steps
- Test agent locally to verify traces emit
- View traces in Agent 365 portal
- Deploy to production to enable Defender integration

---

## 5. add-workiq-tools

### Purpose
Adds WorkIQ MCP tool servers to agents, giving access to Microsoft 365 data (email, calendar, Teams, SharePoint, OneDrive, Word, Copilot, Dataverse).

### Trigger Phrases
- "add workiq tools"
- "add work intelligence tools"
- "wire up workiq"
- "add mcp tools to this agent"

### Prerequisites
- `a365-setup` must be run first
- Works with .NET, Node.js, Python agents

### User Flow

#### Phase 0A: Load Detection
**System Actions:**
- Reads `.a365-workspace-detection.json`
- Validates prerequisites

**User Interaction:**
```
Here's what we detected about your agent:
  • Stack:    LangChain
  • Language: NodeJS

Reply **yes** to confirm, or describe corrections.
```

**User Provides:** Confirmation

#### Phase 0B: Agent Type & Auth Mode
**System Actions:**
- Checks if `agentType` and `authMode` already cached
- If not: follows same two-stage question as instrument-observability

**User Interaction (if needed):**
```
1. Agent kind?
   • AI Teammate
   • Standard Agent (Non Digital Worker)

2. Auth mode? (based on agent kind)
   • user-delegated / agentic-identity / S2S
```

**User Provides:** Agent kind and auth mode (if asked)

**Note:** If `authMode = S2S`, a warning is shown that WorkIQ requires user tokens and won't work in S2S mode.

#### Phase 1: Detect & Check Prerequisites
**System Actions:**
- Checks `a365` CLI is installed
- Runs `a365 develop list-configured` to show current state
- Checks for `AGENTIC_APP_ID` in config files

**Automatic — No User Input**

#### Phase 2: Show Catalog & Select Tools

**System Actions:**
```bash
a365 develop list-available
```

**User Interaction:**
```
Available WorkIQ tool servers:

  • Work IQ Mail         — Read, send, manage email
  • Work IQ Calendar     — Read/create events, check availability
  • Work IQ Teams        — Read channel messages, list teams
  • Work IQ SharePoint   — Search documents, read files
  • Work IQ OneDrive     — Manage OneDrive files
  • Work IQ Word         — Read and write Word documents
  • Work IQ User         — Get user profile and presence
  • Work IQ Copilot      — Chat with M365 Copilot
  • Dataverse and Dynamics 365 — CRUD and domain actions

Which would you like to add? (Select multiple or "All")
```

**User Provides:** Tool selection

#### Phase 3: Add MCP Servers

**System Actions:**
```bash
a365 develop add-mcp-servers "Work IQ Mail" "Work IQ Calendar" ...
```

- Updates or creates `ToolingManifest.json`
- Adds selected servers to manifest

**Then validates:**
```bash
a365 develop list-configured
```

**Automatic — No User Input**

#### Phase 4: Wire Code

**System Actions:**

**For .NET:**
1. Installs packages:
   ```bash
   dotnet add package Microsoft.Agents.A365.Tooling --prerelease
   dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease
   ```

2. Registers services in `Program.cs`:
   ```csharp
   // A365 WorkIQ — added by add-workiq-tools skill
   builder.Services.AddSingleton<IMcpToolRegistrationService, McpToolRegistrationService>();
   ```

3. Adds to agent class:
   ```csharp
   // A365 WorkIQ — added by add-workiq-tools skill
   // A365 auth mode: {authMode}
   var workIQTools = await _toolService.GetMcpToolsAsync(
       agentId,
       UserAuthorization,  // "AGENTIC" handler
       handlerForMcp,
       context
   );
   ```

**For Node.js:**
1. Installs packages:
   ```bash
   npm install @microsoft/agents-a365-tooling
   npm install @microsoft/agents-a365-tooling-extensions-langchain
   ```

2. Adds to client file:
   ```typescript
   // A365 WorkIQ — added by add-workiq-tools skill
   import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-langchain';
   const toolService = new McpToolRegistrationService();
   
   // In getClient():
   // A365 auth mode: {authMode}
   const agentWithTools = await toolService.addToolServersToAgent(
       personalizedAgent,
       authorization,
       "AGENTIC",
       turnContext,
       process.env.BEARER_TOKEN ?? ''
   );
   ```

**For Python:**
1. Installs packages:
   ```bash
   pip install microsoft-agents-a365-tooling
   pip install microsoft-agents-a365-tooling-extensions-agent-framework
   ```

2. Adds to agent:
   ```python
   # A365 WorkIQ — added by add-workiq-tools skill
   from microsoft_agents_a365.tooling.extensions.agent_framework import McpToolRegistrationService
   
   _tool_service = McpToolRegistrationService()
   
   # In handler:
   # A365 auth mode: {authMode}
   work_iq_tools = await _tool_service.get_mcp_tools_async(
       agent_id,
       turn_context.activity.caller_id,
       "AGENTIC",
       turn_context
   )
   ```

**All marked with:**
```
// A365 WorkIQ — added by add-workiq-tools skill
```

#### Phase 5: Permissions Handoff

**User Interaction:**
```
⚠️ WorkIQ tools require Microsoft Graph permissions.

A Global Administrator must grant admin consent using ONE of these options:

Option 1 — Automated (Recommended):
  a365 setup permissions mcp

Option 2 — Include in full setup:
  a365 setup all

The admin can run these commands from any machine with the a365 CLI installed.

Forward this to your Global Admin, or run it yourself if you have that role.
```

**User Action:**
- Forwards to Global Admin
- Admin runs permission grant command

#### Phase 6: Dev Token Setup

**User Interaction:**
```
For local testing, you'll need a development token.

Get one with:
  a365 develop get-token

This token goes in your .env file as BEARER_TOKEN.
It's user-delegated, so it will only access YOUR M365 data during local testing.

Would you like me to show you how to add it to .env?
  • yes — show me
  • skip — I'll handle it
```

**User Provides:** yes/skip

**System Actions (if yes):**
- Shows how to run `a365 develop get-token`
- Shows how to add `BEARER_TOKEN=...` to `.env`

#### Phase 7: Build Validation
**System Actions:**
```bash
# .NET
dotnet build

# Node.js
npm run build

# Python
pip install -e .
```

#### Phase 8: Final Summary

**System Actions:**
```
✅ WorkIQ tools added!

Your agent now has access to:
  [• Work IQ Mail]        (if selected)
  [• Work IQ Calendar]    (if selected)
  [... etc ...]

Files modified:
  • ToolingManifest.json  — MCP server configuration
  • [Language-specific files]

Auth mode: {authMode}
  - user-delegated: Tools access signed-in user's M365 data
  - agentic-identity: Tools access on behalf of agent's identity
  - S2S: ⚠️ Not supported for WorkIQ (requires user token)

Next steps:
  1. Have Global Admin run: a365 setup permissions mcp
  2. Get dev token: a365 develop get-token
  3. Test locally with user's own M365 data
  4. Deploy to production
```

### What Gets Created/Modified
- `ToolingManifest.json` — MCP server entries
- Package manifest — Tooling packages added
- Code files — `GetMcpToolsAsync` calls added
- All new code marked with: `// A365 WorkIQ — added by add-workiq-tools skill`

### Next Steps
- Admin grants permissions
- Get dev token for local testing
- Test WorkIQ tool invocation
- Deploy to production

---

## 6. test-local

### Purpose
Launches agent locally and opens AgentsPlayground for interactive testing without deployment. Works with any AI Teammate stack.

### Trigger Phrases
- "test this agent locally"
- "run agent locally"
- "open agentsplayground"
- "local test this agent"

### Prerequisites
- Agent code must build successfully
- Works with .NET, Node.js, Python AI Teammate agents

### User Flow

#### Phase 1: Detect Agent Type
**System Actions:**
- Checks `.a365-workspace-detection.json` (if exists)
- Or scans for .csproj, package.json, requirements.txt
- Determines default port (5000 for .NET, 3978 for Node.js/Python)
- Determines start command

**User Interaction (if needed):**
```
I couldn't detect the agent type. What are you working with?
  • .NET (AgentFramework or Semantic Kernel)
  • Node.js (LangChain, OpenAI, Claude SDK, Semantic Kernel, Google ADK)
  • Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK)
```

**User Provides:** Agent type (if asked)

**System Actions:**
- Checks if build tool is installed (dotnet/node/python)

**User Interaction (if tool missing):**
```
{BuildTool} is required but not found. Install it now?
  • Yes — install via winget (Windows) or brew (macOS)
  • No — I'll install manually and re-run
```

**User Provides:** yes/no

**System Actions (if yes):**
Attempts automatic installation

#### Phase 2: Install AgentsPlayground
**System Actions:**
```bash
agentsplayground --version
```

**User Interaction (if not installed):**
```
AgentsPlayground CLI is not installed. Install it now with
`npm install -g @microsoft/agentsplayground`?

  • Yes, install it
  • No, I'll install it manually
```

**User Provides:** yes/no

**System Actions (if yes):**
```bash
npm install -g @microsoft/agentsplayground
```

#### Phase 3: Build Agent
**System Actions:**
```bash
# .NET
dotnet build

# Node.js
npm install
npm run build

# Python
pip install -r requirements.txt
```

**User Interaction (if build fails):**
Shows errors and stops — asks user to fix before continuing

#### Phase 4: Launch

**User Interaction:**
```
Ready to start the agent and open AgentsPlayground for a local test?

  • Yes — start agent and open playground
  • No — show me the commands and I'll run them manually
```

**User Provides:** yes/no

**System Actions (if yes):**

**Starts agent in background:**
```bash
# .NET
dotnet run

# Node.js
npm start

# Python
python host_agent_server.py
```

**Waits for agent to be ready (polls /api/messages endpoint)**

**Then launches AgentsPlayground:**
```bash
agentsplayground -e "http://localhost:{port}/api/messages" -c "emulator"
```

**Opens browser to AgentsPlayground UI**

**User Interaction (if no):**
```
Terminal 1 — start your agent:
  .NET:    dotnet run
  Node.js: npm start
  Python:  python host_agent_server.py

Terminal 2 — open AgentsPlayground:
  agentsplayground -e "http://localhost:{port}/api/messages" -c "emulator"
```

#### Phase 5: Testing Session

**User Actions:**
- Types messages in AgentsPlayground UI
- Tests agent responses
- Verifies WorkIQ tools work (if added)
- Checks that observability traces emit (if instrumented)

**Agent runs in background — user can:**
- See console logs
- Monitor requests
- Debug issues

#### Phase 6: Wrap Up

**User Interaction:**
```
Local test complete!

To stop the agent:
  • Press Ctrl+C in the terminal where the agent is running
  • Or close the terminal

To test again:
  • Run this skill again
  • Or manually run the commands shown above
```

### What Gets Created/Modified
- No files modified (read-only testing)
- Agent runs on localhost
- AgentsPlayground opens in browser

### Next Steps
- Fix any issues found during testing
- Deploy to Azure when ready
- Test production deployment

---

## Skill Dependency Flow

```
┌─────────────┐
│ a365-setup  │  Entry point
└──────┬──────┘
       │
       ├─── AI Teammate selected ───→ ┌──────────────────┐
       │                               │ make-ai-teammate │
       │                               └────────┬─────────┘
       │                                        │
       │                                        ├──→ instrument-observability (strongly recommended)
       │                                        │
       │                                        └──→ add-workiq-tools (optional)
       │
       └─── Other paths ──────────────→ ┌─────────────────┐
                                         │ make-a365-agent │
                                         └────────┬────────┘
                                                  │
                                                  ├──→ instrument-observability (optional)
                                                  │
                                                  └──→ add-workiq-tools (optional)

┌────────────┐
│ test-local │  Can be run at any time after make-ai-teammate
└────────────┘
```

## Common User Journeys

### Journey 1: New AI Teammate (Full Stack)
1. User: "run a365 setup"
2. System detects agent, asks for capabilities
3. User selects "4. AI Teammate"
4. → `make-ai-teammate` runs
5. System generates hosting code, runs setup, publishes to Teams
6. User approves manifest, registers in Teams Dev Portal
7. System offers observability
8. User: "yes"
9. → `instrument-observability` runs
10. System offers WorkIQ tools
11. User: "yes"
12. → `add-workiq-tools` runs
13. User: "test local"
14. → `test-local` runs
15. AgentsPlayground opens, user tests agent

**Result:** Fully instrumented AI Teammate ready for Teams deployment

### Journey 2: Standard Agent (Non Digital Worker) with Observability Only
1. User: "run a365 setup"
2. System detects agent
3. User selects "2. Observability"
4. → `make-a365-agent` runs
5. System runs `a365 setup all`
6. System automatically offers and runs `instrument-observability`
7. System offers WorkIQ tools
8. User: "skip"

**Result:** System agent with observability, discoverable in M365 catalog

### Journey 3: Add Tools to Existing Agent
1. User has already run `a365-setup` previously
2. User: "add workiq tools"
3. → `add-workiq-tools` runs directly
4. Shows catalog, user selects tools
5. System wires code, shows permission handoff instructions

**Result:** WorkIQ tools added to already-provisioned agent

### Journey 4: Local Testing Only
1. User has make-ai-teammate code ready
2. User: "test this agent locally"
3. → `test-local` runs directly
4. System builds agent, launches playground
5. User tests in browser

**Result:** Quick local test without deployment

---

## Technical Notes

### Authentication Modes Explained

All skills that instrument code (observability, WorkIQ) ask for `authMode` which determines how the agent authenticates:

| Mode | Description | Identity in Traces | Use Case |
|------|-------------|-------------------|----------|
| **user-delegated** | Agent uses signed-in user's token (OBO) | End user | AI Teammate where user is logged in |
| **agentic-identity** | Agent has its own Azure AD user account | Agent's Azure AD user | AI Teammate (Digital Worker) or Standard Agent (Non Digital Worker) operating as assistant |
| **S2S** | Service-to-service, no user context | Agent service principal | Background automation (.NET only) |

**Code is identical** — all use `authHandlerName: "AGENTIC"`. The difference is in Azure AD provisioning.

### Non-Destructive Principles

All skills follow these rules:
- ✅ Add new files
- ✅ Add new code sections to existing files
- ✅ Install new packages
- ✅ Update configuration files by adding new keys
- ❌ Never delete existing code
- ❌ Never restructure existing logic
- ❌ Never replace user's LLM implementation

### Idempotency

All skills can be run multiple times safely:
- Existing resources are skipped (Azure setup)
- Existing code is preserved
- Package installations check before adding
- Build validation confirms everything works

---

## Support & Troubleshooting

### Common Issues

**"a365-setup must be run first"**
- Detection cache is missing or stale
- Solution: Run `a365-setup` before specialized skills

**Build failures after code generation**
- Usually missing imports or module resolution issues
- For Node.js: Check `tsconfig.json` has `"module": "node16"` AND `"moduleResolution": "node16"`
- For .NET: Check package references are restored
- For Python: Check virtual environment is active

**Admin consent required**
- WorkIQ and some observability features need Global Admin approval
- Forward PowerShell script to admin
- Or run `a365 setup permissions mcp` as admin

**AgentsPlayground won't connect**
- Check agent is running on expected port
- For .NET: Ensure `requireAuth: false` in `MapAgentApplicationEndpoints`
- Check firewall isn't blocking localhost

### Getting Help

- Agent 365 Troubleshooting Guide: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/troubleshooting
- CLI Reference: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/agent-365-cli
- GitHub Issues: https://github.com/microsoft/Agent365-devTools/issues

---

## Glossary

- **A365** — Agent 365 (Microsoft's agent platform)
- **Blueprint** — Agent identity registered in Entra ID
- **CEA** — Custom Engine Agent (has Teams/Copilot integration)
- **MCP** — Model Context Protocol (tool server standard)
- **OBO** — On-Behalf-Of (OAuth flow where agent acts as user)
- **S2S** — Service-to-Service (agent authenticates as itself)
- **WorkIQ** — Pre-built tools for M365 data access
- **AgentsPlayground** — Local testing UI that simulates Teams chat

---

*Last updated: Based on current skill implementations in the repository*
