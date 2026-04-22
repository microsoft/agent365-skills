# Agent 365 Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Agent skills and MCP configuration for [Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/) — works with Claude Code and GitHub Copilot. These skills transform Node.js, .NET, and Python agents into production-ready Microsoft Agent 365 AI Teammates: registering blueprints, wiring WorkIQ MCP tools, instrumenting observability, and handling Teams messages and email notifications.

Browse the [`plugins/agent365/skills/`](https://github.com/microsoft/agent365-skills/blob/main/plugins/agent365/skills) folder for the full catalog.

---

## Prerequisites

- **Microsoft Agent 365** tenant with developer access
- **Node.js 18+**, **.NET 8.0+**, or **Python 3.11+** (depending on your agent)
- **a365 CLI** — `dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease`
- **Azure CLI** — `winget install Microsoft.AzureCLI` (Windows) or `brew install azure-cli` (macOS)

**Supported frameworks:**

| Framework | Packages | Language |
|-----------|---------|---------|
| .NET AgentFramework | `Microsoft.Agents.A365.*` / `AgentApplication` | C# |
| Python AgentFramework | `agent-framework-azure-ai` + `microsoft_agents_a365_*` | Python |
| Node.js LangChain | `@langchain/core` + `@microsoft/agents-hosting` | TypeScript |
| Node.js OpenAI Agents SDK | `@openai/agents` + `@microsoft/agents-hosting` | TypeScript |
| Node.js Claude SDK | `@anthropic-ai/sdk` + `@microsoft/agents-hosting` | TypeScript |

---

## Getting Started

### Claude Code

```
/plugin marketplace add microsoft/agent365-skills
/plugin install agent365@agent365-skills
```

### GitHub Copilot

```
copilot plugin marketplace add microsoft/agent365-skills
copilot plugin install agent365@agent365-skills
```

---

## Skills

### `make-ai-teammate` — Transform Any Agent into an AI Teammate

The full-stack transformation skill. Takes any agent using LangChain, OpenAI Agents SDK, Claude SDK (.NET, Node.js, or Python), or .NET/.Python AgentFramework and makes it a production-ready Microsoft Agent 365 AI Teammate — wrapping your existing LLM code without replacing it.

Adds the complete hosting and integration layer in one pass:

- **Hosting layer** — Express/CloudAdapter (Node.js) · ASP.NET Core/IAgentHttpAdapter (.NET) · aiohttp/CloudAdapterAiohttp (Python) — with `/api/health` and `/api/messages`
- **`AgentApplication` subclass** — message routing, typing indicator loop, observability token preloading, email notification dispatch, install/uninstall lifecycle events
- **Observability** — `ObservabilityManager`/`AddAgenticTracingExporter` initialized before any spans, context propagation, `InferenceScope`/`UseOpenTelemetry` wrapping every LLM call with token counts and finish reasons
- **`McpToolRegistrationService`** — module-level singleton (Node.js), DI-injected singleton (.NET), or per-turn (Python) wired into the per-turn client factory
- **Token cache** — per-language token caching with agentic resolver support
- **`ToolingManifest.json`**, all A365 packages, env vars, and tsconfig/pyproject settings

Supports **LangChain**, **OpenAI Agents SDK**, and **Claude SDK** (Node.js), **AgentFramework** (.NET and Python). Idempotent — re-running on a partially-configured agent only adds what is missing.

**Trigger phrases:**
```
"Make this agent an AI Teammate"      "Transform agent to AI Teammate"
"Add AI Teammate hosting"             "Wire up M365 hosting"
"Convert agent to Teams agent"        "Add CloudAdapter to this agent"
```

---

### `a365-setup` — Register, Configure & Publish

Full A365 CLI lifecycle. Detects your agent stack and Custom Engine Agent status automatically,
then asks two questions — agent type and desired capabilities — and follows the right path:

| Agent Type | Available Capabilities |
|------------|----------------------|
| **Custom Engine Agent** | • **Observability** — OTel tracing + Defender integration<br>• **Observability + WorkIQ** — Adds M365 tools: Mail, Calendar, Teams, SharePoint<br>• **AI Teammate** — Blueprint, permissions, and messaging endpoint registration |
| **Standard Agent** | • **Discoverability** — M365 catalog registration<br>• **Discoverability + Observability** — Registration + telemetry<br>• **AI Teammate** — Blueprint, permissions, and messaging endpoint registration |

**AI Teammate path** — collects Agent Name, Manager Email, and Messaging Endpoint (devtunnel or custom HTTPS). Creates `a365.config.json`, runs `a365 setup all` (Blueprint + permissions + endpoint), and publishes the manifest to M365 Admin Center. You host the agent on your own infrastructure.

**Discoverability path** — Blueprint + permissions only. Agent appears in the M365 catalog but has no messaging endpoint.

**Observability path** — instruments OTel tracing, BaggageBuilder context, and the A365 exporter with agentic token resolver for Microsoft Defender.

**Trigger phrases:**
```
"Run a365 setup"         "Create blueprint"
"Register agent"         "Onboard agent"
"Provision agent"        "Publish agent"
```

---

### `add-workiq-tools` — Add WorkIQ MCP Tools

Adds pre-built Microsoft 365 integration tools to your agent. Runs `a365 develop list-available`
to show the MCP server catalog, adds selected servers via `a365 develop add-mcp-servers`
(which writes `ToolingManifest.json`), wires `McpToolRegistrationService` in the agent code,
and guides the permissions handoff to your Global Administrator.

**What WorkIQ provides:** Ready-to-use MCP tool servers maintained by Microsoft — no custom Graph API integrations needed. Authentication, permissions, and API calls are handled automatically.

| Tool | What it does |
|------|-------------|
| Work IQ Mail | Read, send, and manage email |
| Work IQ Calendar | Read/create events, check availability |
| Work IQ Teams | Read channel messages, list teams and members |
| Work IQ SharePoint | Search documents, read files, list sites |
| Work IQ OneDrive | Manage OneDrive files |
| Work IQ Word | Read and write Word documents |
| Work IQ User | Get user profile and presence |
| Work IQ Copilot | Chat with Microsoft 365 Copilot |
| Dataverse & Dynamics 365 | CRUD and domain actions |

**Trigger phrases:**
```
"Add workiq tools"                   "Add Work IQ Mail"
"Add work intelligence tools"        "Add MCP tools to this agent"
```

---

### `instrument-observability` — Add A365 Observability

Instruments OpenTelemetry-based tracing, BaggageBuilder context propagation, and the A365
exporter with agentic token resolver into an existing agent entry point and message handler.
Use `make-ai-teammate` for new agents — use this skill to add observability incrementally to
an agent that already has a hosting layer.

**Trigger phrases:**
```
"Instrument observability"     "Add A365 observability"
"Enable tracing"               "Add OTel"
"Instrument for Defender"      "Add telemetry"
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

**Transform a plain Node.js agent into a full AI Teammate (all-in-one):**
```
I have a Node.js LangChain agent that runs as a plain script. Transform it into a
Microsoft Agent 365 AI Teammate with Teams hosting, observability, email notifications,
and WorkIQ Mail and Calendar tools.
```

**Transform a .NET AgentFramework agent:**
```
I have a .NET AgentFramework agent. Transform it into a Microsoft Agent 365 AI Teammate
with full hosting, observability, WorkIQ tools, and email notification handling.
```

**Transform a Python agent:**
```
I have a Python agent using agent-framework-azure-ai. Make it a Microsoft Agent 365
AI Teammate with Teams hosting, MCP tooling, and email notification handling.
```

**Register a transformed agent (after make-ai-teammate):**
```
The code is ready. Register this agent as an AI Teammate with Agent 365 — create the
blueprint, grant permissions, and register my messaging endpoint.
```

**Full flow in one prompt:**
```
This agent has never been registered with Agent 365. Walk me through the full AI
Teammate setup: transform the code, register a blueprint, add WorkIQ Mail and
Teams tools, and test it locally.
```

**Register for Discoverability only (self-hosted):**
```
I want to register this agent so it shows up in the M365 catalog,
but I'll handle hosting and deployment myself. Set up Discoverability.
```

**Custom Engine Agent — add observability and WorkIQ:**
```
This is a Custom Engine Agent available in Microsoft Teams and Copilot.
Add A365 observability and WorkIQ Mail, Calendar, and Teams tools.
```

**Add specific WorkIQ tools to an existing agent:**
```
Add Work IQ Mail and Work IQ Calendar to this agent.
Our blueprint already exists — I'll need to know what to give our Global Administrator.
```

**Test locally with AgentsPlayground:**
```
Test my agent locally without deploying to Teams.
```

**Check what's already configured:**
```
Check which Agent 365 skills have already been applied to this agent and tell me what's missing.
```

---

## What's Included

- **5 skills** covering full AI Teammate transformation, blueprint setup, WorkIQ MCP tools, observability instrumentation, and local testing with AgentsPlayground
- **Multi-language support** — Node.js (LangChain, OpenAI Agents SDK, Claude SDK), .NET AgentFramework, and Python AgentFramework
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
