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

**If any signal found AND user does NOT confirm AI Teammate → STOP.**

> Tell the user:
> "This agent is configured for Teams channels, BizChat, or Microsoft Copilot.
> Non-AI-teammate agents cannot be registered as A365 blueprints.
> Only AI Teammate agents are supported. If this detection is wrong, confirm explicitly."

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