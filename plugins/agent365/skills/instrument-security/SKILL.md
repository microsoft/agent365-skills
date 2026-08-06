---
name: instrument-security
description: >
  Instruments Microsoft Defender prevention (Security for AI) into an existing agent so every
  prompt, response, tool call, and tool result is inspected before it is allowed to proceed.
  Adds content- and metadata-inspecting hooks that call the Defender third-party prevention
  webhook (/tp/v1/protection/analyze) with a native Security4AI AISession, authenticating with
  the agent's own Agent 365 Entra identity created by make-a365-agent, and enforces the verdict
  by blocking the call with a readable reason. Google ADK (Vertex AI Agent Engine) is wired
  today via before_agent_callback, after_agent_callback, before_tool_callback, and
  after_tool_callback; the generated code is platform-split so AWS and other hosts can be added
  as additional adapters. Non-destructive and idempotent.
compatibility:
  - claude-code
  - vscode-copilot
  - github-copilot-cli
user-invocable: true
argument-hint: "Optional: path to agent project, or platform hint (google-adk)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-instrument-security.js
      timeout: 30000
    - type: prompt
      prompt: |
        Package layout, hook wiring, configuration, and compilation are checked
        by validate-instrument-security.js. This prompt covers only what the JS
        validator cannot inspect.

        Verify:
        1. All four platform hooks are wired for the detected platform, and the
           agent's pre-existing callbacks were PRESERVED (composed), not replaced.
        2. The tool-result hook inspects the result the model will actually see
           (i.e. it runs after any redaction/rewrite the agent already does).
        3. Blocking returns a readable message containing the Defender reason
           (and diagnostics when present) — never a bare boolean or silent drop.
        4. The fail mode (open/closed) was chosen with the user and is applied
           consistently when the webhook cannot be reached.
        5. Generated code is annotated with the marker comment
           `A365 Security — added by instrument-security skill`.
        6. No secret was written into source; credentials come from env only.

        Return {"ok": false, "reason": "<item>"} if any required item is
        missing, otherwise {"ok": true}.
      timeout: 30000
---

# Instrument Defender Security (Prevention)

> **Trigger phrases** — any of these will activate this skill automatically:
> - "instrument security for this agent"
> - "add defender prevention to this agent"
> - "add a365 security"
> - "protect this agent with defender"
> - "add security hooks to this agent"
> - "block malicious tool calls"
> - "inspect prompts and tool calls with defender"
> - "add prevention webhook to this agent"
> - "wire up security for this google adk agent"
> - "make this agent call the defender prevention endpoint"

---

## Overview

This skill adds **runtime prevention** to an existing agent. It inserts inspection
points at the agent's own lifecycle hooks; each one sends a Security4AI
`AISession` to the Defender third-party prevention webhook and **enforces the
verdict** — blocking the prompt, the response, the tool call, or the tool result
with a human-readable reason.

What gets inspected, and what blocking means:

| Inspection point | Content inspected | Effect when Defender blocks |
|---|---|---|
| Before agent | inbound user prompt | agent never runs; block message is the reply |
| After agent | final agent answer | answer is replaced by the block message |
| Before tool | tool name + arguments | tool never executes |
| After tool | tool result | result the model sees is replaced (indirect prompt-injection checkpoint) |

**Authentication uses the agent's own Entra identity** — the Agent Identity and
Blueprint that `make-a365-agent` / `a365 setup all` already provisioned. No new
app registration, no shared gateway credential, no secret in source. The token
the webhook receives carries the agent's `appid`/`oid`, so the verdict is bound
to a real agent.

**Platform coverage.** Google ADK (Vertex AI Agent Engine) is implemented. The
generated code separates platform-agnostic pieces (config, auth, AISession
builders, webhook client) from a thin per-platform adapter, so AWS and other
hosts are added later as new adapter modules without touching the core.

All changes are **additive** and **idempotent** — existing callbacks are composed,
never replaced, and re-running the skill is safe.

> **Prerequisite:** `a365-setup` → `make-a365-agent` must have run first. This
> skill consumes the Blueprint + Agent Identity they create. It does **not**
> provision Entra objects.

---

## Phase 0: Load Detection Cache and Validate

> **Task-list display (applies throughout this skill).** This skill creates tasks **inline** via `**TaskCreate** — "..."` markers at the start of each phase, and marks them complete at phase end. The user must see this progress visibly.
> - **Claude Code:** `TaskCreate` is in `allowed-tools` — calling it renders a native checklist UI; subsequent `TaskUpdate` calls flip statuses.
> - **VS Code Copilot Chat / GitHub Copilot CLI:** `allowed-tools` is ignored — before Phase 0.1, scan this SKILL.md for all `**TaskCreate** — "..."` lines and emit a markdown checklist in chat (`- [ ] Load detection cache…`), flipping items to `- [x]` as each phase completes.

