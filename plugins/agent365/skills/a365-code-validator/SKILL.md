---
name: a365-code-validator
description: >
  Validates and optionally fixes Agent 365 observability code so an agent actually emits MAC
  Activity telemetry. Use when an Agent 365 agent's telemetry isn't reaching MAC Activity or
  Defender, when spans export (HTTP 200 / "sent") but Activity stays empty, when the caller or
  agent id looks wrong in reporting, or to pre-flight whether an agent will emit MAC Activity
  before shipping. Diagnoses and fixes existing instrumentation; do NOT use it to add
  observability from scratch — use instrument-observability for that.
  Checks exporter activation, runtime agent-identity binding (vs blueprint id),
  the S2S FMI / OBO token shape, S2S vs OBO endpoint selection, and the required semantic spans
  (invoke_agent/chat/execute_tool/output_messages) plus Activity attributes. Read-only by default;
  asks before applying safe fixes. Python, Node.js, and .NET.
compatibility:
  - claude-code
  - vscode-copilot
  - github-copilot-cli
user-invocable: true
argument-hint: "Optional: path to agent project, or agent id / blueprint id to include in the report"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-a365-code-validator.js
      timeout: 15000
    - type: prompt
      prompt: |
        Verify the validation result was presented to the user with:
        1. exporter activation status;
        2. identity binding status (agent id vs blueprint id);
        3. semantic span coverage (invoke_agent/chat/execute_tool/output_messages);
        4. endpoint/token mode (S2S vs OBO);
        5. concrete next debug commands;
        6. if blockers were found, the user was asked whether to fix now, create a fix plan, or stop.
        Return {"ok": false, "reason": "<missing item>"} if any item is absent.
        Otherwise return {"ok": true}.
      timeout: 30000
---

# A365 Code Validator

> **Trigger phrases** — any of these will activate this skill automatically:
> - "validate a365 code"
> - "run a365 code validator"
> - "check a365 observability code"
> - "debug a365 activity missing"
> - "debug MAC activity for this agent"
> - "validate Agent 365 telemetry"
> - "check why Agent Activity is empty"
> - "check A365 exporter flags"
> - "validate gen_ai agent id"
> - "check A365 span types"

---

## Overview

This skill performs a **report-first** validation of an existing agent codebase to answer:

> "If this agent runs now, will its spans reach the A365 backend and become eligible for MAC Activity?"

It is designed for incident response. It checks the exact classes of bugs that cause
silent or confusing A365 Activity failures:

1. Exporter configured but not actually enabled.
2. `gen_ai.agent.id` set to a Blueprint ID instead of the runtime Agent Identity / Source Agent ID.
3. Generic HTTP/OpenAI spans emitted without A365 semantic operations.
4. S2S/OBO endpoint mismatch.
5. Missing token resolver or wrong S2S token shape.
6. MAC reporting expectations confused with raw ingest success.

No source code is modified during validation. After the report, the skill asks whether to
apply safe fixes, create a fix plan only, or stop.

---

## Output is support-safe (applies to every phase)

This report may be pasted into a customer or partner thread, so it must be safe to share:
**never** print internal cluster/database names, Kusto queries, private endpoint or route
templates, correlation IDs, or real tenant/agent IDs. Report file/function names and public,
supportable signals only. This is non-negotiable — it holds even when a user asks for "just
the raw details."

---

## Phase 0 — Create and Display Task List

> **Show the user this checklist BEFORE Phase 1.** Exactly one task is in progress at a time.
> Claude Code uses `TaskCreate` / `TaskUpdate`; VS Code Copilot Chat / GitHub Copilot CLI
> should show and update a markdown checklist.

```text
TaskCreate: "Detect stack and A365 artifacts"
TaskCreate: "Run static A365 code validator"
TaskCreate: "Inspect identity binding and semantic spans"
TaskCreate: "Prepare runtime verification commands"
TaskCreate: "Summarize blockers and next fixes"
TaskCreate: "Offer guided remediation"
```

---

## Phase 1 — Detect Stack and A365 Artifacts

**Mark task in progress:** "Detect stack and A365 artifacts"

Read, in parallel when possible:

- `.a365-workspace-detection.local.json` if present
- `a365.config.json`
- `a365.generated.config.json`
- `.env`, `.env.example`, `.env.production`, `.env.local`
- `appsettings.json`, `appsettings.Development.json`
- `package.json`
- `requirements.txt`, `pyproject.toml`
- `*.csproj`

Detect:

