---
name: a365-setup
description: >
  Full Agent 365 CLI setup lifecycle for AI agents. Asks two path-determination questions
  (agent type and desired capabilities), then follows the correct path: verifies and installs
  the CLI, validates Azure prerequisites, configures the agent blueprint (AI Teammate path),
  runs a365 setup all to provision all prerequisites, and publishes and deploys the agent
  application (AI Teammate path). Supports .NET AgentFramework, Node.js LangChain, and Python agents.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: agent project path"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-setup.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. a365 CLI is installed and the version was confirmed.
        2. Azure CLI login was validated.
        3. a365 setup all completed without fatal errors (or was confirmed skipped/cancelled).
        4. User was shown the blueprint ID or setup summary.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If no setup ran this session, or all items are complete, return {"ok": true}.
      timeout: 30000
---

# Agent 365 CLI Setup

> **Trigger phrases** — any of these will activate this skill automatically:
> "run a365 setup", "create blueprint", "register agent", "setup agent blueprint",
> "onboard agent", "provision agent", "deploy agent", "publish agent", "a365 full setup"

---

> **YOUR FIRST AND ONLY ACTION RIGHT NOW:** Ask the user the two path-determination questions below. Do NOT create todos, run commands, or read further until the user has answered both questions. After both answers are received, create all todos for the determined path and mark Todo 1 in-progress.

**RULE 1 — ASK TWO QUESTIONS FIRST, THEN CREATE ALL TODOS.**

Before creating any todos or running any commands, ask the user these two questions (one at a time, wait for each response):

**Question 1: Which of the following best describes your agent?**

1. M365 custom engine agent — Entra app ID
2. M365 custom engine agent — Blueprint
3. All other agents

Wait for the answer. Store as `agentType` (1, 2, or 3).

**Question 2: What capabilities do you want to enable?**

Present only the options that apply to the user's `agentType`:

- **If `agentType = 1`** (M365 custom engine — Entra app ID):
  1. Observability
  2. Observability and Work IQ
- **If `agentType = 2`** (M365 custom engine — Blueprint):
  1. AI Teammate
- **If `agentType = 3`** (All other agents — Blueprint):
  1. Discoverability
  2. Discoverability and Observability
  3. AI Teammate

Wait for the answer. Store as `capabilities`.

> **Note:** The setup automatically includes all prerequisite capabilities for your selection.

After both questions are answered, set `isAITeammate = true` if `capabilities = AI Teammate`, else `isAITeammate = false`. Then create all todos for the path and mark Todo 1 in-progress:

**AI Teammate path** — `isAITeammate = true` (5 todos total):
- Todo 1: `Step 1: Verify and Install/Update the Agent 365 CLI`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 3: Configure the Agent 365 CLI (Initialize Configuration)`
- Todo 4: `Step 4: Run Agent 365 Setup to Provision Prerequisites`
- Todo 5: `Step 5: Publish and Deploy the Agent Application`

**Standard path** — `agentType = 3, isAITeammate = false` (3 todos total):
- Todo 1: `Step 1: Verify and Install/Update the Agent 365 CLI`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 4: Run Agent 365 Setup to Provision Prerequisites`

**Entra app ID path** — `agentType = 1` (3 todos total):
- Todo 1: `Step 1: Verify and Install/Update the Agent 365 CLI`
- Todo 2: `Step 2: Ensure Prerequisites and Environment Configuration`
- Todo 3: `Step 4: Run Agent 365 Setup to Provision Prerequisites`

> **Note for Entra app ID agents (`agentType = 1`):** Steps 3 and 5 (Blueprint configuration and publish/deploy) do not apply. Follow Steps 1, 2, and 4 only.

**RULE 2 — ALWAYS BEGIN FROM STEP 1.** No step is optional within your path. Even if the CLI appears installed or Azure appears logged in, you MUST run the validation commands in each step. Step 3 (Configure) is only required on the AI Teammate path (`isAITeammate = true`) — it is skipped entirely on all other paths.

**RULE 3 — SUB-SECTIONS ARE NOT SEPARATE TODOS.** Each `## Step` has internal sub-sections — these are tasks WITHIN that step, NOT separate todos.

