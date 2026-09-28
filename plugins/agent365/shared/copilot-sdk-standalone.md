# GitHub Copilot SDK: standalone onboarding spike

This is an **experimental standalone workflow**, not a new skill or a supported runtime adapter.
Use the existing `a365-setup` -> `make-a365-agent` -> `instrument-observability`
workflow. This reference takes precedence over their generic hosting, capability,
installation, authentication, and completion instructions for this route.

## 0. Detect before routing

Read the selected project's `package.json` on every invocation, **before trusting a
fresh detection cache**. An exact `@github/copilot-sdk` key in `dependencies` or
`devDependencies`, plus project TypeScript source (`.ts`, `.mts`, or `.cts`, excluding
declarations, dependencies, build outputs, and tests), identifies:

- `agentStack: "GitHub Copilot SDK"`
- `programmingLanguage: "NodeJS"`
- `agentType: "system-agent"`
- `usesTeamsOrCopilot: 0` for a standalone project

Check this dependency before LangChain/OpenAI/Claude heuristics. A mention in a
README, lockfile-only/transitive dependency, or a package named `copilot` is not
enough. In a monorepo select the actual agent package directory first; do not merge
signals from sibling apps. JavaScript-only projects are outside this TypeScript
spike: report that limitation, without falling back to generic Node.js wiring.

**GitHub Copilot is not Microsoft 365 Copilot.** Never infer CEA/AI Teammate intent
from this package's name. If actual Teams/CEA/AgentApplication, Digital Worker,
WorkIQ, or agentic-user markers conflict with the standalone intent, report the
conflict and stop before edits or commands that mutate anything. Do not delete
existing features, silently rewrite the cache, or auto-route to AI Teammate.

## 1. a365-setup: confirm scope and prerequisites

**Read-only/no-approval checkpoint:** this section replaces the generic skill
workflow, including its introduction promises, checklist, quick scan, and final
answer. If the request is read-only or approval is absent, inspect only permitted
files, report evidence and blockers using the check below, then stop. Do not run
the prerequisite commands below, write a cache, or offer generic installation,
login, or setup commands as the user's next step. Tool versions or source that
were not inspected are **not evaluated**, not missing. Listing an operator-owned
prerequisite is not authorization to acquire it.

For an approved run, show a visible checklist: detect/confirm, prerequisites/version review, registration
preview/approval, optional basic observability, local verification/report. Mark each
finished phase immediately; stop at the confirmations and unresolved prerequisites.

Confirm **standalone registration only** or **standalone registration + basic
observability**. These replace the normal four-option capability menu. Describe
S2S as the candidate non-user Agent 365 identity mode, not a change to GitHub Copilot
authentication. Confirm it explicitly; OBO/agentic-user is not implemented by this
spike. Preserve the existing SDK model, tools, prompts, CLI/service entry point,
session lifecycle, and hosting. Do not offer or create:

- AI Teammate, Digital Worker, Agent Template, Teams/M365 scaffolding or manifests;
- Agentic User, mailbox, license assignment, teammate provisioning or publishing;
- WorkIQ, MCP tool catalogs, notifications, `/api/messages`, AgentsPlayground,
  Express/CloudAdapter/AgentApplication, a dev tunnel, or a cloud deployment.

Before any code edit, write/merge `.a365-workspace-detection.local.json` only from
confirmed detection: the four values above, `authMode: "s2s"`, `capabilities`
(`["Register"]` or `["Register", "Observability"]`), `detectedAt`, existing blueprint
state/reuse decision, and actual composite state flags. Keep
`has_aiteammate_structure` and `has_workiq` false for the standalone route; conflicting
evidence is a blocker, not a value to erase. `has_obs` requires verified bootstrap,
identity/token resolver, and runtime scope wiring together, not a dependency or
entry-point symbol alone. Offline telemetry is not evidence of Agent 365 export.

