---
name: make-ai-teammate
description: >
  Transforms a non-M365 Node.js agent (LangChain, OpenAI Agents SDK, or Claude SDK) into a
  fully-featured Microsoft Agent 365 AI Teammate. Adds the Express/CloudAdapter hosting layer,
  AgentApplication class with message routing and typing indicators, client factory pattern,
  token cache, A365 observability, email notifications, WorkIQ MCP tools, and all required
  packages and env vars. Wraps existing LLM code — does not replace it.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: LLM framework override (langchain | openai | claude)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-make-ai-teammate.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. src/index.ts has Express + CloudAdapter + /api/health + /api/messages pattern.
        2. src/agent.ts has AgentApplication subclass with message, notification, InstallationUpdate handlers.
        3. src/client.ts has ObservabilityManager.configure().start() and McpToolRegistrationService.
        4. src/token-cache.ts exists with createAgenticTokenCacheKey, tokenResolver, and default export.
        5. ToolingManifest.json exists (even if empty mcpServers array).
        6. .env / .env.example has all required A365 variables.
        7. tsconfig.json has module: "node16" and moduleResolution: "node16".
        8. All required @microsoft/agents-* packages are in package.json.
        9. Build succeeds (npm run build or tsc --noEmit).
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

---

## Phase 0A — Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.json` if it exists.
If `detectedAt` is within the last 60 minutes, load cached values and skip to Phase 0B.

Run all detection steps **in parallel**:

**Step 1: Detect LLM Framework** → Store as `agentStack`
- `package.json` contains `@langchain` or `langchain` → `LangChain`
- `package.json` contains `@openai/agents` → `OpenAI`
- `package.json` contains `@anthropic-ai/sdk` → `Claude`
- None found → ask the user (see Phase 0B)

**Step 2: Detect Programming Language** → `NodeJS` if `package.json` exists, else stop.

**Step 3: Find existing LLM entry point**
- **Glob** `src/**/*.ts` and **Grep** for: LLM model instantiation (`ChatOpenAI`, `AzureChatOpenAI`,
  `OpenAI`, `Anthropic`), chain/agent creation (`createAgent`, `createReactAgent`, `new OpenAI`),
  or existing HTTP server (`express()`, `http.createServer`).
- Store the main source file(s) as `existingFiles`.

**Step 4: Check what's already present**
Run these **Grep** checks in parallel:
- `AgentApplication` in `src/**/*.ts` → `hasAgentApp`
- `CloudAdapter` in `src/**/*.ts` → `hasHosting`
- `ObservabilityManager` in `src/**/*.ts` → `hasObservability`
- `onAgentNotification` in `src/**/*.ts` → `hasNotifications`
- `McpToolRegistrationService` in `src/**/*.ts` → `hasWorkIQ`
- `ToolingManifest.json` exists → `hasManifest`

---

## Phase 0B — User Validation

Present all detections in one message:

```
Here's what we detected:
  • LLM Framework:      {agentStack ?? "not detected"}
  • Language:           NodeJS
  • Existing LLM code:  {existingFiles.join(', ') || "not found"}

Already present:
  • Hosting layer:      {hasHosting ? "✅" : "❌"}
  • Agent class:        {hasAgentApp ? "✅" : "❌"}
  • Observability:      {hasObservability ? "✅" : "❌"}
  • Notifications:      {hasNotifications ? "✅" : "❌"}
  • WorkIQ tools:       {hasWorkIQ ? "✅" : "❌"}

Reply **yes** to confirm, or describe corrections (e.g. "it's OpenAI not LangChain").
```

After confirmation, write `.a365-workspace-detection.json`.

If `agentStack` is still unknown, ask:
> "Which LLM framework does this agent use? (LangChain / OpenAI Agents SDK / Claude SDK / Other)"

If `agentStack` is `Other`, tell the user:
> "This skill supports LangChain, OpenAI Agents SDK, and Claude SDK. For other frameworks,
> I'll add the hosting layer and agent class, but you'll need to integrate your LLM calls
> manually into `client.ts`."

---

## Phase 0C — Create Task List

Create tasks only for items not already present (from `hasHosting`, `hasAgentApp`, etc.):

```
TaskCreate: "Install required @microsoft/agents-* packages"
TaskCreate: "Configure tsconfig.json for node16 module resolution"  [skip if already correct]
TaskCreate: "Add src/token-cache.ts"                               [skip if exists]
TaskCreate: "Add src/index.ts — Express + CloudAdapter hosting"    [skip if hasHosting]
TaskCreate: "Add src/agent.ts — AgentApplication class"            [skip if hasAgentApp]
TaskCreate: "Add src/client.ts — client factory with observability" [skip if hasObservability]
TaskCreate: "Add ToolingManifest.json"                             [skip if hasManifest]
TaskCreate: "Update .env / .env.example with A365 variables"
TaskCreate: "Validate build"
```

Always include install, env update, and build tasks — they are safe to re-run.

