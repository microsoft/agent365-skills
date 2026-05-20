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
  WorkIQ tool wiring (add-workiq-tools), local AgentsPlayground test (test-local), A365
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
        10. Build + local AgentsPlayground test ran AND the agent responded
            successfully to at least one message before continuing past Phase 11.
        11. `a365 setup all --aiteammate` (with blueprint) completed; user was then
            walked through publish + devtunnel + Teams Dev Portal endpoint + create
            agent instance + devtunnel test.
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
> `instrument-observability`, `add-workiq-tools`, `test-local`, and `a365-setup` —
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

---

## Phase 0 — Intro + task list

Output this intro to the user verbatim:

```
I'll build you a new Agent 365 AI Teammate from scratch. Here's the plan:

  1. Sign in to Azure
  2. Make sure the A365 CLI is installed
  3. Confirm what your agent should do, the MCP servers it needs, and your
     language / framework / model provider
  4. Look up the latest stable docs and package versions for that stack on
     the web, so the scaffold uses current SDKs
  5. Scaffold the agent project (with notification handlers, plus an
     AGENT_LIFECYCLE handler that introduces your AI Teammate to the user's
     manager via Microsoft Graph on first install) and create two env files
     for credentials
  6. Pause so you can paste in your model credentials
  7. Wire observability and WorkIQ MCP tools
  8. Build, run locally, and verify it responds in AgentsPlayground
  9. Run `a365 setup all --aiteammate`, then walk through publish, devtunnel,
     and Teams Developer Portal endpoint setup
  10. Iteratively test end-to-end through the devtunnel: crank up logging,
      send Teams/email messages, monitor logs, and debug until the experience
      is good

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
AI Teammates by `a365 setup all --aiteammate` in Phase 12.

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
> - Other

Record as `language`. If the user picks **Other**, prompt for the freeform
value and set `languageIsCustom = true`. Warn briefly:

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
> - **Other**

If not inferable, ask with the filtered list as `choices`. Record as
`framework`. If the user picks **Other**, prompt for the freeform value and
set `frameworkIsCustom = true`. Warn briefly:

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
> - Other

Record as `modelProvider`. If the user picks **Direct API key**, prompt for
the provider name and the env-var name holding the key. If the user picks
**Other**, prompt for the freeform value and set `modelProviderIsCustom =
true`; ask which env vars its SDK expects so Phase 8 can wire them
correctly.Use this to pick the correct env-var names in
Phase 8 (e.g. `AZURE_OPENAI_*`, `AWS_*` + `BEDROCK_*`, `ANTHROPIC_API_KEY`,
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
this for **every** orchestration framework — including curated, "Other", and
custom (`frameworkIsCustom = true`) selections. The reference markdown under
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
   (TypeScript) / `microsoft-opentelemetry` (Python). Used by Phase 9.
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
1. HTTP host with `/api/messages` and `/api/health`.
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

After scaffolding finishes, **pause** and tell the user:

> The agent is scaffolded. Open both `<file-1>` and `<file-2>` and add your
> model credentials (API key, endpoint, deployment name, etc.). Reply when
> you've added them to both files and we'll continue.

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

## Phase 9 — Instrument observability

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
| `tenant_id` | `recipient.tenant_id` (turn context) | Per-tenant, comes from incoming activity |
| `agent_id` (per-install instance) | `activity.get_agentic_instance_id()` → fallback `recipient.agentic_app_id` → fallback `AGENT_ID` env | Varies per installation/user. This IS the per-install app instance id |
| `agentic_user_id` | `recipient.agentic_user_id` (turn context) | The agentic user identity for the install |
| `agent_blueprint_id` | **`AGENT365_BLUEPRINT_ID` env var** (or `AGENT365OBSERVABILITY__AGENTBLUEPRINTID`) — populated from `a365.generated.config.json` by `a365 setup all --aiteammate` | **Stable** per agent registration. Do **NOT** use `recipient.agentic_app_id` — that's the per-install instance, not the blueprint. |
| `agent_name` / `agent_description` | `AGENT365_AGENT_NAME` / `AGENT365_AGENT_DESCRIPTION` env vars | From `.env` populated by `a365 setup` |

Make sure the scaffolded `turn_context_utils` (or language equivalent)
reads `agent_blueprint_id` from the env var, **not** from `recipient`.

### Prefer manual instrumentation (default) — opt-in to auto-instrumentation

**Default path: SDK-native manual instrumentation.** Do **not** use the
unified OpenTelemetry distro (`use_microsoft_opentelemetry` / `useMicrosoftOpenTelemetry` /
`UseMicrosoftOpenTelemetry`) unless the user explicitly requests
auto-instrumentation. Instead, wire the A365 SDK directly:

| Language     | Manual setup call (replace the distro's `use_*` call)                                                  |
|--------------|--------------------------------------------------------------------------------------------------------|
| Python       | `from microsoft_agents_a365.observability.core.config import configure` → `configure(service_name=..., service_namespace=..., token_resolver=...)` once at startup |
| Node.js      | Use `ObservabilityManager` from `@microsoft/agents-a365-observability` directly (skip `@microsoft/opentelemetry`) |
| C# / .NET    | `builder.Services.AddAgenticTracingExporter()` + `builder.AddA365Tracing()` (skip `UseMicrosoftOpenTelemetry`) |

Pass a `token_resolver` that reads from your in-memory token cache (the
per-turn `auth.exchange_token` call populates it).

**Manual scopes are the contract.** Wrap the message handler explicitly:
- `InvokeAgentScope.start(request, scope_details, agent_details, caller_details)` — the parent for the whole agent invocation. Pass `CallerDetails` (signed-in user for OBO; Blueprint sponsor for S2S/autonomous) — **required** for traces to appear in the MAC portal.
- `InferenceScope.start(request, inference_details, agent_details)` — wraps each LLM call (model, provider, optional token counts).
- `ExecuteToolScope.start(request, tool_details, agent_details)` — wraps each tool call.
- All three scopes are **required for store publishing**. Use `.start()` factories (context-managers) — not constructors.

For helper utilities that extract identity from `TurnContext` and build
`AgentDetails` / `CallerDetails` / `Request` objects, scaffold a small
`turn_context_utils.py` (or language equivalent) so the message handler is
not cluttered with boilerplate.

**Auto-instrumentation (only on explicit request).** If the user asks for
auto-instrumentation by name (e.g. "use the OpenTelemetry distro" / "wire up
auto-instrumentation"), follow the reference's "Unified Distro" sections
instead. Auto-instrumentation buys broader framework coverage at the cost of
an extra dependency and an extra magic layer.

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
A365_OBSERVABILITY_LOG_LEVEL=info
OTEL_LOG_LEVEL=Debug
```

