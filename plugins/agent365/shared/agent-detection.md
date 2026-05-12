# Agent Detection Reference

Shared heuristics for classifying an agent before any instrumentation or setup runs.
**Both skills must complete this classification before touching any code or running any CLI commands.**

---

## Initial Detection Variables

The skill MUST detect and store these three variables before asking ANY questions:

1. **`agentStack`** — Agent stack/framework
   - Possible values: `Agent Framework`, `LangChain`, `OpenAI`, `Semantic Kernel`, `Claude`, `Google ADK`
   - Detection: See detection logic below

2. **`programmingLanguage`** — Programming language
   - Possible values: `DotNet`, `Python`, `NodeJS`
   - Detection: File extension analysis

3. **`usesTeamsOrCopilot`** — Does this agent have M365 / Teams / Copilot integration markers?
   - Possible values: `1` (M365 CEA detected) or `0` (no M365 integration detected)
   - Detection: Check for CEA signals across file presence, packages, and config (see below)
   - Note: `0` does not mean the agent is not an Agent (Non AI Teammate) — it may be a non-M365 CEA, a background
     automation agent, Agent Builder agent, SharePoint agent, or other Agent (Non AI Teammate) type. It simply means
     no Teams/Copilot markers were detected, so the M365 CEA registration path is not triggered.

### Agent Stack Detection Logic

Run in priority order within each language. Stop at the first match.

```
# .NET ─────────────────────────────────────────────────────────────────────
Agent Framework  → .csproj + (Microsoft.Agents.* OR AgentApplication OR Microsoft.Agents.AI)
Semantic Kernel  → .csproj + Microsoft.SemanticKernel

# Node.js ────────────────────────────────────────────────────────────────── (check in order)
LangChain        → package.json + @langchain/* OR "langchain"
OpenAI           → package.json + @openai/agents OR "openai" (no LangChain)
Claude           → package.json + @anthropic-ai/claude-agent-sdk OR @anthropic-ai/sdk OR "anthropic"
Semantic Kernel  → package.json + @microsoft/semantic-kernel
Google ADK       → package.json + @google/generative-ai OR @google-cloud/vertexai OR @google/adk

# Python ─────────────────────────────────────────────────────────────────── (check in order)
Agent Framework  → requirements.txt/pyproject.toml + microsoft-agents-hosting-core
                   OR microsoft-agents-hosting-aiohttp
LangChain        → requirements.txt/pyproject.toml + langchain
OpenAI           → requirements.txt/pyproject.toml + openai-agents OR openai (no langchain)
Claude           → requirements.txt/pyproject.toml + claude-agent-sdk OR anthropic
Semantic Kernel  → requirements.txt/pyproject.toml + semantic-kernel
Google ADK       → requirements.txt/pyproject.toml + google-adk
```

### Programming Language Detection

```
DotNet → .csproj exists
NodeJS → package.json exists + (.ts OR .js files)
Python → requirements.txt OR .py files
```

### Custom Engine Agent Detection (usesTeamsOrCopilot)

Run these checks in parallel (Glob + Grep).

**Strong standalone signals — any one → CEA:**
```
teamsapp.yml or teamsapp.local.yml                      → CEA (Teams Toolkit project)
appPackage/manifest.json or manifest/manifest.json      → CEA (Teams app package)
a365.config.json or a365.generated.config.json          → CEA (already A365-registered)
@microsoft/teams-ai in package.json                     → CEA (Teams AI SDK, Node.js-specific)
Microsoft.Teams.AI in .csproj                           → CEA (.NET Teams AI SDK)
teams-ai in requirements.txt or pyproject.toml          → CEA (Python Teams AI SDK)
```

**Paired signals — CEA only when a structural file signal above is also present:**
```
"botbuilder" in package.json             + structural → CEA (standalone = channel bot risk)
Microsoft.Bot.Builder in .csproj         + structural → CEA
botbuilder-core in requirements.txt      + structural → CEA
BOT_ID / MicrosoftAppId / TEAMS_APP_ID   + structural → CEA
```

---

## Classification Order (always follow this sequence)