Record explicit user decisions in `standaloneApprovals` inside that ignored cache:
`scope: true` and `s2s: true` only after those confirmations;
`registration: true` only after approval of the specific preview or reuse;
`observability: true` only after reviewing the companion source contract and
approving the specific local diff. Missing or false values do not grant permission.
Never infer approval from a dependency, existing config, or report-only result.
Reconfirm the relevant operation if its source, target, or proposed diff changes.
These local records document decisions; they are not live tenant authorization
or a security boundary against a process that can modify the cache.

The setup stop hook passes `--report-only` to allow ending an explicitly blocked
report without fabricating a cache. It returns `status: "report-only"`,
`operationAllowed: false`, and pending prerequisites; malformed or conflicting
existing state still fails. This is **not completed setup or permission to proceed**.
Direct setup validation without that flag requires confirmed scope/S2S metadata.
Provisioning and instrumentation never accept a report-only bypass: each requires
the confirmed cache and its own recorded approval, plus local config/wiring checks.
Standalone hooks do not run the generic CLI prerequisite or global-install checks.

Read-only prerequisite checks:

```text
node --version
npm --version
dotnet --version
a365 --version
a365 --help
a365 setup --help
a365 setup blueprint --help
az version
```

Use **exact published stable release versions** from the verified sample/CLI
contract. Record the installed versions and any mismatch; never use `latest`,
floating ranges, prerelease packages, workspace tarballs, or local SDK builds.
Preserve a committed lockfile and use `npm ci` for the sample. Do not automatically
update the global a365 CLI to latest (an explicit exception to generic setup).
Missing/mismatched tools require install/change approval; without a verified CLI
pin, stop at the prerequisite report rather than guessing one.

The CLI contract is pinned to package version **1.1.221**:
`setup blueprint --help` exposes `--agent-name`,
`--tenant-id`, `--no-endpoint`, and `--dry-run`, with M365 opt-in disabled by
default. CLI help describes the command surface, **not** successful registration,
S2S permission grants, or runtime identity creation.
**`--dry-run` can start Windows Account Manager authentication when no login is
cached**. It is not auth-free. Obtain approved
sign-in before even previewing; do not submit an OS authentication prompt for the
user. **Windows CLI 1.1.221 blocker:** `az login` does not populate a365's separate
MSAL/WAM login. No supported public setup device-login flag was found in its help.
When browser/device login is required, **do not run or retry this CLI's setup or
dry-run on Windows**, and do not recommend WAM. Report the CLI UX blocker and wait
for an operator-verified browser/device-compatible procedure. Do not invent flags
or a Graph provisioning workaround; a separately verified operator recipe is
required. The clean no-auth fixture always stops before authentication.

The sample's released package pins are `@github/copilot-sdk@1.0.14` (bundled
Copilot runtime **1.0.85**), `@microsoft/opentelemetry@1.4.0`, and
`@azure/msal-node@7.0.0`. Do not replace the bundled runtime with whichever global
Copilot CLI happens to be installed. The fixture below needs no package restore
or runtime launch for detection; runtime helper verification is a separate gate.
The sample also pins `@opentelemetry/api@1.9.1` and `@opentelemetry/core`,
`resources`, `sdk-trace-base`, and `sdk-trace-node` at **2.10.0**.
Its development pins are `typescript@5.9.3` and `@types/node@24.13.5`, and it
requires **Node.js >=22.12.0**, not the generic plugin's Node.js 18 minimum.

Explicit prerequisites, not success assumptions:

- The user identifies the intended Agent 365-enabled tenant and confirms the
  current Azure account/tenant. GitHub Copilot access and its existing authentication
  are separate from Entra/Agent 365 access.
- The tenant admin has completed the CLI custom-client prerequisite. An Agent ID
  Developer/Admin or other documented authorized operator performs registration;
  an appropriate admin must approve required application permissions. Do not claim
  role names, automatic consent, or grant inheritance are proven by a local config.