**TaskCreate** — "Load detection cache and confirm prerequisites"

### Step 0.1 — Triage the workspace

Run in parallel:

- **Glob** `**/*.py`, `**/*.csproj`, `package.json`, `requirements.txt`, `pyproject.toml` → `hasProjectFiles`.
- **Read** `.a365-workspace-detection.local.json` → `cacheState` (`fresh` if `detectedAt` < 60 min, `stale` if older, `missing` if absent).
- **Glob** `a365.generated.config.json`, `a365.config.json`, `.env` → `hasBlueprintArtifacts`.

Decide:

| `cacheState` | `hasProjectFiles` | Action |
|--------------|-------------------|--------|
| `fresh`      | —                 | Continue to Step 0.2. |
| `missing` / `stale` | false      | **Hard stop:** *"This skill adds Defender prevention to an existing agent — there's no agent code in this workspace yet. Run `/agent365:make-a365-agent` first to scaffold and register the agent, then come back here."* |
| `missing` / `stale` | true       | Tell the user: *"Found existing agent code but no fresh Agent 365 registration. I'll run `a365-setup` now to register it and write the detection cache, then continue here automatically."* **Read** `${CLAUDE_PLUGIN_ROOT}/skills/a365-setup/SKILL.md` and follow it to completion, then continue. |

### Step 0.2 — Load from cache

**🛑 STOP — `.a365-workspace-detection.local.json` MUST exist before this step.**
If it does not, you skipped Step 0.1's triage. Do NOT proceed, do NOT invent
default cache values, and do NOT edit any file or install any package. Tell the
user verbatim: *"I skipped the Step 0.1 triage and the detection cache wasn't
written. Running `a365-setup` now to fix that, then I'll return here."* Run it to
completion, then resume.

Read from the cache: `agentStack`, `programmingLanguage`, `agentType`, `authMode`,
`existingBlueprintId`, `tenantId`.

### Step 0.3 — Confirm the agent identity exists

**Read** `a365.generated.config.json` (and `.env`). Extract:

| Value | Source | Used for |
|---|---|---|
| `agentBlueprintId` | `a365.generated.config.json` | `AGENT365_BLUEPRINT_ID` |
| `agenticAppId` | `a365.generated.config.json` | `AGENT365_AGENT_ID` — the Agent Identity |
| blueprint client id / secret | `.env` (`AGENT365_CLIENT_ID` / `AGENT365_CLIENT_SECRET`) | FMI hop 1+2 |
| tenant id | `.env` (`AGENT365_TENANT_ID`) | authority |

If `agenticAppId` is missing, tell the user the agent has no Agent Identity yet
and that `a365 setup all` must be re-run before prevention can authenticate;
offer to continue with `DEFENDER_AUTH_MODE=blueprint` (the Blueprint app
authenticates instead of the per-agent identity) as a documented fallback.

**TaskUpdate** — complete.

---

## Phase 0.5: Prevention Options

**TaskCreate** — "Confirm prevention environment, fail mode, and hooks"

> **INTERACTION POINT.** Ask these with `AskUserQuestion`, one question at a time.
> Skip any question whose value is already present in `.env` and simply report
> what was found (idempotent re-run).

**Question 1 — Defender environment:**

| Choice | Endpoint |
|---|---|
| Dev (Recommended for first wiring) | `https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze` |
| Staging | `https://prevention.thirdparty.stg.ai.defender.microsoft.com/tp/v1/protection/analyze` |
| Prod | `https://prevention.thirdparty.ai.defender.microsoft.com/tp/v1/protection/analyze` |

**Question 2 — Fail mode** (behavior when the webhook is unreachable, times out,
or returns an error):

- **Fail open (Recommended to start)** — allow the action. Availability of the
  agent is preserved; a Defender outage cannot break the agent. This matches the
  platform's own allow-on-failure model.
- **Fail closed** — block the action. Choose this only when the agent handles
  data where an uninspected action is unacceptable, and only after latency and
  reliability have been observed in dev.

**Question 3 — Which inspection points to enable.** Default and recommended: all
four. Offer the subset only if the user asks (e.g. tool-only enforcement while
evaluating latency).

Record answers; they become `DEFENDER_ENVIRONMENT`, `DEFENDER_FAIL_MODE`,
`DEFENDER_HOOKS`.

