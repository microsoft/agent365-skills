---
name: purview-dlp-integration
description: >
  Integrate Microsoft Purview DLP (data loss prevention) + audit into an existing Microsoft
  Agent 365 (A365 SDK) agent, so sensitive prompts/responses are blocked before the LLM. Use
  when a user wants to add Purview DLP to an AI agent, block sensitive data (credit cards, SSNs,
  PII) in agent turns, enforce data protection/compliance on an A365 AgentApplication, call the
  Graph processContent API, or wire a DLP gate into agent code. Bundles drop-in guards for
  Node.js/TypeScript, Python, and .NET, minimal wiring for each, a PowerShell script to create
  the AI-apps DLP policy, a Purview portal/tenant enablement guide, and verification +
  troubleshooting. Works with A365 agents in Node.js (@microsoft/agents-hosting), Python
  (microsoft-agents-hosting-*), and .NET (Microsoft.Agents.*).
compatibility:
  - claude-code
  - vscode-copilot
  - github-copilot-cli
user-invocable: true
argument-hint: "Add Purview DLP blocking to my A365 agent"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-purview-dlp-integration.js
      timeout: 30000
    - type: prompt
      prompt: |
        The DLP guard file, wiring, env var, and marker comments are scanned by
        validate-purview-dlp-integration.js (report-first — findings are advisory
        because the skill supports a legitimate "skip policy" state). This prompt
        covers only the items the JS validator can't inspect.

        Verify:
        1. The agent language was detected and the MATCHING guard was copied
           (Node.js → assets/purview.ts, Python → assets/purview.py,
           .NET → assets/purview.cs) — not a cross-language mix.
        2. Both gates are wired in the message handler: the INPUT gate runs
           BEFORE the LLM call and the OUTPUT gate runs before the reply is sent
           (only when PURVIEW_CHECK_OUTPUT=true).
        3. The guard is passed the agent's own agentic auth handler + auth-handler
           name + turn context/id — NOT app-only client credentials.
        4. `PURVIEW_DLP_ENABLED` was appended to the agent's `.env` (or host app
           settings for .NET).
        5. The DLP policy choice (new / existing / skip) was resolved with the
           user, and the delegated `Content.Process.User` scope grant step was
           surfaced (Grant-DelegatedGraphScope.ps1) — never
           `az ad app permission admin-consent` on the blueprint app.

        Return {"ok": false, "reason": "<item>"} if any required item is
        missing, otherwise {"ok": true}.
      timeout: 30000
---

# Microsoft Purview DLP Integration for Agent 365

> **Trigger phrases** — any of these will activate this skill automatically:
> - "add Purview DLP to my agent"
> - "add data loss prevention to my A365 agent"
> - "block credit cards / SSNs / PII before my agent's LLM sees them"
> - "enforce compliance / audit on agent prompts and responses"
> - "wire a DLP gate into my agent code"
> - "call the Graph processContent API from my agent"
> - "add Purview blocking to my Node.js / Python / .NET agent"

---

Add a Purview data-loss-prevention **gate** around an existing A365 agent's LLM call: every turn's
prompt (and optionally the response) is evaluated by Microsoft Purview via the Graph
`processContent` API and **blocked** when a DLP policy matches. `processContent` also writes the
Purview **audit** event. Designed for **minimal, reversible changes** to the customer's agent.

## When to use
- "Add Purview DLP / data loss prevention to my agent."
- "Block credit cards / SSNs / PII before my agent's LLM sees them."
- "Enforce compliance / audit on agent prompts and responses."
- Any A365 agent — **Node.js, Python, or .NET** — that needs inline DLP.

## When NOT to use
- Adding OpenTelemetry tracing / MAC Activity telemetry → use `instrument-observability`.
- Diagnosing why telemetry isn't reaching MAC Activity / Defender → use `a365-code-validator`.
- Provisioning the blueprint / Entra permissions from scratch → use `a365-setup` /
  `make-a365-agent` first, then return here.

## How it works
```
user turn ─► [INPUT gate] processContent(uploadText, /me)  ─► block? ─► reply "blocked", STOP (LLM never called)
                                                            └─ allow ─► LLM ─► [OUTPUT gate] processContent(downloadText) ─► block? ─► withhold
```
- **Token:** the agent's **agentic delegated** Graph token, evaluated as **`/me`** (the agent
  identity) — acquired via the agent's own auth handler: Node.js `GetAgenticUserToken`, Python
  `authorization.exchange_token(…)`, .NET `UserAuthorization.GetTurnTokenAsync(…)`. *A365 blueprint
  apps cannot use app-only client-credentials here — Graph strips data-plane roles from that token.*