**RULE 4 — ONE STEP AT A TIME.** Complete each step fully. Mark its todo in-progress when starting, complete when done. Do NOT run `az account show`, ask about deployment type, or gather Azure values — those belong to Steps 3 and 2 respectively. The path determination questions (`agentType`, `capabilities`) were already answered before Step 1.

**RULE 5 — SILENT EXECUTION.** Work silently. Do NOT narrate what you are about to do, announce step transitions ("Proceeding to Step 2", "CLI installed, moving on"), print todo state, emoji checklists, or step completion summaries. Only speak to the user when you need input, have an error to report, or need confirmation before a destructive action.

**RULE 6 — INPUT FIELDS.** In Step 3 (AI Teammate path only), present exactly 5 fields (Azure-hosted) or 4 fields (self-hosted). Do NOT ask the user for a client app ID — the CLI resolves it automatically by the well-known app name "Agent 365 CLI".

---

## Context

You are an AI coding agent with access to execute shell commands, read the Agent365-devTools repository (code and docs), and browse the web for documentation or GitHub issues. Your task is to set up, configure, and deploy all prerequisite components for a Microsoft Agent 365–compliant agent using the Agent 365 CLI. You must handle this end-to-end: from installation and configuration to deployment. Work step-by-step, and adapt to any issues or differences in CLI versions along the way.

> **CRITICAL BLOCKING PREREQUISITE:** Before running ANY `a365` CLI commands (including `config init`, `setup`, `publish`, or `deploy`), you MUST validate that the custom client app registration exists in Entra ID with all required permissions and admin consent. This is validated in Step 2. Failure to validate this will cause all CLI commands to fail. Do NOT skip this validation step.

---

## Step 1: Verify and Install/Update the Agent 365 CLI

> **DO NOT SKIP THIS STEP.** Even if you believe the CLI is already installed, you MUST run the version check and validate. Mark this todo in-progress now.

Check if the Agent 365 CLI is installed and up-to-date:

- Run a version check (e.g. `a365 --version` or `a365 -h`).
- If the CLI is not installed or the command is not found, install it. If installed but outdated, update to the latest preview version.

### Ensure .NET is installed

The Agent 365 CLI is a .NET global tool. Verify .NET 8.0 (or compatible) is available:

```bash
dotnet --version
```

If not installed, instruct the user to install .NET 8.0 from https://dotnet.microsoft.com/download.

### Install or update the Agent 365 CLI

