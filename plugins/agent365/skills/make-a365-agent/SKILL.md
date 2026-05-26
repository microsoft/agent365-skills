---
name: make-a365-agent
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
  - github-copilot-cli
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

> **Show the user a visible task checklist BEFORE Phase 1 work begins.** This skill has no per-phase `TaskCreate` calls in the body — derive the checklist from the phase headers (`## Phase 0 — Load Context`, `## Phase 1 — Collect Provisioning Inputs`, `## Phase 2 — Register with Agent 365`, etc.). Exactly one item in_progress at a time; complete before moving on.
> - **Claude Code:** call `TaskCreate` once per phase header (already in `allowed-tools`); the list renders natively. Use `TaskUpdate` to flip statuses.
> - **VS Code Copilot Chat / GitHub Copilot CLI:** `allowed-tools` is ignored — emit a markdown checklist directly in chat (`- [ ] Load context…`, `- [ ] Collect provisioning inputs…`, etc.) and edit items to `- [x]` as each phase completes.

**Check for context passed from a365-setup.** If this skill was invoked by `a365-setup`,
the session already has `capabilities`, `agentStack`, `programmingLanguage`, and
`usesTeamsOrCopilot` set. Load those values directly.

**If invoked directly (no session context):**

1. **Read** `.a365-workspace-detection.local.json` if it exists and `detectedAt` is within 60 minutes.
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

If either file exists, read it and extract the blueprint ID — the field name differs by file:
- `a365.config.json` → read `blueprintId`
- `a365.generated.config.json` → read `agentBlueprintId`

Store whichever is present as `existingBlueprintId`. Then ask:

```
I found an existing Agent 365 config in this project.
  • File: {filename found}
  • Blueprint ID: {existingBlueprintId if found, otherwise "not yet set"}

What would you like to do?

  1. Reuse the existing blueprint — I'll skip `a365 setup all` and use this blueprint directly
     (use this if setup already ran successfully and you just want to add capabilities)
  2. Create a fresh blueprint — runs `a365 setup all` and overwrites the existing config
     (use this if you want to start over or the existing config is stale)
```

Wait for the answer:
- If **1 (reuse)**: if `agentBlueprintId` is empty, ask "Please provide your blueprint ID." Store as `existingBlueprintId`. Set `reuseBlueprint = true`. **Write** both values back to `.a365-workspace-detection.local.json` (merge, preserve all other fields) so the stop-hook validator and follow-on skills can read them. Skip Phase 2 (setup all) entirely — proceed directly to Phase 3.
- If **2 (fresh)**: set `reuseBlueprint = false`. **Write** `reuseBlueprint: false` to `.a365-workspace-detection.local.json`. Continue with Phase 1 inputs and Phase 2 as normal.

If no existing config is found: set `reuseBlueprint = false` and continue.

---

Ask both questions in a single message:

```
To provision your agent with Agent 365, I need two things:

  1. Agent Name — short, unique identifier for your tenant (e.g. "contoso-hr-agent" or "FabrikamHelpdesk")
     Rules: letters, numbers, hyphens only. Start with a letter. 3–20 chars (the CLI appends " Blueprint" to derive the Teams manifest `name.short`, capped at 30).
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

**If Local / Dev Tunnel (option 2):** **auto-start the tunnel — do NOT ask the user to paste a URL.**

#### Dev Tunnel Setup (auto-start)

1. **Verify CLI is installed:** `devtunnel --version`. If it fails, install it and stop until the user confirms:

   | OS | Install command |
   |----|-----------------|
   | Windows | `winget install Microsoft.devtunnel` |
   | macOS | `brew install --cask devtunnel` |
   | Linux | `curl -sL https://aka.ms/DevTunnelCliInstall | bash` |

2. **Verify login:** `devtunnel user show`. If it exits non-zero or prints "not logged in", run `devtunnel user login` (or `devtunnel user login --device-code` on headless machines), wait for the user to complete sign-in, then retry `devtunnel user show`.

3. **Create the tunnel + port** (idempotent — treat "already exists" as success). The port is the agent's listening port — `3978` for Node.js / Python, the .NET project's launch port for .NET (default `5000`):

   ```bash
   devtunnel create <agent-name>-tunnel --allow-anonymous
   devtunnel port create <agent-name>-tunnel -p <port>
   ```

   Parse the **Tunnel ID** from the create output — format is `<id>.<cluster>` (e.g. `abc123xy.usw3`).

4. **Start hosting in the background** — this is a long-running process. Run with `run_in_background=true` so the tunnel keeps running while the skill continues; the user does NOT need a separate terminal:

   ```bash
   devtunnel host <agent-name>-tunnel
   ```

5. **Resolve the public URL deterministically** — it is `https://<id-without-cluster>-<port>.<cluster>.devtunnels.ms`. Example: tunnel ID `abc123xy.usw3` + port `3978` → `https://abc123xy-3978.usw3.devtunnels.ms`. Sanity-check with `devtunnel show <agent-name>-tunnel` and confirm the printed Access URL matches.

6. **Store `tunnelUrl`** and set `messagingEndpoint = "${tunnelUrl}/api/messages"`. Tell the user verbatim: *"Dev tunnel started at `<URL>`. Hosting in the background — leave this session open. Using this endpoint for `a365 setup all`."*