```
Step 1: Unsupported? (M365/Teams/BizChat non-AI-teammate) → STOP
Step 2: AI Teammate?                                    → Warn, special publish path
Step 3: Supported type? (dotnet-agentframework, dotnet-semantic-kernel, nodejs-langchain, python-agentframework) → Full support
Step 4: Near-match? (nodejs-openai, nodejs-claude, nodejs-google-adk, nodejs-semantic-kernel, python-openai, python-claude, python-google-adk, python-langchain, python-semantic-kernel) → Best-effort + confirm
Step 5: Unknown (no signals)                               → Ask user
```

---

## Step 1 — Unsupported Scenario Detection (HARD STOP)

Run these checks **first**, before any other detection.

### Grep signals for M365 / Teams / BizChat / Copilot

```
Grep: "channelId.*msteams"       in *.json, *.ts, *.cs, *.js
Grep: "BizChat"                  in all files
Grep: "MicrosoftCopilot"         in all files
Grep: "M365Copilot"              in all files
Grep: "TeamsChannel"             in all files
Grep: "biz.?chat" (regex)        in ToolingManifest.json, manifest.json
Grep: "teams.?channel" (regex)   in ToolingManifest.json, manifest.json
```

**If any M365 signal is found**, check for CEA markers before stopping:

```
Glob: teamsapp.yml or teamsapp.local.yml                    → Teams Toolkit CEA (allowed)
Glob: appPackage/manifest.json or manifest/manifest.json    → Teams app package (allowed)
Glob: a365.config.json or a365.generated.config.json        → already A365-registered (allowed)
Grep: @microsoft/teams-ai in package.json                   → Teams AI SDK — Node.js CEA (allowed)
Grep: Microsoft.Teams.AI in .csproj                         → Teams AI SDK — .NET CEA (allowed)
Grep: teams-ai in requirements.txt/pyproject.toml           → Teams AI SDK — Python CEA (allowed)
```
Note: generic Bot Framework packages (`botbuilder`, `Microsoft.Bot.Builder`, `botbuilder-core`)
are NOT sufficient on their own — channel bots use these too. In this HARD STOP context, only the
explicitly listed CEA markers above are sufficient exceptions: the structural file markers AND the
Teams AI SDK package references (`@microsoft/teams-ai`, `Microsoft.Teams.AI`, `teams-ai`).
Do not treat generic Bot Framework packages as standalone CEA markers.

- **M365 signal found AND any CEA marker found** → This is a Custom Engine Agent (Agent (Non AI Teammate)). **Do NOT block.** Set `usesTeamsOrCopilot = 1`, continue to Step 2.
- **M365 signal found AND NO CEA marker found** → Likely a Teams/BizChat/Copilot channel bot. **STOP** (see message below), unless user explicitly confirms CEA or AI Teammate intent.

> Tell the user (STOP case only):
> "This agent is configured for Teams channels, BizChat, or Microsoft Copilot.
> Non-AI-teammate channel bots cannot be registered as A365 blueprints.
> Only AI Teammate agents and Custom Engine Agents (as Non AI Teammate) are supported.
> If this detection is wrong (e.g., this is a Custom Engine Agent), confirm explicitly."

Write marker: `.a365setup-m365-blocked` (setup) or skip instrumentation (observability).

---

## Step 2 — AI Teammate Detection

```
Glob: **/ToolingManifest.json
Grep: "isDigitalWorker" in ToolingManifest.json
Grep: "digital_worker"  in ToolingManifest.json
Grep: "digitalWorker"   in *.json
Grep: "agentUpn"        in a365.generated.config.json   ← definitive: Agentic User already provisioned
```

**If AI Teammate detected:**
- Observability instrumentation: continue, but flag in summary
- Setup/publish: `a365 setup all` + `a365 publish` → manual admin upload to MAC (no API yet)

Write markers: `.a365obs-digital-worker`, `.a365setup-digital-worker`

### AI Teammate manual upload path

```
After a365 publish:
  manifest/manifest.zip → Share with tenant admin
  Admin: Microsoft Admin Center → Settings → Integrated Apps → Upload package → Approve
```