- **Fail-closed** by default: any Purview error/timeout blocks the turn.
- **Policy:** a dedicated Purview DLP policy scoped to the agent's **Entra app id** (portal:
  "Managed cloud apps" / `Applications` workload) with a **RestrictAccess=Block** rule.

### S2S / app-only agents (autonomous, no AgentApplication)

For an agent that authenticates **service-to-service** (no signed-in user, no
`@microsoft/agents-hosting` AgentApplication — e.g. an Express / worker-loop agent using the A365
FMI client-credentials chain), use the **S2S guard** [`assets/purview-s2s.ts`](./assets/purview-s2s.ts)
instead of `purview.ts`.

**Verified 2026-08-26 (tenant 01eed126-…):** app-only DLP *is* supported — the "blueprint app-only
tokens get stripped" rule is true for the **blueprint** app but **not** for the **agent identity**:

| Token source | `roles` in the Graph token |
|---|---|
| Blueprint app-only (client-credentials) | `AgentIdentity.CreateAsManager` — **Content.Process.* STRIPPED** |
| Agent identity via the FMI 3-hop chain | **`Content.Process.All` RETAINED** ✅ |

So the S2S guard (1) mints the **agent identity's** Graph token through the FMI chain
(Blueprint → `fmi_path` → Agent Identity → Graph), (2) calls the app-only endpoint
`POST /beta/users/{sponsorUserId}/dataSecurityAndGovernance/processContent` (app-only can't use
`/me`), and (3) passes an `agents:[{"@odata.type":"aiAgentInfo", blueprintId, identifier, name}]`
entry plus `protectedAppMetadata.applicationLocation` = the agent app id (the DLP policy scope).

**Two steps differ from the delegated path:**
- **Permission:** grant `Content.Process.All` (**Application**) to the **agent identity** SP (not the
  blueprint) — run [`scripts/Grant-ContentProcessAppRole.ps1`](./scripts/Grant-ContentProcessAppRole.ps1)
  instead of `Grant-DelegatedGraphScope.ps1`.
- **Wiring:** import `purviewGuard` from `./purview-s2s.js` and call `evaluatePrompt(text)` /
  `evaluateResponse(text)` directly around the LLM call (no TurnContext / Authorization args). The
  guard reuses the `agent365Observability__*` S2S credentials already stamped by `a365 setup all`.

Everything else — the DLP policy (Step 6), the `[purview]` log format, fail-closed semantics — is identical.

---

## Before you start — read the A365 config, then ask for the rest

**First, auto-discover from the project's A365 config.** The guard and both scripts read these
automatically, but read them yourself to confirm values and drive the workflow. From the agent
project root, read `a365.config.json` and `a365.generated.config.json`:

| Value | Config source |
|-------|---------------|
| App (client) id → `PURVIEW_APP_ID` | `a365.generated.config.json` → `agentBlueprintId` (or `botMsaAppId`) |
| Blueprint id → `PURVIEW_BLUEPRINT_ID` | `a365.generated.config.json` → `agentBlueprintId` |
| Agent SP object id (for the consent script) | `a365.generated.config.json` → `agentBlueprintServicePrincipalObjectId` |
| Display name → `PURVIEW_APP_NAME` | `a365.config.json` → `agentBlueprintDisplayName` / `agentDescription` |
| Tenant id | `a365.config.json` → `tenantId` |
| Current Graph scopes (is `Content.Process.User` already granted?) | `a365.generated.config.json` → `resourceConsents[]` where `resourceName == "Microsoft Graph"` → `scopes` |

**Then ask the customer only for what's *not* in config** (use the ask-questions tool):

| Ask | Notes / default |
|-----|-----------------|
| **DLP policy — new, existing, or skip** | **Always ask (unless the user specified it when invoking the skill):** **create a new** policy (default), **use an existing** one, or **skip** (they'll add it manually / already have it). Drives Step 6. |
| **Sensitive info type(s) to block** | Default `Credit Card Number`. Any Purview SIT. Only needed when creating a **new** policy. |
| **Admin UPN for alerts** | Optional; recommended (agents are unaware of blocks). |
| **Agentic auth handler name** | The `static authHandlerName` on their `AgentApplication` (usually `agentic`). |
| **Entry/handler file + LLM call site** | Where the message handler + LLM call live (locate in code when possible). |
| **Who does Purview admin?** | Confirm they (or an admin) can enable billing/DSPM-for-AI + run the scripts. |

> If the project has **no** a365 config (non-A365 or not yet provisioned), ask for the app id,
> display name, and tenant id directly and pass them explicitly to the scripts/env.

---

## Procedure

### 0. Detect the agent language
Pick the guard/wiring by the agent's stack (all three share the SAME env vars, PowerShell scripts,
policy, and `[purview]` log format — only the guard file + wiring differ):

