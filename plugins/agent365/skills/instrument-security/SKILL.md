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

## Prevention resource and app role

Authentication is **the same FMI 3-hop chain `instrument-observability` uses** — only
the target resource, app role, and endpoint differ. Everything else (blueprint
credential → FMI token with `fmi_path=<agentId>` → Agent Identity → resource token,
in-process caching, never raising to the caller) is identical, so read
[instrument-observability](../instrument-observability/SKILL.md) for the shared shape.

| | Observability | Prevention |
|---|---|---|
| Resource app id | `9b975845-388f-4429-889e-eab1ef63949c` | `86a21212-634e-4553-b3d6-e477e4c9d9ec` |
| Resource name | `Agent365Observability` | `Defender for AI Prevention Webhook` |
| Scope | `api://9b975845-…/.default` | `https://rtp-a365.ai.defender.microsoft.com/.default` |
| App role | `Agent365.Observability.OtelWrite` | `AIAgentsRTP.ToolInvocation` |
| Granted to | blueprint SP (agents inherit via FMI) | blueprint SP (agents inherit via FMI) |
| Granted by | `a365 setup all` (automatic) | Phase 6 of this skill — not yet in the CLI |
| Endpoint | Observability ingestion | `/tp/v1/protection/analyze` |

> **`AIAgentsRTP.ToolInvocation` is a reused role.** It is an existing role on the prevention
> application, adopted so the path works today. A **dedicated role for the A365 SDK
> prevention flow should replace it**, so prevention access can be granted and revoked
> independently of tool invocation. Grants bind by role *id*, so a new role means a new
> grant: run both values during the migration (the server takes a list with OR semantics).

**One caller shape only.** An agent calls with its own Agent 365 Entra identity, obtained
through the FMI chain, and is authorized by the app role in its token. There is no gateway
or delegation path and no app allow-list — an application may only report prevention
activity for itself, and the server binds the agent identity in the payload to the token's
`oid` rather than trusting the body.

Like the observability scope, these are **known constants** shipped in the generated
`config.py` (`PREVENTION_RESOURCE_APP_ID`, `PREVENTION_SCOPE`, `PREVENTION_APP_ROLE`) —
they are not per-agent values and must never be asked for per run.
`DEFENDER_WEBHOOK_SCOPE` / `DEFENDER_WEBHOOK_APP_ID` exist only as overrides.

> ⚠️ **The scope is an `https://` URI, not `api://`.** The prevention resource's
> identifier URI is `https://rtp-a365.ai.defender.microsoft.com`; requesting
> `api://86a21212-…/.default` fails with `AADSTS500011` *even when the service principal
> exists*, because that URI is not one of the SP's `servicePrincipalNames`. Observability
> happens to use the `api://<appId>` form, so blindly copying its shape breaks here.
> The token's `aud` comes back as the raw app id (`86a21212-…`), which is what the
> webhook matches against `AzureAd:AuthorizedApplications`.

### Provisioning

The grant is performed by **Phase 6** of this skill, which runs
`scripts/Grant-PreventionRole.ps1`. It does the three operations `a365 setup all` already
does for `Agent365.Observability.OtelWrite`:

| Step | Observability | Prevention |
|---|---|---|
| 1. Resource SP in tenant | `a365 setup all` | `az ad sp create --id 86a21212-…` |
| 2. Inheritable permissions on blueprint | `a365 setup all` | `a365 setup permissions custom` |
| 3. App role assigned to **blueprint SP** | `a365 setup all` | Graph `appRoleAssignments` POST |

`make-a365-agent` Phase 2.4 runs the same script, so an agent registered through that skill
arrives here already granted and Phase 6 reports `already-granted`.

Confirm success by decoding the token: `roles` must contain `AIAgentsRTP.ToolInvocation`.
A token without it means the endpoint is accepting the call on audience validation alone.


**Audience is not identity.** The scope sets `aud` — *which resource* the token is for.
The caller (`azp`/`oid`) always comes from the FMI chain and is the agent's own identity.
A correct token looks like:

```
aud   86a21212-634e-4553-b3d6-e477e4c9d9ec   ← WHAT is being called
azp   <agenticAppId>                          ← WHO is calling — the agent (v2: azp, not appid)
oid   <agent identity object id>
roles ["AIAgentsRTP.ToolInvocation"]          ← authorization
```

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