**TaskUpdate** — complete.

---

## Phase 1: Detect the Agent Platform

**TaskCreate** — "Detect agent platform and select the adapter"

Determine the platform from the cache plus the code:

| Signal | Platform | Adapter |
|---|---|---|
| `agentStack = GoogleADK`, or `google.adk` imports / `google-adk` in requirements | **Google ADK** (Vertex AI Agent Engine) | `security/adapters/google_adk.py` ✅ implemented |
| `bedrock-agentcore`, AgentCore gateway/interceptor Lambda | AWS Bedrock AgentCore | ⛔ not yet implemented |
| anything else | — | ⛔ not yet implemented |

For a **not yet implemented** platform, stop and tell the user exactly this:
*"Defender prevention hooks are currently implemented for Google ADK agents. This
agent runs on `<platform>`, which needs its own adapter under
`security/adapters/`. The platform-agnostic pieces (config, Entra auth, AISession
builders, webhook client) are reusable as-is — only the hook bridge is missing."*
Do not partially wire an unsupported platform.

**TaskUpdate** — complete.

---

## Phase 2: Install Dependencies

**TaskCreate** — "Install prevention dependencies"

Python (Google ADK):

```bash
pip3 install "httpx>=0.27.0" "msal>=1.34.0" "azure-identity>=1.20.0" 2>/dev/null || \
pip install "httpx>=0.27.0" "msal>=1.34.0" "azure-identity>=1.20.0"
```

Add the same three to `requirements.txt` if absent. If the agent already has A365
observability wired, these are almost certainly present already — verify rather
than reinstall, and **do not change pinned versions**: an agent's OpenTelemetry
pins are usually load-bearing.

`azure-identity` is only needed when `AGENT365_USE_MANAGED_IDENTITY=true`; keep
the import inside the function that uses it so managed-identity-less deployments
never pay for it.

**TaskUpdate** — complete.

---

## Phase 3: Create the Security Package

**TaskCreate** — "Create the platform-agnostic security package"

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-security/references/google-adk-security.md`
and create the files it specifies, adapting the package name to the agent:

```
<agent_package>/security/
├── __init__.py            # public surface
├── config.py              # env-driven config; endpoint table; hook toggles
├── entra_auth.py          # Entra token via the agent's OWN identity (FMI 3-hop)
├── ai_session.py          # AISession builders, one per inspection point
├── defender_client.py     # webhook POST + decision model + fail policy
└── adapters/
    ├── __init__.py
    └── google_adk.py      # the four ADK hooks + additive wiring
```

Non-negotiable rules for this phase:

1. **Never write a secret into source.** Every credential is read from the
   environment.
2. **Token acquisition never raises to the caller.** It returns an empty string
   and lets the hook apply the fail policy.
3. **The webhook client never raises.** Transport/auth/protocol errors are folded
   into a decision whose `block` value follows the fail mode.
4. **`sessionContext` must be non-null** in every AISession, or the rule engine
   fails the evaluation open and silently allows everything.
5. **`environment.agent.id` must set the `a365` case** — agent identity is still
   resolved from that oneof; a session without it is rejected.
6. **Omit `entra` unless a non-empty `objectId` is configured.** An empty
   `objectId` is invalid; the webhook stamps it from the authenticated token.

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/instrument-security/references/defender-webhook.md`
for the endpoint contract, the AISession field mapping per hook, and the
permission/consent prerequisites.

Mark every generated file with the marker comment on its first line:
`# A365 Security — added by instrument-security skill`

**TaskUpdate** — complete.

---

## Phase 4: Wire the Platform Hooks

**TaskCreate** — "Wire the four inspection hooks additively"

Wire all four Google ADK callbacks through `secure_agent_callbacks(...)`:

```python
# A365 Security — added by instrument-security skill
from .security.adapters import secure_agent_callbacks

root_agent = Agent(
    ...,
    **secure_agent_callbacks(
        before_agent_callback=before_agent_hook,
        after_agent_callback=after_agent_hook,
        before_tool_callback=before_tool_hook,
        after_tool_callback=after_tool_hook,
    ),
)
```

**Why composition, not a callback list.** ADK accepts a list of callbacks but
stops at the first one that returns a value. An agent that already redacts or
rewrites tool output (common with observability instrumentation) returns a value
from its own after-tool hook — which would silently skip the security hook
appended after it. `secure_agent_callbacks` therefore **composes**:

- **before_agent / before_tool** — the agent's hooks run first; if they
  short-circuit, that is respected; otherwise security decides.
