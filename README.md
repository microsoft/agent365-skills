# Agent 365 Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Agent skills and MCP configuration for [Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/) — works with Claude Code and GitHub Copilot. These skills teach AI agents how to register Agent 365 blueprints, wire WorkIQ MCP tools, instrument observability, and add local CLI runners using natural language.

Browse the [`plugins/agent365/skills/`](https://github.com/microsoft/agent365-skills/blob/main/plugins/agent365/skills) folder for the full catalog.

---

## Prerequisites

- **Microsoft Agent 365** tenant with developer access
- **Node.js 18+** and **.NET 8.0+**
- **a365 CLI** — `dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli --prerelease`
- **Azure CLI** — `winget install Microsoft.AzureCLI` (Windows) or `brew install azure-cli` (macOS)

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

## What's Included

- **5 skills** covering blueprint setup, WorkIQ MCP tools, observability instrumentation, AgentsPlayground smoke testing, and local CLI testing
- **Automatic agent detection** — skills detect agent stack (Agent Framework, LangChain, OpenAI), programming language (DotNet, NodeJS, Python), and Custom Engine Agent status, then ask validation questions before any code runs
- **Smart capability selection** — based on your agent type, you get tailored options: Discoverability, Observability, WorkIQ tools, or AI Teammate registration
- **WorkIQ MCP tools** — pre-built M365 integrations for Mail, Calendar, Teams, SharePoint, OneDrive, Word, User profiles, Copilot, and Dataverse/Dynamics 365
- **Validator scripts** that run as stop hooks to verify each skill completed correctly
- **Reference patterns** for both .NET AgentFramework and Node.js LangChain agents
- **Evals** for every skill covering happy path, idempotency, and error handling

---

## Skills

### `a365-setup` — Register, Configure & Publish

Full A365 CLI lifecycle. Detects your agent stack (Agent Framework, LangChain, OpenAI), programming language (DotNet, NodeJS, Python), and Custom Engine Agent status automatically. Asks validation questions, then guides you through capability selection and follows the right path:

| Agent Type | Available Capabilities |
|------------|----------------------|
| **Custom Engine Agent** | • **Observability** — OTel tracing + Defender integration (self-hosted)<br>• **Observability + WorkIQ** — Adds M365 tools: Mail, Calendar, Teams, SharePoint (self-hosted)<br>• **AI Teammate** — Blueprint registration, permissions, and messaging endpoint registration; you provide hosting |
| **Standard Agent** | • **Discoverability** — M365 catalog registration (self-hosted)<br>• **Discoverability + Observability** — Registration + telemetry (self-hosted)<br>• **AI Teammate** — Blueprint registration, permissions, and messaging endpoint registration; you provide hosting |

**AI Teammate path** — validates prerequisites, creates `a365.config.json`, runs `a365 setup all` (creates the Blueprint, grants permissions, and registers your messaging endpoint), then reviews and publishes the agent manifest. You host the agent on your own infrastructure — any cloud or on-premises deployment is supported.

**Discoverability path** — registers the Blueprint and configures permissions. The agent appears in the M365 catalog but requires self-hosting; no messaging endpoint is provisioned.

**Observability path** — instruments OpenTelemetry tracing, BaggageBuilder context, and A365 exporter with agentic token resolver for Microsoft Defender integration.

**Trigger phrases:**
```
"Run a365 setup"         "Create blueprint"
"Register agent"         "Onboard agent"
"Provision agent"        "Publish agent"
```

### `add-workiq-tools` — Add WorkIQ MCP Tools

Adds pre-built Microsoft 365 integration tools to your agent. Runs `a365 develop list-available` to show the MCP server catalog, adds selected servers via `a365 develop add-mcp-servers`, wires `GetMcpToolsAsync` in the agent code, and guides the permissions handoff.

**What WorkIQ provides:** Instead of writing custom Microsoft Graph API integrations, you get ready-to-use MCP tool servers maintained by Microsoft that handle authentication, permissions, and API calls automatically.

**Trigger phrases:**
```
"Add workiq tools"                   "Add Work IQ Mail"
"Add work intelligence tools"        "Add MCP tools to this agent"
```


### `instrument-observability` — Add A365 Observability

Instruments OpenTelemetry-based tracing, BaggageBuilder context propagation, and the A365 exporter with agentic token resolver into your agent entry point and message handler.

**What Observability provides:**
- ✅ **Microsoft Defender for Cloud integration** — Your agent's traces are exported to Microsoft's security stack for threat detection
- ✅ **OpenTelemetry instrumentation** — Industry-standard distributed tracing for monitoring and debugging
- ✅ **Context propagation** — BaggageBuilder tracks tenant ID, agent ID, and correlation IDs across service boundaries
- ✅ **Agentic token resolver** — Automatic authentication for trace export with 5-minute caching
- ✅ **Security compliance** — Required for production A365 agents to meet Microsoft security standards

**Trigger phrases:**
```
"Instrument observability"     "Add A365 observability"
"Enable tracing"               "Add OTel"
"Instrument for Defender"      "Add telemetry"
```

### `test-local` — Smoke Test with AgentsPlayground

Tests your agent locally without deploying to Azure or Teams. Checks prerequisites (`agentsplayground` CLI, build tools), builds the agent, starts it in the background, and opens AgentsPlayground pointed at your local endpoint — no Bot Framework auth required.

**What this provides:**
- ✅ **Quick iteration** — Test changes immediately without deploying
- ✅ **No cloud dependencies** — Runs entirely on localhost
- ✅ **Visual chat interface** — AgentsPlayground provides a user-friendly chat UI
- ✅ **Debug-friendly** — Easy to attach debuggers and inspect logs

**Trigger phrases:**
```
"Test this agent locally"        "Run agent locally"
"Open AgentsPlayground"          "Launch local test session"
"Smoke test this agent"          "Test without deploying"
```

### `add-cli` — Add Local CLI Runner

Scaffolds an interactive terminal REPL for testing your agent directly from the command line. Perfect for quick smoke tests, CI/CD pipelines, or developers who prefer terminal-based workflows. Uses no extra runtime dependencies.

**What this provides:**
- ✅ **Terminal-based testing** — Chat with your agent from the command line
- ✅ **No UI dependencies** — Works in headless environments and CI/CD pipelines
- ✅ **Zero external dependencies** — Uses only the agent's existing dependencies
- ✅ **Same configuration** — Reads from the same `.env` / `appsettings.json` as production

**Trigger phrases:**
```
"Add CLI to this agent"          "Add a console runner"
"Run agent from command line"    "Add local chat CLI"
"Add REPL to agent"              "Add terminal interface"
```

---

## Starter Prompts

**Register a new agent as an AI Teammate:**
```
This agent has never been registered with Agent 365. Walk me through blueprint setup,
adding WorkIQ SharePoint and Teams tools, instrumentation with observability,
and a local CLI for testing. Register it as an AI Teammate.
```

**Register for Discoverability only (no Azure deployment, self-hosted):**
```
I want to register this agent so it shows up in the M365 catalog,
but I'll handle hosting and deployment myself. Set up Discoverability.
```

**Add Discoverability + Observability (self-hosted with telemetry):**
```
Register this agent in the M365 catalog and add observability instrumentation
for Microsoft Defender integration. I'll host it on my own infrastructure.
```

**Custom Engine Agent — add observability and WorkIQ:**
```
This is a Custom Engine Agent available in Microsoft Teams and Copilot.
Add A365 observability and WorkIQ Mail, Calendar, and Teams tools.
```

**Register a new agent with specific WorkIQ tools:**
```
I have a new .NET AgentFramework agent. Register it with Agent 365 as an AI Teammate
and add Work IQ Mail, Calendar, and SharePoint tools.
I'll host the agent myself.
```

**Add specific WorkIQ tools to an existing agent:**
```
Add Work IQ Mail and Work IQ Calendar to this agent.
Our blueprint already exists — I'll need to know what to give our Global Administrator.
```

**Smoke test without deploying (AgentsPlayground):**
```
Test my agent locally without deploying to Teams.
```

**Set up local testing:**
```
Add a CLI runner so I can chat with this agent from the terminal without deploying.
```

**Check what's already configured:**
```
Check which Agent 365 skills have already been applied to this agent and tell me what's missing.
```

---

## Local Development

Clone the repository first:

```bash
git clone https://github.com/microsoft/agent365-skills.git
```

### Testing with Claude Code

Test the plugin locally without installing from a marketplace:

```bash
# 1. Open your agent project
cd my-agent-project

# 2. Launch Claude Code with the plugin loaded from your local clone
claude --plugin-dir "/path/to/agent365-skills/plugins/agent365"

# 3. Start with a trigger phrase, e.g.:
#    "Add workiq tools to this agent"
```

The `--plugin-dir` path must be in double quotes if it contains spaces. Use the absolute path.

### Testing with GitHub Copilot

Register the local plugin marketplace and install the plugin:

```bash
copilot plugin marketplace add /path/to/agent365-skills
copilot plugin install agent365@agent365-skills
```

To reinstall after pulling or making local changes:

```bash
copilot plugin uninstall agent365@agent365-skills
copilot plugin install agent365@agent365-skills
```

To install the local plugin directly without marketplace registration:

```bash
copilot plugin install /path/to/agent365-skills/plugins/agent365
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

## Supported Agent Types

### By framework

| Framework | Package | Language |
|-----------|---------|---------|
| .NET AgentFramework | `Microsoft.Agents.A365` / `AgentApplication` | C# |
| Node.js LangChain | `@langchain/core` + `@microsoft/agents-hosting` | TypeScript |

### By agent type and capabilities

| Agent Type | Detection Signals | Available Capabilities |
|------------|------------------|----------------------|
| **Custom Engine Agent** | M365/Teams/Copilot signals + `a365.config.json` | • **Observability** — OTel tracing, Defender integration, self-hosted<br>• **Observability + WorkIQ** — Adds pre-built M365 tools (Mail, Calendar, Teams, SharePoint, OneDrive, User), self-hosted<br>• **AI Teammate** — Blueprint + permissions + endpoint registration; you provide hosting |
| **Standard Agent** | No M365 signals, standard agent framework | • **Discoverability** — Blueprint registration only, self-hosted<br>• **Discoverability + Observability** — Registration + telemetry/security, self-hosted<br>• **AI Teammate** — Blueprint + permissions + endpoint registration; you provide hosting |

**WorkIQ Tools Available:**
- **Work IQ Mail** — Read, send, manage email messages
- **Work IQ Calendar** — Events, availability, meeting scheduling
- **Work IQ Teams** — Channel messages, team lists
- **Work IQ SharePoint** — Document search, file operations
- **Work IQ OneDrive** — File and folder management
- **Work IQ Word** — Read and write Word documents
- **Work IQ User** — User profiles and presence status
- **Work IQ Copilot** — Chat with Microsoft 365 Copilot
- **Dataverse & Dynamics 365** — Business data CRUD operations

Skills auto-detect the agent type from codebase analysis and M365 signals, then ask validation questions before presenting capability options.

---

## Reference Samples

Skills are built to match the patterns in:

- `.NET`: https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent
- `Node.js`: https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/langchain

---

## Documentation

- [Agent 365 Developer Docs](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/)
- [A365 CLI Develop Commands](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/reference/cli/develop)
- [A365 Observability](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/observability)
- [AI-Guided Setup](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/ai-guided-setup)

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