This is a **temporary workaround** until the MAC team ships a publish API.

---

## Step 3 — Supported Agent Type Detection

### 3A: .NET AgentFramework (P1 — full support)

| Signal | Detection |
|--------|-----------|
| `.csproj` file exists | `Glob **/*.csproj` |
| Extends `AgentApplication` | `Grep "AgentApplication" **/*.cs` |
| Uses `AddAgentFramework()` | `Grep "AddAgentFramework" **/Program.cs` |
| `Microsoft.Agents.AI` reference | `Grep "Microsoft.Agents.AI" **/*.csproj` |
| A365 NuGet reference | `Grep "Microsoft.Agents.A365" **/*.csproj` |

**Confirmed .NET AgentFramework** = `.csproj` + any one of the Grep matches.

Official sample: `https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/agent-framework/sample-agent`

### 3B: Node.js LangChain (P1 — full support)

| Signal | Detection |
|--------|-----------|
| `package.json` exists | `Glob **/package.json` |
| LangChain dependency | `Grep "@langchain" **/package.json` |
| Or: `langchain` (non-scoped) | `Grep "\"langchain\"" **/package.json` |
| A365 npm package | `Grep "agents-a365" **/package.json` |
| `index.ts` / `index.js` | `Glob **/index.ts` OR `**/index.js` |

**Confirmed Node.js LangChain** = `package.json` + LangChain grep match.

Official sample: `https://github.com/microsoft/Agent365-Samples/tree/main/nodejs/langchain`

> **Framework note:** Coding agents (Claude Code, GitHub Copilot) perform significantly
> better with Node.js and Python. For new demo agents, prefer LangChain unless .NET is required.

### 3C: .NET Semantic Kernel (P1 — full support)

| Signal | Detection |
|--------|-----------|
| `.csproj` file exists | `Glob **/*.csproj` |
| `Microsoft.SemanticKernel` reference | `Grep "Microsoft.SemanticKernel" **/*.csproj` |
| A365 NuGet reference | `Grep "Microsoft.Agents.A365" **/*.csproj` |

**Confirmed .NET Semantic Kernel** = `.csproj` + SemanticKernel grep match.

Official sample: `https://github.com/microsoft/Agent365-Samples/tree/main/dotnet/semantic-kernel`

### 3D: Python AgentFramework (P1 — full support)

| Signal | Detection |
|--------|-----------|
| `requirements.txt` or `pyproject.toml` | `Glob **/requirements.txt` |
| Hosting core package | `Grep "microsoft-agents-hosting-core" **/requirements.txt` |
| Or: aiohttp hosting | `Grep "microsoft-agents-hosting-aiohttp" **/requirements.txt` |
| A365 observability package | `Grep "microsoft.agents.a365" **/requirements.txt` |

**Confirmed Python AgentFramework** = `requirements.txt` + hosting package grep match.

Official sample: `https://github.com/microsoft/Agent365-Samples/tree/main/python/agent-framework`

---

## Step 4 — Best-Effort Types (P2)

### Node.js P2 types

| Detected Type | Key Signal(s) in `package.json` | Official Sample |
|--------------|--------------------------------|-----------------|
| `nodejs-openai` | `@openai/agents` or `"openai"` (no LangChain) | `nodejs/openai` |
| `nodejs-claude` | `@anthropic-ai/claude-agent-sdk` (current) or `@anthropic-ai/sdk` or `"anthropic"` | `nodejs/claude` |
| `nodejs-semantic-kernel` | `@microsoft/semantic-kernel` | — |
| `nodejs-google-adk` | `@google/generative-ai` or `@google-cloud/vertexai` or `@google/adk` | — |

### Python P2 types

| Detected Type | Key Signal(s) in `requirements.txt` / `pyproject.toml` | Official Sample |
|--------------|--------------------------------------------------------|-----------------|
| `python-openai` | `openai-agents` or `openai` (no hosting packages) | `python/openai` |
| `python-claude` | `claude-agent-sdk` or `anthropic` | `python/claude` |
| `python-google-adk` | `google-adk` | `python/google-adk` |
| `python-langchain` | `langchain` | — |
| `python-semantic-kernel` | `semantic-kernel` | — |

