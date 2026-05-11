---
name: make-a365-agent
version: 1.6.0
description: >
  Provisions a non-AI Teammate agent with Agent 365 — use this skill for Register
  and Observability paths. Runs a365 setup all to create the Blueprint and Entra ID permissions.
  After setup, always offers instrument-observability (optional) and add-workiq-tools (optional,
  skipped automatically when authMode = s2s) as add-ons. Supports .NET AgentFramework, Node.js, and Python agents.
  Normally delegated to from a365-setup after CLI and Azure prerequisites are confirmed.
  Can also be invoked directly when those steps are already done.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: agent project path"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-make-a365-agent.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. a365 setup all completed without fatal errors.
        2. a365.generated.config.json exists with a valid agentBlueprintId.
        3. Setup Summary table was shown to the user verbatim.
        4. instrument-observability was offered and either invoked or explicitly skipped by user.
        5. add-workiq-tools was offered and either invoked or explicitly skipped by user — OR authMode = s2s (WorkIQ is not available for S2S agents and must not be offered).
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If all items completed (or were explicitly skipped by the user), return {"ok": true}.
      timeout: 30000
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

# Make A365 Agent

> **Trigger phrases** — any of these will activate this skill:
> - "provision this agent with agent 365"
> - "register this agent"
> - "make this agent findable in the Agent 365 catalog"
> - "Registration setup for this agent"
> - "make this a custom engine agent"
> - "run a365 setup all"
> - "create a365 blueprint for this agent"
> - "set up this agent for observability only"

> **What this skill does:** Provisions your agent with Agent 365 — creates the Blueprint
> and Entra ID permissions. After setup, always offers observability
> (instrument-observability) and WorkIQ tools (add-workiq-tools) as optional add-ons.
>
> **This skill is normally called from `a365-setup`** after CLI verification and Azure
> prerequisites are confirmed. It can also be invoked directly when those steps are done.

---

> **YOUR FIRST ACTION:** Load context (Phase 0), then create all todos before running anything.

---

## Phase 0 — Load Context

**Check for context passed from a365-setup.** If this skill was invoked by `a365-setup`,
the session already has `capabilities`, `agentStack`, `programmingLanguage`, and
`usesTeamsOrCopilot` set. Load those values directly.

**If invoked directly (no session context):**

1. **Read** `.a365-workspace-detection.json` if it exists and `detectedAt` is within 60 minutes.
   Load `agentStack`, `programmingLanguage`, and `usesTeamsOrCopilot` from it.

2. **If no fresh cache**, ask the user in a single message:

```
What capabilities would you like to enable? (options can be combined)

  1. Register — make the agent findable in the Agent 365 catalog
  2. Observability — end-to-end activity tracing for every message, LLM call,
     and tool use, visible in the Agent 365 portal and Microsoft Defender
  3. WorkIQ — add WorkIQ MCP servers (M365 data: email, calendar, Teams, SharePoint, OneDrive)
     (only show this option when authMode ≠ s2s — WorkIQ requires a user token)
  4. AI Teammate — the agent needs a first-class M365 identity
     (Agentic User with UPN, mailbox, presence). Handled by a different skill.
```

   - If the user selects **option 4 (AI Teammate)** — stop here and tell them:
     > "AI Teammate setup is handled by the `make-ai-teammate` skill. Run `/agent365:a365-setup` and select the AI Teammate path, or invoke `make-ai-teammate` directly."
   - Otherwise store the answer as `capabilities` and continue.

**Create all todos for this session:**

- Todo 1: `Register agent with Agent 365 (a365 setup all)`
- Todo 2: `Add Observability (optional)`
- Todo 3: `Add WorkIQ Tools (optional)`

Mark Todo 1 in-progress.

---

## Phase 1 — Collect Provisioning Inputs

### 1.0 — Check for Existing Blueprint

**Before asking for any inputs**, check whether a blueprint config already exists:

```bash
ls a365.config.json a365.generated.config.json 2>/dev/null
```

If either file exists, read it and extract `agentBlueprintId` (if present). Then ask:

```
I found an existing Agent 365 config in this project.
  • File: {filename found}
  • Blueprint ID: {agentBlueprintId if found, otherwise "not yet set"}

What would you like to do?

  1. Reuse the existing blueprint — I'll skip `a365 setup all` and use this blueprint directly
     (use this if setup already ran successfully and you just want to add capabilities)
  2. Create a fresh blueprint — runs `a365 setup all` and overwrites the existing config
     (use this if you want to start over or the existing config is stale)
```

Wait for the answer:
- If **1 (reuse)**: if `agentBlueprintId` is empty, ask "Please provide your blueprint ID." Store as `existingBlueprintId`. Set `reuseBlueprint = true`. **Write** both values back to `.a365-workspace-detection.json` (merge, preserve all other fields) so the stop-hook validator and follow-on skills can read them. Skip Phase 2 (setup all) entirely — proceed directly to Phase 3.
- If **2 (fresh)**: set `reuseBlueprint = false`. **Write** `reuseBlueprint: false` to `.a365-workspace-detection.json`. Continue with Phase 1 inputs and Phase 2 as normal.