If the reference template suggests `ENABLE_A365_OBSERVABILITY_EXPORTER=false`,
override it to `true` here. (.NET samples don't use these env vars — the
exporter is wired in code via `ExportTarget.Agent365` and log levels live in
`appsettings.json`.)

> **Don't pin the observability logger below the env var.** Wire your host so
> that the `microsoft_agents_a365.observability` (Python) /
> `@microsoft/agents-a365-observability` (Node.js) /
> `Microsoft.Agents.A365.Observability` (.NET) logger reads its level from
> `A365_OBSERVABILITY_LOG_LEVEL`. Hardcoding to `ERROR` makes "is observability
> working?" unanswerable in Phase 14 because success messages live at INFO/DEBUG.

Build at the end to confirm no compile errors.

---

## Phase 10 — Add WorkIQ MCP tools

> **Reference:** `${AGENT365_SKILLS}/plugins/agent365/skills/add-workiq-tools/SKILL.md`
> and the matching language file under `references/`.

**Skip every question** — reuse `mcpServers` from Phase 4. The selection has
already been added to `ToolingManifest.json`, so this phase is mostly about
wiring the `McpToolRegistrationService` (or language equivalent) into the
agent code per the reference.

Inform the user about the permissions hand-off (`a365 setup permissions mcp`
or `a365 setup all`) and how to fetch a dev token (`a365 develop get-token`).
Do not run those — they will be run as part of Phase 12.