For all P2 types:
1. Show the user the detected type and ask for confirmation
2. Use the closest language-matched reference doc from `references/`
3. Mark every instrumented line with: `// A365 Observability — best-effort instrumentation (verify against official sample)` (or `#` prefix for Python)
4. Write marker: `.a365obs-best-effort`
5. In the final summary, flag all P2 changes with ⚠️

Official sample base URL: `https://github.com/microsoft/Agent365-Samples/tree/main/`

---

## Step 5 — Unknown (No Signals)

If no `.csproj`, no `package.json`, no `requirements.txt`:

```
AskUserQuestion:
  question: "I couldn't find a recognizable agent project in this directory. What type of agent are you working with?"
  options:
    - .NET — Agent Framework
    - .NET — Semantic Kernel
    - Node.js — LangChain
    - Node.js — OpenAI Agents SDK
    - Node.js — Claude (Anthropic)
    - Node.js — Google ADK
    - Python — Agent Framework
    - Python — LangChain
    - Python — OpenAI Agents SDK
    - Python — Claude (Anthropic)
    - Python — Google ADK
    - Python — Semantic Kernel
    - Other / I'll point you to the right file
```

---

---

## A365 Setup — Registration Type Classification

The a365-setup skill classifies agents into one of three registration types **orthogonal to framework type**. Use these signals to pre-fill `registrationType` before asking the user.

### registrationType 1 — M365 custom engine agent (Entra app ID)

The agent already has an Entra app registration but NO A365 Blueprint. You are adding observability or WorkIQ tools to an existing M365 custom engine agent.

| Signal | Detection |
|--------|-----------|
| M365 auth signals present | See Step 1 greps above |
| No Blueprint configuration | `a365.config.json` absent or missing `blueprintId` |
| Entra app ID referenced | `Grep "entraAppId" **/a365.config.json` OR `Grep "MicrosoftAppId" **/appsettings.json` |
| No `needDeployment` field | `a365.config.json` exists but lacks `needDeployment` |

**Pre-fill:** `registrationType = 1`, `usesTeamsOrCopilot = 1`. Capabilities menu: all 4 options apply; options 2 (Observability) and 3 (Tools/WorkIQ) are most relevant.

### registrationType 2 — M365 custom engine agent (Blueprint)

The agent has both an Entra app registration AND an existing A365 Blueprint. You are deploying it as an AI Teammate.

| Signal | Detection |
|--------|-----------|
| Blueprint ID present | `Grep "blueprintId" **/a365.config.json` OR `Grep "agentBlueprintId" **/a365.generated.config.json` |
| M365 auth signals present | See Step 1 greps above |
| `needDeployment` in config | `Grep "needDeployment" **/a365.config.json` |

**Pre-fill:** `registrationType = 2`, `usesTeamsOrCopilot = 1`. Capabilities menu: option 4 (AI Teammate) is the primary path; options 2 and 3 can be combined.

### registrationType 3 — All other agents

Standard A365 agent with no M365 custom engine configuration. Fresh setup or Register-only registration.

| Signal | Detection |
|--------|-----------|
| No M365 signals | Step 1 greps return nothing |
| No existing a365 config | `a365.config.json` absent |
| Standard agent framework | dotnet-agentframework or nodejs-langchain detected |

**Pre-fill:** `registrationType = 3`, `usesTeamsOrCopilot = 0`. Capabilities menu: all 4 options apply; options can be combined.

### Registration detection signals

Agents needing Register capability (registrationType 3, non-AI Teammate) typically show these signals:

| Signal | Meaning |
|--------|---------|
| No `a365.config.json` | Agent has never been registered |
| No `ToolingManifest.json` | No WorkIQ tools configured |
| No `manifest/manifest.json` | Agent has never been published |
| Agent has observable business logic | Standard LLM agent with no Teams/M365 channel config |

If all four signals are true and the user hasn't specified AI Teammate intent, suggest: **"Would you like to register this agent for registration only, or deploy it as an AI Teammate?"**

---

## Entry Points Map

