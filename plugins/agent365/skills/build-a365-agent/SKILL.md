---
name: build-a365-agent
version: 1.0.0
description: >
  Builds a brand-new Microsoft Agent 365 AI Teammate from scratch given a single user
  prompt. Drives the full greenfield flow — Azure login, A365 CLI install, MCP server
  selection, language/framework/model-provider choice, web research for current stable
  package versions and docs of the chosen orchestration stack, project scaffolding
  (uses make-ai-teammate references for boilerplate including notification handlers;
  pins packages to the latest stable versions found, preferring newer versions when
  resolving incompatibilities), observability instrumentation (instrument-observability),
  WorkIQ tool wiring (add-workiq-tools), local validation via `a365 validate`, A365
  setup with blueprint (a365-setup), and the publish + devtunnel + Teams Developer
  Portal hand-off. Always provisions as AI Teammate (OBO).
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: short description of what the agent should do (will be used as the instruction seed)"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following for the build-a365-agent skill:
        1. `az login` was run (or user confirmed already signed in).
        2. `a365 -h` succeeded (CLI present); if not present, `dotnet tool install -g
           Microsoft.Agents.A365.DevTools.Cli` was run and re-verified.
        3. The four answers were collected (or inferred from the prompt) and recorded:
           agent purpose / instructions seed, MCP server list, language (C# | Python |
           TypeScript), framework, model provider.
        4. `a365 develop list-available` was shown to the user before MCP selection,
           and `a365 develop add-mcp-servers ...` produced a `ToolingManifest.json` in
           the working directory.
        5. Before scaffolding, the web was searched for official documentation
           and current stable package versions for the chosen orchestration
           framework + language (and model provider SDK), AND for the exact
           env-var names the chosen model provider's SDK reads (required vs
           optional). The latest stable package versions found were recorded
           and used during scaffolding, preferring more-recent versions when
           resolving any incompatibilities. The env files in step 7 use the
           researched env-var names verbatim — no provider env-var names
           invented from memory.
        6. The agent project was scaffolded from scratch using the make-ai-teammate
           references (NOT copied from a sample). Notification handlers are wired.
        7. Two environment files exist with matching keys:
           - .NET: appsettings.json + appsettings.Development.json
           - Node.js / Python: .env + .env.local
           and the user was told to add their model credentials to BOTH.
        8. instrument-observability work was completed (AI Teammate + OBO assumed,
           tenant + user pulled from the Microsoft Agents SDK turn context — no
           extra questions asked).
        9. add-workiq-tools work was completed using the MCP selection from step 4
           (no extra questions asked).
        10. `a365 setup all --aiteammate` (with blueprint) completed and
            `agentBlueprintId` is present in `a365.generated.config.json`.
        11. `a365 validate` was run locally; the resulting validate report
            (shape: `references/validate-report.example.json`) had
            `summary.ok = true` (with any non-`ok` tier explicitly
            `skipped`). Fixes were applied and `a365 validate` re-run until
            it passed.
        12. The user was walked through: `a365 publish`, devtunnel setup,
            uploading the manifest zip to MAC, setting the messaging
            endpoint in Teams Dev Portal to the devtunnel URL, and creating
            an agent instance via Teams; the user explicitly confirmed all
            four manual steps are done before tenant validation began.
        13. `a365 validate --with-tenant` was run and produced
            `summary.ok = true`. Fixes were applied and the tenant-validate
            command was re-run until it passed, then the user confirmed
            they are ready for deployment.
        If any item is incomplete, return {"ok": false, "reason": "<specific item>"}.
        Otherwise return {"ok": true}.
      timeout: 45000
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

# Build A365 Agent (from scratch)

> **Trigger phrases** — any of these will activate this skill automatically:
> - "/build-a365-agent"
> - "build A365 agent"
> - "create A365 agent"
> - "make A365 agent from scratch"
> - "scaffold a new agent 365 agent"
> - "new a365 agent from scratch"

> **What this skill does:** Takes you from an empty directory + a one-line prompt
> to a fully-wired, locally-tested, Teams-publish-ready Agent 365 AI Teammate.
> It orchestrates five sibling skills as references — `make-ai-teammate`,
> `instrument-observability`, `add-workiq-tools`, and `a365-setup` —
> but always assumes **AI Teammate (OBO)** and reuses the answers it collects
> up front so it never re-asks the user.

> **What this skill does NOT do:** It does not copy any existing sample code.
> All scaffolding comes from the reference markdown files in the sibling skills'
> `references/` folders.

---

## Inference rule (applies to every question below)

Before asking any question, scan the user's original prompt and the prior
conversation. If the answer is unambiguously stated, **skip the question** and
record the inferred value. Only call `AskUserQuestion` when the answer cannot
be inferred.

When you do ask, ask **one focused question at a time** with a `choices` array
where applicable.

**Do NOT add catch-all choices** like `Custom (I'll describe it)`, `Other`,
`Something else`, `Custom — type below`, or similar. The CLI surfaces a
built-in **"Type something"** freeform input on every question automatically.
Adding your own catch-all option produces a duplicate that confuses the user.
When the user types a freeform value via the built-in input, treat it the
same as if they had picked the explicit `Other` / custom path documented in
each phase (e.g. set `languageIsCustom = true`, `frameworkIsCustom = true`,
`modelProviderIsCustom = true`, or, for Phase 3 agent purpose, record the
freeform text verbatim as `agentPurpose`).

---

## Command-invention rule (never invent CLI commands)

Only suggest CLI commands that are **documented in this skill, the sibling
skill SKILL.md files, the references under `references/`, or confirmed by a
real `--help` / `-h` output you have just observed in this session**. If
you have not seen evidence that a command, subcommand, or flag exists, you
must NOT mention it — not even as advisory guidance, recovery steps, or
"you can also run …" suggestions.

Specifically forbidden patterns:
- Inventing `a365` subcommands (e.g. `a365 setup blueprint --rotate-secret`,
  `a365 reset-token` — none of these exist unless you have verified them
  with `a365 -h` / `a365 <cmd> -h` in the current session).
- Inventing `az` subcommands (e.g. `az ad app rotate-secret`).
- Inventing `dotnet` / `npm` / `pip` flags you have not seen documented.

When you need to advise the user to perform an action there is no real
command for (e.g. rotating a leaked secret, recreating a blueprint,
removing a wrongly-granted permission), describe the action as a **manual
portal step** with a link to the relevant admin surface (Azure Portal,
Entra admin center, Microsoft 365 Admin Center, Teams Developer Portal),
not as a fake CLI command. If you genuinely don't know how to do it, say
so and ask the user — never make one up.

---

## Phase 0 — Intro + task list

Output this intro to the user verbatim:

```
I'll build you a new Agent 365 AI Teammate from scratch. Here's the plan:

  1. Sign in to Azure
  2. Make sure the A365 CLI is installed
  3. Confirm the signed-in user has a Microsoft 365 E7 license (required
     to use Agent 365)
  4. Confirm what your agent should do, the MCP servers it needs, and your
     language / framework / model provider
  5. Look up the latest stable docs and package versions for that stack on
     the web, so the scaffold uses current SDKs
  6. Scaffold the agent project (with notification handlers, plus an
     AGENT_LIFECYCLE handler that introduces your AI Teammate to the user's
     manager via Microsoft Graph on first install) and create two env files
     for credentials
  7. Pause so you can paste in your model credentials
  8. Run `a365 setup all --aiteammate --agent-name <agentName>` to register
     the blueprint and populate `.env` with the service-connection creds
  9. Wire observability and WorkIQ MCP tools (now reads the real blueprint
     id, client id/secret, and tenant id that setup just wrote)
  10. Run `a365 validate` locally and iteratively fix any issues it reports
      (this builds, boots, and tests the agent locally) until it passes
  11. Set up a devtunnel, run `a365 publish`, then walk through the manual
      steps (upload manifest to MAC, set the messaging endpoint in Teams
      Dev Portal to the devtunnel, create an agent instance via Teams) —
      pause for your confirmation
  12. Run `a365 validate --with-tenant` to exercise live Teams + email
      traffic via the devtunnel; iteratively fix any issues until it
      passes, then confirm you're ready for deployment

Starting now.
```

Then create the in-session todo list (one entry per phase below) before
running anything else.

---

## Phase 1 — `az login`

State this to the user verbatim:

> Log in to your Azure account. This is required to add MCP tools and required
> permissions to set up your agent.

Then run:

```bash
az login
```

Wait for completion. If the user is already signed in (`az account show`
succeeds with the right tenant), you may skip the interactive login.

---

## Phase 2 — A365 CLI

Run:

```bash
a365 -h
```

- If it succeeds → continue.
- If it fails (command not found) → tell the user **"Installing A365 CLI..."**,
  then run:

  ```bash
  dotnet tool install -g Microsoft.Agents.A365.DevTools.Cli
  ```

  When it finishes, tell the user **"A365 CLI installed."** Re-run `a365 -h`
  to confirm. If `dotnet` itself is missing, surface that as a hard prerequisite
  and stop.

---

## Phase 2.5 — Microsoft 365 E7 license check

Agent 365 requires the signed-in user to have a **Microsoft 365 Copilot** license
(commonly licensed via the **Microsoft 365 E7** SKU, `skuPartNumber` matching
`Microsoft_365_E7` / `M365_E7_*`). Without it, blueprint registration and
tenant validation will fail later. Verify this **before** wasting time on
scaffolding.

Run (PowerShell):

```powershell
az rest --method GET --uri "https://graph.microsoft.com/v1.0/me/licenseDetails" | ConvertFrom-Json | Select-Object -ExpandProperty value | Select-Object skuPartNumber, skuId
```

Inspect the returned list of SKUs:

- **Pass** — at least one `skuPartNumber` contains `E7` (case-insensitive).
  Tell the user **"Microsoft 365 E7 license detected — proceeding."** and
  continue to Phase 3.
- **Fail** — no `E7` SKU present. Print the full SKU list verbatim so the
  user can confirm, then stop with:

  > ❌ I don't see a Microsoft 365 E7 license on the signed-in account.
  > Agent 365 requires a Microsoft 365 E7 license.
  >
  > Options:
  >   1. Sign in with a different account that has E7 (`az logout` then
  >      `az login`), then re-run this skill.
  >   2. Ask your tenant admin to assign you an E7 license, then re-run.
  >
  > Which would you like to do?

  Do **not** continue past this phase until an E7 SKU is detected. Re-run
  the `az rest` command after the user signs in with a different account or
  confirms a license was assigned.