| Language | Detect by | Guard asset | Wiring |
|----------|-----------|-------------|--------|
| **Node.js / TypeScript** | `package.json` (`@microsoft/agents-hosting`) | `assets/purview.ts` | `assets/wiring-snippet.ts` |
| **Python** | `pyproject.toml` / `requirements.txt` (`microsoft-agents-hosting-*`) | `assets/purview.py` | `assets/wiring-snippet.py` |
| **.NET** | `*.csproj` (`Microsoft.Agents.*`) | `assets/purview.cs` | `assets/wiring-snippet.cs` |

> Node.js and Python guards are verified against a live agent; the **.NET** guard is a **best-effort**
> port — verify the `ITurnContext` / `UserAuthorization` namespaces against your SDK version.

### 1. Locate the agent code
Find the message handler (the method that calls the LLM) and the LLM call:
- **Node.js:** the `AgentApplication` subclass, `onActivity(ActivityTypes.Message, …)`.
- **Python:** the `AgentInterface` implementation's `process_user_message` (or the aiohttp host's `on_message`).
- **.NET:** the `AgentApplication` subclass's `OnMessageAsync`.

Confirm the A365 runtime/hosting package is present (Node.js `@microsoft/agents-a365-runtime`,
Python `microsoft-agents-hosting-core`, .NET `Microsoft.Agents.*`) — standard for A365 agents.

### 2. Add the guard (1 new file)
Copy the guard for your language into the agent's source folder (next to the agent class) — it is
generic and env-driven, no edits needed:
- **Node.js:** [`assets/purview.ts`](./assets/purview.ts)
- **Python:** [`assets/purview.py`](./assets/purview.py)
- **.NET:** [`assets/purview.cs`](./assets/purview.cs) (adjust the `using` namespaces for
  `ITurnContext` / `UserAuthorization` to your SDK version)

### 3. Wire the two gates (minimal edits)
Apply the wiring snippet for your language to the message handler (and any notification/email
handler that calls the LLM): import the guard, add the **input gate** before the LLM and the
**output gate** before the reply is sent. Pass the agent's authorization handler + auth-handler name + turn context/id.
- **Node.js:** [`assets/wiring-snippet.ts`](./assets/wiring-snippet.ts) — passes `this.authorization`.
- **Python:** [`assets/wiring-snippet.py`](./assets/wiring-snippet.py) — passes `auth`, `auth_handler_name`, `context` (already parameters of `process_user_message`).
- **.NET:** [`assets/wiring-snippet.cs`](./assets/wiring-snippet.cs) — passes `UserAuthorization`, the agentic handler name, `turnContext`.

### 4. Add environment variables
Append the keys from [`assets/purview.env.example`](./assets/purview.env.example) to the agent's
`.env`. On an A365 project the only key you **must** set is `PURVIEW_DLP_ENABLED=true` — the guard
auto-reads `PURVIEW_APP_ID` / `PURVIEW_APP_NAME` / blueprint id from `a365.config.json` +
`a365.generated.config.json`. Set them explicitly only to override or for a non-A365 project.

### 5. Grant the delegated Graph scope
Run [`scripts/Grant-DelegatedGraphScope.ps1`](./scripts/Grant-DelegatedGraphScope.ps1) from the
agent project folder (needs `az login`). `-AppId` is **auto-discovered** from
`a365.generated.config.json` (pass `-AppId <app-id>` to override, or `-ConfigDir <path>` if the
config lives elsewhere). It **appends** `Content.Process.User` to the agent's existing agentic
consent. **Never** run `az ad app permission admin-consent` on the blueprint app.

### 6. Choose the DLP policy — new, existing, or skip

**Ask the user which policy to use** (skip the prompt only if they already told you when invoking
the skill, e.g. "use my existing 'Corp PII' policy", "create a new one", or "I'll add it manually"):

> "Which Purview DLP policy should gate this agent?
>   1. **Create a new** dedicated AI-app policy (default),
>   2. **Use an existing** DLP policy you already have, or
>   3. **Skip** — don't create one now; I'll add it manually (or already have one)."