| Agent Type | Primary Entry Point | Secondary |
|-----------|-------------------|-----------|
| `dotnet-agentframework` | `Program.cs` | `<AgentName>.cs` (AgentApplication subclass) |
| `dotnet-semantic-kernel` | `Program.cs` | `<AgentName>.cs` |
| `nodejs-langchain` | `src/index.ts` or `index.ts` | `src/agentApp.ts`, `src/handler.ts` |
| `nodejs-openai` | `index.ts` or `index.js` | `src/agent.ts` |
| `nodejs-claude` | `index.ts` or `index.js` | `src/agent.ts` |
| `nodejs-semantic-kernel` | `index.ts` or `index.js` | `src/agent.ts` |
| `nodejs-google-adk` | `index.ts` or `index.js` | `src/agent.ts` |
| `python-agentframework` | `app.py` or `main.py` | `agent.py` |
| `python-openai` | `app.py` or `main.py` | `agent.py` |
| `python-claude` | `app.py` or `main.py` | `agent.py` |
| `python-google-adk` | `app.py` or `main.py` | `agent.py` |
| `python-langchain` | `main.py` or `app.py` | `agent.py` |
| `python-semantic-kernel` | `main.py` or `app.py` | `agent.py` |

Always **Read** entry points fully before editing them.

---

## Config Files Map

| Agent Type | Editable Config | Generated (do not hand-edit) |
|-----------|----------------|------------------------------|
| dotnet-agentframework | `appsettings.json`, `.env` | `appsettings.Production.json` (partial) |
| nodejs-langchain | `.env`, `.env.example` | — |
| All | `a365.config.json` (editable) | `a365.generated.config.json` (CLI-managed) |

---

## Files to Never Modify

| File | Reason |
|------|--------|
| `ToolingManifest.json` | Managed by the a365 CLI; hand edits will be overwritten |
| `a365.generated.config.json` | Auto-generated by `a365 setup all`; do not hand-edit |
| `manifest/manifest.json` | Updated only by `a365 publish`; never edit directly |

---

## Detection Cache

To avoid re-running globs and greps when multiple skills run in the same session, use a cache file.

### Reading the cache (check before running globs/greps)

Before any detection, check for `.a365-workspace-detection.json` in the working directory:

- If the file exists and `detectedAt` is within the last **60 minutes**, load `agentStack`, `programmingLanguage`, `usesTeamsOrCopilot`, `agentType`, and `authMode` from it — skip all detection globs and greps.
- If the file is missing or older than 60 minutes, run full detection as normal.

### Writing the cache (after detection + user confirmation)

The cache is written in stages as values become known — always preserve fields already present.

**Stage 1 — `a365-setup` Phase 1C** (after capabilities selection and `isAITeammate` is set):
```json
{
  "agentStack": "<Agent Framework | LangChain | OpenAI | Semantic Kernel | Claude | Google ADK>",
  "programmingLanguage": "<DotNet | NodeJS | Python>",
  "usesTeamsOrCopilot": 0,
  "hasAITeammateChanges": 0,
  "hasBlueprintConfig": 0,
  "existingBlueprintId": "<blueprintId string or empty string if none>",
  "reuseBlueprint": false,
  "agentType": "<ai-teammate | system-agent>",
  "authMode": "",
  "detectedAt": "<ISO 8601 timestamp>"
}
```

- `hasAITeammateChanges`: `1` if signals from **both** of the following categories are present; `0` otherwise:
  - *AI Teammate structure* (any one): `AgentApplication` in source files, `CloudAdapter`/`CloudAdapterAiohttp`, `@microsoft/agents-a365-notifications` in `package.json`, `Microsoft.Agents.A365.Notifications` in `.csproj`, `ToolingManifest.json` exists, or `agentUpn` present in `a365.generated.config.json`
  - *Observability* (any one): `Microsoft.Agents.A365.Observability.*`/`Microsoft.OpenTelemetry` in `.csproj`, `@microsoft/agents-a365-observability`/`@microsoft/opentelemetry` in `package.json`, `microsoft-agents-a365-observability-core`/`microsoft-opentelemetry` in `requirements.txt`/`pyproject.toml`, or `A365 Observability` comment in source
