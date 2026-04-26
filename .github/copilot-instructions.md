# Agent 365 Skills — GitHub Copilot Instructions

This repository contains six skills for instrumenting and registering Microsoft Agent 365 agents.
When a user asks for any of the trigger phrases below, follow the corresponding SKILL.md exactly.

---

## Skill: make-ai-teammate

**Full instructions:** [plugins/agent365/skills/make-ai-teammate/SKILL.md](../plugins/agent365/skills/make-ai-teammate/SKILL.md)

**Trigger phrases:**
- "make this agent an ai teammate"
- "transform agent to ai teammate"
- "add ai teammate hosting"
- "wire up m365 hosting"
- "add agent365 hosting layer"
- "convert agent to teams agent"
- "add cloudadapter to this agent"
- "make this agent work with teams"

**Summary of what this skill does:**
1. Detects the agent language/framework (Node.js LangChain/OpenAI/Claude SDK, .NET AgentFramework, Python AgentFramework)
2. Adds the hosting layer — Express + CloudAdapter (Node.js), ASP.NET Core (\.NET), or aiohttp (Python)
3. Creates the AgentApplication subclass with message routing, typing indicators, and email notification handling
4. Writes an empty `ToolingManifest.json` and all required environment variables
5. Offers `instrument-observability` (Strongly Recommended) and `add-workiq-tools` (Optional) as follow-on steps

**Reference patterns:**
- Node.js: [plugins/agent365/skills/make-ai-teammate/references/nodejs-ai-teammate.md](../plugins/agent365/skills/make-ai-teammate/references/nodejs-ai-teammate.md)
- Node.js notifications: [plugins/agent365/skills/make-ai-teammate/references/nodejs-notifications.md](../plugins/agent365/skills/make-ai-teammate/references/nodejs-notifications.md)
- .NET: [plugins/agent365/skills/make-ai-teammate/references/dotnet-ai-teammate.md](../plugins/agent365/skills/make-ai-teammate/references/dotnet-ai-teammate.md)
- Python: [plugins/agent365/skills/make-ai-teammate/references/python-ai-teammate.md](../plugins/agent365/skills/make-ai-teammate/references/python-ai-teammate.md)

---

## Skill: a365-setup

**Full instructions:** [plugins/agent365/skills/a365-setup/SKILL.md](../plugins/agent365/skills/a365-setup/SKILL.md)

**Trigger phrases:**
- "run a365 setup"
- "create blueprint"
- "register agent"
- "setup agent blueprint"
- "onboard agent"
- "create agent blueprint"
- "run cli setup"
- "run a365 register"
- "register blueprint"
- "provision agent"
- "publish agent"

**Summary of what this skill does:**
1. Installs/updates the `a365` CLI and validates Azure CLI login
2. Checks Entra ID roles and confirms language-specific build tools are present
3. Asks which capability path the user wants (AI Teammate, Discoverability, Observability, WorkIQ)
4. Delegates to `make-ai-teammate` for the AI Teammate path, or to `make-a365-agent` for all other paths

**This skill does NOT:** run `a365 setup all` itself — it delegates that to `make-ai-teammate` or `make-a365-agent`.

---

## Skill: make-a365-agent

**Full instructions:** [plugins/agent365/skills/make-a365-agent/SKILL.md](../plugins/agent365/skills/make-a365-agent/SKILL.md)

**Trigger phrases:**
- "provision agent with a365"
- "run a365 setup all"
- "create a365 blueprint"
- "discoverability setup"
- "observability setup"
- "register agent for discoverability"
- "set up agent for observability"
- "add workiq to this agent"
- "make this a custom engine agent"

**Summary of what this skill does:**
1. Shows a dry-run preview of all `a365` operations before applying anything
2. Runs `a365 setup all` — creates the Blueprint and Entra ID permissions
3. After setup, always offers `instrument-observability` and `add-workiq-tools` as optional add-ons
4. Guides the Global Administrator consent handoff workflow for WorkIQ permissions

**Normally delegated to from `a365-setup`** after CLI and Azure prerequisites are confirmed. Can also be invoked directly.

---

## Skill: add-workiq-tools

**Full instructions:** [plugins/agent365/skills/add-workiq-tools/SKILL.md](../plugins/agent365/skills/add-workiq-tools/SKILL.md)

**Trigger phrases:**
- "add workiq tools"
- "add a365 tools"
- "add work intelligence tools"
- "add microsoft 365 tools"
- "wire up workiq"
- "add mcp tools to this agent"
- "add work iq mail"
- "add work iq calendar"

**Summary of what this skill does:**
1. Runs `a365 develop list-available` to show the MCP server catalog
2. Adds selected servers via `a365 develop add-mcp-servers` (updates `ToolingManifest.json`)
3. Wires `McpToolRegistrationService` in the agent code (.NET, Node.js, or Python)
4. Guides the permissions handoff to the Global Administrator (`a365 setup permissions mcp`)

**Prerequisite:** `a365-setup` must be run first. Reads `.a365-workspace-detection.json` to skip re-detection.

**Reference patterns:**
- .NET: [plugins/agent365/skills/add-workiq-tools/references/dotnet-workiq.md](../plugins/agent365/skills/add-workiq-tools/references/dotnet-workiq.md)
- Node.js: [plugins/agent365/skills/add-workiq-tools/references/nodejs-workiq.md](../plugins/agent365/skills/add-workiq-tools/references/nodejs-workiq.md)
- Python: [plugins/agent365/skills/add-workiq-tools/references/python-workiq.md](../plugins/agent365/skills/add-workiq-tools/references/python-workiq.md)