| Signal | Meaning |
|---|---|
| `microsoft-opentelemetry` | Python A365 distro present |
| `@microsoft/opentelemetry` | Node.js A365 distro present |
| `Microsoft.OpenTelemetry` | .NET A365 distro present |
| `agentBlueprintId` / `agenticAppId` | Distinguish Blueprint ID from runtime Agent Identity |
| `ENABLE_A365_OBSERVABILITY_EXPORTER` / `EnableAgent365Exporter` | Runtime exporter gate |
| `authMode` | Drives S2S vs OBO path expectations |

**Mark task complete.**

---

## Phase 2 — Run Static A365 Code Validator

**Mark task in progress:** "Run static A365 code validator"

Run the validator from the target project root.

When running from the plugin source (Claude Code / marketplace plugin), use:

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-a365-code-validator.js
```

If the runtime cannot expand `${CLAUDE_PLUGIN_ROOT}`, run with the absolute plugin path:

```bash
node /path/to/agent365-skills/plugins/agent365/hooks/stop/validate-a365-code-validator.js
```

When running from an open-standard `.agents/skills/a365-code-validator/` install, use the
standalone copy that ships with the skill:

```bash
node .agents/skills/a365-code-validator/references/a365-code-validator.js
```

Parse the JSON output. Treat findings by severity:

| Severity | Meaning |
|---|---|
| `critical` | Known MAC Activity blocker — fix before expecting activity |
| `high` | Likely export or identity failure |
| `medium` | Risky or env-dependent — verify before incident closure |
| `low` / `info` | Useful context |

**Important:** Findings are not stop-hook failures. A validation run is successful when it
accurately reports what is wrong.

**Mark task complete.**

---

## Phase 3 — Inspect Identity Binding and Semantic Spans

**Mark task in progress:** "Inspect identity binding and semantic spans"

Read the reference checklist:

```text
${CLAUDE_PLUGIN_ROOT}/skills/a365-code-validator/references/validation-checklist.md
```

Then inspect source for these required MAC Activity inputs:

### 3.1 Exporter activation

Python must have either explicit code:

```python
use_microsoft_opentelemetry(
    enable_a365=True,
    a365_enable_observability_exporter=True,
)
```

or a runtime env guarantee:

```text
ENABLE_A365_OBSERVABILITY_EXPORTER=true
```

Node.js must have:

```ts
useMicrosoftOpenTelemetry({
  a365: {
    enabled: true,
    enableObservabilityExporter: true,
  },
});
```

.NET must have:

```json
"EnableAgent365Exporter": true
```

### 3.2 Identity binding

Verify the same runtime Agent Identity is used consistently:

```text
token azp/appid/oid == route /agents/{agentId} == span gen_ai.agent.id
```

The following is wrong for S2S/MAC Activity:

```text
gen_ai.agent.id = <blueprint id>
```

Blueprint belongs in:

```text
microsoft.a365.agent.blueprint.id
```

### 3.3 Semantic span coverage

MAC Activity needs supported A365 operations:

```text
invoke_agent
chat
execute_tool
output_messages
```

Generic HTTP spans alone are not enough. Flag code that only sets baggage but never
creates or auto-generates supported semantic spans.

### 3.4 Activity/run context coverage

If the developer expects MAC Activity or Defender agent-activity views (not just exporter
HTTP 200), inspect whether real runs carry the public Agent 365 activity attributes:

| Attribute | What to validate |
|---|---|
| `gen_ai.agent.name` | Human-readable agent name exists; otherwise UI can show a GUID/blank |
| `gen_ai.conversation.id` | Present on every span; for non-chat agents use a logical run/job/incident ID |
| `microsoft.channel.name` | Present on every span; use `msteams` for Teams, or a product/source value such as `icm`, `web`, `scheduler` |
| `microsoft.session.id` | Prefer a stable run/session ID; optional, but useful for grouping |
| `user.id` | Human caller OID for `HumanToAgent`; do not confuse it with the agent's own user |
| `microsoft.agent.user.id` | Agent's own Agent User OID when testing AI teammate / Agent-User / OBO |
| `gen_ai.input.messages` / `gen_ai.output.messages` | Present on invoke/chat/output spans where applicable |
| Tool details | `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` |
| Model details | `gen_ai.request.model`, `gen_ai.provider.name` on `chat` spans |

When reviewing a mixed app, separate the two objectives:

```text
S2S/export success proves telemetry plumbing.
AI teammate/HumanToAgent or EventToAgent run context proves Activity/reporting eligibility.
```

Do not require Teams-specific values for autonomous agents; require equivalent logical run
context instead.

Caller identity caveat: for `HumanToAgent`, `user.id` is the caller ID used for "who ran
this agent" reporting. If it is missing or set to the agent identity / agent user instead
of the human caller object ID, export can succeed while caller/user Activity remains blank
or incomplete.

### 3.5 S2S vs OBO transport mode

Do not expose or require internal service URLs in the report. Validate only the structural
intent:

| Auth mode | Structural expectation |
|---|---|
| S2S / application | Uses service-to-service export mode and a token for the runtime Agent Identity |
| OBO / agentic-user | Uses delegated export mode and a token whose delegated scope includes observability write |

Report whether the code appears to select the correct transport mode (`useS2SEndpoint` /
`a365_use_s2s_endpoint` / `UseS2SEndpoint`) for S2S, without printing backend route templates.
For Python S2S, prefer `a365_use_s2s_endpoint=True` in code rather than relying only on
`A365_USE_S2S_ENDPOINT=true` in runtime environment. Also check the **token shape**: the S2S
observability token must come from the 3-hop FMI exchange (principal == runtime Agent Identity),
not a bare client-credentials call — see checklist §5 for the failure signatures.

### 3.6 Blueprint permission inheritance wording

Do not claim that application app roles can never inherit from blueprints. Current public
Entra Agent ID docs describe both `inheritableScopes` and `inheritableRoles`. If a repo or
tenant shows delegated scope inheritance working but S2S app roles requiring direct assignment,
report it as a provisioning/configuration behavior to verify, not as the intended scalable model.

**Mark task complete.**

---

## Phase 4 — Prepare Runtime Verification Commands

**Mark task in progress:** "Prepare runtime verification commands"

Generate commands appropriate for the project.

### Local / App Service env check

For Azure App Service:

```powershell
az webapp config appsettings list `
  -g <resource-group> `
  -n <app-name> `
  --query "[?name=='ENABLE_A365_OBSERVABILITY_EXPORTER' || name=='EnableAgent365Exporter' || name=='A365_USE_S2S_ENDPOINT']"
```