- `hasBlueprintConfig`: `1` if `a365.config.json` or `a365.generated.config.json` was found in the project root; `0` otherwise.
- `existingBlueprintId`: the `agentBlueprintId` extracted from the existing config, or empty string if not yet set.
- `reuseBlueprint`: `true` if the developer chose to reuse the existing blueprint (skip `a365 setup all`); `false` if creating fresh or no existing config.

**Stage 2 — `instrument-observability` Phase 0.5 or `add-workiq-tools` Phase 0B** (after `agentType` and `authMode` questions):
Merge `agentType` and `authMode` into the existing file — update only those two fields, keep the rest unchanged.

Use the **Write** tool to write the merged object back to `.a365-workspace-detection.json` in the current working directory.

---

## AGENTIC_APP_ID Requirement

The A365 observability token resolver requires `AGENTIC_APP_ID` to authenticate.

Detection order:
1. Check `.env` or `.env.example` for `AGENTIC_APP_ID=`
2. Check `appsettings.json` for `AgenticAppId` key
3. Check `a365.generated.config.json` for `agentBlueprintId` (equivalent)

If not found → warn the user and recommend running `/agent365:a365-setup` first.
Write marker: `.a365obs-appid-warned` to avoid repeating the warning.

---

## Agent Type and Auth Mode Detection

**Used by:** `instrument-observability`, `add-workiq-tools`

**When to run:** After loading the detection cache, before Phase 1 detection.
**Cache hit:** If `agentType` and `authMode` are already in the cache, confirm with user and skip questions. When reading `authMode` from the cache, treat it as case-insensitive — `S2S`, `s2s`, `OBO`, `obo` are all equivalent. Always **write** the canonical lowercase value (`obo`, `s2s`, or `agentic-user`) back to the cache.

---

### Stage 1 — What kind of agent is this?

Pre-fill from cache if `usesTeamsOrCopilot` is already known:
- `usesTeamsOrCopilot = 1` → suggest **A — AI Teammate**, ask to confirm
- `usesTeamsOrCopilot = 0` → suggest **B — Agent (Non AI Teammate)**, ask to confirm

```
AskUserQuestion:
  question: |
    First — what kind of agent is this?

    A — AI Teammate
        Has a first-class M365 identity — an Agentic User with a UPN, mailbox, and
        presence in your tenant. Behaves like a real colleague inside Teams and Outlook.
        Designed for ongoing, human-like teamwork.

    B — Agent (Non AI Teammate)
        No Agentic User identity (no UPN). Task-oriented, system-oriented, or assistive.
        Uses an Entra App ID or Agent Blueprint + Agent Identity.
        Appears as a system or service agent, not as a virtual teammate.
  options:
    - "A — AI Teammate"
    - "B — Agent (Non AI Teammate)"
```

Store as **`agentType`**: A → `ai-teammate` · B → `system-agent`

---

### Stage 2a — If AI Teammate

> **AI Teammate always uses `agentic-user`:** The agent acts through its own M365 identity (Agentic User — a dedicated Azure AD user with UPN, mailbox, and presence). This is **not** the caller's OBO token. No question is needed — auto-set `authMode = "agentic-user"`.
>
> **CLI note:** `--authmode` is not supported with `--aiteammate`; the Agentic User identity is provisioned automatically by `a365 setup all --aiteammate`. The `authMode` value is for **code wiring only** (which token path is instrumented in the agent code).

Set `authMode = "agentic-user"` and continue to the next stage — no question asked.

---

### Stage 2b — If Agent (Non AI Teammate)

```
AskUserQuestion:
  question: |
    How does this Agent (Non AI Teammate) execute?

    1 — Autonomous (S2S / Service Principal)
        Agent runs independently as itself — no signed-in user required.
        Authenticates with Entra App ID or Agent Blueprint credentials.
        → Docs: https://learn.microsoft.com/en-us/microsoft-agent-365/developer/authentication-flow

    2 — Assistive (OBO)
        Agent acts on behalf of the signed-in user via On-Behalf-Of flow.
        → Docs: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow

    ✅ Both modes work with Observability
    ❌  Autonomous (S2S) cannot use WorkIQ tools — WorkIQ requires a delegated user token (OBO)
  options:
    - "1 — Autonomous (S2S / Service Principal)"
    - "2 — Assistive (OBO)"
```