Build to confirm the wiring compiles.

---

## Phase 11 — Build + local test (HARD GATE)

> **Reference:** `${AGENT365_SKILLS}/plugins/agent365/skills/test-local/SKILL.md`

**Do NOT enter this phase until Phases 8, 9, AND 10 are all complete.**

1. Verify `agentsplayground` is installed; install if missing per the
   reference.
2. Build the agent (`dotnet build` / `npm run build` / `pip install -e .`).
3. Start the agent in the background.
4. Launch AgentsPlayground pointed at the local `/api/messages` endpoint.
5. Send a test message and **wait for a successful response**.

### Failure handling

If the agent does not respond, debug using the agent + playground output:

- Compile / import errors → fix the code, rebuild, retry.
- LLM client errors → re-check env-var values; remind the user to confirm
  credentials in **both** files from Phase 8.
- Tool registration errors → re-check `ToolingManifest.json` and Phase 10
  wiring.
- **JWT / auth middleware errors during local testing** are acceptable to
  bypass for local dev. Set the appropriate flag in the **dev** env file:

  | Language     | Variable to set in dev file                              |
  |--------------|----------------------------------------------------------|
  | C#           | `"TokenValidation": { "Enabled": false }` in `appsettings.Development.json` |
  | Python       | `BYPASS_AUTH=true` in `.env.local`                       |
  | TypeScript   | `BYPASS_AUTH=true` in `.env.local`                       |

  Then read the env var in the host startup and skip the JWT middleware when
  it's set. **This bypass is local-only — never set it in the production
  env file.**

**HARD GATE:** Do not move to Phase 12 until the user confirms the agent has
responded to a message in AgentsPlayground.

---

## Phase 12 — A365 setup (AI Teammate + blueprint)

> **Reference:** `${AGENT365_SKILLS}/plugins/agent365/skills/a365-setup/SKILL.md`

**Skip the detection and prerequisite-checking phases** — assume:
- `agentType` = AI Teammate
- All prerequisites already verified in Phases 1–2

Run:

```bash
a365 setup all --aiteammate
```

When complete, read `a365.generated.config.json` and confirm `agentBlueprintId`
is present. Show the Setup Summary table verbatim.

---

## Phase 13 — Publish + devtunnel + Teams Developer Portal

After setup completes, walk the user through these steps **in order**, asking
them to confirm each before continuing:

1. **Publish the agent**

   ```bash
   a365 publish
   ```

   If publish fails on auth, offer the sideload fallback documented in the
   `make-ai-teammate` reference.

2. **Create a devtunnel**

   ```bash
   devtunnel create --allow-anonymous
   devtunnel port create -p 3978   # or 5000 for .NET defaults
   devtunnel host
   ```

   Capture the public HTTPS URL.

3. **Set the messaging endpoint in Teams Developer Portal**

   Read `agentBlueprintId` from `a365.generated.config.json` and construct the
   direct configuration URL:

   ```
   https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration
   ```

   Tell the user:

   > Open the link above (it deep-links straight to your agent blueprint's
   > **Configuration** page) → set **Endpoint address** to
   > `<devtunnel-url>/api/messages` and save.

4. **Create an agent instance through the Teams store**

   > In the Microsoft 365 / Teams store, find your published agent and add
   > it to your account so it shows up as an installable AI Teammate.

When all four steps are confirmed, **proceed to Phase 14** for end-to-end
testing and iterative debugging via the live devtunnel.