If no existing config is found: set `reuseBlueprint = false` and continue.

---

Ask both questions in a single message:

```
To provision your agent with Agent 365, I need two things:

  1. Agent Name — short, unique identifier for your tenant (e.g. "contoso-hr-agent" or "SunilsAgent1")
     Rules: letters, numbers, hyphens only. Start with a letter. 3–20 chars.
     This derives the Blueprint name. Pass the name exactly as you type it — do NOT normalize case.
     Type "default" to use the name "developer".

  2. Project directory — full path to your agent code, or "current" for this directory.
```

Store as `agent_name` and `project_dir`. If the user replies `current`, use CWD.
If the user types `default`, set `agent_name = "developer"`.

### 1.1 — Determine Messaging Endpoint

Ask the user where their agent is (or will be) hosted:

```
Where will your agent run?

  1. Azure / Cloud — the agent has (or will have) a public HTTPS endpoint already
  2. Local / Dev Tunnel — the agent runs on localhost and needs a dev tunnel for a public URL
  3. Skip - I just want to set up the Blueprint and Entra ID permissions for now, without registering an endpoint yet
```

**If Cloud (option 1):** Ask for the full HTTPS endpoint URL (e.g. `https://myagent.azurewebsites.net/api/messages`). Store as `messagingEndpoint`.

**If Local / Dev Tunnel (option 2):** Guide the user through dev tunnel setup:

#### Dev Tunnel Setup

```bash
devtunnel --version
```

If the command fails, install it:

| OS | Install command |
|----|-----------------|
| Windows | `winget install Microsoft.devtunnel` |
| macOS | `brew install --cask devtunnel` |
| Linux | `curl -sL https://aka.ms/DevTunnelCliInstall | bash` |

> Ask the user to confirm installation is complete before continuing.

```bash
# Authenticate with dev tunnel
devtunnel user login

# Create a persistent named tunnel (reuse the same URL across restarts)
devtunnel create <agent-name>-tunnel --allow-anonymous

# Start hosting the tunnel (leave this running in a separate terminal)
devtunnel host <agent-name>-tunnel --port 3978
```

> Tell the user: "Start the tunnel in a separate terminal and copy the tunnel URL shown in the output (format: `https://<id>-3978.<region>.devtunnels.ms`). Paste it here."

Wait for the user to paste the URL. Store as `tunnelUrl`.
Set `messagingEndpoint = "${tunnelUrl}/api/messages"`.

> **Headless / no browser:** Use `devtunnel user login --device-code` for device-code auth instead.
> **Tunnel not reachable:** Confirm `--allow-anonymous` flag was used; port firewall rules are not blocking 3978.

---

## Phase 2 — Register with Agent 365

### 2.1 — Dry-run preview (REQUIRED before applying anything)

```bash
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --dry-run
```

> **`--authmode` flag:** If the user's auth mode is known from `.a365-workspace-detection.json`, append `--authmode obo` or `--authmode s2s` to all `setup all` commands. This controls how the agent identity SP receives permissions (OBO = principal-scoped delegated grants, S2S = application app-role assignments requiring GA).

Show the full dry-run output to the user, then ask:

> "Here's what `a365 setup all` will create. Does this look correct? Type **yes** to proceed or **no** to abort."

- **no**: Stop. Tell the user "Setup cancelled. Run the make-a365-agent skill again when ready."
- **yes**: Proceed to 2.2.

### 2.2 — Apply setup

Choose the right flags based on the detected agent type:

```bash
# Agent (Non AI Teammate) — default
cd "<project_dir>" && a365 setup all --agent-name <agent_name>

# With explicit auth mode (append based on .a365-workspace-detection.json authMode)
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --authmode obo
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --authmode s2s

# Custom Engine Agent (CEA) with Teams/Copilot integration — add --m365
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --m365
```

**For CEA agents (`usesTeamsOrCopilot = 1`):** after `setup all`, also run the bot permission step:
```bash
a365 setup permissions bot
```
This is required for Messaging Bot API grants and must follow `setup all` (which handles `permissions mcp`).

This command:
- Creates the Agent 365 Blueprint in Entra ID (agent identity + app registration)
- Grants required Entra ID permissions
- For registration: makes the agent findable in the Agent 365 catalog
- For Custom Engine Agents (`--m365`): registers the endpoint via MCP Platform

Monitor output carefully:
- The CLI logs progress in numbered steps (e.g. `[1/5]`). Watch for errors or warnings.
- Existing resources from a previous run are skipped — this is expected behavior.