| Choice | `authMode` |
|--------|-----------|
| Autonomous (S2S / Service Principal) | `s2s` |
| Assistive (OBO) | `obo` |

---

### Full result mapping

| `agentType` | Label | `authMode` |
|------------|-------|-----------|
| `ai-teammate` | Access data as the signed-in user | `obo` |
| `ai-teammate` | Its own persistent identity in your org | `agentic-user` |
| `system-agent` (Agent (Non AI Teammate)) | Autonomous (S2S / Service Principal) | `s2s` |
| `system-agent` (Agent (Non AI Teammate)) | Assistive (OBO) | `obo` |

---

### Compatibility table

| Agent kind | `authMode` | Observability | WorkIQ tools |
|-----------|-----------|---------------|-------------|
| AI Teammate | `obo` (signed-in user access) | ✅ | ✅ M365 data scoped to signed-in user |
| AI Teammate | `agentic-user` (agent's own M365 identity) | ✅ | ✅ M365 data scoped to agent identity |
| Agent (Non AI Teammate) | `obo` / Assistive (OBO) | ✅ | ✅ OBO only |
| Agent (Non AI Teammate) | `s2s` / Autonomous (Service Principal) | ✅ | ❌ Not available — WorkIQ requires a delegated user token (OBO) |

---

### Code impact

The `authMode` value (`obo`, `s2s`, or `agentic-user`) drives which code path is used:
- `obo` — signed-in user OBO; auth handler name from config, never hardcoded
- `agentic-user` — agent's own M365 identity (persistent Azure AD user); same OBO wire-up as `obo` but the identity is the agent, not the signed-in human
- `s2s` — service principal / autonomous; no per-turn user token; scaffold token-service file handles credential acquisition

For `obo` and `agentic-user` paths: auth handler name comes from config (`AgentApplication:AgenticAuthHandlerName` in .NET, `agentApplication.authorization` object in Node.js, `auth_handler_id` from config in Python) — never hardcode `"AGENTIC"`. Agent IDs are always resolved dynamically from TurnContext (`agenticAppId` / `agentic_app_id`), never from config.

Add this inline comment wherever the auth handler is wired:

```
// A365 auth mode: {authMode} — see: https://learn.microsoft.com/en-us/entra/agent-id/agent-on-behalf-of-oauth-flow
```

---

### Prerequisites by `authMode`

**`obo`** — signed-in user OBO; no additional Azure AD setup required. Uses the signed-in user's existing token.

**`agentic-user`** — agent's own persistent M365 identity. The Agentic User (an Azure AD user with a mailbox, OneDrive, and `agent@tenant` UPN) is provisioned automatically by `a365 setup all --aiteammate` via blueprint app-only credentials — no Global Administrator and no manual Azure AD setup required. If `agentUpn` is absent from `a365.generated.config.json` after setup, run `a365 create-instance` to create the agent identity, Agentic User, and assign licenses in one step.

**`s2s`** — service principal / autonomous. Authenticates with the agent blueprint's own credentials (service principal). No signed-in user token.

---

### WorkIQ guard — `s2s` agents

**WorkIQ must never be presented as an option when `authMode = s2s`.** This applies everywhere:

- **In capabilities menus** (e.g., `a365-setup`): omit WorkIQ from the list entirely — do not show it, do not grey it out.
- **In `add-workiq-tools`**: if `authMode = s2s` is detected (from cache or from the auth mode question), **exit immediately before any further questions or actions**:

```
❌  WorkIQ tools are not available for S2S (autonomous) agents.
    WorkIQ requires a delegated user token (OBO) at runtime — S2S client credentials
    cannot be used for WorkIQ API calls.

    To use WorkIQ, switch your agent to Assistive mode (obo) and re-run this skill.
```

Do **not** proceed. Do **not** show a server list. End the session.