For local PowerShell:

```powershell
$env:ENABLE_A365_OBSERVABILITY_EXPORTER="true"
$env:OTEL_LOG_LEVEL="INFO"
$env:A365_OBSERVABILITY_LOG_LEVEL="debug"
```

### SDK log grep

```powershell
Select-String .a365-observability.log -Pattern "Agent365Exporter|identity groups|Obtained token|export|No token|No eligible"
```

### Backend verification handoff

If backend verification is required, keep customer-facing validation on public/supportable
surfaces:

1. SDK/exporter logs show export success and no chunk failures,
2. direct OTel responses have `partialSuccess` empty/null where applicable,
3. Microsoft Defender Advanced Hunting `CloudAppEvents` shows the expected AgentId /
   TargetAgentId / AlternateId after indexing.

If the user is on an internal service team, they may also use their team's approved
dashboard/playbook to confirm request acceptance and downstream delivery, but do not print
those internal queries or endpoints in the validator report.

(Report only support-safe signals — see **Output is support-safe** above.)

### If code checks pass but Activity is still empty — verify tenant-side

Most "exporter returns 200/`sent` but nothing shows in MAC" incidents are **not** code bugs.
When the code checks above pass, have the user confirm, in the *target* tenant:

> **Provenance (verified 2026-07-06):** the observability resource-SP GUID, the
> `Agent365.Observability.OtelWrite` scope, and the ingestion-lag figure below are preview-era
> Agent 365 facts and will change. Re-verify against current Agent 365 onboarding docs before
> quoting them to a customer.

- **Licensing state** — confirm the target tenant/user meets the current Agent 365 licensing
  prerequisites from public onboarding docs.
- **Tenant enrollment state** — confirm Agent 365 is enabled for the target tenant through the
  supported onboarding or admin process.