- **Command error** — if `az rest` returns 401 / 403 / `InvalidAuthenticationToken`,
  the Azure CLI session is missing Microsoft Graph scope. Tell the user to run
  `az login --scope https://graph.microsoft.com/.default` and retry. If the
  command returns an empty `value` array, treat it the same as Fail above.

---

## Phase 3 — Agent purpose

If not inferable from the user prompt, ask:

> What do you want your agent to do?

Record the answer as `agentPurpose`. This becomes the seed for the agent
system instructions in Phase 8.

**Always-on:** because this skill always provisions an AI Teammate, the
scaffold in Phase 8 will automatically include a dedicated `AGENT_LIFECYCLE`
handler that introduces the teammate to the user's manager via Microsoft
Graph (1:1 Teams chat) on first install. No question needed — the required
Graph scopes (`Chat.ReadWrite`, `User.Read.All`) are already consented for
AI Teammates by `a365 setup all --aiteammate` in Phase 9.

---

## Phase 4 — MCP server selection

1. Run:

   ```bash
   a365 develop list-available
   ```

2. **Suggest** MCP servers by matching the user's agent prompt/purpose
   (captured in Phase 3) against the available servers from the CLI output.
   Match by server name and description — for example, an agent dealing with
   email → `mcp_MailTools`; a calendar/scheduling agent → calendar-related
   servers; a research/browsing agent → `mcp_W365ComputerUse`; etc.
   If nothing clearly matches, suggest an empty set.

   Present the suggestion to the user with `AskUserQuestion`, lead-in:
   
   > Based on your agent's purpose, I suggest these MCP servers:
   >
   > - <server-1> — <one-line reason>
   > - <server-2> — <one-line reason>
   >
   > How would you like to proceed?
   
   Provide exactly these three choices:
   
   - **Yes — use these and continue** (accept the suggestion as `mcpServers`)
   - **Yes — add more** (keep the suggestion, then show the **full list** of
     available MCP servers from `a365 develop list-available` and ask which
     additional servers to add; merge those into `mcpServers`)
   - **No** (discard the suggestion, show the **full list** of available MCP
     servers, and ask which servers — if any — the agent requires; record as
     `mcpServers`, which may be empty)
   
   When showing the full list (the second and third options), include each
   server's name and a brief description from the CLI output so the user can
   choose intelligently. Allow multi-select via freeform if your
   `AskUserQuestion` doesn't support multi.
   
   If the prompt makes the selection unambiguous (e.g., the user explicitly
   named the servers), you may skip the question and record `mcpServers`
   directly.

3. Ensure a `ToolingManifest.json` exists in the current working directory.
   If not, create an empty one (the next command will populate it). Then run:

   ```bash
   a365 develop add-mcp-servers <server-1> <server-2> ...
   ```

   For example:
   ```bash
   a365 develop add-mcp-servers mcp_MailTools mcp_W365ComputerUse
   ```

   Verify `ToolingManifest.json` now contains those entries.

---

## Phase 5 — Language

If not inferable, ask:

> What language do you want to use?
>
> - C#
> - Python
> - TypeScript

Record as `language`. If the user types a freeform value via the CLI's
built-in "Type something" option, set `languageIsCustom = true` and warn
briefly:

> ⚠️ `${language}` isn't a first-party Agent 365 SDK target. A sidecar
> approach is planned to support arbitrary languages — for now, continuing
> is best-effort. Continue?

---

## Phase 6 — Orchestration framework

Filter the choices by `language` (do not show options that are not supported):

| Framework                       | C# | Python | TypeScript | Official documentation |
|---------------------------------|:--:|:------:|:----------:|------------------------|
| Microsoft Agent Framework       | ✓  | ✓      |            | https://github.com/microsoft/agent-framework |
| LangChain                       |    | ✓      | ✓          | https://python.langchain.com/docs/introduction/ (Python) · https://js.langchain.com/docs/introduction/ (JS/TS) |
| OpenAI Agents SDK               |    | ✓      |            | https://openai.github.io/openai-agents-python/ |
| CrewAI                          |    | ✓      |            | https://github.com/crewAIInc/crewAI |
| Vercel SDK                      |    |        | ✓          | https://ai-sdk.dev/docs/introduction |
| Google Agent Development Kit    |    | ✓      | ✓          | https://google.github.io/adk-docs/ |
| Claude Agent SDK                |    | ✓      | ✓          | https://code.claude.com/docs/en/agent-sdk/overview |

When asking the user, present each option with its documentation link so they
can review the framework before choosing. Example phrasing:

> Which orchestration framework do you want to use?
>
> - **Microsoft Agent Framework** — https://github.com/microsoft/agent-framework
> - **OpenAI Agents SDK** — https://openai.github.io/openai-agents-python/
> - **CrewAI** — https://github.com/crewAIInc/crewAI
> - **Claude Agent SDK** — https://code.claude.com/docs/en/agent-sdk/overview
> - …(only show rows whose `language` column is checked)

If not inferable, ask with the filtered list as `choices`. Record as
`framework`. If the user types a freeform value via the CLI's built-in
"Type something" option, set `frameworkIsCustom = true` and warn briefly:

> ⚠️ `${framework}` isn't on the curated list — best-effort wiring only.

---

## Phase 7 — Model provider

If not inferable, ask:

> What model provider do you want to use?
>
> - Microsoft Azure
> - Amazon Bedrock
> - Anthropic Console
> - Google Gemini Enterprise Agent Platform
> - Direct API key

Record as `modelProvider`. If the user picks **Direct API key**, prompt for
the provider name and the env-var name holding the key. If the user types a
freeform value via the CLI's built-in "Type something" option, set
`modelProviderIsCustom = true` and ask which env vars its SDK expects so
Phase 8 can wire them correctly. Use this to pick the correct env-var names
in Phase 8 (e.g. `AZURE_OPENAI_*`, `AWS_*` + `BEDROCK_*`, `ANTHROPIC_API_KEY`,
`GOOGLE_APPLICATION_CREDENTIALS` + `VERTEX_*`).

### Azure OpenAI — auth is fixed (do NOT prompt)

When `modelProvider = Microsoft Azure` (Azure OpenAI / AI Foundry), **always
default to API key + `.env`**. Do not ask the user to pick between Entra ID
(`DefaultAzureCredential` / `AzureCliCredential` / Managed Identity) and API
key — this question must not appear in the build flow. The scaffold uses
`AzureKeyCredential` reading from `AZURE_OPENAI_API_KEY`. If the user later
wants Entra-based auth, they can swap it in manually after the agent is
running; the skill does not offer it.

Concretely in Phase 8:
- .NET — `new AzureOpenAIClient(new Uri(endpoint), new AzureKeyCredential(apiKey))`. Never `new DefaultAzureCredential()` or any other `TokenCredential` for the Azure OpenAI client.
- Node.js — `new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment })` from the `openai` SDK. Never `new DefaultAzureCredential()` (`@azure/identity`).
- Python — `AzureOpenAI(azure_endpoint=..., api_key=os.environ["AZURE_OPENAI_API_KEY"], api_version=..., azure_deployment=...)`. Never `DefaultAzureCredential()` from `azure-identity`.
- All three languages — load `.env` at startup (`DotNetEnv` in .NET, `dotenv` / `dotenvx` in Node.js, `python-dotenv` in Python) and read `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT` / `AZURE_OPENAI_API_VERSION` from environment variables. Do NOT put the API key in `appsettings.json` / `appsettings.Development.json` / `config.yaml`.
- Generate a `.env` file populated with the user-provided endpoint, deployment, and a `<<YOUR_API_KEY>>` placeholder, plus an `.env.example` with the same shape but blank values. Ensure `.env` is gitignored.

---

## Phase 7.5 — Research framework docs + latest package versions (web search)

**Before scaffolding (Phase 8), search the web** for up-to-date documentation
and current stable package versions for the chosen orchestration stack. Do
this for **every** orchestration framework — including curated and custom
(`frameworkIsCustom = true`) selections. The reference markdown under
`make-ai-teammate/references/` is the structural source of truth (project
layout, hosting wiring, notification dispatch), but package version pins
there may be stale; the web is the source of truth for versions.

For each item below, run a web search and record the result before
scaffolding:

1. **Orchestration framework** (`framework` × `language`):
   - Official docs URL (use the link from the Phase 6 table when present).
   - Latest stable release / package version (skip pre-release / beta / RC
     unless no stable release exists, in which case record `prerelease: true`
     and note the version).
   - A current "getting started" or quickstart example for the chosen
     language so the scaffold reflects the framework's current idioms
     (imports, builder pattern, agent run loop, tool-calling shape).
2. **Microsoft Agents SDK** for the chosen language — latest stable version
   of `Microsoft.Agents.*` (.NET) / `@microsoft/agents-*` (TypeScript) /
   `microsoft-agents-*` (Python). These pin the hosting layer.
3. **A365 observability distro** for the chosen language — latest stable
   version of `Microsoft.OpenTelemetry` (.NET) / `@microsoft/opentelemetry`
   (TypeScript) / `microsoft-opentelemetry` (Python). Used by Phase 10.