The guard is **policy-name-agnostic** — it calls `processContent` with the agent's app id as the
`applicationLocation`, and Purview evaluates *every* policy whose Applications location includes
that app id. So this choice affects only this step, never the guard code.

**Option A — Create a new policy (default):**
Run [`scripts/New-AiAppDlpPolicy.ps1`](./scripts/New-AiAppDlpPolicy.ps1) from the agent project
folder (needs the `ExchangeOnlineManagement` module). `-AppId` / `-AppName` are **auto-discovered**
from the a365 config; typically you only pass `-SensitiveInfoType "Credit Card Number" -NotifyUser
<admin-upn>`. Override with `-AppId` / `-AppName` for a non-A365 project. Or follow
[`references/purview-portal-guide.md`](./references/purview-portal-guide.md) to do it in the portal.

**Option B — Use an existing policy:**
1. **List candidates** (read-only) to see which policies already cover this agent's app id:
   ```powershell
   ./scripts/New-AiAppDlpPolicy.ps1 -ListExisting
   ```
   It connects to Security & Compliance and prints every DLP policy, flagging whether the agent's
   app id is already **COVERS THIS APP**.
2. **If the chosen policy already covers the app id** — nothing to create; the guard will match it.
   Confirm its `Mode` is `Enable` and it has a `RestrictAccess`/`Block` rule on `UploadText`.
3. **If the chosen policy does *not* cover the app id** — add this agent's app id to that policy's
   Applications (Managed cloud apps) location in the portal
   ([purview-portal-guide.md](./references/purview-portal-guide.md)), or fall back to Option A.

**Option C — Skip (add the policy manually, or handle it later):**
Create nothing now. The guard stays wired and enabled — it just won't *block* until a matching
policy exists (until then it logs `allowed … 0 policyAction(s)`). To add the policy yourself, it
**must** have ALL of the following or the guard won't block (full portal walkthrough:
[purview-portal-guide.md](./references/purview-portal-guide.md)):

