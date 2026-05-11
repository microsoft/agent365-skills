# Agent 365 Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.5.0-blue)](https://github.com/microsoft/agent365-skills/blob/main/plugins/agent365/.claude-plugin/plugin.json)

Agent skills and MCP configuration for [Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/) — works with Claude Code and GitHub Copilot. Six skills cover the full A365 lifecycle: transforming agents into AI Teammates, registering Blueprints for registration or Observability paths, wiring WorkIQ MCP servers, instrumenting observability, and local testing with AgentsPlayground.

Browse the [`plugins/agent365/skills/`](https://github.com/microsoft/agent365-skills/blob/main/plugins/agent365/skills) folder for the full catalog.

---

## Prerequisites

- **Microsoft Agent 365** tenant with developer access
- **Node.js 18+**, **.NET 8.0+**, or **Python 3.11+** (depending on your agent)
- **a365 CLI** — `dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease`
- **Azure CLI** — `winget install Microsoft.AzureCLI` (Windows) or `brew install azure-cli` (macOS)

---

## Getting Started

### Claude Code (app or web)

Run these inside an active Claude Code session:

```
/plugin marketplace add https://github.com/microsoft/agent365-skills
/plugin install agent365@agent365-skills
```

### Claude Code CLI

Launch Claude Code from your agent project directory with the plugin loaded:

```bash
cd my-agent-project
claude --plugin-dir "/path/to/agent365-skills/plugins/agent365"
```

Or install via the marketplace first (inside a Claude Code session), then the CLI picks it up automatically on every `claude` invocation.

### GitHub Copilot CLI — `gh skill` (recommended)

The fastest way to install for GitHub Copilot CLI and VS Code agent mode:

```bash
gh skill add microsoft/agent365-skills
```

This reads `.github/plugin/marketplace.json` and installs all six skills directly into your Copilot CLI session. Use `/skills list` to verify, and invoke skills by name:

```bash
gh copilot suggest "Make this agent an AI Teammate"
gh copilot suggest "Instrument observability for this agent"
```

### VS Code agent mode — `.agents/skills/` (open standard)

To install into your project for VS Code agent mode, Copilot cloud agent, and any agentskills.io-compatible tool, run the installer from your agent project directory:

```bash
cd my-agent-project
node /path/to/agent365-skills/scripts/install.js
```

The installer copies all six skill directories into `.agents/skills/` in your project. Skills then appear automatically in VS Code's Configure Skills menu (`/skills list`) and are loaded on demand by VS Code agent mode and the Copilot cloud agent.

### GitHub Copilot CLI (`gh copilot`)

The same `.github/copilot-instructions.md` file is read by `gh copilot` when run inside a workspace that contains it. Run the installer above, then use `gh copilot suggest` or `gh copilot explain` with any of the trigger phrases:

```bash
gh copilot suggest "Make this agent an AI Teammate"
gh copilot suggest "Instrument observability for this agent"
```

---

## Recommended Workflow

**Start with `a365-setup`** — it verifies CLI and Azure prerequisites, asks which capabilities you want, then delegates to the right skill:

```
a365-setup  (recommended entry point — handles CLI, Azure, Blueprint)
│
├─ AI Teammate  → make-ai-teammate  (adds hosting layer + AI Teammate identity)
│     user OBO or OBO Agent Identity                ├─ instrument-observability  (optional, offered automatically)
│     (always OBO-based)                            └─ add-workiq-tools          (optional, offered automatically)
│
└─ Agent (Non AI Teammate) → make-a365-agent  (Blueprint + Entra permissions)
      Assistive (OBO) or                       ├─ instrument-observability  (optional, offered automatically)
      Autonomous (S2S)                         └─ add-workiq-tools          (optional, Assistive only)

test-local  ← standalone; run at any point to test your agent locally
```

`a365-setup` writes `.a365-workspace-detection.json`. All downstream skills read this file to skip re-detection.

**Already registered? Run skills directly:**

```
"Make this agent an AI Teammate"    → make-ai-teammate       (Blueprint must exist)
"Add observability to this agent"   → instrument-observability
"Add WorkIQ tools to this agent"    → add-workiq-tools
"Test this agent locally"           → test-local
```

---

## Skills

### `make-ai-teammate` — Transform Any Agent into an AI Teammate

An **AI Teammate** is an agent with a first-class M365 identity. It has an Agentic User with a UPN, mailbox, and presence in your tenant, and behaves like a real colleague inside Teams, Outlook, and other Microsoft 365 apps. It is designed for ongoing, human-like teamwork.

**Before this skill:** Your agent is a standalone script or HTTP server with no Teams presence.

**After this skill:** Your agent has the full A365 hosting layer — Express + CloudAdapter (Node.js), ASP.NET Core (\.NET), or aiohttp (Python) — with an AgentApplication class, message routing, typing indicators, email notification handling, and ToolingManifest.json. Then offers Observability and WorkIQ tools as optional add-ons.

**Prerequisite:** `a365-setup` must create the Blueprint and Agentic User identity first. This skill is normally invoked automatically from `a365-setup` after prerequisites are confirmed; it can also be run directly against an already-registered agent.

**Trigger phrases:**
```
"Make this agent an AI Teammate"         "Transform this agent into an AI Teammate"
"Publish this agent to Teams"            "Make this agent available in Microsoft Teams"
"Add Teams support to this agent"        "Convert this agent to a Teams agent"
"Publish this agent to Microsoft Copilot"
```

---

### `a365-setup` — A365 Onboarding Entry Point

Detects your agent stack and asks which capabilities you want, then delegates to the right skill:

| Path | Delegated to |
|------|-------------|
| **AI Teammate** | `make-ai-teammate` — adds A365 hosting layer + AI Teammate identity (Blueprint created by a365-setup) |
| **Agent (Non AI Teammate)** — Registration / Observability / WorkIQ | `make-a365-agent` — Blueprint provisioning + optional observability/WorkIQ |

Handles Steps 1–2 for every path: installs/updates the a365 CLI, validates Azure CLI login, checks Entra ID roles, and confirms language-specific build tools. After prerequisites are confirmed, all remaining work is handed off.

**Trigger phrases:**
```
"Set up Agent 365 for this agent"    "Run a365 setup"
"Register this agent with Agent 365" "Onboard this agent to Agent 365"
"Make this agent an A365 agent"      "Make this agent discoverable in M365"
"Connect this agent to Agent 365"    "Create A365 blueprint"
```

---

### `make-a365-agent` — Provision Agent (Non AI Teammate) Agents

Provisions an **Agent (Non AI Teammate)** with Agent 365. A Standard Agent has no Agentic User identity (no UPN) — it is task-oriented, system-oriented, or assistive, and appears as a system or service agent rather than a virtual teammate. It authenticates via an Entra App ID or Agent Blueprint + Agent Identity, in one of two execution modes:

> **Taxonomy:** Agent (Non AI Teammate) is a broad category. **CEA (Custom Engine Agent) is a specific subset** — built on a custom runtime, often with Teams/M365 integration. CEA ⊂ Agent (Non AI Teammate), but not all Standard Agents are CEAs. Other Standard Agent types include Agent Builder agents, SharePoint agents, background automation / import / sync agents, policy / classifier agents, and 3P system agents with no Teams surface.
>
> CEA is the primary supported Standard Agent path. CEA is **not** supported as an AI Teammate.

- **Assistive (OBO)** — acts on behalf of the signed-in user via On-Behalf-Of flow
- **Autonomous (S2S / Service Principal)** — runs independently, no user required

Normally invoked from `a365-setup` after CLI and Azure prerequisites are confirmed, but can also be called directly.

| Capability | What it does |
|-----------|-------------|
| **Register** | Blueprint + Entra permissions. Agent appears in the Agent 365 catalog. |
| **Register + Observability** | Same, then invokes `instrument-observability`. |
| **Observability** (Custom Engine Agent / Standard Agent) | Blueprint + permissions, then invokes `instrument-observability`. Supports Assistive (OBO) and Autonomous (S2S). |
| **Observability + WorkIQ** | Same, then also invokes `add-workiq-tools`. |

Always shows a dry-run preview before applying anything. `a365 setup all` is idempotent — safe to re-run. WorkIQ MCP calls use OAuth On-Behalf-Of (OBO) tokens; users consent on first data access.

**Trigger phrases:**
```
"register this agent"    "Registration setup for this agent"
"Make this agent findable in the Agent 365 catalog"
"Make this a custom engine agent"            "Run a365 setup all"
"Create A365 blueprint for this agent"
```

---

### `add-workiq-tools` — Add WorkIQ MCP servers

> **Prerequisite:** `a365-setup` must be run first.
> **Auth requirement:** WorkIQ requires a user in the loop — supported for AI Teammates and Agent (Non AI Teammate) Assistive (OBO). Not available for Standard Agent Autonomous (S2S).

Adds pre-built Microsoft 365 integration tools to your agent. Runs `a365 develop list-available`
to show the MCP server catalog, adds selected servers via `a365 develop add-mcp-servers`
(which updates `ToolingManifest.json`), wires `McpToolRegistrationService` in the agent code,
and guides the permissions handoff to your Global Administrator. Supports .NET, Node.js, and Python.

Available tools: Mail, Calendar, Teams, SharePoint, OneDrive, Word, User, Copilot, Dataverse/Dynamics 365.

**Trigger phrases:**
```
"Add WorkIQ tools to this agent"          "Add Work Intelligence tools"
"Give this agent access to M365 data"     "Add Work IQ Mail to this agent"
"Give my agent access to email and calendar"
"Add SharePoint access to this agent"     "Add Work IQ Calendar to this agent"
```

---

### `instrument-observability` — Add A365 Observability

> **Prerequisite:** `a365-setup` must be run first.

Instruments OpenTelemetry-based tracing, context propagation, and the A365 exporter. Before
wiring any code, asks a two-stage question to determine **agent kind** and **auth mode** — the answers drive which token path is wired:

**Stage 1 — Agent kind:**
- **AI Teammate**: has Agentic User with UPN; then asks whether it uses `obo` (signed-in user) or `obo` (agent's own M365 identity — agentic identity). **Both support Observability and WorkIQ.**
- **Agent (Non AI Teammate)**: no Agentic User; then asks whether it is `obo` (Assistive OBO) or `s2s` (Autonomous / Service Principal). **Observability supports both; WorkIQ is obo only (Assistive mode).**

**Wiring by auth mode:**
- **obo / agentic-user (Assistive OBO)**: `AddAgenticTracingExporter` + per-turn `RegisterObservability` with `AgenticTokenStruct`
- **Autonomous S2S** (all languages): creates a scaffold token-service file per language (`Observability/ObservabilityTokenService.cs` for .NET, `observability/observability-token-service.ts` for Node.js, `observability/observability_token_service.py` for Python) that acquires the Observability API token (`api://9b975845-388f-4429-889e-eab1ef63949c/.default`) via MSAL client credentials and refreshes every 50 min — no per-turn token call

All new code is marked `// A365 Observability — best-effort instrumentation` and changes are non-destructive and idempotent.

**Trigger phrases:**
```
"Instrument observability for this agent"   "Add A365 observability to this agent"
"Add observability to this agent"           "Set up tracing for this agent"
"Make this agent visible in Microsoft Defender"
"Wire up OpenTelemetry for this agent"      "Enable Agent 365 telemetry"
"Add observability to this .NET agent"      "Add A365 observability to this Python agent"
```

---

### `test-local` — Local Testing with AgentsPlayground

Tests your agent locally without deploying to Azure or Teams. Checks prerequisites
(`agentsplayground` CLI, build tools), builds the agent, starts it in the background on
port 3978, and opens AgentsPlayground pointed at your local endpoint — no Bot Framework
auth required.

**Trigger phrases:**
```
"Test this agent locally"               "Run my agent locally"
"Open AgentsPlayground"                 "Launch AgentsPlayground"
"Start a local test session"            "Debug this agent locally"
"Test my agent without deploying to Teams"
```

---

## Starter Prompts

**New agent — full AI Teammate setup in one prompt:**
```
This is a new Node.js LangChain agent. Register it with Agent 365, transform it
into an AI Teammate so it can receive messages in Teams, add Work IQ Mail and
Calendar tools, instrument observability, and test it locally.
```

**Already have agent code — step by step:**

Step 1 — register and transform:
```
Set up Agent 365 for this agent and make it an AI Teammate available in Microsoft Teams.
```

Step 2 — add M365 data access:
```
Give this agent access to email and calendar through WorkIQ tools.
```

Step 3 — add observability:
```
Add A365 observability to this agent so I can track LLM calls and tool invocations in Microsoft Defender.
```

Step 4 — test locally:
```
Test this agent locally without deploying to Teams.
```

---

**Transform a .NET AgentFramework agent:**
```
I have a .NET AgentFramework agent. Make it a Microsoft Agent 365 AI Teammate
with Teams hosting and email notification handling.
```

**Transform a Python agent:**
```
I have a Python agent using AgentFramework. Make it a Microsoft Agent 365
AI Teammate with aiohttp hosting and email notification handling.
```

**Registration only (no Teams hosting):**
```
Register this agent so it shows up in the Agent 365 catalog.
I'll handle hosting myself — registration only.
```

**Registration + Observability:**
```
Register this agent and add A365 observability so I can
track LLM calls and tool invocations in Microsoft Defender.
```

**Custom Engine Agent (Agent (Non AI Teammate)) — add observability and WorkIQ:**
```
This is a Custom Engine Agent already available in Microsoft Teams and Copilot.
It is an Agent (Non AI Teammate) — not an AI Teammate.
Add A365 observability and WorkIQ Mail, Calendar, and Teams tools.
```

**Add specific WorkIQ tools to an already-registered agent:**
```
Add Work IQ Mail and Work IQ Calendar to this agent.
Our blueprint already exists — tell me what to give our Global Administrator.
```

**Agent (Non AI Teammate) with S2S observability (.NET):**
```
This is a .NET Agent (Non AI Teammate) that runs autonomously — no signed-in user.
Add A365 observability with S2S auth (MSAL client credentials).
```

**Check what's already configured:**
```
Check which Agent 365 capabilities have already been applied to this agent and tell me what's still missing.
```

---

## What's Included

- **6 skills** covering full AI Teammate transformation, Blueprint provisioning for all capability paths, WorkIQ MCP servers, observability instrumentation, and local testing with AgentsPlayground
- **Multi-language support** — Node.js (LangChain, OpenAI Agents SDK, Claude SDK, Semantic Kernel, Google ADK), .NET (AgentFramework, Semantic Kernel), and Python (AgentFramework, LangChain, OpenAI, Claude, Semantic Kernel, Google ADK)
- **Auth mode detection** — two-stage question flow determines agent kind (AI Teammate vs Agent (Non AI Teammate)) and auth mode (`obo` / `s2s` / `agentic-user`); drives the correct observability and WorkIQ token path; cached in `.a365-workspace-detection.json` across skills
- **Automatic agent detection** — skills detect your LLM framework, programming language, and Custom Engine Agent status, then ask validation questions before any code runs
- **Non-destructive and idempotent** — skills wrap existing code without deleting anything; re-running skips what is already configured
- **WorkIQ MCP servers** — pre-built M365 integrations for Mail, Calendar, Teams, SharePoint, OneDrive, Word, User profiles, Copilot, and Dataverse/Dynamics 365

---

## Local Development

Clone the repository first:

```bash
git clone https://github.com/microsoft/agent365-skills.git
```

### Testing with Claude Code CLI

```bash
# 1. Open your agent project
cd my-agent-project

# 2. Launch Claude Code with the plugin loaded from your local clone
claude --plugin-dir "/path/to/agent365-skills/plugins/agent365"

# 3. Start with a trigger phrase, e.g.:
#    "Make this agent an AI Teammate"
```

The `--plugin-dir` path must be in double quotes if it contains spaces. Use the absolute path.

### Testing with GitHub Copilot CLI or VS Code agent mode

```bash
# Preferred: install via gh skill (global, works in any project)
gh skill add microsoft/agent365-skills

# Or: copy skills to .agents/skills/ in your test project (open standard)
cd my-agent-project
node /path/to/agent365-skills/scripts/install.js
```

The installer always copies skill files into `.agents/skills/` (open standard — VS Code agent mode, Copilot cloud agent, Copilot CLI). If `gh skill` is available it also runs `gh skill add` for the CLI session. If neither is available, it falls back to `copilot-instructions.md`.

To update after pulling changes, re-run `gh skill add microsoft/agent365-skills` (idempotent) or delete `.agents/skills/` and re-run `install.js`.

---

## Safety & Security

The plugin is designed around a least-privilege model — it cannot exceed the permissions of the authenticated user. Key safeguards:

- **CLI authorization** — All `a365` commands authenticate via Azure CLI or MSAL; the plugin passes credentials through to the CLI and never stores them
- **Read-before-write** — Every skill reads and shows existing configuration before making any changes; destructive operations require explicit user confirmation
- **No automatic permission grants** — Permissions are always explained and require either `a365 setup all` (developer-run) or `a365 setup permissions mcp` (Global Administrator); the plugin never silently grants access
- **ToolingManifest.json is CLI-managed** — WorkIQ servers are added only via `a365 develop add-mcp-servers`; the plugin never hand-edits the manifest
- **Additive changes only** — Skills never delete or restructure existing agent code; all added code is marked with a comment identifying the skill that added it
- **Path guard hook** — A `preToolUse` hook blocks every Write and Edit call that targets a file outside the agent project directory or inside the plugin directory itself; symlinks are resolved and Windows path casing is normalized before the check
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
