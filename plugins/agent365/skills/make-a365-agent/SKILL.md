---
name: make-a365-agent
description: >
  Provisions a non-AI Teammate agent with Agent 365 — use this skill for Discoverability
  and Observability paths. Runs a365 setup all to create the Blueprint and Entra ID permissions.
  After setup, always offers instrument-observability (optional) and add-workiq-tools (optional)
  as add-ons regardless of capability path. Supports .NET AgentFramework, Node.js, and Python agents.
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
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-make-a365-agent.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. a365 setup all completed without fatal errors.
        2. a365.generated.config.json exists with a valid agentBlueprintId.
        3. Setup Summary table was shown to the user verbatim.
        4. instrument-observability was offered and either invoked or explicitly skipped by user.
        5. add-workiq-tools was offered and either invoked or explicitly skipped by user.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        If all items completed (or were explicitly skipped by the user), return {"ok": true}.
      timeout: 30000
---

# Make A365 Agent

> **Trigger phrases** — any of these will activate this skill:
> "provision agent with a365", "run a365 setup all", "create a365 blueprint",
> "discoverability setup", "observability setup", "register agent for discoverability",
> "set up agent for observability", "add workiq to this agent", "make this a custom engine agent"

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
What would you like to set up?

If your agent is a Standard Agent (no Teams/Copilot integration):
  A. Discoverability — make the agent appear in the M365 catalog

If your agent is a Custom Engine Agent (Teams or Copilot integration):
  B. Observability — OTel tracing for a Teams/Copilot-connected agent
```

   Store the answer as `capabilities`.

**Create all todos for this session:**

- Todo 1: `Register agent with Agent 365 (a365 setup all)`
- Todo 2: `Add Observability (optional)`
- Todo 3: `Add WorkIQ Tools (optional)`

Mark Todo 1 in-progress.

---

## Phase 1 — Collect Provisioning Inputs

Ask both questions in a single message:

```
To provision your agent with Agent 365, I need two things:

  1. Agent Name — short, unique identifier for your tenant (e.g. "contoso-hr-agent")
     Rules: lowercase letters, numbers, hyphens only. Start with a letter. 3–20 chars.
     This derives the Blueprint name.

  2. Project directory — full path to your agent code, or "current" for this directory.
```

Store as `agent_name` and `project_dir`. If the user replies `current`, use CWD.

---

## Phase 2 — Register with Agent 365

### 2.1 — Dry-run preview (REQUIRED before applying anything)

```bash
cd "<project_dir>" && a365 setup all --agent-name <agent_name> --dry-run
```

Show the full dry-run output to the user, then ask:

> "Here's what `a365 setup all` will create. Does this look correct? Type **yes** to proceed or **no** to abort."

- **no**: Stop. Tell the user "Setup cancelled. Run the make-a365-agent skill again when ready."
- **yes**: Proceed to 2.2.

### 2.2 — Apply setup

```bash
cd "<project_dir>" && a365 setup all --agent-name <agent_name>
```

This command:
- Creates the Agent 365 Blueprint in Entra ID (agent identity + app registration)
- Grants required Entra ID permissions
- For Discoverability: makes the agent findable in the M365 catalog
- For Custom Engine Agents with a messaging endpoint: registers the endpoint

Monitor output carefully:
- The CLI logs progress in numbered steps (e.g. `[1/5]`). Watch for errors or warnings.
- Existing resources from a previous run are skipped — this is expected behavior.

**Handle these conditions:**

| Condition | Action |
|-----------|--------|
| `Graph API Forbidden / Authorization_RequestDenied` | Stop. Resolve permission issue (return to a365-setup Step 2 or grant the role). Then re-run. |
| Interactive browser auth required | If headless, instruct user to use `az login --device-code` first. |

`a365 setup all` is idempotent — safe to re-run after fixing an issue.

### 2.3 — Show setup output

After `a365 setup all` completes, show the user:

1. **The Setup Summary table** from CLI output — verbatim.
2. **If the CLI printed an admin consent action item (Permission Grants):** Show both options verbatim:
   - Option A (Entra portal steps)
   - Option B (PowerShell script)

   Tell the user:
   > "If admin consent is required, have a Global Admin run the PowerShell script above."
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
  • Blueprint:       Created in Entra ID (see a365.generated.config.json for Blueprint ID)
  • Discoverability: Agent appears in the M365 catalog
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