| # | Requirement | Value / note |
|---|-------------|--------------|
| 1 | **Location = Applications** (portal: **"Managed cloud apps"**) | scoped to the agent's **Entra app (client) id** (`PURVIEW_APP_ID`). Do **not** combine Exchange/SharePoint/OneDrive/Teams in the same policy — Purview rejects that mix for this workload. |
| 2 | **Enforcement plane = `Application`** | NOT "Copilot experiences" (that's first-party Copilot). |
| 3 | **Rule condition** = Content contains **sensitive info type** | your SIT(s), e.g. `Credit Card Number`. |
| 4 | **Rule action = Restrict access → Block** on the **prompt** (`UploadText`) | blocking the response (`DownloadText`) isn't supported for this workload → prompt/input gate only. |
| 5 | **Mode = Enable** | turn the policy on. |
| 6 | *(optional)* **Notify** an admin UPN | agents don't surface a block to a human. |

Equivalent Security & Compliance PowerShell (exactly what Option A automates — run it by hand if you prefer):

```powershell
Connect-IPPSSession
$loc = '[{"Workload":"Applications","Location":"<APP_ID>","LocationDisplayName":"<name>","LocationSource":"Entra","LocationType":"Individual","Inclusions":[{"Type":"Tenant","Identity":"All"}]}]'
New-DlpCompliancePolicy -Name "<policy>" -Mode Enable -Locations $loc -EnforcementPlanes @('Application')
New-DlpComplianceRule   -Name "<rule>" -Policy "<policy>" `
  -ContentContainsSensitiveInformation @(@{ Name = 'Credit Card Number' }) `
  -RestrictAccess @(@{ setting = 'UploadText'; value = 'Block' })
```

Judge success only by the agent's `[purview] uploadText -> BLOCKED (… 1 policyAction(s) … errors=0)`
log line — **not** by `DistributionStatus` (shows `Pending` even for live policies). Allow up to ~1 hour to propagate.

### 7. Confirm tenant prerequisites
DLP-for-AI is metered. If everything is configured but nothing blocks (with `errors=0`), verify
**pay-as-you-go billing** + **DSPM-for-AI onboarding** + licensing — see
[`references/purview-portal-guide.md`](./references/purview-portal-guide.md) §0.

### 8. Build, run, verify
Rebuild/restart the agent so it reloads `.env` (**Node.js:** `npm run build && npm start`;
**Python:** restart `python …`; **.NET:** `dotnet run`). Send a message containing a **Luhn-valid**
test value, e.g. `My credit card is 4111 1111 1111 1111`. Watch the console.

---

## Verify — expected logs
```
[turn] in  <- ... text="My credit card is 4111 1111 1111 1111"
[purview] uploadText -> BLOCKED (HTTP 200, 1 policyAction(s), scopeState=modified, errors=0)
```
- ✅ `BLOCKED` + `1 policyAction(s)` + `errors=0` → working; the agent replies with the block message and the LLM is never called.
- `allowed (… 0 policyAction(s) … errors=0)` → request fine, but no policy matched yet (scope/propagation/tenant enablement).
- `REQUEST ERROR (… errors=1 …)` → malformed request (usually the `name` field) — see troubleshooting.

Full symptom→fix table: [`references/troubleshooting.md`](./references/troubleshooting.md).

---

## Dependencies (customer agent)
No extra Graph SDK / `@azure/identity` / MSAL needed for any language — the guard uses the agent's
own agentic auth handler + a plain HTTPS POST.
- **Node.js:** `@microsoft/agents-hosting` + `@microsoft/agents-a365-runtime`, Node 18+ (global `fetch`), `dotenv`.
- **Python:** `microsoft-agents-hosting-core` + `httpx` (both standard in A365 Python agents), `python-dotenv`.
- **.NET:** `Microsoft.Agents.*` hosting packages (standard); uses `System.Net.Http` + `System.Text.Json` (no extra NuGet).

## Non-negotiable constraints (why it's built this way)
1. **Agentic delegated token + `/me` (AgentApplication agents); agent-identity FMI token (S2S agents)** — a *blueprint* app-only token is stripped of data-plane roles (Content.Process.*) by Graph, so an AgentApplication agent must use its agentic delegated token (Node.js `AgenticAuthenticationService.GetAgenticUserToken`, Python `authorization.exchange_token(…)`, .NET `UserAuthorization.GetTurnTokenAsync(…)`). **But an S2S / autonomous agent CAN do app-only DLP** — using the **agent identity's** FMI-minted Graph token (not the blueprint's) against `/users/{sponsor}/…` instead of `/me`. See "S2S / app-only agents" above. Do not "fix" the AgentApplication path by switching *it* to client-credentials.
2. **`contentEntry.name` is required** — omitting it returns a permanent `BadRequest` that looks like a clean allow. The guard always sets it and treats `processingErrors` as fail-closed.
3. **Dedicated AI-app policy** — the `Applications`/Managed-cloud-apps location can't be combined with Exchange/SharePoint/OneDrive/Teams in one policy.
4. **`RestrictAccess` block, `EnforcementPlanes=Application`** — not `BlockAccess`, not `CopilotExperiences` (that's first-party Copilot).
5. **Never `admin-consent` the blueprint app** — it can narrow the agentic consent and break the agent's sign-in. Append the scope instead.
6. **Trust the `[purview]` log, not `DistributionStatus`** (which reads `Pending` even for live policies).

## Files in this skill

| File | Purpose |
|------|---------|
| [`assets/purview.ts`](./assets/purview.ts) · [`purview.py`](./assets/purview.py) · [`purview.cs`](./assets/purview.cs) | Drop-in DLP guard (Node.js / Python / .NET — generic, env-driven). |
| [`assets/purview-s2s.ts`](./assets/purview-s2s.ts) | **S2S (app-only)** DLP guard for autonomous Node.js agents — agent-identity FMI Graph token, `/users/{sponsor}` endpoint. |
| [`assets/wiring-snippet.ts`](./assets/wiring-snippet.ts) · [`.py`](./assets/wiring-snippet.py) · [`.cs`](./assets/wiring-snippet.cs) | The minimal handler edits (Node.js / Python / .NET). |
| [`assets/purview.env.example`](./assets/purview.env.example) | Environment variables (same for all three languages). |
| [`scripts/Grant-DelegatedGraphScope.ps1`](./scripts/Grant-DelegatedGraphScope.ps1) | Append the delegated Graph scope (surgical, no admin-consent). |
| [`scripts/Grant-ContentProcessAppRole.ps1`](./scripts/Grant-ContentProcessAppRole.ps1) | **S2S:** grant `Content.Process.All` (Application) to the agent identity SP. |
| [`scripts/New-AiAppDlpPolicy.ps1`](./scripts/New-AiAppDlpPolicy.ps1) | Create the AI-app DLP policy + block rule. |
| [`references/purview-portal-guide.md`](./references/purview-portal-guide.md) | Tenant enablement (billing/DSPM) + manual portal policy steps. |
| [`references/troubleshooting.md`](./references/troubleshooting.md) | Log reference + symptom→cause→fix table. |