- The runtime needs the verified sample's non-user identity and credential inputs.
  Keep blueprint ID, runtime agent identity, tenant, and sponsor/caller identities
  distinct. A blueprint ID is not a runtime agent ID.
- Never print, request in chat, commit, or overwrite a client secret/token. Use the
  existing local secret store or ignored `.env`; tracked examples contain placeholders
  only. Ignore `.env`, generated config, and detection cache before producing them.
  Ignore local `.env` and `.env.*` variants except `.env.example`; examples must contain only
  placeholders. Keep Copilot state/traces outside the checkout or in the dedicated
  ignored `.copilot-local/` and `.copilot-traces/` directories. Do not hide arbitrary
  JSON, source fixtures, keys, or captures with broad ignore rules. Custom output
  paths need explicit review; ignore rules are not secret scanning.

For this experimental workflow, tenant login, admin consent, secret provisioning,
and all cloud/browser operations remain manual, separately approved steps. Report missing
prerequisites and continue only with independent local checks. Do not run
`a365 setup requirements`, `az login`, Graph mutations, or provisioning on their
behalf. `a365-setup` delegates registration to `make-a365-agent`; it does not apply it.

### Standalone final-response check

Use exactly this three-paragraph template for a read-only/no-approval report,
omitting runnable commands and all next-step instructions. Replace braces only
with observed facts or explicit unknown/blocked status; do not insert procedures.

```text
**Detected / preserved:** {observed stack and declared SDK version; unresolved if detection is incomplete}. Standalone scope, not AI Teammate; runtime, hosting, model, tools, and files unchanged.

**Local evidence:** {successfully inspected files and current-project facts only}. Static inspection does not verify registration or telemetry export.

**Blocked / not verified:** Confirmed onboarding cache: {present / absent / not inspected}; approved tenant authentication: {confirmed / not provided / not verified}; runtime identity and grants: {confirmed / not provided / not verified}; observability wiring/export: {specific inspected evidence / not evaluated}. No authentication, installation, provisioning, or edits were performed.
```

**END after the report.** No extra section, generic outro, next gate, admin
handoff, command name/example, follow-up question, or request for secrets/tokens.
This applies to recommendations as well as execution. `a365 setup all` must not
appear anywhere in the final answer, even in parentheses, a negated explanation,
or a suggestion for an administrator. Do not quote this prohibition in the answer;
use the positive template instead.

Report only the current project's inspected state; historical sample evidence
does not verify this fixture. Unread or failed reads mean **not evaluated**.
The sample intentionally uses `NodeTracerProvider`, `Agent365Exporter`,
`createTokenResolver`, and invocation/tool scopes (section 3), not
`useMicrosoftOpenTelemetry`. Its missing distro initializer is **not** a
missing-instrumentation finding. Assess the full inspected contract or report
**observability not evaluated**; do not invent a bootstrap repair.

Before sending, remove any recommendation to run `a365 setup all`, generic
Steps 1-3/.NET quick scan, automatic CLI updates, or `az login` as a setup-all
prerequisite. These are forbidden recommendations, not merely forbidden tool
calls. Azure CLI sign-in does not resolve CLI 1.1.221's separate WAM login.
Never count correct detection, successful skill invocation, or an unchanged
fixture as a safe-routing pass if the final answer violates these boundaries.

## 2. make-a365-agent: preview and approval, no hosting

Read existing `a365.config.json` and `a365.generated.config.json` without exposing
secrets. Compare the input `blueprintId` and generated `agentBlueprintId`; conflicting
IDs or tenants block reuse. Ask **Reuse**, **Preview re-run**, or **Stop**. Reuse skips
creation only after the operator confirms the correct tenant and live identity.
Do not automatically clean up or replace resources. Preserve unrelated config and
code on every re-run. Collect a name and directory only if not already known.