> **Tunnel not reachable:** confirm `--allow-anonymous` flag was used and the agent process is listening on the configured port.

---

## Phase 2 — Register with Agent 365

### 2.0 — Guardrail: route AI Teammate agents away

This skill is for **Agent (Non AI Teammate)** registration only. Re-read `.a365-workspace-detection.local.json`:

- **If `agentType = "ai-teammate"`** (stale cache from a prior session, or user picked the wrong skill): **abort this skill** and tell the user verbatim: *"This agent is registered as an AI Teammate. The `make-a365-agent` skill handles non-AI-Teammate agents only — appending `--authmode obo|s2s` to `a365 setup all` would conflict with `--aiteammate`. Switch to `/agent365:make-ai-teammate` instead, which uses `a365 setup all --aiteammate --m365` and never passes `--authmode`."* Do NOT proceed to 2.1.
- **If `agentType = "system-agent"`** (or unset): proceed to 2.1.

### 2.1 — Dry-run preview (REQUIRED before applying anything)

```bash
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --dry-run
```

> **`--authmode` flag:** If the user's auth mode is known from `.a365-workspace-detection.local.json`, append `--authmode obo` or `--authmode s2s` to all `setup all` commands. This controls how the agent identity SP receives permissions (OBO = principal-scoped delegated grants, S2S = application app-role assignments requiring GA).

Show the full dry-run output to the user, then ask:

> "Here's what `a365 setup all` will create. Does this look correct? Type **yes** to proceed or **no** to abort."

- **no**: Stop. Tell the user "Setup cancelled. Run the make-a365-agent skill again when ready."
- **yes**: Proceed to 2.2.

### 2.2 — Apply setup

> ⚠️ **`a365 setup all` is long-running and block-buffers under chat-tool execution.** If output stalls, see [AGENTS.md § CLI output buffering under chat-tool execution](../../../../AGENTS.md#cli-output-buffering-under-chat-tool-execution) — preferred remediation is `run_in_background: true` (Claude Code Bash tool); fallback is hand-off to a separate terminal.

Choose the right flags based on the detected agent type:

```bash
# Agent (Non AI Teammate) — default
cd "<project_dir>" && a365 setup all --agent-name <agent_name>

# With explicit auth mode (append based on .a365-workspace-detection.local.json authMode)
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
- **If the command fails or prints any error/warning block: show the full CLI output verbatim** before consulting the error table below.

> **Windows Account Manager (WAM):** If you see `"Authenticating via Windows Account Manager..."` in the output, a native Windows sign-in dialog has appeared. Do NOT kill the process. Tell the user: "A Windows sign-in dialog has appeared — please complete it. Setup will continue automatically after you sign in."
> - If no dialog appears on a headless machine: `Ctrl+C`, run `az login --allow-no-subscriptions` to populate the token cache, then retry.
> - **Conditional Access Policy (CAP):** If WAM/browser auth is blocked by CAP (AADSTS53003, AADSTS53000), the CLI automatically falls back to device code flow — no user action needed.

**Handle these conditions:**

| Condition | Action |
|-----------|--------|
| `Graph API Forbidden / Authorization_RequestDenied` | Stop. Resolve permission issue (return to a365-setup Step 2 or grant the role). Then re-run. |
| Interactive browser auth required | If headless, instruct user to use `az login --device-code` first. |
| `managerApplications` error / blueprint rejected | Blueprint was created before May 2025 and lacks `managerApplications`. Delete and re-run `a365 setup all`, or patch via Graph API. |
| `AADSTS700016` / `Authorization_IdentityNotFound` immediately after blueprint creation | Entra replication lag — the CLI retries automatically with exponential back-off (up to 5× for identity, 12× for blueprint token, 60-second cap). No manual retry needed; wait for the CLI to complete. |

`a365 setup all` is idempotent — safe to re-run after fixing an issue.

### 2.3 — Show setup output

After `a365 setup all` completes, show the user:

1. **The Setup Summary table** from CLI output — verbatim.
2. **`Agent365.Observability.OtelWrite` is automatically granted** to the agent identity by `a365 setup all` — no GA consent step required for newly provisioned agents. If the CLI output includes a "Permission Grants" action item (upgrade scenario for pre-1.1 agents), display the PowerShell script verbatim so the user can hand it to a Global Admin.
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

**CLI error surfacing:** When any CLI command exits non-zero or prints a warning or error line, **show the complete output verbatim** in a fenced code block before suggesting a fix. Do not abstract, paraphrase, or discard CLI output — the exact error message is always more useful than a summary. If the error is not in the table below, display it and ask the user how to proceed.

- Run failing commands with `-v` / `--verbose` for detailed logs.
- Manage and locate CLI diagnostic logs via `a365 logs --help`. Log files live at Windows `%APPDATA%/a365/logs/`, Linux/Mac `~/.config/a365/logs/`.
- Most `a365` commands are idempotent — safe to re-run after fixing an issue.
- For a full cleanup of a config-free agent: `a365 cleanup --agent-name <name>`. For granular cleanup: `a365 cleanup blueprint`, `a365 cleanup azure`, or `a365 cleanup instance`. Use only as a last resort.