---

## Phase 1 — Install Required Packages

**Mark task in progress: "Install required @microsoft/agents-* packages"**

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-ai-teammate.md`
for the package list for `{agentStack}`.

**Grep** `package.json` for `@microsoft/agents-hosting`. If already present, check each
required package individually and install only the missing ones.

```bash
# Install all required packages for the detected framework in one command
npm install <packages from reference doc>
```

Also install dev dependencies if missing (`typescript`, `ts-node`, `nodemon`, `@types/express`, `@types/node`).

**Mark task complete.**

---

## Phase 2 — Configure tsconfig.json

**Mark task in progress: "Configure tsconfig.json for node16 module resolution"**

**Read** `tsconfig.json` if it exists.

Check: `"module": "node16"` and `"moduleResolution": "node16"` are both present.

If missing or wrong, **Edit** (or **Write** if not present) `tsconfig.json` using the exact
config from the reference doc. Do NOT change `rootDir`/`outDir` if the user has customized them —
only update the module resolution fields if they are wrong.

**Mark task complete.**

---

## Phase 3 — Add src/token-cache.ts

**Mark task in progress: "Add src/token-cache.ts"**

**Glob** `src/token-cache.ts`. If it exists, **Read** it — check that `createAgenticTokenCacheKey`,
`tokenResolver`, and the default export are all present. Add anything missing.

If it does not exist, **Write** `src/token-cache.ts` using the exact pattern from the reference doc.

**Mark task complete.**

---

## Phase 4 — Add src/index.ts — Hosting Layer

**Mark task in progress: "Add src/index.ts — Express + CloudAdapter hosting"**

**Read** `src/index.ts` if it exists.

### If index.ts does NOT exist or has no CloudAdapter:

**Write** `src/index.ts` using the pattern from the reference doc.

### If index.ts already has an HTTP server (Express or other):

Migrate it to the CloudAdapter pattern:
1. Add `configDotenv()` as the very first line (before existing imports).
2. Replace or augment the existing server with `CloudAdapter`, `authorizeJWT`, and `loadAuthConfigFromEnv`.
3. Add `/api/health` endpoint BEFORE `authorizeJWT`.
4. Replace the existing message endpoint with `/api/messages` using `adapter.process()`.
5. Replace `server.listen('0.0.0.0', ...)` with the production/dev host detection pattern.
6. Preserve any existing routes or middleware the user has.

> **Non-destructive rule:** Never delete existing routes. Add the A365 routes alongside them.

**Mark task complete.**

---

## Phase 5 — Add src/agent.ts — Agent Class

**Mark task in progress: "Add src/agent.ts — AgentApplication class"**

**Read** `src/agent.ts` if it exists. **Grep** `AgentApplication` in `src/**/*.ts`.

### If agent.ts does NOT exist:

**Write** `src/agent.ts` using the full pattern from the reference doc.
- Replace `MyAgent` class name with a name derived from the project (e.g., from `package.json` `name` field).
- Replace `'user turn'` in `sessionDescription` with a brief description of what the agent does.

### If an AgentApplication subclass already exists:

Read the existing class and check each handler:
- `onAgentNotification('agents:*', ...)` with priority `1` and `[authHandlerName]` — add if missing
- `onActivity(ActivityTypes.Message, ...)` with `[authHandlerName]` — add auth restriction if missing
- `onActivity(ActivityTypes.InstallationUpdate, ...)` — add if missing
- `preloadObservabilityToken()` — add if missing
- `handleAgentNotificationActivity()` dispatching on `NotificationType.EmailNotification` — add if missing
- `handleEmailNotification()` using `createEmailResponseActivity` — add if missing
- `handleInstallationUpdateActivity()` — add if missing
- Typing indicator loop pattern in message handler — add if missing

Add only what is missing. Do not restructure existing code.

> **Critical import:** Ensure `import '@microsoft/agents-a365-notifications'` (side-effect form)
> is present in this file. Without it, notification routing silently breaks.

**Mark task complete.**

---

## Phase 6 — Add src/client.ts — Client Factory

**Mark task in progress: "Add src/client.ts — client factory with observability"**

This is the most important integration step — it wraps the user's existing LLM code.

### 6.1 Read existing LLM code

**Read** all files in `existingFiles`. Identify:
- How the LLM model is instantiated (constructor, env vars used)
- How agents/chains are created
- How the LLM is invoked (method name, input/output format)
- Any existing tools or system prompts

### 6.2 If client.ts does NOT exist

**Write** `src/client.ts` using the `{agentStack}` variant from the reference doc.
- Preserve the user's existing model instantiation (API keys, deployment names, etc.)
- Preserve the user's existing system prompt if one exists — replace the placeholder
- Preserve any existing tools or LangGraph configurations

### 6.3 If client.ts already exists

Check for each required element and add what is missing:
- `ObservabilityManager.configure().start()` at module level before other imports
- `Agent365ExporterOptions` with `maxQueueSize: 10` and `withExporterOptions()`
- Token resolver using `AgenticTokenCacheInstance.getObservabilityToken` (or custom when
  `Use_Custom_Resolver=true`)
- `McpToolRegistrationService` module-level singleton
- `getClient()` factory calling `toolService.addToolServersToAgent()`
- `Client` interface with `invokeInferenceScope(prompt: string): Promise<string>`
- `invokeInferenceScope()` using `InferenceScope.start()` with `withActiveSpanAsync`,
  `recordInputMessages`, `recordOutputMessages`, `recordFinishReasons`, and `scope.dispose()`
  in a `finally` block

### 6.4 Wire existing LLM invocation

The user's existing LLM invocation goes INSIDE `invokeInferenceScope()` where the `invokeAgent()`
call is. If the user's invocation is in a different file, import it or inline it here.

Show the user a diff summary of what was added to their existing code.

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

## Phase 8 — Update .env / .env.example

**Mark task in progress: "Update .env / .env.example with A365 variables"**

**Read** `.env.example` or `.env` — whichever exists. Identify which A365 variables are missing.

Add only the missing variables from the reference doc template, appended to the end of the
existing file. Do NOT overwrite or reorder existing variables.

Variables to ensure are present:
- `ENABLE_A365_OBSERVABILITY_EXPORTER=false`
- `Use_Custom_Resolver=false`
- `A365_OBSERVABILITY_LOG_LEVEL=`
- `SERVICE_NAME=my-agent`
- `BEARER_TOKEN=`
- `NODE_ENV=development`
- `PORT=3978`
- `agentic_type=agentic`
- `agentic_altBlueprintConnectionName=service_connection`
- `agentic_scopes=ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default`
- `connections__service_connection__settings__clientId=`
- `connections__service_connection__settings__clientSecret=`
- `connections__service_connection__settings__tenantId=`
- `connectionsMap__0__serviceUrl=*`
- `connectionsMap__0__connection=service_connection`

Also add the LLM variables for the detected framework if not already present.

**Mark task complete.**

---

## Phase 9 — Validate Build

**Mark task in progress: "Validate build"**

```bash
npm install
npm run build || npx tsc --noEmit
```

If the build fails, show the errors and fix them:
- Missing type imports → add the correct `@types/*` package
- Module resolution errors → check `tsconfig.json` `module`/`moduleResolution`
- Import path errors → check `.ts` extension in imports for `node16` module resolution
- `Cannot find module` → add the missing package

Do NOT revert changes on build failure — fix forward.

**Mark task complete.**

---

## Phase 10 — Final Summary

**TaskList** — show all completed tasks.

```
✅ AI Teammate transformation complete!

Your agent now has:
  • Hosting layer:     Express + CloudAdapter + JWT auth (/api/health, /api/messages)
  • Agent routing:     AgentApplication with message, notification, lifecycle handlers
  • Observability:     ObservabilityManager + BaggageBuilder + InferenceScope
  • Notifications:     Email notification handling + install/uninstall lifecycle
  • WorkIQ tools:      McpToolRegistrationService (add tools with add-workiq-tools skill)
  • Token cache:       Built-in AgenticTokenCacheInstance (or custom via Use_Custom_Resolver)

Next steps:
  1. Run: a365 setup  — register a Blueprint and messaging endpoint with Agent 365
  2. Test locally:    npm run dev  (starts on http://127.0.0.1:3978)
  3. Health check:    curl http://localhost:3978/api/health
  4. Add WorkIQ tools: run the add-workiq-tools skill
  5. Deploy your agent to a hosting provider and run a365 setup to register the endpoint
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| `agentStack` not detected | Ask the user; default to LangChain patterns if still unclear |
| Existing `index.ts` has complex custom middleware | Preserve it; add A365 routes alongside existing ones |
| `client.ts` uses a framework not in reference (e.g., LlamaIndex) | Add hosting + agent layers; add observability init; leave LLM invocation as-is and tell user what to integrate manually |
| Build fails with `module` errors | Ensure both `"module": "node16"` AND `"moduleResolution": "node16"` in tsconfig |
| Build fails with `import ... from 'langchain'` not found | Run `npm install langchain @langchain/core @langchain/openai @langchain/langgraph` |
| `AgentApplication` import not found | Check `@microsoft/agents-hosting` is installed |

---

## Idempotency

On re-runs, detect what is already present (Phase 0A checks) and skip completed phases.
Never overwrite a file that already has the required pattern — only add what is missing.

---

## References

- **Reference patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-ai-teammate.md`
- **Agent detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **Observability details:** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/references/nodejs-observability.md`
- **WorkIQ tools:** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/references/nodejs-workiq.md`
- **Notifications:** `${CLAUDE_PLUGIN_ROOT}/skills/make-ai-teammate/references/nodejs-notifications.md`
- **Blueprint registration:** run the `a365-setup` skill after this skill completes