**Skip the generic messaging-endpoint question and all tunnel/hosting steps.**
Read the verified pinned CLI contract and its help before choosing registration
commands. Use the granular `setup blueprint` surface, **not `setup all`** or bot
permissions. Do not invent a "standalone" flag. Do not assume a dry run is read-only
or avoids unrelated permissions/resources until the operator verifies this.

If the pinned CLI supports an approved login method and a safe minimal dry run, the
operator may review this command shape (help-verified only, not an authorization to
execute it). The Windows/browser-only blocker in section 1 still applies even
after Azure CLI sign-in:

```text
a365 setup blueprint --agent-name <confirmed-name> --tenant-id <confirmed-tenant-id> --no-endpoint --dry-run
```

Compare the preview against the approved scope: blueprint/agent identity and only
permissions necessary for basic observability; no hosting, Teams, teammate,
mailbox, WorkIQ, or notifications. If it exceeds scope or needs an endpoint, **stop**
and request the verified blueprint-only CLI procedure; do not use generic setup as
a fallback. Show redacted output and require explicit approval before removing
`--dry-run` to apply this exact blueprint command.
Only an authorized operator runs separately approved live commands.
Changing flags/config invalidates prior approval and requires another preview.

Record registration evidence separately from grants and telemetry evidence.
Blueprint creation alone does not create the runtime agent identity or establish
its S2S grants. Creating that non-user identity remains a separate operator step
pending a verified recipe. `a365 setup permissions custom --scopes` grants
**delegated scopes**, not application roles; do not present it as granting the S2S
`Agent365.Observability.OtelWrite` role. After approved login,
`a365 query-entra blueprint-scopes`, `instance-scopes`, and `inheritance` are read-only diagnostics;
use the pinned CLI's help for their required arguments, not guessed switches.
An admin handoff or `completed: false` means prerequisites remain pending.
Do not suppress a required secret/credential handoff, but never display its value.
Missing Azure Web App managed identity is not a standalone failure.

**Registration boundary:** Entra blueprint/child identity creation is distinct
from Agent 365 registry registration. The latter uses
`POST beta/copilot/agentRegistrations` and requires `AgentRegistration.ReadWrite.All`;
see the public [blueprint creation documentation](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-blueprint).
Do not infer catalog or portal availability from an Entra identity, a local config,
or telemetry export. Record the actual HTTP status and redacted diagnostic when a
request fails; an opaque error alone does not establish an authorization failure.
These facts do not authorize Graph mutations or broader consent.

Verify existing resource IDs and propagation before retrying creation. Never
blindly retry mutations or create duplicate blueprints, identities, or secrets.
Keep tenant-specific diagnostics and credentials outside the repository.

## 3. instrument-observability: verified sample gate

Do not follow the generic Node.js hosting, TurnContext, token-service scaffold,
auto-instrumentation, or automatic live smoke-test phases. There is no verified
first-class Copilot SDK adapter in this spike. Do not generate an adapter, token
recipe, `InferenceScope` around `sendAndWait`, or model-produced telemetry.

The companion source helper is **pending/unpublished** at
`microsoft/Agent365-Samples`, path `nodejs/copilot-sdk`. Do not claim it is on
`main`, fetch it from an invented release URL, or overwrite the agent with a sample.
Before adapting any helper, obtain and inspect its verified source revision/files,
exact published dependency/CLI pins, auth/env contract, bootstrap and shutdown
exports, event/tool wrapping rules, and deterministic tests. Missing verification
is a blocker: report "observability wiring pending verified sample contract" and
leave existing runtime untouched.

### Pending companion helper contract

The following describes the expected companion source contract against the exact
published dependency pins above. These are sample exports, not a published
Copilot/A365 adapter API. No public immutable sample revision is linked here;
instrumentation is blocked until the source is supplied and its build/tests and
contract are verified. A local commit is not proof of public availability.