---

## Phase 14 — Devtunnel testing + iterative debug loop

By this point: agent is published, devtunnel is hosting, the messaging
endpoint is set in the Teams Developer Portal, and the AI Teammate has been
hired in Teams. Now drive a tight feedback loop using live traffic.

### 14.0 — Crank up logging

Make every signal visible before the first test message. Update the
**production** env file (`.env` for Python/Node.js, `appsettings.json` for .NET)
to the values below. These are intentionally noisy — they're for debugging,
not steady-state operation. Tell the user we'll quiet them back down when
the agent is verified.

**Python / Node.js (`.env`):**
```
ENABLE_A365_OBSERVABILITY_EXPORTER=true
ENABLE_A365_OBSERVABILITY=true            # Python: required second flag
A365_OBSERVABILITY_LOG_LEVEL=info
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
from Phase 11/13, **restart it** so the new env vars take effect. Confirm
startup banner contains:
- ✅ A365 observability configured (SDK-native or distro)
- 🔐 Auth handler in use (e.g. `AGENTIC`) — NOT "running anonymous"

### 14.1 — Sanity checks

Before involving Teams, verify the local agent and the tunnel:

```powershell
# Agent should respond on health
Invoke-WebRequest http://localhost:3978/api/health   # → 200

# Tunnel should forward
Invoke-WebRequest https://<devtunnel-url>/api/health # → 200

# Messages endpoint should require JWT (NOT anonymous)
Invoke-WebRequest -Method POST -Uri http://localhost:3978/api/messages -Body '{}'
# → 401 expected
```

If any of these fail, do NOT ask the user to send messages yet — fix the
plumbing first.

### 14.2 — Iterative test loop

Run the loop below until the user confirms the experience is good. Stay in
the loop on each round; don't bail after a single message.

1. **Prompt the user** for ONE specific test action, e.g.:
   - "Send a message in Teams: `hey` (verifies basic round-trip)"
   - "Send a message that needs a tool: `summarize my latest email` (verifies MCP)"
   - "Send yourself an email (verifies AGENT_LIFECYCLE / EMAIL_NOTIFICATION)"
   - "Uninstall + reinstall the agent (verifies onboarding greeting fires)"

2. **Wait** for the user to confirm they've sent it.

3. **Tail the agent log.** Pull the last ~100 lines, filter out the noise
   (`Acquir`/`Attempting`/`Retrieving` MSAL chatter, `Replying to activity`
   typing indicators, `aiohttp.access` health pings) and look for:
   - `📨 <message>` — confirms the user's text actually reached the handler
   - `Turn from user — DisplayName: ...` — confirms `process_user_message`
     was entered
   - `httpx: HTTP Request: POST https://<your-llm>... HTTP/1.1 200 OK` — LLM call
   - `Token resolved successfully for agent <agentId>` — observability auth
   - `HTTP 200 success on attempt 1` (or any 4xx/5xx with correlation id)
     from the A365 exporter
   - `Reply to conversation/activity: <id>, <id>` — final reply emitted

4. **Diagnose using the patterns below.**

5. **Apply a fix**, restart the agent, then return to step 1 with a message
   targeted at the same scenario.

### 14.3 — Common failure patterns and fixes