Use the [official documentation](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/agent-365-cli#install-the-agent-365-cli). Always include `--prerelease`:

```bash
# If not installed:
dotnet tool install --global Microsoft.Agents.A365.DevTools.Cli --prerelease

# If an older version is installed:
dotnet tool update --global Microsoft.Agents.A365.DevTools.Cli --prerelease
```

On Windows, if the above fails, use `scripts/cli/install-cli.ps1` from the devTools repository (after `dotnet tool uninstall -g Microsoft.Agents.A365.DevTools.Cli`).

### Verify installation

```bash
a365 -h
```

This must show usage information, not an error. Confirms the CLI is on PATH.

### Adapt to CLI version differences

The CLI is under active development. If a command referenced later is not recognized, upgrade the CLI. Using the latest version is essential — newer versions include important fixes and new commands (e.g. `create-instance`, `publish`).

> **BEFORE MOVING ON:** Mark Todo 1 (Step 1) as **completed**. Then mark Todo 2 (Step 2) as **in-progress**. Only then proceed to Step 2.

---

## Step 2: Ensure Prerequisites and Environment Configuration

> **DO NOT SKIP THIS STEP.** You MUST validate Azure CLI login, Entra ID roles, the custom client app registration, and language-specific build tools before any `a365` commands will work. Mark this todo in-progress now.

### Azure CLI & Authentication

```bash
az --version
```

If not installed, direct the user to https://learn.microsoft.com/en-us/cli/azure/install-azure-cli.

Ensure you are logged in to the correct Azure account and tenant:

```bash
az login
# If multiple subscriptions:
az account set -s <SubscriptionNameOrID>
```

If interactive login is not possible (headless environment), instruct the user to follow the device-code login URL.

### Microsoft Entra ID roles

The authenticated account must be at minimum an **Agent ID Administrator** or **Agent ID Developer**. Full environment setup requires **Global Administrator + Azure Contributor**. If the logged-in user lacks these roles, prompt them to use an appropriate account or have an admin grant the needed roles.

### Custom client app

The CLI resolves the client app automatically by the well-known display name **"Agent 365 CLI"** registered in the tenant. Do NOT ask the user for a client app ID.

The CLI will validate permissions and prompt for consent at runtime. If the CLI reports that "Agent 365 CLI" cannot be found, inform the user that an admin must register an Entra app with that exact display name and grant admin consent, then retry.

### Validate language-specific prerequisites (REQUIRED)

> **BLOCKING PREREQUISITE:** You MUST validate that language-specific build tools are installed BEFORE proceeding to Step 3.

#### Detect project type

```bash
# Check for .NET project
find . -name "*.csproj" -print -quit

# Check for Node.js project
test -f "package.json" && echo "Node.js project detected"

# Check for Python project
{ test -f "requirements.txt" || test -f "pyproject.toml"; } && echo "Python project detected"
```

#### Validate required tools based on project type

**For .NET agents:**
```bash
dotnet --version
dotnet --list-sdks
```
Confirm .NET SDK 8.0 or later is installed.

**For Node.js agents:**
```bash
node --version
npm --version
```
Confirm Node.js 18.x or later and npm are available.

**For Python agents:**
```bash
python --version
pip --version
```
Confirm Python 3.10 or later and pip are available.

> **STOP AND CONFIRM before proceeding to Step 3:**
> - Project type detected (at least one of: .NET, Node.js, or Python)
> - Required build tools installed and verified
> - Azure CLI login confirmed, custom client app validated, permissions checked

> **BEFORE MOVING ON:** Mark Todo 2 (Step 2) as **completed**.
> - **AI Teammate path** (`isAITeammate = true`): Mark Todo 3 in-progress → proceed to Step 3.
> - **All other paths** (`isAITeammate = false`): Skip Step 3. Mark Todo 3 in-progress → jump to Step 4.

---

## Step 3: Configure the Agent 365 CLI (Initialize Configuration)

> **AI TEAMMATE PATH ONLY** (`isAITeammate = true`). If `isAITeammate = false`, skip this entire step and go to Step 4.

> **MANDATORY GATE:**
> - Todo 1 (Step 1) is **completed** — CLI verified/installed
> - Todo 2 (Step 2) is **completed** — Azure login confirmed, custom client app validated, build tools verified
> - Todo 3 (Step 3) is **in-progress**
>
> If any checkbox above is not satisfied, STOP and finish the incomplete step first.

### Gather auto-detected values

```bash
az account show --query "{tenantId:tenantId, subscriptionId:id}" -o json
```

Set `deploymentProjectPath` to the current working directory (absolute path).

### Ask deployment type

Send the user **only** the following message and STOP:

---

**Do you want to create a web app in Azure for this agent? (yes/no)**

- **Yes** = Azure-hosted (recommended for production)
- **No** = Self-hosted (e.g., local development with dev tunnel)

---

> ⛔ **STOP. OUTPUT ONLY THE QUESTION ABOVE. WAIT for the user's reply before continuing.**

After the user responds:
- **yes** → `needDeployment: true`
- **no** → `needDeployment: false`

### Collect configuration inputs

> ⛔ DO NOT execute this section until the user has answered the deployment type question above.

#### First: Query the subscription for real example values

Run this as **ONE command**:

```bash
az ad signed-in-user show --query userPrincipalName -o tsv; az group list --query "[].{Name:name, Location:location}" -o table; az appservice plan list --query "[].{Name:name, ResourceGroup:resourceGroup, Location:location}" -o table
```

Extract: `{loggedInUser}`, `{existingResourceGroup}`, `{existingLocations}`, `{existingAppServicePlan}`.
Use descriptive fallbacks (`my-agent-rg`, `my-agent-plan`) if queries return no results.

#### If Azure-hosted (`needDeployment: true`)

**"Please provide the following values to configure your Azure-hosted agent:"**

| Field | Description | Example |
|-------|-------------|---------|
| **Resource Group** | Azure Resource Group (new or existing) | `{existingResourceGroup}` |
| **Location** | Azure region for deployment | `{existingLocations}` |
| **Agent Name** | Unique name for your agent (see rules below) | `contoso-support-agent` |
| **Manager Email** | M365 manager email (must be from your tenant) | `{loggedInUser}` |
| **App Service Plan** | Azure App Service Plan name | `{existingAppServicePlan}` |

> **Agent Name rules:** Globally unique across Azure. Derives web app URL (`{name}-webapp.azurewebsites.net`), Agent Identity, Blueprint, and UPN. Lowercase letters, numbers, hyphens only. Start with a letter. 3-20 chars recommended. Include your org name.
>
> Do NOT ask for `clientAppId` — it was collected in Step 2. Present ONLY the 5 fields above.

#### If self-hosted (`needDeployment: false`)

**"Please provide the following values to configure your self-hosted agent:"**

| Field | Description | Example |
|-------|-------------|---------|
| **Resource Group** | Azure Resource Group (new or existing) | `{existingResourceGroup}` |
| **Location** | Azure region for deployment | `{existingLocations}` |
| **Agent Name** | Unique name for your agent | `contoso-support-agent` |
| **Manager Email** | M365 manager email (must be from your tenant) | `{loggedInUser}` |

#### Determine messaging endpoint (self-hosted only)

Ask: **"Would you like to use a dev tunnel for local development, or provide a custom messaging endpoint? (devtunnel/custom)"**

- **devtunnel**: Creates a secure tunnel from the internet to your local machine. Tunnel URL becomes `messagingEndpoint`.
- **custom**: Ask the user to provide their `messagingEndpoint` URL (e.g., `https://myagent.example.com/api/messages`).

#### Set up a dev tunnel (devtunnel path only)

> ⛔ **Run this only if the user chose devtunnel.**

```bash
# Step 1 — Check if devtunnel CLI is installed
devtunnel --version
```

If not installed:

```bash
# Windows
winget install Microsoft.devtunnel

# macOS / Linux
curl -sL https://aka.ms/DevTunnelCliInstall | bash

# After install, restart the terminal or source your profile, then confirm:
devtunnel --version
```

Log in (first-time setup only — skip if already authenticated):

```bash
# Interactive (requires browser)
devtunnel user login

# Headless / CI environment
devtunnel user login --device-code
```

Start the tunnel for your local agent port (default: **3978**):

```bash
devtunnel host -p 3978 --allow-anonymous
```

The CLI outputs a URL like `https://abc123-3978.devtunnels.ms`. Set:

```
messagingEndpoint = https://<tunnel-subdomain>.devtunnels.ms/api/messages
```

> Keep this terminal running — the tunnel is active as long as this process is alive.
> If the tunnel URL changes on restart, update the endpoint with:
> `a365 setup blueprint --update-endpoint https://<new-url>/api/messages`

### Derive naming values from base name

Using `agentBaseName` and domain from `managerEmail`:

| Field | Pattern | Example (`mya365agent` / `contoso.onmicrosoft.com`) |
|-------|---------|-----------------------------------------------------|
| `agentIdentityDisplayName` | `{baseName} Identity` | `mya365agent Identity` |
| `agentBlueprintDisplayName` | `{baseName} Blueprint` | `mya365agent Blueprint` |
| `agentUserPrincipalName` | `UPN.{baseName}@{domain}` | `UPN.mya365agent@contoso.onmicrosoft.com` |
| `agentUserDisplayName` | `{baseName} Agent User` | `mya365agent Agent User` |
| `agentDescription` | `{baseName} - Agent 365 Agent` | `mya365agent - Agent 365 Agent` |
| `webAppName` (Azure-hosted only) | `{baseName}-webapp` | `mya365agent-webapp` |

### Confirm derived values with user

Present the derived values and ask:

**"Would you like to update any of these derived values, or proceed with the defaults? (update/proceed)"**

### Create the a365.config.json file

**Template for Azure-hosted deployment** (`needDeployment: true`):

```json
{
  "tenantId": "<from az account show>",
  "subscriptionId": "<from az account show>",
  "resourceGroup": "<user provided>",
  "location": "<user provided>",
  "environment": "prod",
  "needDeployment": true,
  "clientAppId": "<from Step 2 validation>",
  "appServicePlanName": "<user provided>",
  "webAppName": "<derived from baseName>",
  "agentIdentityDisplayName": "<derived from baseName>",
  "agentBlueprintDisplayName": "<derived from baseName>",
  "agentUserPrincipalName": "<derived from baseName and domain>",
  "agentUserDisplayName": "<derived from baseName>",
  "managerEmail": "<user provided>",
  "agentUserUsageLocation": "US",
  "deploymentProjectPath": "<current working directory>",
  "agentDescription": "<derived from baseName>"
}
```

**Template for self-hosted deployment** (`needDeployment: false`):

```json
{
  "tenantId": "<from az account show>",
  "subscriptionId": "<from az account show>",
  "resourceGroup": "<user provided>",
  "location": "<user provided>",
  "environment": "prod",
  "messagingEndpoint": "<user provided>",
  "needDeployment": false,
  "clientAppId": "<from Step 2 validation>",
  "agentIdentityDisplayName": "<derived from baseName>",
  "agentBlueprintDisplayName": "<derived from baseName>",
  "agentUserPrincipalName": "<derived from baseName and domain>",
  "agentUserDisplayName": "<derived from baseName>",
  "managerEmail": "<user provided>",
  "agentUserUsageLocation": "US",
  "deploymentProjectPath": "<current working directory>",
  "agentDescription": "<derived from baseName>"
}
```

### Import the configuration

```bash
a365 config init -c ./a365.config.json
```

If validation fails (app not found, missing permissions, unrecognized project platform), correct `a365.config.json` and re-run `a365 config init -c ./a365.config.json`.

---

## Step 4: Run Agent 365 Setup to Provision Prerequisites

> **Skill tip:** If the `/provision` slash command appears in your Claude Code slash commands, type `/provision <agent_name>` and follow the prompts — then skip the rest of this step.

### 4.1 — Collect provisioning inputs

**For the Standard path (`isAITeammate = false`):** Ask two questions (one at a time):

1. **"What agent name should be used for provisioning?"**
   - Globally unique across Azure; lowercase, numbers, hyphens; start with letter; 3–20 chars recommended.
   - If the user replies `default`, use `developer`.
   - Store as `agent_name`.

2. **"What is the project directory containing your agent code? Reply with a full path, or reply 'current' to use the current working directory."**
   - Store as `project_dir`. If `current`, use CWD.

**For the AI Teammate path (`isAITeammate = true`):**
- `agent_name` is derived from `agentBaseName` (Step 3). Do NOT ask again.
- `project_dir` is `deploymentProjectPath` from config. Do NOT ask again.

### 4.2 — Dry-run preview (REQUIRED)

> **MUST run and show to user before applying anything.**

```bash
# Standard path:
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --dry-run

# AI Teammate path:
cd "<project_dir>" && a365 setup all --dry-run
```

After displaying full output, ask: **"Do you want to proceed with the setup shown above? (yes/no)"**

- **no**: Stop. Tell the user "Setup cancelled. Return to Step 4 when ready."
- **yes**: Proceed to 4.3.

### 4.3 — Apply setup

```bash
# Standard path (agentType 3 — Discoverability or Discoverability + Observability):
cd "<project_dir>" && a365 setup all --agent-name <agent_name>

# AI Teammate path (agentType 2 or agentType 3 — AI Teammate):
cd "<project_dir>" && a365 setup all
```

What `a365 setup all` provisions depends on your path:

**Discoverability path** (`agentType 3`, `isAITeammate = false`):
- Creates the Agent 365 Blueprint in Entra ID (agent identity + app registration)
- Configures blueprint permissions for Discoverability
- Does NOT create Azure infrastructure (no Resource Group, App Service Plan, or Web App)
- Does NOT register a messaging endpoint
- Agent will appear in the M365 catalog but will not receive messages until a messaging endpoint is configured separately

**AI Teammate path** (`isAITeammate = true`):
- Creates/validates Azure infrastructure (Resource Group, App Service Plan, Web App, Managed Identity)
- Creates the Agent 365 Blueprint in Entra ID
- Configures blueprint permissions
- Registers the messaging endpoint
- Agent is fully deployed and can receive messages from Teams

Monitor output carefully:
- The CLI logs progress in numbered steps (e.g., `[1/5]`). Watch for errors or warnings.
- Performance notices are non-blocking.
- Existing resources from a previous run are skipped — expected behavior.

**Handle these conditions:**

| Condition | Action |
|-----------|--------|
| Quota limit error | Report to user, halt. Update `location` in config and retry. |
| Region not supported | Update location and retry. |
| Graph API Forbidden / Authorization_RequestDenied | Stop. Resolve permission issue (Step 2). Then re-run `a365 setup all`. |
| Interactive browser auth required | If headless, see Troubleshooting section. |

`a365 setup all` is idempotent — safe to re-run after fixing an issue.

### 4.4 — Show setup output to user

After `a365 setup all` completes, show the user:

1. **The Setup Summary table** from CLI output — verbatim.
2. **If the CLI printed an admin consent action item (Permission Grants):** Show both options verbatim:
   - Option A (Entra portal steps)
   - Option B (PowerShell script)
3. **Skip the client secret action item entirely.** Do not show or mention it.
4. Output exactly this closing line and nothing else:
   > "Your agent is provisioned. If admin consent is required, have a Global Admin run the PowerShell script above."

> Mark all todos as completed. This is the final action for non-AI Teammate paths. Do NOT proceed to Step 5.

---

## Step 5: Publish and Deploy the Agent Application

> **AI TEAMMATE PATH ONLY.** If `isAITeammate = false`, do not proceed here.

Your agent is now set up. You can see it in Microsoft Admin Center Agent Registry. Proceed with manifest review, publish, and deploy.

### Review and Update the Manifest File (REQUIRED)

Before publishing, you **MUST** review and customize `<deploymentProjectPath>/manifest/manifest.json`.

#### Manifest fields to update

| Field | Description | What to Update |
|-------|-------------|----------------|
| `name.short` | Agent display name (max 30 chars) | Replace `"Your Agent Name"` with actual name |
| `name.full` | Full name (max 100 chars) | Replace with descriptive full name |
| `description.short` | Brief description (max 80 chars) | One-line summary of what the agent does |
| `description.full` | Full description (max 4000 chars) | Cover: what it does, data/systems accessed, how to interact, limitations |
| `developer.name` | Publisher/org name | Your organization name |
| `developer.websiteUrl` | Developer website | Your org URL |
| `developer.privacyUrl` | Privacy policy URL | Required for production |
| `developer.termsOfUseUrl` | Terms of use URL | Required for production |
| `icons.color` | Color icon (192x192 PNG) | Ensure `color.png` exists |
| `icons.outline` | Outline icon (32x32 PNG) | Ensure `outline.png` exists |
| `accentColor` | Hex accent color | Match your branding (e.g., `"#0078D4"`) |
| `version` | Semantic version | Update on each change (e.g., `"1.0.0"`) |

#### Example manifest

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/vdevPreview/MicrosoftTeams.schema.json",
  "id": "<auto-generated-by-cli>",
  "name": {
    "short": "Contoso HR Bot",
    "full": "Contoso Human Resources Assistant"
  },
  "description": {
    "short": "Get answers to HR questions and submit time-off requests.",
    "full": "The Contoso HR Assistant helps employees with common HR tasks. Ask about company policies, check PTO balance, submit time-off requests, and get information about benefits."
  },
  "icons": { "outline": "outline.png", "color": "color.png" },
  "accentColor": "#0078D4",
  "version": "1.0.0",
  "manifestVersion": "devPreview",
  "developer": {
    "name": "Contoso Ltd",
    "mpnId": "",
    "websiteUrl": "https://www.contoso.com",
    "privacyUrl": "https://www.contoso.com/privacy",
    "termsOfUseUrl": "https://www.contoso.com/terms"
  },
  "agenticUserTemplates": [{ "id": "<auto-generated>", "file": "agenticUserTemplateManifest.json" }]
}
```

> The `id` and `agenticUserTemplates[].id` fields are auto-populated by the CLI. Do not set them manually.

Ask the user: **"Have you updated the manifest with your agent's name, description, and developer information? (yes/no)"**

Wait for **yes** before proceeding.

### Publish the agent manifest

```bash
a365 publish
```

This updates manifest identifiers and publishes the agent package to the tenant's Microsoft 365 admin center catalog. Watch for errors — if the CLI cannot reach the admin center, verify your account has `Application.ReadWrite.All` and that connectivity is good.

### Deploy the agent code to Azure

```bash
a365 deploy
```

This builds and deploys your agent code to the Azure Web App. It also finalizes any remaining permission setups. For subsequent iterations, you can use:
- `a365 deploy app` — redeploy code only
- `a365 deploy mcp` — update tool permissions only

Monitor output. If the build fails, address the build error. If deployment fails (network, Azure App Service issues), note the error and retry.

### Post-deployment (User action required)

> The following steps require browser-based interactions that cannot be automated. Provide these instructions so the user can complete them.

#### Configure agent in Teams Developer Portal

1. Get your blueprint ID:
   ```bash
   a365 config display -g --field agentBlueprintId
   ```

2. Navigate to:
   ```
   https://dev.teams.microsoft.com/tools/agent-blueprint/<your-blueprint-id>/configuration
   ```

3. In the Developer Portal:
   - Set **Agent Type** to `API Based`
   - Set **Notification URL** to your messaging endpoint:
     ```bash
     a365 config display -g --field messagingEndpoint
     ```
   - Select **Save**

#### Create agent instance

1. Open **Teams > Apps** and search for your agent name
2. Select your agent and click **Request Instance** (or **Create Instance**)
3. Teams sends the request to your tenant admin for approval

Admins approve from [Microsoft admin center - Requested Agents](https://admin.cloud.microsoft/#/agents/all/requested). After approval, the agent instance is created and available.

> The user needs to be part of the [Frontier preview program](https://adoption.microsoft.com/copilot/frontier-program/) to create agent instances while Agent 365 is in preview.

#### Test your deployed agent

1. Search for the new agent user in Teams
   > Agent user creation is asynchronous — can take minutes to hours to become searchable.
2. Start a new chat with the agent instance
3. Send test messages to verify functionality (e.g., "Hello!")
4. Check application logs:
   ```bash
   az webapp log tail --name <your-web-app> --resource-group <your-resource-group>
   ```

View your agent in the [Microsoft 365 admin center - Agents](https://admin.cloud.microsoft/#/agents/all).

---

## Error Handling and Troubleshooting

For detailed guidance, refer to:
- [Agent 365 Troubleshooting Guide](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/troubleshooting)
- [Agent 365 CLI Reference](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/agent-365-cli)
- [GitHub Issues](https://github.com/microsoft/Agent365-devTools/issues)

### Quick tips

- Run failing commands with `-v` / `--verbose` for detailed logs.
- Check log files: Windows `%APPDATA%/a365/logs/`, Linux/Mac `~/.config/a365/logs/`.
- Most `a365` commands are idempotent — safe to re-run after fixing an issue.
- Use `a365 cleanup azure` or `a365 cleanup blueprint` only as a last resort.

### Dev tunnel issues

| Issue | Resolution |
|-------|-----------|
| Dev tunnel CLI not found | Restart terminal or add install directory to PATH |
| Auth failure in headless env | `devtunnel user login --device-code` |
| Tunnel not receiving messages | Verify tunnel is running, correct port, `--allow-anonymous` was used |
| Tunnel URL changed | `a365 setup blueprint --update-endpoint https://<new-url>/api/messages` |
| Port already in use | Delete old port, create new: `devtunnel port delete/create` |
| Cannot access from Teams | Ensure `--allow-anonymous`; firewall allows `*.devtunnels.ms`; path includes `/api/messages` |

### Escalating to GitHub

If the issue appears to be a CLI bug, draft an issue with: CLI version (`a365 --version`), OS/shell, exact steps to reproduce, error output, and expected vs actual behavior. Present the draft to the user — do not create the issue unless authorized.