- **Observability resource SP present** — `az ad sp show --id 9b975845-388f-4429-889e-eab1ef63949c`
  returns a service principal in the tenant. A `404` / `AADSTS500011` ("resource principal … not
  found") means the observability app isn't provisioned there — an onboarding step, not a code fix.
- **Ingestion lag** — Defender `CloudAppEvents` populates before the admin center; give it ~5 min.

**Mark task complete.**

---

## Phase 5 — Summarize Blockers and Next Fixes

**Mark task in progress:** "Summarize blockers and next fixes"

Return a concise report. Default to the short format below; include the optional details block
only when the user asks for deeper debugging or when a blocker needs a code pointer to be
actionable.

```markdown
## A365 Code Validator Result

**Status:** PASS / PASS WITH RISKS / BLOCKED

**Blockers**
1. **<short title>** — <one-sentence impact>.  
   Fix: <one-sentence fix>.
2. **<short title>** — <one-sentence impact>.  
   Fix: <one-sentence fix>.

**High-risk checks**
- <short item> — <why to verify>.

**Identity binding**
- Runtime agent id: <source / missing / from config>
- Blueprint id: <source / missing / from config>
- Verdict: <correct | wrong | unclear>

**Semantic spans**
- Found: <invoke_agent/chat/execute_tool/output_messages or "none">
- Missing: <ops or "none">

**Recommended fix order**
1. <fix root cause first>
2. <then fix config/env>
3. <then verify spans/identity>

**Optional details**
- Files: `<file>:<line or function>`, ...
- Runtime check: <local/App Service env check or SDK log grep>
- Backend verification: use the team's approved telemetry playbook; do not paste internal
  cluster names, private endpoints, or correlation IDs into this report.
```

Style rules:
- Keep the default report to **8 bullets or fewer**.
- Put details under **Optional details**, not in the main blocker list.
- Use exact file/function names for evidence, but do not paste long code blocks.
- Redact per **Output is support-safe** above (no internal infra, tenant/agent IDs, or correlation IDs).
- Do not suggest `a365 publish` unless the agent is an AI Teammate / M365 package flow;
  blueprint-based observability does not use `a365 publish`.

**Mark task complete.**

---

## Phase 6 — Offer Guided Remediation

**Mark task in progress:** "Offer guided remediation"

If there are no `critical` or `high` findings, say:

```markdown
No blocking fixes needed. Keep the runtime verification commands handy for live validation.
```

Then mark the task complete and stop.

If there are `critical` or `high` findings, ask the user with `AskUserQuestion`:

```text
I found blockers. What would you like me to do next?
```

Options:

| Option | Meaning |
|---|---|
| `apply_safe_fixes` | Apply only low-risk, deterministic code/config-template fixes |
| `make_fix_plan` | Produce an implementation plan, no edits |
| `report_only` | Stop after the report |

Default: `make_fix_plan`.

### Safe fixes allowed after confirmation

Only apply these automatically when the user chooses `apply_safe_fixes`:

1. **Python exporter kwarg**
   - If code calls `use_microsoft_opentelemetry(...)` or builds `kwargs` for that call and already
     sets `enable_a365=True`, add the explicit exporter flag:
     ```python
     a365_enable_observability_exporter=True
     ```
     or:
     ```python
     kwargs["a365_enable_observability_exporter"] = True
     ```
   - Preserve existing code style.

2. **Environment templates**
   - Add missing, commented or empty template entries only:
     ```text
     ENABLE_A365_OBSERVABILITY_EXPORTER=true
     ```
   - For S2S mode, add the version-appropriate S2S transport setting only if the code/reference for
     that project already names it. Do not invent a setting name.

3. **Config field scaffolding for runtime agent identity**
   - If the project already has a settings/config class, add a clearly named optional field such as
     `agent_identity_app_id` / `AGENT_IDENTITY_APP_ID`.
   - Use an empty default or placeholder; never hardcode real IDs.
   - Update `.env.example` if present.

### Fixes that require a second explicit question

Ask a focused follow-up before editing:

1. **Which runtime agent identity config name to use**
   - Suggested default: `AGENT_IDENTITY_APP_ID` / `agent_identity_app_id`.
   - Ask if the repo already uses a different naming convention.

2. **Token resolver wiring**
   - If the project already has a token provider with the required exchange flow, ask whether to
     wire an observability token resolver to it.
   - If no such provider exists, do not generate a full token service silently. Provide a plan and
     ask the user to confirm a follow-up implementation.

3. **Semantic spans**
   - Ask whether to add only top-level `invoke_agent` / `output_messages` scopes first, or also wrap
     tools and LLM calls.
   - Prefer incremental fixes: identity/exporter first, semantic span enrichment second.

### Fix report

After applying fixes, show:

```markdown
**Applied fixes**
- ...

**Still needs user input**
- ...

**Validation to rerun**
- `validate a365 code`
- runtime exporter log check
```

Run the smallest available project tests if the edited repo has an obvious test command and the
user did not decline validation. Otherwise, state that no obvious test command was run.

**Mark task complete.**
