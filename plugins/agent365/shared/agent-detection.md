# Agent Detection Reference

Shared heuristics for classifying an agent before any instrumentation or setup runs.
**Both skills must complete this classification before touching any code or running any CLI commands.**

---

## Classification Order (always follow this sequence)

```
Step 1: Unsupported? (M365/Teams/BizChat non-AI-teammate) → STOP
Step 2: Digital worker?                                    → Warn, special publish path
Step 3: Supported type? (dotnet-agentframework, nodejs-langchain)  → Full support
Step 4: Near-match? (nodejs-openai, python-*, custom)      → Best-effort + confirm
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

**If any M365 signal is found**, first check for M365 custom engine markers before stopping:

```
Glob: **/a365.config.json                            → M365 custom engine agent (allowed)
Glob: **/a365.generated.config.json                 → M365 custom engine agent (allowed)
Grep: "entraAppId"      in a365.config.json         → agentType 1 (Entra app ID)
Grep: "blueprintId"     in a365.config.json         → agentType 2 (Blueprint)
```

- **M365 signal found AND a365 custom engine marker found** → This is an M365 custom engine agent (agentType 1 or 2). **Do NOT block.** Continue to Step 2 and pre-fill `agentType` accordingly.
- **M365 signal found AND NO a365 custom engine marker found** → Likely a Teams/BizChat/Copilot channel bot. **STOP** (see message below), unless user explicitly confirms AI Teammate intent.

> Tell the user (STOP case only):
> "This agent is configured for Teams channels, BizChat, or Microsoft Copilot.
> Non-AI-teammate channel bots cannot be registered as A365 blueprints.
> Only AI Teammate agents and M365 custom engine agents are supported.
> If this detection is wrong (e.g., this is an M365 custom engine agent), confirm explicitly."

Write marker: `.a365setup-m365-blocked` (setup) or skip instrumentation (observability).

---

## Step 2 — Digital Worker Detection

```
Glob: **/ToolingManifest.json
Grep: "isDigitalWorker" in ToolingManifest.json
Grep: "digital_worker"  in ToolingManifest.json
Grep: "digitalWorker"   in *.json
```

**If digital worker detected:**
- Observability instrumentation: continue, but flag in summary
- Setup/publish: `a365 setup all` + `a365 publish` → manual admin upload to MAC (no API yet)

Write markers: `.a365obs-digital-worker`, `.a365setup-digital-worker`

### Digital worker manual upload path

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

---

## Step 4 — Best-Effort Types (P2)

| Detected Type | Signals | Action |
|--------------|---------|--------|
| `nodejs-openai` | `package.json` + `openai` dep, no LangChain | Confirm with user, use Node.js patterns |
| `python-langchain` | `requirements.txt` + `langchain` | Confirm with user, no official sample yet |
| `python-openai` | `requirements.txt` + `openai` | Confirm with user, no official sample yet |
| `custom` | Unknown framework | Confirm with user, closest language match |

For all P2 types:
1. Show the user the detected type and ask for confirmation
2. Use the closest language-matched reference doc from `references/`
3. Mark every instrumented line with: `// A365 Observability — best-effort instrumentation (verify against official sample)`
4. Write marker: `.a365obs-best-effort`
5. In the final summary, flag all P2 changes with ⚠️

---

## Step 5 — Unknown (No Signals)

If no `.csproj`, no `package.json`, no `requirements.txt`:

```
AskUserQuestion:
  question: "I couldn't find a recognizable agent project in this directory. What type of agent are you working with?"
  options:
    - .NET AgentFramework (C#)
    - Node.js LangChain (TypeScript)
    - Node.js with OpenAI SDK
    - Python agent
    - Other / I'll point you to the right file
```

---

---

## A365 Setup — Registration Type Classification

The a365-setup skill classifies agents into one of three registration types **orthogonal to framework type**. Use these signals to pre-fill `agentType` before asking the user.

### agentType 1 — M365 custom engine agent (Entra app ID)

The agent already has an Entra app registration but NO A365 Blueprint. You are adding observability or WorkIQ tools to an existing M365 custom engine agent.

| Signal | Detection |
|--------|-----------|
| M365 auth signals present | See Step 1 greps above |
| No Blueprint configuration | `a365.config.json` absent or missing `blueprintId` |
| Entra app ID referenced | `Grep "entraAppId" **/a365.config.json` OR `Grep "MicrosoftAppId" **/appsettings.json` |
| No `needDeployment` field | `a365.config.json` exists but lacks `needDeployment` |

**Pre-fill:** `agentType = 1`. Capabilities options: Observability, Observability + WorkIQ.

### agentType 2 — M365 custom engine agent (Blueprint)

The agent has both an Entra app registration AND an existing A365 Blueprint. You are deploying it as an AI Teammate.

| Signal | Detection |
|--------|-----------|
| Blueprint ID present | `Grep "blueprintId" **/a365.config.json` OR `Grep "agentBlueprintId" **/a365.generated.config.json` |
| M365 auth signals present | See Step 1 greps above |
| `needDeployment` in config | `Grep "needDeployment" **/a365.config.json` |

**Pre-fill:** `agentType = 2`. Capabilities options: AI Teammate only.

### agentType 3 — All other agents

Standard A365 agent with no M365 custom engine configuration. Fresh setup or Discoverability-only registration.

| Signal | Detection |
|--------|-----------|
| No M365 signals | Step 1 greps return nothing |
| No existing a365 config | `a365.config.json` absent |
| Standard agent framework | dotnet-agentframework or nodejs-langchain detected |

**Pre-fill:** `agentType = 3`. Capabilities options: Discoverability, Discoverability + Observability, AI Teammate.

### Discoverability detection signals

Agents needing Discoverability capability (agentType 3, non-AI Teammate) typically show these signals:

| Signal | Meaning |
|--------|---------|
| No `a365.config.json` | Agent has never been registered |
| No `ToolingManifest.json` | No WorkIQ tools configured |
| No `manifest/manifest.json` | Agent has never been published |
| Agent has observable business logic | Standard LLM agent with no Teams/M365 channel config |

If all four signals are true and the user hasn't specified AI Teammate intent, suggest: **"Would you like to register this agent for Discoverability only, or deploy it as an AI Teammate?"**

---

## Entry Points Map

| Agent Type | Primary Entry Point | Secondary |
|-----------|-------------------|-----------|
| dotnet-agentframework | `Program.cs` | `<AgentName>.cs` (AgentApplication subclass) |
| nodejs-langchain | `src/index.ts` or `index.ts` | `src/agentApp.ts`, `src/handler.ts` |
| nodejs-openai | `index.ts` or `index.js` | `src/agent.ts` |
| python-* | `main.py` or `app.py` | `agent.py` |

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

## AGENTIC_APP_ID Requirement

The A365 observability token resolver requires `AGENTIC_APP_ID` to authenticate.

Detection order:
1. Check `.env` or `.env.example` for `AGENTIC_APP_ID=`
2. Check `appsettings.json` for `AgenticAppId` key
3. Check `a365.generated.config.json` for `agentBlueprintId` (equivalent)

If not found → warn the user and recommend running `/agent365:a365-setup` first.
Write marker: `.a365obs-appid-warned` to avoid repeating the warning.