- **after_agent / after_tool** — the agent's hooks always run (they close tracing
  scopes), then security inspects the **effective** result — what the model or
  user would actually receive — and a block verdict wins.

Preserve every existing callback. If a hook is disabled in `DEFENDER_HOOKS`, the
original callback must be passed through untouched.

**Idempotency:** if `secure_agent_callbacks` is already imported and applied, do
not wrap a second time — report that the wiring is already in place.

**TaskUpdate** — complete.

---

## Phase 5: Update Configuration

**TaskCreate** — "Stamp prevention configuration"

Append to `.env` (do not duplicate keys that already exist):

```bash
# ── Microsoft Defender prevention (Security for AI) — added by instrument-security ──
DEFENDER_PREVENTION_ENABLED=true
DEFENDER_ENVIRONMENT=dev
DEFENDER_WEBHOOK_APP_ID=<resource app id the webhook validates the audience against>
DEFENDER_AUTH_MODE=agent-identity
DEFENDER_FAIL_MODE=open
DEFENDER_HOOKS=before_agent,after_agent,before_tool,after_tool
DEFENDER_TIMEOUT_SECONDS=10
DEFENDER_MAX_CONTENT_CHARS=20000
```

**Forward the variables to the deployed runtime.** Local `.env` is not visible to
a hosted agent. For Vertex AI Agent Engine, add the `DEFENDER_*` keys to the
`env_vars` passed to `agent_engines.create/update` in `deploy.py`. For other
hosts, set them at the platform level (`az webapp config appsettings set`,
`gcloud run services update --set-env-vars`, `eb setenv`, …). Say this explicitly
to the user — silently-missing env vars in the cloud is the most common reason
prevention appears wired but never runs.

**TaskUpdate** — complete.

---

## Phase 6: Verify Permissions

**TaskCreate** — "Verify the agent identity can reach the prevention resource"

The agent identity must be able to acquire a token for the prevention resource
(`api://<DEFENDER_WEBHOOK_APP_ID>/.default`), and the webhook must accept that
audience.

Check `a365.generated.config.json` → `resourceConsents` and report status. If the
prevention resource is absent, surface the handoff rather than attempting to
grant anything: permission grants require a Global Administrator, and this skill
never mutates Graph. Tell the user which resource app id needs consent for which
blueprint, and that `a365 setup all` prints the GA script.

A `401`/`403` from the webhook, or an `AADSTS500011`/`AADSTS65001` from the token
endpoint, means this step is incomplete — say so plainly instead of reporting a
generic failure.

**TaskUpdate** — complete.

---

## Phase 7: Validate

**TaskCreate** — "Validate the project builds"

Python: `python -m compileall -q <agent_package>` and import the agent module.
Fix any error before continuing. Do not proceed to a smoke test on a project that
does not import.

**TaskUpdate** — complete.

---

## Phase 8: Smoke Test

**TaskCreate** — "Smoke-test allow and block paths"

Run two turns and show the user the outcome of each:

1. **Benign** — e.g. *"Call the platform_info tool and tell me whether the
   connection is authenticated."* Expect one verdict per enabled hook, all
   `block=false`, and a normal answer. Seeing four verdicts confirms all four
   inspection points are live.
2. **Known-bad** — a prompt that routes a known test indicator into a tool
   argument, e.g. *"Save this link to notes.txt in my 'work' drive:
   `https://test.security.dfai.microsoft.com`"*. Expect `block=true` with a
   reason, and the agent surfacing the readable block message.

If the known-bad case is allowed, do not declare success. Check, in order:
exporter/hook enablement, that the tool argument actually carries the indicator,
and whether the webhook returned `evaluated=false` (an auth/transport failure
being masked by fail-open).

**TaskUpdate** — complete.

---

## Phase 9: Final Summary

**TaskCreate** — "Summarize what was wired"

Report:

- Which inspection points are live, and the endpoint/environment in use.
- The auth mode, and the identity the webhook sees (`appid` = Agent Identity).
- The fail mode, stated as its operational consequence — *"if Defender is
  unreachable, calls are allowed"* or *"…are blocked"*.
- Observed per-call latency from the smoke test, and that each enabled hook adds
  one round trip to the turn.
- Which env vars must be set in the **deployed** runtime, and how.
- That blocking is enforced client-side by this agent: prevention is only as
  strong as the agent's own code path, so the hooks must not be bypassed by
  alternate entry points.

**TaskUpdate** — complete.

---

## Reference

- Full Google ADK implementation: [references/google-adk-security.md](references/google-adk-security.md)
- Webhook contract, AISession mapping, auth and consent: [references/defender-webhook.md](references/defender-webhook.md)
