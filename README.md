# Agent 365 Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Agent skills and MCP configuration for [Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/) — works with Claude Code and GitHub Copilot. These skills teach AI agents how to register Agent 365 blueprints, wire WorkIQ MCP tools, instrument observability, and add local CLI runners using natural language.

Browse the [`plugins/agent365/skills/`](/microsoft/agent365-skills/blob/main/plugins/agent365/skills) folder for the full catalog.

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

- **4 skills** covering blueprint setup, WorkIQ MCP tools, observability instrumentation, and local CLI testing
- **MCP configuration** for WorkIQ tool servers (Mail, Calendar, Teams, SharePoint, OneDrive, Word, User, Copilot, Dataverse)
- **Validator scripts** that run as stop hooks to verify each skill completed correctly
- **Reference patterns** for both .NET AgentFramework and Node.js LangChain agents
- **Evals** for every skill covering happy path, idempotency, and error handling

---

## Skills

### `a365-setup` — Register, Configure & Deploy

Full A365 CLI lifecycle. Asks two questions up front — your agent registration type and the
capabilities you want — then follows the right path automatically:

| Registration type | Available capabilities |
|------------------|----------------------|
| M365 custom engine — Entra app ID | Observability, Observability + WorkIQ |
| M365 custom engine — Blueprint | AI Teammate |
| All other agents | Discoverability, Discoverability + Observability, AI Teammate |

**AI Teammate path** — validates prerequisites, creates `a365.config.json`, runs
`a365 setup all` (provisions Azure infra, Blueprint, messaging endpoint), reviews and
publishes the manifest, and deploys the agent code.

**Discoverability path** — registers the Blueprint and configures permissions. No Azure
infrastructure or messaging endpoint is created; the agent appears in the M365 catalog.

**Entra app ID path** — validates prerequisites and runs `a365 setup all` to add
Observability or WorkIQ permissions to an existing M365 custom engine app.

**Trigger phrases:**
```
"Run a365 setup"         "Create blueprint"
"Register agent"         "Deploy agent"
"Onboard agent"          "Provision agent"
```

### `add-workiq-tools` — Add WorkIQ MCP Tools

Runs `a365 develop list-available` to show the MCP server catalog, adds selected servers
via `a365 develop add-mcp-servers`, wires `GetMcpToolsAsync` in the agent code, and guides
the permissions handoff.

**Trigger phrases:**
```
"Add workiq tools"                   "Add Work IQ Mail"
"Add work intelligence tools"        "Add MCP tools to this agent"
```

**Available WorkIQ servers:**

| Server | Capabilities |
|--------|-------------|
| Work IQ Mail | Read, send, manage email |
| Work IQ Calendar | Events, availability, meeting finder |
| Work IQ Teams | Channel messages, team list |
| Work IQ SharePoint | Document search, file read |
| Work IQ OneDrive | File management |
| Work IQ Word | Read and write documents |
| Work IQ User | Profile and presence |
| Work IQ Copilot | Chat with Microsoft 365 Copilot |
| Dataverse and Dynamics 365 | Business data CRUD |

### `instrument-observability` — Add A365 Observability

Instruments OTel-based tracing, BaggageBuilder context propagation, and the A365 exporter
token resolver into your agent entry point and message handler.

**Trigger phrases:**
```
"Instrument observability"     "Add A365 observability"
"Enable tracing"               "Add OTel"
```

### `add-cli` — Add Local CLI Runner

Scaffolds an interactive terminal REPL for testing your agent locally without deploying to
Teams or a messaging endpoint. Uses no extra runtime dependencies.

**Trigger phrases:**
```
"Add CLI to this agent"          "Add a console runner"
"Run agent from command line"    "Add local chat CLI"
```

---

## Starter Prompts

**Register a new agent as an AI Teammate (full deployment):**
```
This agent has never been deployed to Agent 365. Walk me through blueprint setup,
adding WorkIQ SharePoint and Teams tools, instrumentation with observability,
and a local CLI for testing.
```

**Register for Discoverability only (no messaging endpoint):**
```
I want to register this agent so it shows up in the M365 catalog,
but I'm not ready to deploy it as an AI Teammate yet. Set up Discoverability.
```

**M365 custom engine agent — add observability:**
```
This is an M365 custom engine agent with an existing Entra app ID.
Add A365 observability and WorkIQ tools to it.
```

**Register a new agent and add WorkIQ tools:**
```
I have a new .NET AgentFramework agent. Register it with Agent 365 and add Work IQ Mail and Calendar.
```

**Add specific WorkIQ tools to an existing agent:**
```
Add Work IQ Mail and Work IQ Calendar to this agent.
Our blueprint already exists — I'll need to know what to give our Global Administrator.
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

### By registration type

| Type | Description | Supported capabilities |
|------|-------------|----------------------|
| M365 custom engine — Entra app ID | Existing M365 app; no Blueprint yet | Observability, WorkIQ |
| M365 custom engine — Blueprint | Existing Blueprint; deploying as AI Teammate | AI Teammate |
| All other agents | Standard A365 agent; fresh setup | Discoverability, AI Teammate |

Skills auto-detect the registration type from `a365.config.json` and M365 signals and
pre-fill the selection before asking the user to confirm.

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

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.conduct.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
