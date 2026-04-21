---
name: instrument-observability
description: >
  Instruments Microsoft Agent 365 observability into existing .NET AgentFramework or Node.js
  LangChain agents. Adds OTel-based tracing, BaggageBuilder context propagation, A365 exporter
  with agentic token resolver, and updates configuration files. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: path to agent project, or framework hint (dotnet|nodejs)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-observability.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was correctly detected (.NET AgentFramework or Node.js LangChain).
        2. A365 observability packages were installed (check package.json or .csproj).
        3. Observability was wired in the entry point (Program.cs or index.js/ts).
        4. BaggageBuilder context is added to the message handler.
        5. Agentic token resolver with caching is implemented.
        6. Configuration files (appsettings.json or .env) include observability variables.
        7. Build/compile succeeds (dotnet build or npm run build).
        8. All instrumented code is marked with: // A365 Observability — best-effort instrumentation
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 30000
---

# Instrument A365 Observability

> **Trigger phrases** — any of these will activate this skill automatically:
> - "instrument observability for this agent"
> - "add a365 observability"
> - "enable tracing"
> - "add otel"
> - "observe this agent"

---

## Overview

This skill instruments Microsoft Agent 365 observability into an existing agent codebase
without disrupting the agent's core logic. It:

1. **Detects** the agent type (.NET AgentFramework or Node.js LangChain)
2. **Installs** the correct A365 observability packages
3. **Wires** observability in the entry point
4. **Adds** BaggageBuilder context to message handlers
5. **Implements** the agentic token resolver with caching
6. **Updates** configuration files with observability settings
7. **Validates** the build passes

All changes are **additive** and **idempotent** — rerunning the skill is safe.

---

## Phase 1: Detect Agent Type

**TaskCreate** — "Detect agent type and load reference patterns"

1. **Read** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md` for detection heuristics.

2. **Run detection** following the rules in `agent-detection.md`:
   - Check for `.NET AgentFramework` indicators (Microsoft.Agent.*, AgentFramework)
   - Check for `Node.js LangChain` indicators (@langchain/*, @azure/msal-node)
   - Determine package file (*.csproj, package.json)
   - Determine entry point (Program.cs, index.ts/js, app.ts)
   - Determine message handler location

3. **Load reference patterns:**
   - If .NET: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
   - If Node.js: **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`

4. **If agent type cannot be determined**, write marker `.a365setup-unknown-agent` and **exit early** with clear error message.

5. **TaskUpdate** — Mark complete and report detected agent type to user.

---

## Phase 2: Install A365 Observability Packages

**TaskCreate** — "Install A365 observability packages"

### For .NET AgentFramework

1. **Bash** — Run package installation:
   ```bash
   dotnet add package Microsoft.Agent.Observability --version <version-from-reference>
   dotnet add package Azure.Identity --version <version-from-reference>
   ```

2. **Verify** the packages appear in the `.csproj` file.

### For Node.js LangChain

1. **Bash** — Run package installation:
   ```bash
   npm install @azure/monitor-opentelemetry-exporter@<version-from-reference> \
               @opentelemetry/api@<version-from-reference> \
               @opentelemetry/sdk-node@<version-from-reference> \
               @opentelemetry/instrumentation@<version-from-reference> \
               @azure/identity@<version-from-reference>
   ```

2. **Verify** the packages appear in `package.json`.

3. **TaskUpdate** — Mark complete.

---

## Phase 3: Wire Observability in Entry Point

**TaskCreate** — "Wire observability in entry point"

### For .NET AgentFramework

1. **Read** the current entry point (`Program.cs` or detected file).

2. **Edit** — Add observability wiring following the reference pattern:
   - Add `using Microsoft.Agent.Observability;`
   - Add `builder.Services.AddA365Tracing();` after service registration
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

### For Node.js LangChain

1. **Read** the current entry point (`index.ts`, `app.ts`, or detected file).

2. **Edit** — Add observability initialization following the reference pattern:
   - Add imports for ObservabilityManager
   - Add `ObservabilityManager.configure()` at the top of `main()` or entry function
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing code — only add new lines, never remove.