| Symptom in log | Likely cause | Fix |
|---|---|---|
| `WARNING ... ⚠️ No auth env vars; running anonymous` | `AUTH_HANDLER_NAME` empty in `.env.local` overriding `.env` (dotenv load-order pitfall — see Phase 8) | Either delete the empty `KEY=` line in `.env.local` or set `AUTH_HANDLER_NAME=AGENTIC` there. Same for `CLIENT_ID`/`TENANT_ID`/`CLIENT_SECRET`. Restart. |
| User sees `Got it — working on it…` but no follow-up | Stuck tool / MCP call in `agent.run()` | Set `DISABLE_MCP_TOOLS=true` in `.env`, restart, retest. If now works → MCP server is the cause; debug separately. Also confirm `AGENT_RUN_TIMEOUT_SECONDS` is wired so future stalls produce a user-facing timeout instead of silence. |
| `httpx: POST https://agent365.svc.cloud.microsoft/agents/servers/mcp_* HTTP/1.1 4xx` | WorkIQ MCP server rejected the agentic token | Confirm `a365 develop list-available` succeeds; re-run `a365 setup permissions mcp` if needed. Use `DISABLE_MCP_TOOLS=true` to unblock the user while debugging. |
| Repeated `📬 NotificationTypes.AGENT_LIFECYCLE` followed by `connector_client: Error replying to activity: 502` storm; user message turn hangs for minutes | AGENT_LIFECYCLE retry storm starving the event loop because dedupe runs *after* `await` calls | Confirm Phase 8 lifecycle handler does its dedupe **before any await**. Confirm `_SuppressLifecycleConnectorErrors` filter is registered. The 502s on `agentOnboarding` are expected; they should be silently dropped. |
| `'AgentNotificationActivity' object has no attribute 'text'` in lifecycle path | Generic notification handler accessed `.text` on a lifecycle activity | Confirm Phase 8 routes `NotificationTypes.AGENT_LIFECYCLE` to the dedicated Graph manager-greeting helper instead of the generic dispatch. |
| `microsoft.opentelemetry.a365.core.exporters.agent365_exporter: No spans with tenant/agent identity found; nothing exported.` | Spans being created outside `BaggageBuilder` context, OR using raw HTTP (aiohttp/requests) which OTel doesn't auto-instrument | Confirm `BaggageBuilder().tenant_id(...).agent_id(...).build()` wraps the message handler. For onboarding/Graph calls, wrap each step in an explicit `tracer.start_as_current_span(...)`. |
| Spans appear to run but exporter says nothing exported (Python only) | Missing `ENABLE_A365_OBSERVABILITY=true` env var | Add it. Without this second flag, scopes are no-ops even though `configure()` succeeded. |
| Exporter `HTTP 401 ... Correlation ID: ...` | OBO token missing or wrong audience; OR `OtelWrite` role not granted to Agent Identity SP | Confirm per-turn `auth.exchange_token(scopes=get_observability_authentication_scope(), auth_handler_id=...)` runs and caches. If still 401, follow the `Agent365.Observability.OtelWrite` Global Admin grant from `instrument-observability/SKILL.md` "S2S Known Issues". |
| Exporter `HTTP 400 ... TenantIdInvalid` | Wrong/empty `tenant_id` in `AgentDetails` | Confirm `tenant_id` comes from `recipient.tenant_id` (turn context), not env. |
| Telemetry shows the wrong blueprint — every install gets a different blueprint id | Using `recipient.agentic_app_id` for `agent_blueprint_id` (per-install instance, not blueprint) | Read `AGENT365_BLUEPRINT_ID` from env (populated by `a365 setup all --aiteammate`). See Phase 9 "Identity sources" table. |
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

### 14.4 — Quiet things back down

Once the user confirms the experience is good (round-trip works, observability
spans visible, manager onboarding greeting received), restore quieter levels:

```
A365_OBSERVABILITY_LOG_LEVEL=warn
OTEL_LOG_LEVEL=Info
LOG_LEVEL=INFO
```

Leave `ENABLE_A365_OBSERVABILITY_EXPORTER=true` and (Python only)
`ENABLE_A365_OBSERVABILITY=true` — those are correct for production.

### 14.5 — Final summary

Output a final summary listing:
- agent name, language, framework, model provider
- MCP servers wired
- blueprint ID
- devtunnel URL
- Teams Dev Portal endpoint
- which Phase 14 scenarios were verified (round-trip, MCP, EMAIL_NOTIFICATION,
  onboarding greeting)

…then end the skill.