4. **Model provider SDK + required environment variables** for the chosen
   `modelProvider` (e.g. Azure OpenAI, Bedrock, Anthropic, Vertex / Gemini,
   OpenAI direct). Search the provider's official docs / SDK readme and
   record:
   - latest stable client library version for the chosen language;
   - the **exact env-var names** the SDK reads by default (e.g. Azure OpenAI
     → `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`,
     `AZURE_OPENAI_API_VERSION`; Bedrock → `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
     `AWS_SECRET_ACCESS_KEY` (+ optional `AWS_SESSION_TOKEN`, `BEDROCK_*`);
     Anthropic → `ANTHROPIC_API_KEY`; Gemini / Vertex →
     `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`,
     `GOOGLE_CLOUD_LOCATION`, `GEMINI_API_KEY`; OpenAI direct → `OPENAI_API_KEY`,
     `OPENAI_BASE_URL`);
   - which of those are **required** vs **optional**, and any default values
     the SDK falls back to;
   - the canonical model / deployment identifier shape the SDK expects (e.g.
     deployment name vs model id vs ARN), so the scaffold can pre-fill a
     sensible placeholder.

   If `modelProviderIsCustom = true`, search for the provider's official SDK
   docs and record the same fields. Do **not** invent env-var names from
   memory — they must come from the live docs.
5. **MCP client library** for the chosen language (if not bundled with the
   orchestration framework) — latest stable version.

Record everything as a structured note for Phase 8 (in-session state, not
on disk):

```
researchedVersions:
  framework:
    name: <framework>
    docsUrl: <url>
    package: <package-name>
    version: <x.y.z>
    prerelease: <true|false>
  agentsSdk:        { package: ..., version: ... }
  observability:    { package: ..., version: ... }
  modelProvider:
    package: ...
    version: ...
    envVars:
      required: [ ... ]   # e.g. [AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT]
      optional: [ ... ]   # e.g. [AZURE_OPENAI_API_VERSION]
      modelIdKey: ...     # which key holds the deployment / model id
      docsUrl:   ...
  mcp:              { package: ..., version: ... }   # if applicable
```

### Version selection rules

- **Always prefer the latest stable release** found by web search over any
  version pinned in the reference markdown.
- If two packages have a known incompatibility (e.g. orchestration framework
  requires an older OpenAI SDK, or Microsoft Agents SDK requires an older
  OpenTelemetry), **prefer the more recent version** and adjust the other
  package to its newest version that is compatible with that choice. Never
  downgrade to an older version just to match a stale pin.
- If a conflict can only be resolved by holding back one package (e.g. peer
  dependency hard-pin), pick the combination that maximises the newest
  *orchestration framework* version, then maximise the *Agents SDK* version,
  then maximise the rest. Record the pin and the reason in the scaffold
  README so the next developer can see why it was held back.
- For pre-1.0 packages where the latest stable is the only choice, take it.
  If only pre-release versions exist, take the newest pre-release and set
  `prerelease: true` in the note above; surface this to the user verbatim:

  > ⚠️ `${package}` has no stable release yet — using pre-release
  > `${version}`. This may need updating later.

- If the web search fails (network blocked, no result), tell the user:

  > I couldn't reach the package registry / docs to confirm the latest
  > version of `${package}`. I'll fall back to the version pinned in the
  > reference markdown (`${fallbackVersion}`). Update it manually after
  > scaffolding if a newer release exists.

  …and use the reference-pinned version. Do **not** silently guess a
  version string.

### Where to search

- Package registries: NuGet (nuget.org), npm (npmjs.com), PyPI (pypi.org).
- Official framework docs (links in the Phase 6 table).
- Official model-provider SDK docs / repos.

Keep the research scoped — do not crawl unrelated pages. One search per
package family is enough.

---


> **Reference (do not copy from samples):**
> - `${AGENT365_SKILLS}/plugins/agent365/skills/make-ai-teammate/SKILL.md`
> - `${AGENT365_SKILLS}/plugins/agent365/skills/make-ai-teammate/references/dotnet-ai-teammate.md` (if `language` = C#)
> - `${AGENT365_SKILLS}/plugins/agent365/skills/make-ai-teammate/references/python-ai-teammate.md` (if `language` = Python)
> - `${AGENT365_SKILLS}/plugins/agent365/skills/make-ai-teammate/references/nodejs-ai-teammate.md` (if `language` = TypeScript)
> - `${AGENT365_SKILLS}/plugins/agent365/skills/make-ai-teammate/references/nodejs-notifications.md` (always — notification handlers are critical)

Build the project structure for the chosen `language` + `framework` directly
from these reference files. Do **not** read from or copy any file under
`Agent365-Samples/` — scaffold greenfield from the reference markdown.

Required wiring (all stacks):
1. HTTP host with `/api/messages` and `/api/health` **listening on port 5000**
   for all languages (.NET, Python, Node.js). The `a365 validate` harness
   probes `http://localhost:5000/api/health` regardless of stack — do not
   default to the legacy `3978`. Read `PORT` (or `ASPNETCORE_URLS` for
   .NET) from the env file with `5000` as the fallback.
2. `AgentApplication` (or language equivalent) with handlers for:
   - inbound message
   - **notification activity (notifications handlers are CRITICAL — wire them as
     described in `nodejs-notifications.md`, mapping the same shape into your
     chosen language)**
   - installation update
3. LLM client wrapper for the chosen `framework` + `modelProvider`.
4. System prompt seeded from `agentPurpose`.
5. `ToolingManifest.json` already present from Phase 4.
6. All required `Microsoft.Agents.*` / `@microsoft/agents-*` /
   `microsoft_agents_*` packages added.

### Activity validation guard (all stacks)

Wrap the activity processing entry point (`adapter.process()` in Node.js,
the equivalent in Python/.NET) in a try/catch (or language-appropriate error
handler). The Agents SDK validates inbound activities using strict schemas —
malformed payloads (e.g. missing `type` field) will throw an unhandled
exception and crash the process. The guard should:
- Catch validation errors and return HTTP 400 with a descriptive message.
- Log a warning (not an error — invalid input is not an app fault).
- Never crash or exit the process on bad input.

### Package versions

Use the `researchedVersions` table captured in Phase 7.5 as the authoritative
source for every package pin written into `*.csproj`, `package.json`, or
`pyproject.toml` / `requirements.txt`. Do **not** copy version numbers from
the reference markdown when Phase 7.5 produced a newer stable value. When a
package isn't covered by `researchedVersions` (e.g. small utility libraries),
fall back to the reference markdown's pin.

If during install / restore (`dotnet restore`, `npm install`, `pip install`)
a version conflict appears, resolve it by **moving the conflicting package
forward to a newer compatible version**, not by downgrading the package
chosen in Phase 7.5. Re-run the install and confirm it succeeds before
moving on.

> **Common peer-dep trap (LangChain + TypeScript/Python):** `@langchain/core`
> must satisfy peer requirements from both `langchain` and any
> `@langchain/<integration>` packages (e.g. `@langchain/openai`,
> `@langchain/mcp-adapters`). When in doubt, align the entire `@langchain/*`
> family to the **same major version** (e.g. all `^1.0.0`). Mixing 0.x and
> 1.x will produce unresolvable peer conflicts.

### Telemetry / observability package allowlist (CRITICAL)

When scaffolding `*.csproj` / `package.json` / `pyproject.toml`, only add
**these** observability-adjacent packages — nothing else:

| Category | C# / .NET | Node.js / TypeScript | Python |
|---|---|---|---|
| **OpenTelemetry distro (required)** | `Microsoft.OpenTelemetry` | `@microsoft/opentelemetry` | `microsoft-opentelemetry` |
| **Microsoft Agents hosting (required)** | `Microsoft.Agents.Hosting.*`, `Microsoft.Agents.Builder`, `Microsoft.Agents.Activity`, `Microsoft.Agents.Authentication.Msal` | `@microsoft/agents-hosting`, `@microsoft/agents-activity`, etc. | `microsoft-agents-hosting-core`, `microsoft-agents-authentication-msal`, `microsoft-agents-activity` |
| **A365 SDK (required)** | `Microsoft.Agents.A365.Notifications`, `Microsoft.Agents.A365.Tooling.Extensions.<framework>`, `Microsoft.Agents.A365.Runtime` | `@microsoft/agents-a365-notifications`, `@microsoft/agents-a365-tooling-extensions-<framework>`, `@microsoft/agents-a365-runtime` | `microsoft-agents-a365-notifications`, `microsoft-agents-a365-tooling-extensions-<framework>`, `microsoft-agents-a365-runtime` |

**Forbidden — do NOT install or import any of these:**

- `@microsoft/agents-telemetry` (Node.js) and any equivalent Agents-SDK standalone telemetry side-package in other languages — do not install or import.
- `Microsoft.Agents.A365.Observability.Runtime` / `Microsoft.Agents.A365.Observability.Hosting`
  (and the Node.js `@microsoft/agents-a365-observability` /
  Python `microsoft-agents-a365-observability` equivalents) — these are the
  **legacy SDK-native** observability packages. The unified
  `Microsoft.OpenTelemetry` / `@microsoft/opentelemetry` /
  `microsoft-opentelemetry` distro **re-exports every type they expose**
  (`BaggageBuilder`, `InvokeAgentScope`, `InferenceScope`, `ExecuteToolScope`,
  `IExporterTokenCache`, `AgentDetails`, `CallerDetails`, etc.). Installing
  both produces:
  - .NET: CS0433 *"The type ... exists in both ... and ..."* duplicate-type
    errors at compile time.
  - Node.js / Python: at runtime, two separate exporter instances post the
    same span twice and compete for the per-turn token, so traces silently
    double-up or vanish.
  Only install the legacy packages when the user has **explicitly** opted
  out of the distro in Phase 10 (the "SDK-native opt-out" path).
- `OpenTelemetry.*` standalone packages (`OpenTelemetry.Exporter.OpenTelemetryProtocol`,
  `@opentelemetry/sdk-node`, `opentelemetry-sdk` raw, etc.) for the *purpose
  of A365 export*. The distro already brings in the OTel SDK + every
  auto-instrumentation (AspNetCore, HttpClient, OpenAI, LangChain,
  SemanticKernel, AgentFramework) — adding them again at the project level
  pins a second copy that will diverge from what the distro expects.
  *Exception:* a standalone OTel package is fine if it's a peer dep pulled
  in transitively by another library you legitimately need — let the package
  manager resolve it; never add it to your top-level manifest.
- Application-Insights / Azure Monitor / Jaeger / Zipkin direct exporters.
  A365 traces go to the **A365 exporter** built into the distro — that's
  the only supported pipeline. If the user separately wants APM-style export
  to App Insights, that's a post-deployment configuration concern, not
  something this scaffold wires.

> **Verify before leaving Phase 8** — `grep` the manifest for the forbidden
> package names; if any matches, remove them and re-run install. Surface to
> the user any package the scaffold removed and why, so they don't add it
> back by hand.

### AGENT_LIFECYCLE handler (always include — AI Teammate default)

Wire a **dedicated** lifecycle handler that **bypasses** the generic
notification dispatch — `agentOnboarding` conversations don't accept
synchronous chat replies (they 502), so the side-effect must happen via
Microsoft Graph, not `context.send_activity`.

**Host-side handler (in the notification dispatcher):**

When `notification_activity.notification_type == NotificationTypes.AGENT_LIFECYCLE`:

1. **Synchronous dedupe** keyed by `context.activity.recipient.agentic_app_id`
   (or language equivalent), checked **before any `await`**. Lifecycle events
   arrive in retry storms; without this dedupe the asyncio/event loop is
   starved and user message turns hang. Maintain the dedupe set on the agent
   instance (e.g. `_onboarded_agent_ids: set[str]`).
2. Cache the observability token via the existing helper so spans can export
   (`_setup_observability_token(context, tenant_id, agent_id)` or equivalent).
3. Wrap the helper invocation in `BaggageBuilder().tenant_id(...).agent_id(...).build()`
   so spans carry tenant/agent identity and the A365 exporter ships them.
4. Call the agent's `_send_onboarding_greeting_to_manager(auth, auth_handler_name, context, agent_id)`
   helper inside a single `try/except` with **no retry attempts** — the
   per-agent dedupe handles retries idempotently.
5. **Return without `send_activity`** (lifecycle conversations always 502
   on chat replies; suppress that connector-client error spam with a
   `logging.Filter` on `microsoft_agents.hosting.core.connector.client.connector_client`
   that drops `Error replying to activity: 502` lines on `agentOnboarding` paths).

**Agent-side helper (`_send_onboarding_greeting_to_manager`):**

Serialize with an `asyncio.Lock` (the lock and dedupe set live on the agent
instance). Inside the lock:

1. Re-check the dedupe (a concurrent retry may have completed it).
2. **Token exchange** — `auth.exchange_token(context, scopes=["https://graph.microsoft.com/.default"], auth_handler_id=auth_handler_name)`.
3. `GET https://graph.microsoft.com/v1.0/me` → resolve `me_id` and `displayName`.
4. `GET https://graph.microsoft.com/v1.0/me/manager` → resolve manager (treat
   404 as "no manager configured", log + bail gracefully, mark deduped).
5. `POST https://graph.microsoft.com/v1.0/chats` with `chatType=oneOnOne`
   and both users as `aadUserConversationMember` owners → returns chat id.
6. `POST https://graph.microsoft.com/v1.0/chats/{chat_id}/messages` with:
   ```
   body.content = "Hi {manager_name}, I'm {user_name}, your new {job_function}."
   ```
   - `{manager_name}` — `displayName` from `GET /me/manager`
   - `{user_name}` — `displayName` from `GET /me` (the agentic identity's friendly name; this is the agent's introducing-self name)
   - `{job_function}` — derived from the `AGENT365_AGENT_NAME` env var with `-`/`_` normalized to spaces (falls back to `"AI teammate"`)
7. On success, add `agent_id` to the dedupe set.

**Observability spans:** raw HTTP clients are not auto-instrumented by
OpenTelemetry. Wrap each Graph step in an explicit span using
`opentelemetry.trace.get_tracer(...).start_as_current_span(...)`:
- parent: `onboarding.greet_manager` (attributes: `a365.agent_id`,
  `a365.user.id`, `a365.user.display_name`, `a365.manager.id`,
  `a365.manager.display_name`, `a365.chat.id`, `a365.onboarding.outcome`)
- children: `onboarding.exchange_graph_token`,
  `onboarding.graph.get_me`, `onboarding.graph.get_manager`,
  `onboarding.graph.create_chat`, `onboarding.graph.send_message`

These spans inherit the BaggageBuilder context set by the host, so the A365
exporter picks them up instead of dropping them with "No spans with
tenant/agent identity found".

### Two environments (mandatory)

Create two environment files with matching keys:

| Language     | Files                                                  |
|--------------|--------------------------------------------------------|
| C#           | `appsettings.json` and `appsettings.Development.json`  |
| Python       | `.env` and `.env.local`                                |
| TypeScript   | `.env` and `.env.local`                                |

Populate keys for the chosen `modelProvider`, plus the standard A365 keys.
**Use the env-var names captured in `researchedVersions.modelProvider.envVars`
(Phase 7.5) as the source of truth** — do not hand-type provider env-var
names from memory, and do not reuse stale names from older reference
markdown. Required vars must be present in both files; optional vars only
appear in the production file with a comment noting they're optional.
Leave secret values blank or as `<<YOUR_API_KEY>>` placeholders. Add both
files to `.gitignore` as appropriate (sample/template stays committed; secret
file does not).

> **Dotenv load-order pitfall (Python / Node.js).** If both files are loaded
> with `override=False` (typical pattern: `load_dotenv(".env.local", override=False)`
> then `load_dotenv()`), the **first** file wins. An *empty* value in `.env.local`
> still counts as set — `.env`'s value will NOT fill it in. Concretely:
>
> - If `.env.local` contains `AUTH_HANDLER_NAME=` (empty) and `.env` contains
>   `AUTH_HANDLER_NAME=AGENTIC`, the agent runs anonymously — **JWT silently
>   disabled** despite the production `.env` saying otherwise.
> - Same trap for `CLIENT_ID` / `TENANT_ID` / `CLIENT_SECRET`.
>
> Two safe patterns:
> 1. Don't include any `KEY=` (empty) lines in `.env.local` — only set keys
>    you actually want to override.
> 2. When the user says "test in Teams" / "use real auth", explicitly populate
>    the AUTH/CONNECTIONS keys in `.env.local` (or delete the empty lines).
>
> Document this in the scaffolded `.env.local` so the next dev doesn't hit it.

### Pause for credentials

After scaffolding finishes, **pause** and tell the user. The message must
make clear that **only one file needs editing** — the production env file
(`.env` for Python/Node.js, `appsettings.json` for .NET). The local override
file (`.env.local` / `appsettings.Development.json`) intentionally inherits
all model credentials from the production file and must NOT contain empty
`KEY=` lines for those credentials (the dotenv load-order pitfall above
would silently shadow the production value).

Use this exact phrasing (substitute `<production-env-file>` with the actual
file name and `<credentials>` with the specific keys the chosen provider
requires — e.g. `ANTHROPIC_API_KEY` for Anthropic, or
`AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_DEPLOYMENT`
for Azure OpenAI):

> The agent is scaffolded. Open **`<production-env-file>`** and fill in
> your model credentials:
>
> ```
> <credentials>
> ```
>
> Reply when you've added the credentials and we'll continue.

Wait for explicit confirmation before moving on.

### Runtime safety nets (wire during scaffold; toggled in Phase 14)

Include two debug switches in the scaffolded code so Phase 14 has the levers
it needs without re-touching the source. Both default to off, and the *when*
to flip them is owned by Phase 14:

1. **`AGENT_RUN_TIMEOUT_SECONDS`** (default 60) — wrap the LLM/agent call
   in a timeout (`asyncio.wait_for(...)` for Python, `Promise.race` for
   Node.js, `CancellationTokenSource` for .NET). On timeout return a clear
   user-facing message rather than hanging.
2. **`DISABLE_MCP_TOOLS=true`** — when set, skip MCP wiring entirely so
   the agent answers from the LLM only. Used in Phase 14 to bisect a
   misbehaving WorkIQ tool from the agent's core path.

---

## Phase 9 — A365 setup (AI Teammate + blueprint)

> **Reference:** `${AGENT365_SKILLS}/plugins/agent365/skills/a365-setup/SKILL.md`

**Do NOT enter this phase until Phase 8 (scaffold) is complete.** Setup
runs *before* observability and WorkIQ wiring so that the blueprint ID,
service-principal client id/secret, and tenant id are written into `.env`
*before* observability/MCP code reads them — that way both subsequent
phases can be smoke-tested locally against real values.

**Skip the detection and prerequisite-checking phases** — assume:
- `agentType` = AI Teammate
- All prerequisites already verified in Phases 1–2

Run (always pass `--agent-name <agentName>` — the CLI errors out with
*"Run 'a365 setup all --agent-name <name>' to set up for the new tenant"*
when the agent name isn't on the command line, even though the blueprint
display name is otherwise inferred):

```bash
a365 setup all --aiteammate --agent-name <agentName>
```

Use the directory name the user picked in Phase 4 (e.g. `pirate-agent`) as
`<agentName>`. The blueprint will be created as `<agentName> Blueprint`.

When complete, read `a365.generated.config.json` and confirm `agentBlueprintId`
is present. Show the Setup Summary table verbatim. The blueprint must exist
before `a365 validate` (Phase 12) can authenticate observability exports.

`a365 setup all --aiteammate` stamps the observability identity fallbacks
into `.env` (Python / Node.js) or `appsettings.json` (.NET):

- `AGENT365OBSERVABILITY__TENANTID`
- `AGENT365OBSERVABILITY__AGENTID`
- `AGENT365OBSERVABILITY__AGENTBLUEPRINTID`

Verify all three are present after `setup all` returns. If any is missing,
copy the value from `a365.generated.config.json` (`tenantId`, `agentId`,
`agentBlueprintId`) into the env file manually. These are the fallbacks
the Phase 10 identity resolver reads when the activity recipient is empty
— do not write them anywhere else and do not invent alternate names. The
namespaced `AGENT365OBSERVABILITY__*` prefix is what the CLI emits and
what survives the `a365 validate` subprocess environment (plain `TENANT_ID`
is clobbered by the validator harness).

Because MCP permissions are part of `a365 setup all`, the user must
complete admin consent now (the CLI opens the browser; if the 180s timeout
fires, surface each `consentUrl` from `a365.generated.config.json` to the
user and ask them to grant before continuing). MCP code wiring in Phase 11
assumes the permissions hand-off is done.

---

## Phase 10 — Instrument observability

> **Reference:** `${AGENT365_SKILLS}/plugins/agent365/skills/instrument-observability/SKILL.md`
> and the matching language file under `references/`.

**Skip the cache detection and "what kind of agent is this?" questions.** Use
the answers already collected:
- `agentType` = `ai-teammate`
- `authMode` = `obo`
- `language` / `framework` already known

For tenant ID and user ID, **do not ask the user**. Pull them at runtime from
the Microsoft Agents SDK turn context (e.g. `turnContext.activity.channelData`,
`turnContext.activity.from.aadObjectId`, `turnContext.activity.conversation.tenantId`,
or the language equivalent) inside the `BaggageBuilder` step described in the
reference.

### Identity sources — turn context vs config (CRITICAL)

When populating `AgentDetails` for the manual scopes, use the **right source**
for each field. Mixing them up — particularly using `recipient.agentic_app_id`
as the blueprint id — produces wrong telemetry attribution:

| Field | Source | Notes |
|---|---|---|
| `tenant_id` | `recipient.tenant_id` (turn context) → fallback **`AGENT365OBSERVABILITY__TENANTID` env var** | Per-tenant, comes from the incoming activity. Required env fallback because `a365 validate` (anonymous local mode) synthesizes activities with no `recipient.tenant_id` — without the fallback the A365 exporter silently drops every span. The CLI stamps `AGENT365OBSERVABILITY__TENANTID` during `a365 setup all --aiteammate` (Phase 9). Use this namespaced name — NOT plain `TENANT_ID`, which the validator harness clobbers with empty in the subprocess environment. |
| `agent_id` (per-install instance) | `activity.get_agentic_instance_id()` → `recipient.agentic_app_id` → fallback **`AGENT365OBSERVABILITY__AGENTID` env var** | Varies per installation/user. This IS the per-install app instance id. The CLI stamps `AGENT365OBSERVABILITY__AGENTID` during `a365 setup all --aiteammate`. Same validator-clobber rule as tenant — use the namespaced name. |
| `agentic_user_id` | `recipient.agentic_user_id` (turn context) | The agentic user identity for the install |
| `agent_blueprint_id` | **`AGENT365OBSERVABILITY__AGENTBLUEPRINTID` env var** — populated from `a365.generated.config.json` by `a365 setup all --aiteammate` | **Stable** per agent registration. Do **NOT** use `recipient.agentic_app_id` — that's the per-install instance, not the blueprint. |
| `agent_name` / `agent_description` | `AGENT365_AGENT_NAME` / `AGENT365_AGENT_DESCRIPTION` env vars | From `.env` populated by `a365 setup` |

Make sure the scaffolded `turn_context_utils` (or language equivalent)
reads `agent_blueprint_id` from the env var, **not** from `recipient`.

### Prefer the unified distro (default) — opt-out to SDK-native instrumentation

**Default path: Unified OpenTelemetry distro.** Use the single `Microsoft.OpenTelemetry`
(.NET) / `@microsoft/opentelemetry` (Node.js) / `microsoft-opentelemetry` (Python)
package — it re-exports all the A365 observability types (`BaggageBuilder`,
`InvokeAgentScope`, `InferenceScope`, `ExecuteToolScope`, `IExporterTokenCache`,
`AgentDetails`, `CallerDetails`, etc.) plus configures the OTel pipeline and the
A365 exporter in one call. Auto-instrumentation for AspNetCore, HttpClient,
SemanticKernel, OpenAI, AgentFramework, etc. is built in (all default `true`).

> **⚠️ Do NOT mix the distro with the legacy SDK packages.** Adding
> `Microsoft.Agents.A365.Observability.Runtime` / `…Hosting` (or their
> Node.js / Python equivalents) alongside the distro causes CS0433 duplicate-type
> errors. The distro re-exports those types transitively — let them flow through.

| Language     | Default setup call (distro)                                                                                       |
|--------------|-------------------------------------------------------------------------------------------------------------------|
11| C# / .NET    | `builder.UseMicrosoftOpenTelemetry(o => { o.Exporters = builder.Environment.IsDevelopment() ? ExportTarget.Agent365 \| ExportTarget.Otlp \| ExportTarget.Console : ExportTarget.Agent365 \| ExportTarget.Otlp; })` (OBO path — distro auto-registers `IExporterTokenCache<AgenticTokenStruct>`; no separate `AddAgenticTracingExporter()` / `AddA365Tracing()` call needed). For S2S, also set `o.Agent365.Exporter.UseS2SEndpoint = true` and supply `o.Agent365.Exporter.TokenResolver`. |
| Node.js      | `useMicrosoftOpenTelemetry({ a365: { enabled: true, enableObservabilityExporter: true, tokenResolver } })` from `@microsoft/opentelemetry`. For S2S, also set `useS2SEndpoint: true`. |
| Python       | `use_microsoft_opentelemetry(enable_a365=True, a365_enable_observability_exporter=True, a365_token_resolver=...)` from `microsoft_opentelemetry`. For S2S, also pass `a365_use_s2s_endpoint=True`. |

Also wire `.UseOpenTelemetry()` on the `IChatClient` (.NET) / equivalent on the
chosen AI SDK — that's what makes the SDK emit `gen_ai.inference` / `gen_ai.tool`
spans for `InvokeAgentScope` to anchor as children.

**Manual scopes are still the contract.** Even with the distro, wrap the message
handler explicitly:
- `InvokeAgentScope.start(request, scope_details, agent_details, caller_details)` — the parent for the whole agent invocation. Pass `CallerDetails` (signed-in user for OBO; Blueprint sponsor for S2S/autonomous) — **required** for traces to appear in the MAC portal.
- `InferenceScope.start(request, inference_details, agent_details)` — wraps each LLM call (model, provider, optional token counts).
- `ExecuteToolScope.start(request, tool_details, agent_details)` — wraps each tool call.
- All three scopes are **required for store publishing**. Use `.start()` factories (context-managers) — not constructors.

For helper utilities that extract identity from `TurnContext` and build
`AgentDetails` / `CallerDetails` / `Request` objects, scaffold a small
`turn_context_utils.py` (or language equivalent) so the message handler is
not cluttered with boilerplate.

**Opt-out: SDK-native manual instrumentation.** Only fall back to the legacy
A365 SDK packages if the user explicitly asks (e.g. "use the SDK directly" /
"skip the OpenTelemetry distro" / "manual instrumentation only"). In that
case, swap the distro call for these:

| Language     | Manual setup call (replace the distro's call) |
|--------------|------------------------------------------------|
| C# / .NET    | Install `Microsoft.Agents.A365.Observability.Runtime` + `…Hosting`; then `builder.Services.AddAgenticTracingExporter()` + `builder.AddA365Tracing()` (skip `UseMicrosoftOpenTelemetry`) |
| Node.js      | Use `ObservabilityManager` from `@microsoft/agents-a365-observability` directly (skip `@microsoft/opentelemetry`) |
| Python       | `from microsoft_agents_a365.observability.core.config import configure` → `configure(service_name=..., service_namespace=..., token_resolver=...)` once at startup |

The SDK-native path buys finer control at the cost of losing built-in
auto-instrumentation for AspNetCore / HttpClient / SemanticKernel / OpenAI /
AgentFramework — you have to install and wire each extension package yourself.

Apply the rest of the reference for the chosen path (packages, BaggageBuilder
or BaggageMiddleware, per-turn agentic-token refresh, env vars). Mark each
instrumented block with the comment:

```
// A365 Observability — best-effort instrumentation
```

**Defaults for the env file (Python / Node.js samples):** scaffold the
following with these values so the exporter is on out of the box and the
generated agent emits useful logs the moment it boots:

```
ENABLE_A365_OBSERVABILITY_EXPORTER=true
# Python ONLY: also gates A365 span creation — without this scopes are no-ops
ENABLE_A365_OBSERVABILITY=true
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
OTEL_LOG_LEVEL=Debug
# OTLP endpoint for Aspire Dashboard (local dev) or collector (production)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
# Service name resource attribute — must be set as OTEL_SERVICE_NAME (the
# standard OTel env var), NOT SERVICE_NAME, or it won't be applied to the
# resource block and the `a365 validate` telemetry parser will fail with
# "missing OTel resource attributes".
OTEL_SERVICE_NAME=<agent-name>
```

The `A365_OBSERVABILITY_LOG_LEVEL` value MUST be the full pipe-separated
list `info|warn|error` (all three levels). Single-level values like `info`
or `warn` are rejected by the distro.

If the reference template suggests `ENABLE_A365_OBSERVABILITY_EXPORTER=false`,
override it to `true` here. (.NET samples don't use these env vars — the
exporter is wired in code via `ExportTarget.Agent365 | ExportTarget.Otlp` and
log levels live in `appsettings.json`.)

### Aspire Dashboard setup (local OTel visualization)

**Prerequisites:**
1. **Docker Desktop must be running.** Start Docker Desktop before proceeding — if it's not running, `docker run` will fail silently. On Windows, launch from Start Menu or run `Start-Process "Docker Desktop"` and wait ~30 seconds for the engine to initialize.
2. Docker must be installed (Windows: Docker Desktop via winget, macOS: `brew install --cask docker`).

For .NET agents, `ExportTarget.Otlp` sends traces, metrics, and structured logs
to the OTLP endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://localhost:4317`).
Run the [Aspire Dashboard](https://learn.microsoft.com/dotnet/aspire/fundamentals/dashboard/standalone) via Docker to visualize telemetry during development:

```bash
docker run -d --name aspire-dashboard \
  -p 4318:18888 -p 4317:18889 \
  -e DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true \
  mcr.microsoft.com/dotnet/aspire-dashboard:latest
```

| Port | Purpose |
|------|---------|
| `4318` (host) → `18888` (container) | Aspire Dashboard web UI |
| `4317` (host) → `18889` (container) | OTLP gRPC receiver (traces + metrics + logs) |

Open `http://localhost:4318` to view:
- **Traces tab** — distributed traces for each agent interaction (InvokeAgentScope, InferenceScope, HTTP spans)
- **Metrics tab** — token usage, request counts, durations
- **Structured Logs tab** — filtered logs with correlation IDs

**Reference:** [`microsoft/agent-framework` — AgentOpenTelemetry sample](https://github.com/microsoft/agent-framework/tree/main/dotnet/samples/02-agents/AgentOpenTelemetry)

#### .NET configuration

The agent's `Program.cs` must include `ExportTarget.Otlp` in the exporter flags:

```csharp
builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Exporters = builder.Environment.IsDevelopment()
        ? ExportTarget.Agent365 | ExportTarget.Otlp | ExportTarget.Console
        : ExportTarget.Agent365 | ExportTarget.Otlp;
});
```

#### Node.js / Python configuration

**Important:** The `@microsoft/agents-a365-observability` package's `ObservabilityManager.start()` registers its own TracerProvider. You **cannot** start a second `NodeSDK` after it — OTel only allows one global provider. Instead, use the standard `@opentelemetry/sdk-node` `NodeSDK` as the sole provider with OTLP exporters, and import A365 utilities (`BaggageBuilder`, `InvokeAgentScope`) from the package without calling `ObservabilityManager.start()`:

```typescript
// observability.ts — Node.js pattern
import { BaggageBuilder, InvokeAgentScope } from '@microsoft/agents-a365-observability';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.AGENT365_AGENT_NAME || 'my-agent',
    [ATTR_SERVICE_VERSION]: '0.1.0',
  }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint }))],
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: otlpEndpoint }),
    exportIntervalMillis: 10000,
  }),
  logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: otlpEndpoint }))],
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': { enabled: true },
    '@opentelemetry/instrumentation-express': { enabled: true },
  })],
});
sdk.start();
```

Required `.env` variables:
```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

The gRPC exporter uses the base endpoint directly (do NOT append `/v1/traces` — that's for HTTP/protobuf only).

**Production:** Replace the local Aspire Dashboard with your production OTLP
collector (Application Insights, Grafana Alloy, Datadog Agent, etc.) by
changing `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector's endpoint URL.

> **Don't pin the observability logger below the env var.** Wire your host so
> that the observability logger reads its level from `A365_OBSERVABILITY_LOG_LEVEL`.
> Logger categories depend on which path you chose:
> - **Distro (default):** `microsoft_opentelemetry` (Python) / `@microsoft/opentelemetry` (Node.js) / `Microsoft.OpenTelemetry` (.NET)
> - **SDK-native (opt-out):** `microsoft_agents_a365.observability` (Python) / `@microsoft/agents-a365-observability` (Node.js) / `Microsoft.Agents.A365.Observability` (.NET)
>
> Hardcoding to `ERROR` makes "is observability working?" unanswerable in Phase 14 because success messages live at INFO/DEBUG.

### AI Teammate OTel debugging

1. **S2S is BLOCKED for AI Teammates** — AADSTS82001/82005. Entra blocks
   `client_credentials` for agentic app registrations. Only the OBO per-turn
   token path works. Do NOT attempt the FMI 3-hop chain.

2. **Init order is critical** — the OTel distro must initialize **before** any
   LLM / orchestration framework imports so it can patch target libraries.
   Create a dedicated side-effect module that calls the distro setup at module
   scope, then import it as the very first line of your entry point.

3. **`configureA365Hosting(adapter)`** — call after adapter creation to
   register `BaggageMiddleware` automatically (populates baggage from
   `TurnContext` on every request). Replaces any manual middleware wiring.

4. **Per-turn token refresh uses the per-install instance ID** — pass
   `recipient.agenticAppId` (Node.js/Python) or
   `activity.GetAgenticInstanceId()` (.NET) as the `agentId` argument to the
   token refresh call. Do NOT pass the blueprint ID here — that's a different
   identifier.

5. **Type casts may be required** — the GA distro's interface types can be
   stricter than the Agents SDK's runtime types (e.g. `TurnContextLike` vs
   the actual `TurnContext`). Use language-appropriate casts (`as any` in
   TypeScript, explicit interface implementations in .NET) when the compiler
   complains at token-refresh or baggage-builder call sites.

Build at the end to confirm no compile errors.

---

## Phase 11 — Add WorkIQ MCP tools

> **Reference:** `${AGENT365_SKILLS}/plugins/agent365/skills/add-workiq-tools/SKILL.md`
> and the matching language file under `references/`.

**Skip every question** — reuse `mcpServers` from Phase 4. The selection has
already been added to `ToolingManifest.json`, so this phase is mostly about
wiring the `McpToolRegistrationService` (or language equivalent) into the
agent code per the reference.

> **API note:** The correct method is `addToolServersToAgent()` (or language
> equivalent). There is no `getTools()` method on `McpToolRegistrationService`.
> Always verify the actual API surface from the reference docs — do not guess
> method names.

> **Python + Microsoft Agent Framework only — agent class check.** The
> SDK's `add_tool_servers_to_agent(...)` returns a **`RawAgent`** by design.
> Do NOT rewrap it with `Agent(...)` / `chat_client.as_agent(...)` on the
> MCP path — `Agent`'s telemetry layer emits spans outside `BaggageBuilder`
> and breaks A365 trace export. (`Agent` is fine in the
> `DISABLE_MCP_TOOLS=true` fallback branch only.) Quick verify:
> `python -c "import inspect; from microsoft_agents_a365.tooling.extensions.agentframework.services.mcp_tool_registration_service import McpToolRegistrationService; print(inspect.signature(McpToolRegistrationService.add_tool_servers_to_agent).return_annotation)"`
> must print `RawAgent`.

The MCP permissions were already granted as part of Phase 9
(`a365 setup all --aiteammate`); no separate `a365 setup permissions mcp`
run is needed here.

### Fetch the local-development MCP bearer tokens

For local runs (Phase 12 `a365 validate` and any manual smoke tests), the
agent needs a delegated MCP token per server because it isn't yet receiving
real user OBO tokens from Teams. Run:

```bash
a365 develop get-token
```

This command reads `ToolingManifest.json` and **automatically stamps**
`BEARER_TOKEN_MCP_<SERVER>=<token>` lines into the local env file (e.g.
`BEARER_TOKEN_MCP_MAILTOOLS=eyJ0eXAi...`) — one per MCP server in the
manifest. No manual copy/paste is needed.

Make sure the env file already contains the matching **empty** placeholders
before running `get-token` so the scaffolded code knows which vars to read.
Add one `BEARER_TOKEN_MCP_<SERVER>=` line per entry in
`ToolingManifest.json` (uppercase the server short name, strip the `mcp_`
prefix). Example for a manifest with `mcp_MailTools` and `mcp_W365ComputerUse`:

```
BEARER_TOKEN_MCP_MAILTOOLS=
BEARER_TOKEN_MCP_W365COMPUTERUSE=
```

The tokens are short-lived. If local validation later fails with a 401 from
an MCP endpoint, just re-run `a365 develop get-token` — it overwrites the
existing stamped values in place. This step is **not** required for Phase
14 tenant validation; real Teams traffic supplies the OBO token at runtime.

Build to confirm the wiring compiles.

---

## Phase 12 — Local validation loop (`a365 validate`)

> **Validate report reference:** [`references/validate-report.example.json`](./references/validate-report.example.json)

This phase replaces the old build-and-poke-AgentsPlayground step. The
`a365 validate` command builds, boots, and locally exercises the agent in
one shot and returns a structured JSON report describing every tier that
ran.

### 12.1 — Run validate

From the agent project root:

```bash
a365 validate
```

Capture the JSON written to `validate-report.json`. Its shape matches
[`references/validate-report.example.json`](./references/validate-report.example.json):

```jsonc
{
  "agent":   { "path": "...", "language": "dotnet | python | typescript" },
  "tiers": {
    "structural":   { "checks": [ { "name": "...", "ok": true, "message": "..." } ], "ok": true },
    "build":        { "log": "...", "exitCode": 0, "ok": true },
    "boot":         { "port": 5000, "bootMs": 1639, "ok": true },
    "conversation": { "skipped": true, "reason": "..." } | { "ok": true | false, ... },
    "telemetry":    { ... },
    "blueprint":    { ... },
    "mac":          { ... },
    "m365":         { ... },
    "judge":        { ... }
  },
  "repair":  { ... },
  "summary": { "ok": true | false }
}
```

**Pass condition:** `summary.ok = true` AND every tier is either `ok = true`
or explicitly `skipped: true` with a known reason. A `skipped` tier is not
a failure — Phase 12 only requires local tiers (`structural`, `build`,
`boot`, and `conversation` when present) to be passing.

### 12.2 — Iterative fix loop

If `summary.ok = false`, walk `tiers` in order and address the **first**
tier where `ok = false`:

- `tiers.structural.ok = false` → inspect `checks[]` for the failing
  `name` (e.g. `config-exists`, `config-format`, `config-schema`,
  `tooling-manifest`); fix the named file or wiring.
- `tiers.build.ok = false` → inspect `tiers.build.log` for the compiler /
  package-manager error; fix the code or `*.csproj` / `package.json` /
  `pyproject.toml`. Cross-reference against
  `researchedVersions` (Phase 7.5) if a package version is the cause.
- `tiers.boot.ok = false` → confirm the agent listens on port **5000**
  (the `a365 validate` harness expects port 5000 for all languages —
  .NET, Python, and Node.js). Set `PORT=5000` (or
  `ASPNETCORE_URLS=http://0.0.0.0:5000` for .NET) in the env file.
  Inspect agent stdout for startup exceptions; confirm env vars from
  Phase 8 (names from `researchedVersions.modelProvider.envVars`) are
  set in both env files.
  If `pip install` / `python -m compileall` took >60s on first run, the
  30-second health-check window can fire before the agent is ready —
  simply re-run `a365 validate` (subsequent runs reuse the installed
  packages and start in ~5s).
- `tiers.conversation.ok = false` → if reachable, the issue is in the
  message handler or LLM client; consult the **diagnostic pattern table
  in Phase 14.3** for log-symptom-to-fix mappings. If the log shows a 401
  from `https://agent365.svc.cloud.microsoft/agents/servers/mcp_*`, the
  local MCP bearer tokens have expired — re-run `a365 develop get-token`
  to re-stamp fresh `BEARER_TOKEN_MCP_*` values into the env file, then
  restart the agent and re-validate.
- `tiers.telemetry.ok = false` → confirm `InvokeAgentScope`,
  `InferenceScope` (or LLM client `.UseOpenTelemetry()` auto-instrumentation),
  and `ExecuteToolScope` (or MCP tool dispatch auto-instrumentation) are
  all wired — the validator requires all three `gen_ai.operation.name`
  values (`invoke_agent`, `chat`, `execute_tool`) to appear. Also set
  `OTEL_SERVICE_NAME=<agent-name>` in `.env` so `service.name` lands in
  the resource block.

After applying a fix, re-run `a365 validate` and re-evaluate the report.
**Do not skip ahead** — stay in this loop until `summary.ok = true`.

### 12.3 — HARD GATE

Do not move to Phase 13 until `a365 validate` returns `summary.ok = true`
with no unexplained `ok: false` tiers.

---

## Phase 13 — Publish + devtunnel + Teams Developer Portal (manual hand-off)

Once Phase 12 passes locally, prepare the agent for live tenant traffic.
Walk the user through these steps **in order**, asking them to confirm
each before continuing:

### 13.0 — Switch to production auth mode (CRITICAL for devtunnel)

Before publishing or starting the devtunnel, the agent **must** run with
production auth enabled. The scaffolded code gates auth loading and network
binding behind an environment flag — in development mode, auth is disabled
(agent has no identity) and the server may bind only to localhost (unreachable
by devtunnel).

Set the production environment flag in the local override env file:
- **Node.js / TypeScript:** `NODE_ENV=production` in `.env.local`
- **Python:** `PYTHON_ENVIRONMENT=production` (or equivalent) in `.env.local`
- **.NET:** `ASPNETCORE_ENVIRONMENT=Production` in `appsettings.Development.json` or launch profile

After setting this, **restart the agent** and verify the startup banner shows:
1. ✅ The agent's `appId` / `clientId` matches the blueprint ID (NOT `undefined` / empty)
2. ✅ Server binds to `0.0.0.0` (NOT `127.0.0.1` — devtunnel cannot reach localhost-only)
3. ✅ Auth handler active (NOT "running anonymous")

If `appId` is undefined/empty: the service connection env vars are missing or
the local override file has empty `KEY=` lines shadowing the production values
(see the dotenv load-order pitfall in Phase 8). Fix before continuing.

Do NOT proceed to the devtunnel steps until all three checks pass.

---

1. **Publish the agent**

   ```bash
   a365 publish
   ```

   This packages `manifest.zip` (or `appPackage.zip` for Teams Toolkit).
   `publish` does NOT upload to MAC and does NOT touch the bot endpoint —
   both are manual steps below. If publish fails on auth, offer the
   sideload fallback documented in the `make-ai-teammate` reference.

2. **Create a devtunnel**

   ```bash
   devtunnel create --allow-anonymous
   devtunnel port create -p 5000   # all languages use port 5000
   devtunnel host
   ```

   Capture the public HTTPS URL.

3. **Upload the manifest zip to the Microsoft Admin Center (MAC)**

   Tell the user (manual step in MAC — the CLI does NOT do this):

   > Open the [Microsoft 365 Admin Center](https://admin.cloud.microsoft) →
   > **Integrated apps** → **Upload custom apps** → upload the
   > `manifest.zip` produced by `a365 publish`.

4. **Set the messaging endpoint in Teams Developer Portal**

   Read `agentBlueprintId` from `a365.generated.config.json` and construct
   the direct configuration URL:

   ```
   https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration
   ```

   Tell the user:

   > Open the link above (deep-links straight to your agent blueprint's
   > **Configuration** page) → set **Agent Type** to **API Based** →
   > set **Notification URL** / **Endpoint address** to
   > `<devtunnel-url>/api/messages` and save. This is required for Teams
   > to deliver messages to your agent.

5. **Create an agent instance through Teams**

   > In Microsoft Teams → **Apps** → find your published agent → add it
   > to your account. If admin approval is required, request it from the
   > Teams Apps page and wait for an admin to approve in
   > [admin.cloud.microsoft](https://admin.cloud.microsoft).

### 13.x — WAIT FOR USER CONFIRMATION

After listing the five steps, **stop and explicitly ask** the user to
confirm:

> Have you completed all five steps above (publish, devtunnel host,
> MAC upload, Teams Dev Portal endpoint set to `<devtunnel-url>/api/messages`,
> and agent instance created/approved in Teams)?

**Do NOT proceed to Phase 14 until the user answers "yes" to all of them.**
If they say no, ask which steps are pending and wait. The next phase
(`a365 validate --with-tenant`) requires the agent to be reachable from
Teams via the devtunnel, so these manual steps are a hard prerequisite.

Before triggering Phase 14, restart the agent + devtunnel host (still in
the foreground) so the agent is live on the URL the user just configured
in the Dev Portal.

---

## Phase 14 — Tenant validation loop (`a365 validate --with-tenant`)

By this point the agent is published, MAC-uploaded, devtunnel-hosted, the
Teams Dev Portal endpoint matches the devtunnel URL, and the agent
instance exists in Teams. Now exercise it against the real tenant.

### 14.0 — Crank up logging

Make every signal visible before tenant validation starts. Update the
**production** env file (`.env` for Python/Node.js, `appsettings.json` for .NET)
to the values below. These are intentionally noisy — they're for debugging,
not steady-state operation. They'll be quieted in Phase 14.4 once
validation passes.

**Python / Node.js (`.env`):**
```
ENABLE_A365_OBSERVABILITY_EXPORTER=true
ENABLE_A365_OBSERVABILITY=true            # Python: required second flag
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error
OTEL_LOG_LEVEL=Debug
LOG_LEVEL=DEBUG                           # or PYTHON_ENVIRONMENT=development
```

**.NET (`appsettings.json` Logging:LogLevel block):**
```jsonc
{
  "EnableAgent365Exporter": true,
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.Agents.A365.Observability": "Debug",
      "OpenTelemetry": "Debug"
    }
  }
}
```

If this is a fresh devtunnel session and the agent process is still running
from Phase 12/13, **restart it** so the new env vars take effect. Confirm
startup banner contains:
- ✅ `appId` / `clientId` shows the blueprint ID (NOT `undefined` / empty)
- ✅ Bound to `0.0.0.0` (NOT `127.0.0.1` — devtunnel can't reach localhost-only)
- ✅ A365 observability configured (SDK-native or distro)
- 🔐 Auth handler in use (e.g. `AGENTIC`) — NOT "running anonymous"

### 14.1 — Sanity checks

Before running the tenant-validate command, confirm the tunnel is live:

```powershell
# Agent should respond on health
Invoke-WebRequest http://localhost:5000/api/health   # → 200

# Tunnel should forward
Invoke-WebRequest https://<devtunnel-url>/api/health # → 200

# Messages endpoint should require JWT (NOT anonymous)
Invoke-WebRequest -Method POST -Uri http://localhost:5000/api/messages -Body '{}'
# → 401 expected
```

If any of these fail, fix the plumbing before continuing — do not invoke
`a365 validate --with-tenant` against a broken endpoint.

### 14.2 — Run tenant validate

```bash
a365 validate --with-tenant
```

This exercises the agent with real Teams + email traffic via the
devtunnel. The output JSON has the same shape as Phase 12 but with the
tenant-dependent tiers (`conversation`, `telemetry`, `blueprint`, `mac`,
`m365`, `judge`) actually executed rather than `skipped`.

**Pass condition:** `summary.ok = true` with `tiers.conversation.ok`,
`tiers.telemetry.ok`, `tiers.m365.ok` (and any other non-`skipped` tier)
all `true`.

### 14.3 — Common failure patterns and fixes

When a tenant-validate tier fails, cross-reference the agent's tail log
with the table below to identify the root cause, then apply the fix and
re-run `a365 validate --with-tenant`. This table is also the right
reference for Phase 12 `tiers.conversation.ok = false` failures when the
local conversation tier is exercised.

| Symptom in log | Likely cause | Fix |
|---|---|---|
| `WARNING ... ⚠️ No auth env vars; running anonymous` | `AUTH_HANDLER_NAME` empty in `.env.local` overriding `.env` (dotenv load-order pitfall — see Phase 8) | Either delete the empty `KEY=` line in `.env.local` or set `AUTH_HANDLER_NAME=AGENTIC` there. Same for `CLIENT_ID`/`TENANT_ID`/`CLIENT_SECRET`. Restart. |
| User sees `Got it — working on it…` but no follow-up | Stuck tool / MCP call in `agent.run()` | Set `DISABLE_MCP_TOOLS=true` in `.env`, restart, retest. If now works → MCP server is the cause; debug separately. Also confirm `AGENT_RUN_TIMEOUT_SECONDS` is wired so future stalls produce a user-facing timeout instead of silence. |
| `httpx: POST https://agent365.svc.cloud.microsoft/agents/servers/mcp_* HTTP/1.1 401` (or any 4xx) — agent reply contains `Failed to enter context manager ... HTTPStatusError("Client error '401 Unauthorized' for url 'https://agent365.svc.cloud.microsoft/agents/servers/mcp_*')` | Local-dev MCP bearer token in `.env` (e.g. `BEARER_TOKEN_MCP_MAILTOOLS`) has expired — they're short-lived | First, re-run `a365 develop get-token` to re-stamp every `BEARER_TOKEN_MCP_<SERVER>=…` value in `.env`, restart the agent, and re-validate. If 401s persist, confirm `a365 develop list-available` succeeds and re-run `a365 setup permissions mcp`. Use `DISABLE_MCP_TOOLS=true` to unblock the user while debugging. |
| Boot: `AttributeError: type object 'MsalConnectionManager' has no attribute 'from_environment'` | Older scaffold used a method that doesn't exist on the current SDK | Replace with `MsalConnectionManager(**load_configuration_from_env(os.environ))` (Python) — import `load_configuration_from_env` from `microsoft_agents.activity`. |
| Boot: `AttributeError: 'CloudAdapter' object has no attribute 'on_activity'` | Activity decorators were placed on the adapter; they belong on `AgentApplication` | Construct `AgentApplication[TurnState](storage=MemoryStorage(), adapter=adapter, authorization=auth)`, move all `@adapter.on_activity(...)` decorators to `@app.activity(...)` on that instance, and route POST `/api/messages` through `start_agent_process(request, app, adapter)` instead of `adapter.process(request)`. |
| Boot: `AttributeError: module 'microsoft_agents_a365.notifications' has no attribute 'on_agent_notification'` (or `'agent_notification' has no attribute …`) | `AgentNotification` was used as a module, not a class | Import the class: `from microsoft_agents_a365.notifications import AgentNotification`. Instantiate as `notifications = AgentNotification(app)`, then decorate handlers with `@notifications.on_agent_notification(channel_id=ChannelId(...))`. |
| `Conversation` tier: agent reply contains `'dict' object has no attribute 'channel_id' and no __dict__ for setting new attributes` | A handler called `context.send_activity({"type": "typing"})` — `send_activity` requires an `Activity`, not a dict | Replace every `send_activity({"type": "typing"})` with `send_activity(Activity(type=ActivityTypes.typing))` (import `Activity, ActivityTypes` from `microsoft_agents.activity`). `AgentApplication` already emits a built-in typing indicator, so the manual sends can also simply be deleted. |
| Repeated `📬 NotificationTypes.AGENT_LIFECYCLE` followed by `connector_client: Error replying to activity: 502` storm; user message turn hangs for minutes | AGENT_LIFECYCLE retry storm starving the event loop because dedupe runs *after* `await` calls | Confirm Phase 8 lifecycle handler does its dedupe **before any await**. Confirm `_SuppressLifecycleConnectorErrors` filter is registered. The 502s on `agentOnboarding` are expected; they should be silently dropped. |
| `'AgentNotificationActivity' object has no attribute 'text'` in lifecycle path | Generic notification handler accessed `.text` on a lifecycle activity | Confirm Phase 8 routes `NotificationTypes.AGENT_LIFECYCLE` to the dedicated Graph manager-greeting helper instead of the generic dispatch. |
| `microsoft.opentelemetry.a365.core.exporters.agent365_exporter: No spans with tenant/agent identity found; nothing exported.` | Spans being created outside `BaggageBuilder` context, OR using raw HTTP (aiohttp/requests) which OTel doesn't auto-instrument | Confirm `BaggageBuilder().tenant_id(...).agent_id(...).build()` wraps the message handler. For onboarding/Graph calls, wrap each step in an explicit `tracer.start_as_current_span(...)`. |
| (Python + Agent Framework) Duplicate `agent.run` / `invoke_agent` spans in the same trace, or A365 exporter drops MCP-turn spans even though `BaggageBuilder` wraps the handler | MCP path wraps the SDK's `RawAgent` with `Agent(...)` / `chat_client.as_agent(...)`, so `AgentTelemetryLayer` emits an extra span outside the baggage scope | Return the `RawAgent` from `add_tool_servers_to_agent(...)` directly — no rewrapping. `Agent` is only allowed on the `DISABLE_MCP_TOOLS=true` fallback branch. See Phase 11 agent-class check. |
| Spans appear to run but exporter says nothing exported (Python only) | Missing `ENABLE_A365_OBSERVABILITY=true` env var | Add it. Without this second flag, scopes are no-ops even though `configure()` succeeded. |
| Exporter `HTTP 401 ... Correlation ID: ...` | OBO token missing or wrong audience; OR `OtelWrite` role not granted to Agent Identity SP | Confirm per-turn `auth.exchange_token(scopes=get_observability_authentication_scope(), auth_handler_id=...)` runs and caches. If still 401, follow the `Agent365.Observability.OtelWrite` Global Admin grant from `instrument-observability/SKILL.md` "S2S Known Issues". |
| Exporter logs `Agent365Exporter] 1 spans skipped due to missing tenant or agent ID` followed by `No eligible genAI spans to export; nothing exported.` | `recipient.tenant_id` / `recipient.agentic_app_id` are empty on the incoming activity (very common under `a365 validate` anonymous mode), and the resolver had no env fallback | Confirm `a365 setup all --aiteammate` stamped `AGENT365OBSERVABILITY__TENANTID` and `AGENT365OBSERVABILITY__AGENTID` into `.env`/`appsettings.json`, and that `extract_agent_identity()` falls back to them when the recipient fields are empty. Use the namespaced `AGENT365OBSERVABILITY__*` names — plain `TENANT_ID` is overwritten with empty by the validator harness. See Phase 10 "Identity sources" table. |
| Exporter `HTTP 400 ... TenantIdInvalid` (response body literally says `"Tenant id  is invalid."`) with the URL already containing the correct tenant GUID | Server validates tenant from the **OBO token claims**, not the URL; no token = empty tenant claim = 400. This is the anonymous-validate ceiling — there is no signed-in user to mint an OBO token | Expected when running `a365 validate` without `--with-tenant`. The telemetry tier cannot pass in anonymous local mode for AI Teammates (`client_credentials` is blocked by Entra with `AADSTS82001` for agentic apps). Confirm `AGENT365OBSERVABILITY__TENANTID` is set so the URL is correct, then validate telemetry under `a365 validate --with-tenant` (Phase 14) where Teams provides a real user OBO token. |
| Telemetry shows the wrong blueprint — every install gets a different blueprint id | Using `recipient.agentic_app_id` for `agent_blueprint_id` (per-install instance, not blueprint) | Read `AGENT365OBSERVABILITY__AGENTBLUEPRINTID` from env (stamped by `a365 setup all --aiteammate`). See Phase 10 "Identity sources" table. |
| Exporter logs `invoke_agent` spans only — no sibling `inference` or `execute_tool` spans in the same trace (rule `store_publishing_scopes_present`) | LLM call or tool dispatch isn't wrapped in `InferenceScope` / `ExecuteToolScope` | `InvokeAgentScope` is present but no `InferenceScope` or `ExecuteToolScope` was found in the same trace. Both are required for store publishing — see `instrument-observability` Phase 5.5. |
| S2S exporter posts succeed (`HTTP 200`) but nothing surfaces in the MAC portal; trace has no `microsoft.a365.caller.*` / `gen_ai.caller.*` attributes (rule `s2s_caller_details_required`) | `CallerDetails` not passed to `InvokeAgentScope.Start()` | S2S agents must populate `CallerDetails` on `InvokeAgentScope.Start()`; without it, traces reach the API (200) but stay invisible in the MAC portal. |
| Exporter URL contains `/observability/` instead of `/observabilityService/` (rule `s2s_endpoint_path`) | S2S endpoint flag not set | S2S agent posted to `/observability/` instead of `/observabilityService/` — set `Agent365.Exporter.UseS2SEndpoint=true` (.NET) or `AGENT365_USE_S2S_ENDPOINT=true` (Node.js). |
| Exported spans missing `service.name` resource attribute (rule `resource_service_name_present`) | Resource not configured at OTel init | `service.name` resource attribute is missing — set `SERVICE_NAME` (Node.js/Python) or `use_microsoft_opentelemetry(service_name=...)`. |
| Log shows `Span has parentSpanId X but parent not found in trace` (rule `parent_span_resolution`) | Parent emit lost or parent context broken | Span has `parentSpanId` but no matching parent in the same trace's captures — likely the parent emit was lost or the agent broke the parent context. |
| `gen_ai.conversation.id` differs across spans within the same trace (rule `conversation_id_consistency`) | Baggage propagation broken | `gen_ai.conversation.id` differs across spans within one trace — baggage propagation likely broken; check `BaggageBuilder` usage in the message handler. |
| Non-root span missing `microsoft.a365.agent.id` / `microsoft.a365.tenant.id` baggage (rule `baggage_propagation`) | Baggage set on InvokeAgent but not propagated to children | Required baggage keys missing on a non-root span — baggage was set on the InvokeAgent but not propagated to children. Confirm `BaggageBuilder.run()` wraps the entire handler body. |
| Exporter URL path contains `/otlp/` (rule `otlp_path_canonical`) | Known Node.js / .NET SDK bug | URL contains `/otlp/` — Node.js / .NET SDK bug. Status: pending SDK fix; no client-side workaround is correct. |
| `microsoft.a365.exporter.token_aud` ≠ `api://9b975845-388f-4429-889e-eab1ef63949c/.default` (rule `fmi_token_audience`) | Wrong FMI token audience | FMI token audience does not match the Observability API scope — token may be rejected by the gateway. |
| `inference` span start time precedes its parent `invoke_agent` start (rule `scope_ordering`) | Scope opened outside the parent's using-block, or clock skew | Child scope start time precedes its parent `InvokeAgent` start — likely a clock skew or the scope was opened outside the parent's using-block. |
| `UnicodeEncodeError: 'charmap' codec can't encode character '\\U0001f527'` (Windows + Python only) | Default `cp1252` stdout can't render emoji in log messages | Run with `python -X utf8` (or set `PYTHONUTF8=1`). |
| Agent crashes silently on start with no error in tunnel logs | stdout/stderr swallowed by detached host | Run the agent in the foreground for one round to capture the traceback, then re-detach once fixed. |
| JWT / auth middleware errors when invoking the agent from Teams | Real tenant validation requires real auth — bypassing it is wrong here | Do **not** set `BYPASS_AUTH=true` for tenant validation; that's a local-only escape hatch. Confirm `AUTH_HANDLER_NAME=AGENTIC`, `CLIENT_ID`, `TENANT_ID`, `CLIENT_SECRET` are populated in `.env`, and re-run `a365 validate --with-tenant`. |

### 14.3a — Tenant validate loop

After applying a fix from 14.3, **restart the agent** so the change takes
effect, then re-run:

```bash
a365 validate --with-tenant
```

Stay in this loop — fix the first failing tier, restart, re-validate —
until `summary.ok = true`. Do not bail after a single round.

### 14.4 — Quiet things back down

Once `a365 validate --with-tenant` returns `summary.ok = true`, restore
quieter log levels for steady-state operation:

```
A365_OBSERVABILITY_LOG_LEVEL=info|warn|error  # must include all three pipe-separated
OTEL_LOG_LEVEL=Info
LOG_LEVEL=INFO
```

Leave `ENABLE_A365_OBSERVABILITY_EXPORTER=true` and (Python only)
`ENABLE_A365_OBSERVABILITY=true` — those are correct for production.

### 14.5 — Final confirmation + summary

Explicitly ask the user:

> `a365 validate --with-tenant` is passing end-to-end. Are you ready
> to deploy this agent to production?

When they confirm, output a final summary listing:
- agent name, language, framework, model provider
- MCP servers wired
- blueprint ID
- devtunnel URL (and a reminder to swap for a real cloud endpoint when deploying)
- Teams Dev Portal endpoint
- which tiers `a365 validate --with-tenant` exercised (`conversation`,
  `telemetry`, `m365`, etc.)

…then end the skill.