4. **TaskUpdate** — Mark complete.

---

## Phase 4: Add BaggageBuilder Context to Message Handler

**TaskCreate** — "Add BaggageBuilder context to message handler"

### For .NET AgentFramework

1. **Read** the detected message handler file.

2. **Edit** — Add BaggageBuilder context extraction following the reference pattern:
   - Add `using Microsoft.Agent.Observability;`
   - Extract tenant, agent, correlation IDs from context
   - Add to baggage: `BaggageBuilder.Add("tenantId", tenantId);` etc.
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

### For Node.js LangChain

1. **Read** the detected message handler file.

2. **Edit** — Add baggage context following the reference pattern:
   - Import `context, propagation` from `@opentelemetry/api`
   - Extract tenant, agent, correlation IDs from request/context
   - Add to active span baggage
   - Mark all new lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Preserve** all existing handler logic.

4. **TaskUpdate** — Mark complete.

---

## Phase 5: Implement Agentic Token Resolver

**TaskCreate** — "Implement agentic token resolver with caching"

### For .NET AgentFramework

1. **Check** if a token resolver class already exists. If yes, skip creation but verify it matches the pattern.

2. **If not present**, create `AgenticTokenResolver.cs` following the reference pattern:
   - Implement `DefaultAzureCredential` with caching
   - Add 5-minute token expiry logic
   - Expose static `GetTokenAsync()` method
   - Mark all lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Edit** the observability configuration to use the token resolver.

### For Node.js LangChain

1. **Check** if a token resolver module already exists. If yes, skip creation but verify it matches the pattern.

2. **If not present**, create `tokenResolver.ts` (or `.js`) following the reference pattern:
   - Implement `DefaultAzureCredential` with caching
   - Add 5-minute token expiry logic
   - Export `getToken()` function
   - Mark all lines with: `// A365 Observability — best-effort instrumentation (verify against official sample)`

3. **Edit** the observability configuration to use the token resolver.

4. **TaskUpdate** — Mark complete.

---

## Phase 6: Update Configuration Files

**TaskCreate** — "Update configuration files with observability settings"

### For .NET AgentFramework

1. **Read** `appsettings.json` (or `appsettings.Development.json`).

2. **Check for existing `a365 setup` configuration:**
   - If `EnableAgent365Exporter` exists → **preserve** it (do not change)
   - If `Agent365Observability` section exists → **preserve** all existing values (AgentBlueprintId, TenantId, AgentName, AgentDescription)
   - If missing → add with defaults

3. **Edit** — Add or update observability configuration following the reference pattern:

   **If `a365 setup` was already run (EnableAgent365Exporter exists):**
   ```json
   {
     "EnableAgent365Exporter": false,  // ← PRESERVE existing value
     "Agent365Observability": {
       "AgentBlueprintId": "...",      // ← PRESERVE from a365 setup
       "TenantId": "...",               // ← PRESERVE from a365 setup
       "AgentName": "",                 // ← ADD if empty
       "AgentDescription": ""           // ← ADD if empty
     },
     "Logging": {                       // ← ADD this entire section
       "LogLevel": {
         "Default": "Information",
         "Microsoft.Agents.A365.Observability": "Debug",
         "OpenTelemetry": "Debug"
       }
     }
   }
   ```

   **If `a365 setup` was NOT run (no existing config):**
   ```json
   {
     "EnableAgent365Exporter": false,  // ← Default to false (user enables manually)
     "Agent365Observability": {
       "AgentBlueprintId": "",         // ← Placeholder (user fills in)
       "TenantId": "",                  // ← Placeholder (user fills in)
       "AgentName": "",
       "AgentDescription": ""
     },
     "Logging": {
       "LogLevel": {
         "Default": "Information",
         "Microsoft.Agents.A365.Observability": "Debug",
         "OpenTelemetry": "Debug"
       }
     }
   }
   ```

4. **Critical:** The `Logging.LogLevel` section is **required** for observability events to appear in console output and Microsoft Defender. Without this, the SDK is instrumented but logs are suppressed. The `a365 setup` command does **not** add logging configuration.