| Value | Source | Becomes |
|---|---|---|
| `agentBlueprintId` | `a365.generated.config.json` | `AGENT365_BLUEPRINT_ID` |
| `agenticAppId` | `a365.generated.config.json` | `AGENT365_AGENT_ID` — the Agent Identity |
| blueprint client id | `.env` `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID` (= the blueprint id) | `AGENT365_CLIENT_ID` |
| blueprint client secret | `.env` `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET` | `AGENT365_CLIENT_SECRET` |
| tenant id | `.env` `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID` | `AGENT365_TENANT_ID` |

> **`a365 setup all` does NOT write the `AGENT365_*` names this skill's code reads.**
> The CLI writes its own shapes — `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__*` and
> `AGENT365OBSERVABILITY__*`. An agent that already has A365 observability wired may
> also have the canonical `AGENT365_*` block, but a freshly registered agent will not.
> Do not assume they exist: Phase 5 stamps any that are missing, mapping from the
> sources in the table above. Skipping this produces a confusing runtime failure —
> `AGENT365_TENANT_ID is not set` — on an agent whose registration is perfectly fine.

If `agenticAppId` is missing, tell the user the agent has no Agent Identity yet
and that `a365 setup all` must be re-run before prevention can authenticate.
There is no fallback — the FMI chain needs the agent identity, and no other
caller shape is accepted by the webhook.

If the blueprint client secret is not in `.env` in any form, retrieve it with
`a365 setup blueprint --show-secret` (same folder, machine, and user account that
ran setup). Never echo it — write it straight into `.env`.

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

1. **`entra_auth.py` is `observability/token_provider.py` with a different scope.**
   If the agent already has observability wired, start from that file and change only:
   the scope (`PREVENTION_SCOPE`), the resolver name (`get_defender_token`), and the
   error strings. The FMI 3-hop chain, the in-process cache, and the never-raise
   contract are identical and must stay identical — do not invent a second token flow.
   There is exactly **one** flow: blueprint credential → FMI token (`fmi_path=<agentId>`)
   → agent identity → prevention token. No gateway, no federation, no client-secret
   shortcut.
2. **Never write a secret into source.** Every credential is read from the
   environment.
3. **Token acquisition never raises to the caller.** It returns an empty string
   and lets the hook apply the fail policy.
4. **The webhook client never raises.** Transport/auth/protocol errors are folded
   into a decision whose `block` value follows the fail mode.
5. **`sessionContext` must be non-null** in every AISession, or the rule engine
   fails the evaluation open and silently allows everything.
6. **`environment.agent.id` must set the `a365` case** — agent identity is still
   resolved from that oneof; a session without it is rejected.
7. **Omit `entra` unless a non-empty `objectId` is configured.** An empty
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
# Override only. The prevention resource is a known constant (see "Prevention
# resource and app role"), exactly as Observability uses api://9b975845-…/.default.
# Sets the token AUDIENCE, never the caller identity.
# DEFENDER_WEBHOOK_SCOPE=<override only — defaults to the shipped PREVENTION_SCOPE constant>
DEFENDER_FAIL_MODE=open
DEFENDER_HOOKS=before_agent,after_agent,before_tool,after_tool
DEFENDER_TIMEOUT_SECONDS=10
DEFENDER_MAX_CONTENT_CHARS=20000
```

**Also stamp the canonical `AGENT365_*` identity values if they are absent** —
`a365 setup all` does not write them (see Step 0.3). Map them from
`a365.generated.config.json` and the CLI's own `.env` entries:

```bash
# ── Agent 365 identity — consumed by the prevention config ──
AGENT365_TENANT_ID=<CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID>
AGENT365_AGENT_ID=<agenticAppId from a365.generated.config.json>
AGENT365_BLUEPRINT_ID=<agentBlueprintId from a365.generated.config.json>
AGENT365_CLIENT_ID=<agentBlueprintId — the blueprint app is the FMI client>
AGENT365_CLIENT_SECRET=<CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET>
AGENT365_AGENT_NAME=<agent name>
AGENT365_USE_MANAGED_IDENTITY=false
```

Without these the agent fails at runtime with `AGENT365_TENANT_ID is not set`,
which looks like a broken registration but is only a naming mismatch.

**Forward the variables to the deployed runtime.** Local `.env` is not visible to
a hosted agent. For Vertex AI Agent Engine, add the keys to the `env_vars` passed
to `agent_engines.create/update` in `deploy.py`:

```python
# A365 Security — added by instrument-security skill
DEFENDER_ENV_KEYS = (
    "DEFENDER_PREVENTION_ENABLED",
    "DEFENDER_ENVIRONMENT",
    "DEFENDER_WEBHOOK_URL",
    "DEFENDER_WEBHOOK_APP_ID",
    "DEFENDER_WEBHOOK_SCOPE",
    "DEFENDER_FAIL_MODE",
    "DEFENDER_HOOKS",
    "DEFENDER_TIMEOUT_SECONDS",
    "DEFENDER_MAX_CONTENT_CHARS",
    "AGENT365_AGENT_OBJECT_ID",
    "AGENT365_PLATFORM_AGENT_ID",
    "AGENT365_PLATFORM_TYPE",
)

