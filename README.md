# Agent 365 Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Agent skills and MCP configuration for [Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/) — works with Claude Code and GitHub Copilot. Six skills cover the full A365 lifecycle: transforming agents into AI Teammates, registering Blueprints for Discoverability or Observability paths, wiring WorkIQ MCP tools, instrumenting observability, and local testing with AgentsPlayground.

Browse the [`plugins/agent365/skills/`](https://github.com/microsoft/agent365-skills/blob/main/plugins/agent365/skills) folder for the full catalog.

---

## Prerequisites

- **Microsoft Agent 365** tenant with developer access
- **Node.js 18+**, **.NET 8.0+**, or **Python 3.11+** (depending on your agent)
- **a365 CLI** — `dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease`
- **Azure CLI** — `winget install Microsoft.AzureCLI` (Windows) or `brew install azure-cli` (macOS)

---

## Getting Started

### Claude Code

```
/plugin marketplace add https://github.com/microsoft/agent365-skills
/plugin install agent365@agent365-skills
```

### GitHub Copilot

```
copilot plugin marketplace add microsoft/agent365-skills
copilot plugin install agent365@agent365-skills
```

---

## Recommended Workflow

Three entry points — choose the one that fits your goal:

```
        make-ai-teammate          make-a365-agent          a365-setup
        (AI Teammate path)        (Standard / CEA)    (verifies CLI + Azure,
               ↓                        ↓               then delegates to one
         a365 setup all           a365 setup all          of the two above)
          + publish + Teams
               ↓                        ↓
    ┌──────────┴────────┐   ┌───────────┴───────────┐
    │                   │   │                       │
instrument-         add-workiq-tools     instrument-      add-workiq-tools
observability       (optional)           observability    (optional)
(strongly rec.)                          (optional)

test-local   ← no prerequisite; can run after any step
```

`a365-setup` writes `.a365-workspace-detection.json`. The `add-workiq-tools` and
`instrument-observability` skills read that file to skip re-detection and to confirm
the agent is registered before they run.

**Already have a registered Standard Agent?** You can add WorkIQ and Observability at any time without re-running setup:

```
"Add WorkIQ tools to this agent"          → add-workiq-tools
"Add observability to this agent"         → instrument-observability
```

Both skills detect the existing registration from `.a365-workspace-detection.json` and run standalone.

---

## Skills

### `make-ai-teammate` — Transform Any Agent into an AI Teammate

An **AI Teammate** is an agent registered with Microsoft Agent 365 that can receive direct messages in Microsoft Teams, respond to email notifications, and access Microsoft 365 data through WorkIQ tools — all authenticated through your tenant's Entra ID.

**Before this skill:** Your agent is a standalone script or HTTP server with no Teams presence.

**After this skill:** Your agent has the full A365 hosting layer — Express + CloudAdapter (Node.js), ASP.NET Core (\.NET), or aiohttp (Python) — with an AgentApplication class, message routing, typing indicators, email notification handling, ToolingManifest.json, and all required packages. Ready to register with `a365-setup`.

**Trigger phrases:**
```
"Make this agent an AI Teammate"      "Transform agent to AI Teammate"
"Add AI Teammate hosting"             "Wire up M365 hosting"
"Convert agent to Teams agent"        "Add CloudAdapter to this agent"
```

---

### `a365-setup` — A365 Onboarding Entry Point

Detects your agent stack and asks which capabilities you want, then delegates to the right skill:

| Path | Delegated to |
|------|-------------|
| **AI Teammate** | `make-ai-teammate` — full code generation + registration + publish |
| **Discoverability / Observability / WorkIQ** | `make-a365-agent` — Blueprint provisioning + optional observability/WorkIQ |

Handles Steps 1–2 for every path: installs/updates the a365 CLI, validates Azure CLI login, checks Entra ID roles, and confirms language-specific build tools. After prerequisites are confirmed, all remaining work is handed off.

**Trigger phrases:**
```
"Run a365 setup"         "Create blueprint"
"Register agent"         "Onboard agent"
"Provision agent"        "Publish agent"
```

---

### `make-a365-agent` — Provision Non-AI Teammate Agents

Provisions a non-AI Teammate agent with Agent 365 — for Discoverability, Observability, and WorkIQ paths. Normally invoked from `a365-setup` after CLI and Azure prerequisites are confirmed, but can also be called directly.

| Capability | What it does |
|-----------|-------------|
| **Discoverability** | Blueprint + Entra permissions. Agent appears in the M365 catalog. |
| **Discoverability + Observability** | Same, then invokes `instrument-observability`. |
| **Observability** (Custom Engine Agent) | Blueprint + permissions, then invokes `instrument-observability`. |
| **Observability + WorkIQ** | Same, then also invokes `add-workiq-tools`. |

Always shows a dry-run preview before applying anything. `a365 setup all` is idempotent — safe to re-run. WorkIQ MCP calls use OAuth On-Behalf-Of (OBO) tokens; users consent on first data access.

**Trigger phrases:**
```
"Discoverability setup"                "Observability setup"
"Provision agent with a365"            "Register agent for discoverability"
"Create a365 blueprint"                "Make this a custom engine agent"
```

---

### `add-workiq-tools` — Add WorkIQ MCP Tools

> **Prerequisite:** `a365-setup` must be run first.

Adds pre-built Microsoft 365 integration tools to your agent. Runs `a365 develop list-available`
to show the MCP server catalog, adds selected servers via `a365 develop add-mcp-servers`
(which updates `ToolingManifest.json`), wires `McpToolRegistrationService` in the agent code,
and guides the permissions handoff to your Global Administrator.

Available tools: Mail, Calendar, Teams, SharePoint, OneDrive, Word, User, Copilot, Dataverse/Dynamics 365.

**Trigger phrases:**
```
"Add workiq tools"                   "Add Work IQ Mail"
"Add work intelligence tools"        "Add MCP tools to this agent"
```

---

### `instrument-observability` — Add A365 Observability

> **Prerequisite:** `a365-setup` must be run first.

Instruments OpenTelemetry-based tracing, context propagation, and the A365 exporter. Before
wiring any code, asks a two-stage question to determine **agent kind** (AI Teammate or System
Agent) and **auth mode** (`user-delegated`, `agentic-identity`, or `S2S`) — the answers drive
which token path is wired:

- **user-delegated / agentic-identity** (OBO): `AddAgenticTracingExporter` + per-turn `RegisterObservability` with `AgenticTokenStruct`
- **S2S** (.NET only): creates `Observability/ObservabilityServiceExtensions.cs` and `Observability/ObservabilityTokenService.cs` scaffolds (3-hop FMI token chain) + `AddAgent365Observability()` — no per-turn token call

All new code is marked `// A365 Observability — best-effort instrumentation` and changes are non-destructive and idempotent.

**Trigger phrases:**
```
"Instrument observability"              "Add A365 observability"
"Enable tracing"                        "Add OTel"
"Instrument for Defender"               "Add telemetry"
"Add A365 observability to this Python agent"
```

---

### `test-local` — Local Testing with AgentsPlayground

Tests your agent locally without deploying to Azure or Teams. Checks prerequisites
(`agentsplayground` CLI, build tools), builds the agent, starts it in the background on
port 3978, and opens AgentsPlayground pointed at your local endpoint — no Bot Framework
auth required.

**Trigger phrases:**
```
"Test this agent locally"        "Run agent locally"
"Open AgentsPlayground"          "Launch local test session"
"Local test this agent"          "Test without deploying"
```

---

## Starter Prompts

**Step 1 — Transform your agent code:**
```
Make this agent an AI Teammate.
```

**Step 2 — Register with Agent 365:**
```
Register this agent as an AI Teammate — create the blueprint, grant permissions,
and register my messaging endpoint.
```

**Step 3a — Add WorkIQ tools:**
```
Add Work IQ Mail and Work IQ Calendar to this agent.
```

**Step 3b — Add observability:**
```
Instrument observability for this agent.
```

**Step 4 — Test locally:**
```
Test this agent locally without deploying to Teams.
```

---

**Full flow in one prompt:**
```
This agent has never been registered with Agent 365. Walk me through the full AI
Teammate setup: transform the code, register a blueprint, add WorkIQ Mail and
Calendar tools, instrument observability, and test it locally.
```

**Transform a .NET AgentFramework agent:**
```
I have a .NET AgentFramework agent. Make it a Microsoft Agent 365 AI Teammate
with Teams hosting and email notification handling.
```

**Transform a Python agent:**
```
I have a Python agent using agent-framework-azure-ai. Make it a Microsoft Agent 365
AI Teammate with aiohttp hosting and email notification handling.
```

**Register for Discoverability only:**
```
I want to register this agent so it shows up in the M365 catalog.
Set up Discoverability — I'll handle hosting myself.
```

**Discoverability + Observability:**
```
Register this agent for discoverability and add A365 observability so I can
track LLM calls and tool invocations in Microsoft Defender.
```

**Custom Engine Agent — add observability and WorkIQ:**
```
This is a Custom Engine Agent available in Microsoft Teams and Copilot.
Add A365 observability and WorkIQ Mail, Calendar, and Teams tools.
```

**Add specific WorkIQ tools to an already-registered agent:**
```
Add Work IQ Mail and Work IQ Calendar to this agent.
Our blueprint already exists — I'll need to know what to give our Global Administrator.
```

**System Agent with S2S observability (.NET):**
```
This is a .NET System Agent that runs autonomously — no signed-in user.
Add A365 observability with S2S auth (FMI token chain).
```

**Check what's already configured:**
```
Check which Agent 365 skills have already been applied to this agent and tell me what's missing.
```

---

## What's Included

- **6 skills** covering full AI Teammate transformation, Blueprint provisioning for all capability paths, WorkIQ MCP tools, observability instrumentation, and local testing with AgentsPlayground
- **Multi-language support** — Node.js (LangChain, OpenAI Agents SDK, Claude SDK, CopilotStudio, Semantic Kernel, Google ADK), .NET (AgentFramework, Semantic Kernel), and Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK)
- **Auth mode detection** — two-stage question flow determines agent kind (AI Teammate vs System Agent) and auth mode (user-delegated / agentic-identity / S2S); drives the correct observability and WorkIQ token path; cached in `.a365-workspace-detection.json` across skills
- **Automatic agent detection** — skills detect your LLM framework, programming language, and Custom Engine Agent status, then ask validation questions before any code runs
- **Non-destructive and idempotent** — skills wrap existing code without deleting anything; re-running skips what is already configured
- **WorkIQ MCP tools** — pre-built M365 integrations for Mail, Calendar, Teams, SharePoint, OneDrive, Word, User profiles, Copilot, and Dataverse/Dynamics 365

