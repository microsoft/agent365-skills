# Agent 365 Skills — GitHub Copilot Instructions

This repository contains two skills for instrumenting and registering Microsoft Agent 365 agents.
When a user asks for any of the trigger phrases below, follow the corresponding SKILL.md exactly.

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
1. Detects whether the agent is .NET AgentFramework or Node.js LangChain
2. Installs `Microsoft.Agents.A365.Observability` (NuGet) or `@microsoft/agents-a365-observability` (npm)
3. Wires `AddA365Tracing()` / `ObservabilityManager.configure()` in the entry point
4. Adds `BaggageBuilder` context (tenant/agent/correlation IDs) to the message handler
5. Implements the agentic token resolver with 5-minute caching
6. Updates `appsettings.json` / `.env` with observability config AND `Logging.LogLevel` entries
7. Validates the build passes (`dotnet build` / `npm run build`)

**Reference patterns:**
- .NET: [plugins/agent365/skills/instrument-observability/references/dotnet-observability.md](../plugins/agent365/skills/instrument-observability/references/dotnet-observability.md)
- Node.js: [plugins/agent365/skills/instrument-observability/references/nodejs-observability.md](../plugins/agent365/skills/instrument-observability/references/nodejs-observability.md)

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

**Summary of what this skill does:**
1. Validates `a365` CLI, `az` CLI, and `dotnet` are installed
2. Guides `a365 config init` with derived naming conventions
3. Runs `a365 setup all` (blueprint + permissions + endpoint registration)
4. Handles the Global Administrator consent handoff workflow
5. Provides a summary with the blueprint ID and next steps

**This skill does NOT:** provision Azure infrastructure, deploy code, or publish to Admin Center.

---

## Agent Detection

When identifying the agent type, follow the heuristics in:
[plugins/agent365/shared/agent-detection.md](../plugins/agent365/shared/agent-detection.md)

Key rules:
- `.csproj` referencing `Microsoft.Agent.*` or `Microsoft.Agents.*` → **.NET AgentFramework**
- `package.json` referencing `@langchain/*` → **Node.js LangChain**
- Teams / M365 / BizChat agents → **not supported** (stop with clear message)

---

## Code Conventions

All code added by these skills must be marked with:
```
// A365 Observability — best-effort instrumentation (verify against official sample)
```

Skills are **additive and idempotent** — never delete or restructure existing agent code.