for key in DEFENDER_ENV_KEYS:          # inside build_env_vars()
    value = os.environ.get(key)
    if value:
        env_vars[key] = value
```

The `AGENT365_*` identity keys must be forwarded the same way — most deploy
scripts already do this for observability; verify rather than assume.

For other hosts, set them at the platform level (`az webapp config appsettings set`,
`gcloud run services update --set-env-vars`, `eb setenv`, …). Say this explicitly
to the user — silently-missing env vars in the cloud is the most common reason
prevention appears wired but never runs.

**TaskUpdate** — complete.

---

## Phase 6: Grant the Prevention App Role

**TaskCreate** — "Grant the prevention app role to the agent's blueprint"

The agent's token must carry `AIAgentsRTP.ToolInvocation` or the call is unauthorized.
`a365 setup all` does **not** grant it yet (it does the equivalent automatically for
`Agent365.Observability.OtelWrite`), so this skill performs the grant itself.

Run the packaged script from the agent project folder. It takes no arguments — everything
is discovered from `a365.generated.config.json`:

```bash
pwsh ${CLAUDE_PLUGIN_ROOT}/skills/instrument-security/scripts/Grant-PreventionRole.ps1 -Json
```

It performs the three operations `a365 setup all` would:

1. `az ad sp create` — provisions the prevention resource SP in the tenant (without it the
   token request fails `AADSTS500011`).
2. `a365 setup permissions custom` — adds the resource to the blueprint's required access
   and inheritable permissions.
3. Graph `appRoleAssignments` POST on the **blueprint** SP — the actual grant. Agent
   identities inherit it through the FMI chain, so one grant covers every agent from that
   blueprint.

**All three are required.** Steps 1–2 alone leave the token with **no `roles` claim** —
inheritable permissions describe what *may* be inherited; they are not a grant.

Parse the single-line JSON result and act on `status`:

| `status` | Meaning | What to do |
|---|---|---|
| `already-granted` | Role present — including once the SDK grants it | Nothing. Report and move on. |
| `granted` | The three operations succeeded | Report that prevention is authorized for every agent from this blueprint. |
| `needs-admin` | Caller lacks privileges | Show `message` verbatim — it carries the exact command for a Global Administrator. The agent will run fail-open until it is done; say so plainly. |
| `error` | Setup incomplete | Show `message`; usually `a365 setup all` has not run in this folder. |

The script is **idempotent and self-retiring**: it checks first and exits immediately when
the role is already granted. Once the A365 SDK grants it during `a365 setup all`, every run
returns `already-granted` and this phase can be deleted.

Use `-WhatIf` to report state without changing anything.

**Do not** attempt any other authorization path. There is no app allow-list and no gateway
delegation — an application may only report prevention activity for itself, and the app role
is the only way in. If the grant cannot be completed, say the agent is unauthorized rather
than looking for a bypass.

Entra propagation can take up to a minute, and a token cached before the grant will not
carry the role — so a smoke test immediately after granting may still show `401`.

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