| Local sample file | Contract |
|---|---|
| `src/config.ts` | `loadConfig(env?)` returns telemetry flags, explicit `AgentDetails`, and optional identity. Export defaults false; identity is required only for export and cannot equal the blueprint. `runtimeEnvironment(env)` strips A365/Azure/OTel credentials/settings from the Copilot subprocess. |
| `src/auth.ts` | `createTokenResolver(identity)` returns the asynchronous `(agentId, tenantId, scopes?) => token` resolver, with identity/scope checks, expiry-aware caching, concurrent refresh coalescing, and sanitized errors. Verify the supplied implementation; do not replace it with the generic hosting/token-service scaffold. Each identity/tenant requires its own grant and token verification. |
| `src/telemetry.ts` | `createTelemetry(config, tokenResolver?)` returns `invoke(sessionId, async events => ...)`, `snapshot()`, and `shutdown()`. Uses one explicit `NodeTracerProvider`, `InvokeAgentScope.start`, and `ExecuteToolScope.start`; every scope receives `AgentDetails`, tool scopes receive `parentContext: root.getSpanContext()`. |
| `src/telemetry.ts` | `InvocationTelemetry.onEvent(SessionEvent)` correlates actual tool-start/completion IDs; `executeTool(invocation, action)` wraps a custom handler and rethrows its error. Pending tools are closed/marked incomplete at invocation cleanup. Actual `assistant.usage` is an event, not an inference span or fabricated count. |
| `src/index.ts` | Resolves/preflights the non-user token only for opted-in live export, initializes telemetry once, and calls `shutdown()` in `finally`. `shutdown()` flushes before disposal and surfaces exporter failures. `--smoke` ignores ambient env and never starts Copilot or token acquisition. |
| `src/agent.ts`, `src/tools.ts` | Demonstrate `onEvent` hookup and custom-tool handler wrapping. **Do not copy the sample's arithmetic tools, model, system prompt, isolated-session policy, or runtime setup over an existing app.** Preserve those application decisions. |

This sample deliberately **does not call `useMicrosoftOpenTelemetry()` or
`configureA365Hosting()`**. It imports the scopes and `Agent365Exporter` from the
pinned distro but manages the provider itself. Only `if (config.exportToA365)` creates
`Agent365Exporter({ tokenResolver, useS2SEndpoint: true, authScopes: [...] })`.
The generic distro's `enableObservabilityExporter` option and hosted baggage
requirements do not apply to this direct-exporter contract. Do not add those
calls to satisfy a generic validator or initialize a second global provider.
The sample passes the verified 1.4.0 `AgentDetails.agentId`, tenant, and
`agentBlueprintId` explicitly; no TurnContext, BaggageBuilder, agentic user, or
hosted token service is required.

**Minimal integration after approval:** adapt only the inspected config/auth/telemetry
helper units and their exact dependencies. Keep the existing SDK entry point and
GitHub authentication. Initialize telemetry once before the existing invocation
loop; wrap each logical invocation in `telemetry.invoke(...)`, forward real SDK
events while preserving existing callbacks, and wrap existing custom handlers in
`events.executeTool(...)`. Preserve session cleanup and add a single telemetry
shutdown in the application shutdown/finally path. Do not rewrite the toolset,
model, prompts, permissions, hosting, or session configuration. If an OTel provider
already exists, stop for a verified combined-provider adaptation instead of
registering another one. Mark added wiring with the repository's
`// A365 Observability — best-effort instrumentation (verify against official sample)`
comment. Review the diff and rerun the app's build/tests before completion.

The companion environment contract is:

| Key | Meaning |
|---|---|
| `ENABLE_A365_OBSERVABILITY_EXPORTER=false` | Default: offline/local attribution only; explicit `true` opts into export. |
| `ENABLE_A365_OBSERVABILITY=true` | Enables basic instrumentation, not proof of backend export. |
| `AGENT365_TENANT_ID` | Operator-confirmed tenant, required only for export. |
| `AGENT365_BLUEPRINT_CLIENT_ID` | Blueprint credential's client ID; never use as runtime agent ID. |
| `AGENT365_AGENT_ID` | Runtime agent identity app ID from the verified identity contract. |
| `AGENT365_CLIENT_SECRET` | Blueprint credential, local environment/secret store only. |
| `AGENT365_AGENT_NAME` | Agent display name. |
| `COPILOT_GITHUB_TOKEN` | Optional sample-only GitHub authentication input; keep existing app authentication unchanged. Never expose the value. |
| `COPILOT_MODEL`, `COPILOT_TIMEOUT_MS` | Sample runtime choices; not permission to change an existing agent's model/timeout. |
| `COPILOT_SAMPLE_HOME`, `COPILOT_TRACE_FILE` | Optional sample isolation/evidence paths; trace snapshots omit prompt/tool payloads. Keep output local. |

With export disabled the sample requires no Entra identity or credentials and labels
spans as local. This env list does not authorize constructing a token recipe: inspect
the verified helper before wiring export, and do not downgrade managed-identity-only
apps to a client secret.

Basic instrumentation must be deterministic host code from that verified contract:
explicit agent invocation/custom-tool boundaries, real SDK events only where
available, scoped identity and correlation, sanitized metadata, error handling,
and flush/shutdown. Never ask the model to emit, classify, summarize, or fabricate
telemetry; never present invocation duration as LLM inference duration or invent
token counts. Do not claim built-in Copilot tools or all model calls are covered.
Agent 365 export stays opt-in and disabled until identity/grants are verified.
Do not record prompts, replies, tool arguments/results, or credentials by default.

Adapt the smallest required bootstrap/wrapper additions in place; preserve model,
tools, hosting, authentication to GitHub, and session behavior. Show a diff before
changes and get approval. On re-run check actual source before adding another
provider, event listener, token resolver, wrapper, or shutdown handler.

## 4. Validation and honest completion

`a365-code-validator` remains report-first. For this stack, report standalone
guardrails, exact version pins, export opt-in state, identity/token requirements,
actual event/tool coverage, and unverified items. Never "fix" it by adding
TurnContext, AgentApplication, Teams, an agentic user, or WorkIQ. No live queries
without the operator's separately approved session.
Partial wiring produces standalone missing-provider/exporter findings, not a
generic distro-initializer repair. An absent exporter may be intentional for
local-only telemetry; do not turn export on to silence a report.

Use the verified sample's `npm ci`, `npm run build`, `npm test`, and
`npm run smoke` only when its contract confirms smoke is deterministic/offline.
For an existing agent use its actual scripts; do not invent them. Running a real
Copilot prompt or enabling export is an explicit operator step, not a static check.
`test-local` must not install or launch AgentsPlayground for a standalone SDK app.
Offline smoke must check invocation/tool spans, common trace/correct parent IDs,
successful and intentionally failed tools, and explicit `local-only` attribution.
It does not verify GitHub authentication, actual model inference, token acquisition,
or ingestion.
`npm run runtime:check` and `npm start -- --prompt "..."` are **operator-approved live
steps**, not part of offline validation; do not run them automatically.

The observability stop hook has a standalone branch for this exact sample contract:
it checks pins, explicit provider/scopes, opt-in/S2S exporter, identity inputs,
parent context, and flush/shutdown. It uses only the already installed local
TypeScript compiler, never `npx` auto-install. These are static signals, not proof
of correct event correlation or authorization; require the sample/app tests too.

**Live verification is separate:** check the runtime identity, token audience,
application role, endpoint eligibility, actual invocation/tool correlation, and
backend acceptance only with explicit permission. Never print tokens or credentials.
The sample's public exporter callback does not expose per-span backend acceptance;
its `a365IngestionVerified: false` default must not be changed based on that callback
or static/offline tests. Registry registration and portal indexing require their
own evidence. Keep tenant-specific captures and diagnostics outside the repository.