5. **If `appsettings.json` does not exist**, create it with the complete structure above.

6. **If `Logging.LogLevel` already exists**, merge the new entries preserving existing log levels.

7. **Inform user:**
   - If `EnableAgent365Exporter` is `false`: "Observability is instrumented but disabled. Set EnableAgent365Exporter: true in appsettings.json to start exporting traces."
   - If `AgentBlueprintId` or `TenantId` are empty: "Run `a365 setup` to populate AgentBlueprintId and TenantId, or fill them manually from your Entra app registration."

### For Node.js LangChain

1. **Read** `.env` (or `.env.local`, `.env.development`).

2. **Check for existing `a365 setup` configuration:**
   - If `ENABLE_A365_OBSERVABILITY_EXPORTER` exists → **preserve** it (do not change)
   - If missing → add with default value `false`

3. **Edit** — Add or update observability environment variables following the reference pattern:

   **If `a365 setup` was already run:**
   ```dotenv
   ENABLE_A365_OBSERVABILITY_EXPORTER=false  # ← PRESERVE existing value
   SERVICE_NAME=my-langchain-agent
   A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
   ```

   **If `a365 setup` was NOT run:**
   ```dotenv
   ENABLE_A365_OBSERVABILITY_EXPORTER=false  # ← Default to false (user enables manually)
   SERVICE_NAME=my-langchain-agent
   A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
   ```

4. **If `.env` does not exist**, create it with the variables above.

5. **If the project uses `.env.example`**, also update it with placeholder values.

6. **Inform user:**
   - If `ENABLE_A365_OBSERVABILITY_EXPORTER` is `false`: "Observability is instrumented but disabled. Set ENABLE_A365_OBSERVABILITY_EXPORTER=true in .env to start exporting traces."

7. **TaskUpdate** — Mark complete.

---

## Phase 7: Validate Build

**TaskCreate** — "Validate build passes"

### For .NET AgentFramework

1. **Bash** — Run:
   ```bash
   dotnet build
   ```

2. **If build fails**, collect error output and present to user with suggested fixes.

3. **If build succeeds**, confirm to user.

### For Node.js LangChain

1. **Bash** — Run:
   ```bash
   npm install   # Ensure new packages are installed
   npm run build || npm run compile || echo "No build script found — skipping compile check"
   ```

2. **If build fails**, collect error output and present to user with suggested fixes.

3. **If build succeeds** (or no build script exists), confirm to user.

4. **TaskUpdate** — Mark complete.

---

## Phase 8: Final Summary

1. **TaskList** — Show all completed tasks.

2. **Present summary** to user:
   ```
   ✅ A365 observability instrumented successfully!

   **Agent type:** [.NET AgentFramework | Node.js LangChain]
   **Packages installed:** [list packages]
   **Files modified:** [list files]

   **Next steps:**
   1. Update the observability endpoint in your config file:
      - [appsettings.json | .env]
   2. Set up Azure Application Insights or A365 monitoring backend.
   3. Run your agent and verify traces are being sent.

   **Verification command:**
   [dotnet run | npm start]

   All changes are marked with:
   // A365 Observability — best-effort instrumentation (verify against official sample)
   ```

3. **Remind user** to:
   - Review the instrumented code against the official A365 samples
   - Update configuration with real endpoint values
   - Test the agent in a live environment

---

## Error Handling

### Unknown Agent Type
If the agent type cannot be determined:
- Write marker: `.a365setup-unknown-agent`
- Exit early with message: "Could not detect agent type. Please verify this is a .NET AgentFramework or Node.js LangChain project."

### Build Failures
If the build fails after instrumentation:
- Do NOT revert changes
- Present error output to user
- Suggest fixes based on error messages
- Offer to help debug

### Missing Files
If expected files are not found:
- Ask user to confirm the project structure
- Suggest running detection again
- Offer to create missing files if appropriate

---

## Idempotency

This skill is safe to rerun. On subsequent runs:
- Skip package installation if packages already present
- Skip code edits if observability is already wired (detect by marker comments)
- Update configuration only if values are missing
- Always revalidate the build

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **.NET Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/dotnet-observability.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