> **Windows Account Manager (WAM):** If you see `"Authenticating via Windows Account Manager..."` in the output, a native Windows sign-in dialog has appeared. Do NOT kill the process. Tell the user: "A Windows sign-in dialog has appeared — please complete it. Setup will continue automatically after you sign in."
> - If no dialog appears on a headless machine: `Ctrl+C`, run `az login --allow-no-subscriptions` to populate the token cache, then retry.
> - **Conditional Access Policy (CAP):** If WAM/browser auth is blocked by CAP (AADSTS53003, AADSTS53000), the CLI automatically falls back to device code flow — no user action needed.

**Handle these conditions:**

| Condition | Action |
|-----------|--------|
| `Graph API Forbidden / Authorization_RequestDenied` | Stop. Resolve permission issue (return to a365-setup Step 2 or grant the role). Then re-run. |
| Interactive browser auth required | If headless, instruct user to use `az login --device-code` first. |
| `managerApplications` error / blueprint rejected | Blueprint was created before May 2025 and lacks `managerApplications`. Delete and re-run `a365 setup all`, or patch via Graph API. |

`a365 setup all` is idempotent — safe to re-run after fixing an issue.

### 2.3 — Show setup output

After `a365 setup all` completes, show the user:

1. **The Setup Summary table** from CLI output — verbatim.
2. **If the CLI printed an admin consent action item (Permission Grants) or any role assignment failed (403):**
   - **Extract the PowerShell admin consent script** from the CLI output and display it in a fenced code block so the user can copy it easily. The CLI typically prints a `Connect-AzAccount` / `New-AzADServicePrincipalAppRoleAssignment` script block — find and display it verbatim.
   - If no PowerShell script was printed, provide the manual Entra portal steps:
     [Entra portal](https://entra.microsoft.com) > App registrations > select Blueprint app > API permissions > Add a permission > APIs my organization uses > search `9b975845-388f-4429-889e-eab1ef63949c` > add both Delegated and Application `Agent365.Observability.OtelWrite` > Grant admin consent
   - Tell the user:
     > "⚠️ The OtelWrite app role assignment requires **Global Administrator**. Copy the PowerShell script above and have a Global Admin run it — without this, trace exports will fail with HTTP 403."
3. **Skip the client secret action item entirely.** Do not show or mention it.

Mark Todo 1 as completed.

---

## Phase 3 — Add Observability (Optional)

Mark Todo 2 in-progress.

Ask the user:

```
Your agent is provisioned. Observability lets you track every message, LLM call, and tool
invocation in the Agent 365 portal and Microsoft Defender.

  Would you like to add observability now?
    • yes  — I'll run the instrument-observability skill now
    • skip — you can add it later by running the instrument-observability skill
```

**If yes:** **Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-observability/SKILL.md` and follow it.
The skill will detect the project language and wire up OTel + A365 tracing exporter.

**If skip:** Note that the user can run the `instrument-observability` skill at any time.

Mark Todo 2 as completed when done (or skipped by user).

---

## Phase 4 — Add WorkIQ Tools (Optional)

Mark Todo 3 in-progress.

**If `authMode = s2s`:** Skip this phase entirely — WorkIQ is not available for S2S agents (requires a user token). Mark Todo 3 as completed and proceed to Phase 5.

Ask the user:

```
Would you like to add WorkIQ tools? These give your agent access to Microsoft 365 data —
email, calendar, Teams messages, SharePoint files, OneDrive, and more.

Note: WorkIQ MCP calls use OAuth On-Behalf-Of (OBO) tokens. Users will be prompted to
consent the first time the agent accesses their data.

  • yes  — I'll run the add-workiq-tools skill now
  • skip — you can add it later by running the add-workiq-tools skill
```

**If yes:** **Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-workiq-tools/SKILL.md` and follow it.

**If skip:** Note that the user can run the `add-workiq-tools` skill at any time.

Mark Todo 3 as completed when done (or skipped by user).

---

## Phase 5 — Final Summary

Show the user a summary:

```
✅ Agent provisioned with Agent 365!

Your agent now has:
  • Blueprint:       Created in Entra ID (Blueprint ID in `a365.generated.config.json`)
  • Register: Agent appears in the Agent 365 catalog
  [• Observability:  OpenTelemetry + A365 tracing exporter wired]  (if added)
  [• WorkIQ tools:   M365 data access via MCP]                     (if added)

Next steps:
  1. If admin consent was required, ensure a Global Admin has run the PowerShell script.
  2. Test discovery: search for your agent in Microsoft 365 apps.
  3. Add observability:  run the instrument-observability skill  (if not done)
  4. Add WorkIQ tools:   run the add-workiq-tools skill          (if not done)
```

---

## Error Handling

- Run failing commands with `-v` / `--verbose` for detailed logs.
- Check log files: Windows `%APPDATA%/a365/logs/`, Linux/Mac `~/.config/a365/logs/`.
- Most `a365` commands are idempotent — safe to re-run after fixing an issue.
- Use `a365 cleanup azure` or `a365 cleanup blueprint` only as a last resort.