Report these evidence levels separately:

1. Local detection/guardrails/build/offline smoke.
2. Entra blueprint/identity creation, separate Agent 365 registry registration,
   and actual required grants (operator evidence, each reported independently).
3. A real Copilot invocation/tool run with opt-in export (operator evidence).
4. Backend acceptance and portal indexing/visibility (operator evidence).

No static validator, mocked token, HTTP success alone, or offline smoke proves
end-to-end success, catalog discovery, MAC Activity, or Defender visibility.
Leave blocked phases explicitly pending. Do not offer publication or marketplace
listing: discovery remains the existing GitHub Copilot CLI plugin marketplace.

### Read-only fixture/eval smoke

From this repository run `node --test tests\copilot-sdk.test.js`. To inspect only
fresh detection, change to `tests\fixtures\copilot-sdk` and run:

```text
node ..\..\..\plugins\agent365\hooks\lib\copilot-sdk.js
```

Expected: exit 1, `agentStack: "GitHub Copilot SDK"`, the standalone route, and a
missing confirmed detection-cache blocker. The diagnostic is local filesystem-only:
it must not invoke a365, Azure, WAM/device login, npm install, the Copilot runtime,
or any network/write operation. Repeat it to get identical output and unchanged
source. This fixture has no tenant credentials, approved login, or live grants.

For a model-driven eval, use a **plugin-capable full Copilot CLI development host**,
load this checkout's `plugins\agent365` session-locally (no global install/update),
and use the fixture as cwd. The root `plugin.json` declares the same skills as the
Claude manifest, without Claude-only startup hooks. The full CLI's
[manifest reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
accepts both locations and a string or array `skills` path.

**Harness/runtime distinction:** plugin discovery depends on the development
host's capabilities and configuration, not just a manifest or SDK option.
Use a plugin-capable full CLI with an isolated configuration and explicit plugin
directory; see the public [SDK plugin directory guidance](https://github.com/github/copilot-sdk/blob/main/docs/features/plugin-directories.md).
An empty catalog alone does not establish a runtime limitation. Verify the loaded
plugin/skill catalogs and actual skill invocation before evaluating routing.
Do not assume the bundled agent runtime accepts full-CLI launch arguments.

**Experimental limitation:** strict response-format and no-follow-up adherence
are not guaranteed. A read-only harness prevents writes by restricting tools;
it does not establish safe autonomous behavior with broader permissions. Review
the final response as well as tool calls. This is not turnkey or autonomous
end-to-end onboarding.

Onboarding skills run in the development-time full CLI, **not inside the agent's SDK runtime**.
Do not replace the app's pinned runtime, change hosting, or enable its tools to
work around harness settings. For SDK-driven evals, verify the full CLI connection
and its capabilities separately rather than relying on bundled-runtime types.

Verify discovery **before** sending the prompt: confirm `a365-setup` in the actual
skill catalog (`session.rpc.skills.list()` in a compatible SDK harness), then verify
invocation and successful content reads. A model answer without a discovered/invoked skill does not count as
plugin verification. Keep file hooks disabled and do not grant cloud/write/shell
tools for this read-only eval. Invoke `/agent365:a365-setup` with:

> Register this TypeScript GitHub Copilot SDK agent with Agent 365, standalone
> registration and basic observability only. No tenant credentials or cloud/auth
> approval are available. This is a read-only fixture eval: detect the stack,
> inspect the local instructions, and report missing prerequisites without edits,
> installing packages, running login/dry-run/setup, adding scopes, or starting a runtime.

Expected: recognize the SDK, distinguish it from M365 Copilot, report the missing
approved login/registration/identity/grants, and stop safely. Do not write even a
detection cache in this read-only eval. Record model-driven results separately
from the deterministic regression tests.