---

## Local Development

Clone the repository first:

```bash
git clone https://github.com/microsoft/agent365-skills.git
```

### Testing with Claude Code

```bash
# 1. Open your agent project
cd my-agent-project

# 2. Launch Claude Code with the plugin loaded from your local clone
claude --plugin-dir "/path/to/agent365-skills/plugins/agent365"

# 3. Start with a trigger phrase, e.g.:
#    "Make this agent an AI Teammate"
```

The `--plugin-dir` path must be in double quotes if it contains spaces. Use the absolute path.

### Testing with GitHub Copilot

```bash
copilot plugin marketplace add /path/to/agent365-skills
copilot plugin install agent365@agent365-skills
```

To reinstall after pulling or making local changes:

```bash
copilot plugin uninstall agent365@agent365-skills
copilot plugin install agent365@agent365-skills
```

---

## Safety & Security

The plugin is designed around a least-privilege model — it cannot exceed the permissions of the authenticated user. Key safeguards:

- **CLI authorization** — All `a365` commands authenticate via Azure CLI or MSAL; the plugin passes credentials through to the CLI and never stores them
- **Read-before-write** — Every skill reads and shows existing configuration before making any changes; destructive operations require explicit user confirmation
- **No automatic permission grants** — Permissions are always explained and require either `a365 setup all` (developer-run) or `a365 setup permissions mcp` (Global Administrator); the plugin never silently grants access
- **ToolingManifest.json is CLI-managed** — WorkIQ servers are added only via `a365 develop add-mcp-servers`; the plugin never hand-edits the manifest
- **Additive changes only** — Skills never delete or restructure existing agent code; all added code is marked with a comment identifying the skill that added it
- **No plugin telemetry** — The plugin does not collect or transmit usage analytics; data flows only to your Azure tenant and to the AI host (Claude or Copilot) as part of normal operation

---

## Documentation

- [Agent 365 Developer Docs](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/)
- [A365 CLI Develop Commands](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/reference/cli/develop)
- [A365 Observability](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/observability)
- [AI-Guided Setup](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/ai-guided-setup)
- [Node.js LangChain Sample](https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/langchain/sample-agent)
- [Node.js OpenAI Sample](https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/openai/sample-agent)
- [Node.js Claude Sample](https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/claude/sample-agent)
- [.NET AgentFramework Sample](https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent)
- [Python AgentFramework Sample](https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework/sample-agent)

---

## Contributing

We welcome contributions — new skills, improvements to existing ones, and bug fixes. See [AGENTS.md](./AGENTS.md) for guidelines.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

---

## License

This project is licensed under the [MIT License](./LICENSE).

---

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