---

## Skill: instrument-observability

**Full instructions:** [plugins/agent365/skills/instrument-observability/SKILL.md](../plugins/agent365/skills/instrument-observability/SKILL.md)

**Trigger phrases:**
- "instrument observability for this agent"
- "add a365 observability"
- "add observability"
- "enable tracing"
- "add otel"
- "instrument agent"
- "add telemetry"
- "observe this agent"
- "set up observability"
- "add tracing"
- "emit traces"
- "instrument for defender"
- "instrument traces"
- "add a365 traces"
- "wire up observability"
- "make my agent a365 compliant"
- "make this agent a365 compliant"
- "make this agent a365 ready"
- "prepare agent for a365"

**Summary of what this skill does:**
1. Asks a two-stage question: agent kind (AI Teammate / Digital Worker or Non-DW / Non-Digital Worker) then auth mode (`user-delegated`, `agentic-identity`, or `S2S`)
2. Installs the observability package (`Microsoft.Agents.A365.Observability.Runtime` + `Microsoft.Agents.A365.Observability.Hosting` for .NET; `@microsoft/agents-a365-observability` + `@microsoft/agents-a365-observability-hosting` for Node.js; `microsoft-agents-a365-observability-core` + `microsoft-agents-a365-observability-hosting` for Python)
3. **OBO path** (user-delegated / agentic-identity): wires `AddAgenticTracingExporter()` and per-turn `RegisterObservability(new AgenticTokenStruct(..., "AGENTIC"))`
4. **S2S path (.NET only)**: creates `Observability/ObservabilityServiceExtensions.cs` and `Observability/ObservabilityTokenService.cs` scaffolds; wires `AddAgent365Observability()` and `InvokeAgentScope.Start().FromTurnContext()`
5. Updates `appsettings.json` with `Agent365Observability` section (S2S: adds `ClientId` + `ClientSecret` for FMI token chain); creates `appsettings.Development.json` with exporter disabled
6. Validates the build passes

**Auth mode note:** All three `authMode` values use `authHandlerName: "AGENTIC"` in SDK code — the difference is Azure AD provisioning, not code structure. S2S is .NET-only.

**Prerequisite:** `a365-setup` must be run first. Reads `.a365-workspace-detection.json` to skip re-detection.

**Reference patterns:**
- .NET: [plugins/agent365/skills/instrument-observability/references/dotnet-observability.md](../plugins/agent365/skills/instrument-observability/references/dotnet-observability.md)
- Node.js: [plugins/agent365/skills/instrument-observability/references/nodejs-observability.md](../plugins/agent365/skills/instrument-observability/references/nodejs-observability.md)
- Python: [plugins/agent365/skills/instrument-observability/references/python-observability.md](../plugins/agent365/skills/instrument-observability/references/python-observability.md)

---

## Skill: test-local

**Full instructions:** [plugins/agent365/skills/test-local/SKILL.md](../plugins/agent365/skills/test-local/SKILL.md)

**Trigger phrases:**
- "test this agent locally"
- "run agent locally"
- "open agentsplayground"
- "launch local test session"
- "local test this agent"
- "test without deploying"

**Summary of what this skill does:**
1. Detects agent language (.NET → port 5000, Node.js/Python → port 3978)
2. Checks `agentsplayground` CLI is installed — installs automatically if missing
3. Checks language-specific build tools are present; offers to install any that are missing
4. Builds the agent to confirm there are no compile errors
5. Starts the agent in the background and launches AgentsPlayground at the local endpoint

**Works for any AI Teammate stack:** AgentsPlayground connects to `/api/messages` over HTTP — the LLM framework on the server is invisible to it.

---

## Agent Detection

When identifying the agent type, follow the heuristics in:
[plugins/agent365/shared/agent-detection.md](../plugins/agent365/shared/agent-detection.md)

Key rules:
- `.csproj` referencing `Microsoft.Agent.*` or `Microsoft.Agents.*` → **.NET AgentFramework**
- `package.json` referencing `@langchain/*` → **Node.js LangChain**
- `package.json` referencing `openai-agents` → **Node.js OpenAI Agents SDK**
- `package.json` referencing `@anthropic-ai/sdk` → **Node.js Claude SDK**
- `.py` files + `pyproject.toml` or `requirements.txt` referencing `microsoft-agents-*` → **Python AgentFramework**
- `.py` files + `langchain` in requirements → **Python LangChain**

---

## Code Conventions

All code added by observability instrumentation must be marked with the language-appropriate comment form:
- C# / JavaScript / TypeScript: `// A365 Observability — best-effort instrumentation (verify against official sample)`
- Python: `# A365 Observability — best-effort instrumentation (verify against official sample)`

All code added by WorkIQ wiring must be marked with the language-appropriate comment form:
- C# / JavaScript / TypeScript: `// A365 WorkIQ — added by add-workiq-tools skill`
- Python: `# A365 WorkIQ — added by add-workiq-tools skill`

Skills are **additive and idempotent** — never delete or restructure existing agent code.

## Skill Dependency Chain

```
a365-setup  →  make-ai-teammate    (AI Teammate path)
            →  make-a365-agent     (Discoverability / Observability / WorkIQ paths)

make-ai-teammate  →  instrument-observability  (Strongly Recommended)
                  →  add-workiq-tools          (Optional)

make-a365-agent   →  instrument-observability  (Observability paths)
                  →  add-workiq-tools          (WorkIQ paths)

test-local  (no prerequisite — works after any step)
```
