# AI Teammate Deploy Pipeline (Phase 9.7 of make-ai-teammate)

This reference covers the full AI Teammate registration + publishing flow that runs
after the code-generation phases. Read it in full when Phase 9.7 of
`make-ai-teammate/SKILL.md` points here.

The pipeline:
`a365 setup all --m365` (registers the bot messaging endpoint at the blueprint level)
→ manifest verification (read-only)
→ `a365 publish` (packages the manifest into a zip — does not upload, does not touch the endpoint)
→ **manual zip upload** to Microsoft 365 Admin Center
→ **manual Teams Developer Portal configuration** (Agent Type + Notification URL — required for Teams to deliver messages)
→ request agent instance
→ admin approval
→ smoke test.

Step numbering matches the original Phase 9.7 sub-section IDs (9.7.1 through 9.7.7) so
the inline references in the SKILL.md, stop-hook prompt, and evals continue to point at
the same places.

---



This phase runs the full AI Teammate registration and publishing pipeline:
`a365 setup all --m365` (registers the bot messaging endpoint at the blueprint level) → manifest verification (read-only) → `a365 publish` (packages the manifest into a zip — does not upload, does not touch the endpoint) → **manual zip upload** to Microsoft 365 Admin Center → **manual Teams Developer Portal configuration** (Agent Type + Notification URL — required for Teams to deliver messages to the agent) → request agent instance → admin approval → smoke test.

> **Authoritative Microsoft Learn references** — keep these handy for the rest of Phase 9.7:
> - [Create agent instance](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance) — post-publish manual steps (Dev Portal config, instance request, admin approval, verification checklist).
> - [Test agents using the Microsoft Agent 365 SDK](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing) — `.env` / `appsettings.json` variable reference, AgentsPlayground setup, auth handler config.
> - [Test agents by using Dev Tunnels](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels) — canonical `devtunnel` command sequence and tunnel lifecycle.
> - [Deploy agent to Azure](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-azure) — Azure App Service deployment, app-settings management, log inspection.
> - [Deploy agent to AWS](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-aws) — AWS Elastic Beanstalk deployment + non-Azure `a365.config.json` config.
> - [Deploy agent to GCP](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-gcp) — Google Cloud Run deployment + non-Azure `a365.config.json` config.

---

## Step 9.7.1 — Register the Blueprint (`a365 setup all`)

### Step 9.7.1a — Re-check blueprint state from disk and ask the user

**Do NOT trust `disk_blueprint_present` from the cache alone** — `a365.generated.config.json` may have been created or deleted since the cache was last refreshed. Re-check now:

```bash
ls a365.generated.config.json 2>/dev/null && \
  node -e "const c=require('./a365.generated.config.json'); console.log('Blueprint:', c.agentBlueprintId || '(empty)')"
```

**If `a365.generated.config.json` exists with a non-empty `agentBlueprintId`** — ask the user explicitly before any CLI command (including the dry-run). Do NOT silently reuse or re-run:

```
I found an existing Agent 365 blueprint registered for this project.
  Blueprint ID: {existingBlueprintId}
  Agent name:   {existing agent name from config, if available}

What would you like to do?

  1. Reuse the existing blueprint  (fastest — recommended)
     Skip `a365 setup all` entirely. Use this blueprint ID directly for the
     rest of the publish / Dev Portal / instance flow. Picks up the existing
     Agentic User, service principal, permissions, and messaging endpoint
     unchanged.

  2. Re-run `a365 setup all` to refresh
     The CLI is idempotent — it will reuse the same blueprint ID but
     refresh service principal permissions, FIC, managed identity, and
     project settings. Safe; nothing is destroyed. Use this after a CLI
     upgrade or when permissions look out of date.

  3. Create a fresh blueprint
     Destroys the existing Agentic User and blueprint registration with
     `a365 cleanup --agent-name <name>`, then runs `a365 setup all`
     from scratch. ⚠️ This invalidates any Teams instance that has been
     approved — instance request must be redone after fresh provisioning.
```

Branch on the answer. **All three branches set `blueprint_verified_for_session = true` on completion** — this is the session-level gate that downstream phases consult before treating the blueprint as authoritative. Disk presence alone is never enough.

- **1 (Reuse):** Skip the rest of Step 9.7.1 entirely. Read `agentBlueprintId` and `messagingEndpoint` from `a365.generated.config.json` and jump to Step 9.7.2. Set `blueprint_verified_for_session = true` (user explicitly confirmed this is the right blueprint for this agent).
- **2 (Re-run):** Continue with the setup-all flow below (Step 9.7.1b). The CLI will detect the existing blueprint and reuse the ID. Set `blueprint_verified_for_session = true` after setup-all completes.
- **3 (Fresh):** Run `a365 cleanup --agent-name <name>` first with an explicit *"Type yes to confirm destructive cleanup"* gate. Only after cleanup succeeds, continue with the setup-all flow below. Set `blueprint_verified_for_session = true` after setup-all completes.

**Otherwise** (no `a365.generated.config.json` on disk, or `agentBlueprintId` empty) → no existing blueprint, continue with the setup-all flow below.

### Step 9.7.1b — Run setup-all (when reached from 9.7.1a paths 2, 3, or "no blueprint")

Ask the user for the **agent name** (reuse from session context if available, otherwise ask).

**Pre-flight check — STOP if it fails:** `a365 setup all --agent-name <name>` derives `AgentBlueprintDisplayName = "<name> Blueprint"` ([AllSubcommand.cs](https://github.com/microsoft/Agent365-devTools/blob/main/src/Microsoft.Agents.A365.DevTools.Cli/Commands/SetupSubcommands/AllSubcommand.cs)), and `a365 publish` stamps that string verbatim into `manifest.json#name.short`, which the Teams app manifest schema caps at 30 chars. Enforce **`length(agent-name) ≤ 20`** (i.e. `length(agent-name) + len(" Blueprint") ≤ 30`) before invoking the CLI.

If the supplied name is longer than 20 chars (whether typed now or reused from session context / `a365.generated.config.json`), STOP and tell the user verbatim:

> "Your agent name is N chars; the CLI appends ' Blueprint' to derive the Teams manifest's `name.short` (capped at 30). Please supply a name ≤ 20 chars. The CLI's own warning fires only at publish time, after the blueprint and Azure resources are already provisioned — easier to fix now."

Wait for a corrected name. Re-run the pre-flight check on the new value.

Then show a dry-run first:

```bash
# Dry-run preview (required before applying)
a365 setup all --agent-name <name> --aiteammate --dry-run
```

Show the full dry-run output and ask:
> "Here's what `a365 setup all` will create. Does this look correct? Type **yes** to proceed or **no** to abort."

**If yes**, apply with `--m365` — AI Teammate is always M365-integrated (registered in the M365 admin center and reachable from Microsoft Teams / Copilot). **Do NOT ask the user** whether to include `--m365` — it's implied by the AI Teammate choice.

```bash
a365 setup all --agent-name <name> --aiteammate --m365
```

**`--authmode` note:** Do NOT pass `--authmode` with `--aiteammate`. AI Teammate agents use the Agentic User identity (the agent's own M365 identity — not the caller's token). In CLI 1.1+, `--authmode obo` is accepted but emits a warning (OBO is the default for AI Teammate — the flag is superfluous). `--authmode s2s` or `--authmode both` with `--aiteammate` is rejected with an error. Omit `--authmode` entirely.

**Windows Account Manager (WAM):** If `"Authenticating via Windows Account Manager..."` appears, a native Windows sign-in dialog appeared. Do NOT kill the process — tell the user: "Please complete the sign-in dialog — setup will continue automatically." If no dialog appears on a headless machine: `Ctrl+C`, run `az login --allow-no-subscriptions`, retry. If blocked by Conditional Access Policy (AADSTS53003), the CLI automatically falls back to device code flow.

After completion:
- Show the **Setup Summary table** verbatim from CLI output.
- Extract and store `blueprintId` from `a365.generated.config.json`:

```bash
node -e "const c=require('./a365.generated.config.json'); console.log('Blueprint ID:', c.agentBlueprintId)"
```

**If the CLI output includes a "Permission Grants" action item or any 403 errors:** display the PowerShell script printed in the CLI output verbatim so the user can copy it. This is only expected for agents upgrading from a pre-1.1 CLI version where OtelWrite was not yet auto-granted. For newly provisioned agents no admin consent step is required.

---

## Step 9.7.2 — Choose Run Target (Prod vs Local)

The blueprint is registered. Decide where the user wants to run the agent — this controls whether Phases 9.7.3 – 9.7.6 (manifest verify, publish, Dev Portal, instance request) execute and what URL the Teams Developer Portal Notification URL will point to.

**Remember-with-confirm:** read `.a365-workspace-detection.local.json` for `runTarget` and `runTargetHosting`. If present, show *"Last time you chose `{runTarget}`{ — `runTargetHosting`}. Use the same again? (yes / switch)"* and store the confirmed value. Otherwise, ask:

```
Where do you want to run this agent?

  1. Production — reachable from Microsoft Teams / Microsoft Copilot.
     I'll then ask how the agent is hosted (dev tunnel or cloud endpoint),
     then run publish → Dev Portal config → instance request → smoke test.

  2. Local — AgentsPlayground only (no Teams reachability).
     The agent runs at http://localhost:3978/api/messages. Skips publish,
     Dev Portal config, MAC upload, and instance request.
```

Store as `runTarget` ∈ `{"prod", "local"}` and write back to `.a365-workspace-detection.local.json` (merge).

### Step 9.7.2a — Local target

When `runTarget = "local"`:
- The agent listens on `http://localhost:3978/api/messages` (or the language-specific default port — Node.js/Python: 3978, .NET: 5000 if that's what the project uses).
- Tell the user verbatim: *"Local mode. Start the agent in another terminal, then I'll launch AgentsPlayground. Teams reachability is skipped — no publish, no Dev Portal config, no instance request."*
- Jump directly to Step 9.7.7 (Smoke Test) — Option B (AgentsPlayground) only.

### Step 9.7.2b — Production target: sub-question on hosting

When `runTarget = "prod"`, ask:

```
How is your agent hosted?

  1. Dev tunnel — agent runs on localhost; exposed via Microsoft Dev Tunnel
     so Teams can reach it. Best for in-Teams testing before deploying to
     a real cloud. Reference:
     https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels

  2. Cloud endpoint — agent is (or will be) deployed to a public HTTPS URL:
     • Azure App Service / Container Apps / Functions — see
       https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-azure
     • AWS Elastic Beanstalk — see
       https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-aws
     • Google Cloud Run — see
       https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-gcp
     I'll ask for the full messaging endpoint URL
     (e.g. https://my-agent.azurewebsites.net/api/messages).
```

Store as `runTargetHosting` ∈ `{"devtunnel", "cloud"}` and merge into `.a365-workspace-detection.local.json`.

- **`runTargetHosting = "devtunnel"`:** **auto-start the tunnel AND the local agent — do NOT ask the user to paste a URL.** Use the agent name from session context (or cache) as the tunnel name so the URL is stable across restarts ([reference](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels)). The order matters: **tunnel up → agent up → reconcile endpoint → publish.** Bringing publish online before the local server is listening leaves Teams pointing at a dead endpoint.

  1. **Verify CLI is installed and current.** Run `devtunnel --version` — if it fails, install with `winget install Microsoft.devtunnel` (Windows), `brew install --cask devtunnel` (macOS), or `curl -sL https://aka.ms/DevTunnelCliInstall | bash` (Linux). If it succeeds, also offer to update to latest (idempotent — same install command on Windows/macOS/Linux re-installs the latest build; older devtunnel CLIs are known to silently default to `https` on `port create`, which causes the 502 below). Stop until the user confirms install/update is complete.
  2. **Verify login:** `devtunnel user show`. If it exits non-zero or prints "not logged in", run `devtunnel user login` (or `devtunnel user login --device-code` on headless machines), wait for the user to complete sign-in, then retry `devtunnel user show`.
  3. **Create the tunnel and the port — `--protocol http`, NOT `https`** (idempotent — treat "already exists" as success). Pick the port from `programmingLanguage` in `.a365-workspace-detection.local.json`: `3978` for Node.js / Python, the .NET project's launch port for .NET (default `5000`).
     ```bash
     devtunnel create <agent-name>-tunnel --allow-anonymous
     devtunnel port create <agent-name>-tunnel -p <port> --protocol http
     ```
     > ⚠️ **`--protocol http` is required.** The local agent listens over plain HTTP. If the port is registered as `https` (the CLI's default on some versions), the devtunnel relay attempts a TLS handshake against the local server and fails with **HTTP 502 Bad Gateway**. If you hit a 502 after the tunnel starts, delete the port (`devtunnel port delete <agent-name>-tunnel -p <port>`) and recreate it with `--protocol http`. The public-facing URL the relay exposes is still HTTPS — the protocol flag controls only how the relay talks to your local process.
     >
     > Parse the **Tunnel ID** from the create output — format is `<id>.<cluster>` (e.g. `abc123xy.usw3`).
  4. **Start tunnel hosting in the background** — long-running, run with `run_in_background=true` so it keeps running while the skill continues. The user does NOT need to open a separate terminal.
     ```bash
     devtunnel host <agent-name>-tunnel
     ```
  5. **Resolve the public URL deterministically** — `https://<id-without-cluster>-<port>.<cluster>.devtunnels.ms`. Example: tunnel ID `abc123xy.usw3` + port `3978` → `https://abc123xy-3978.usw3.devtunnels.ms`. Sanity-check by running `devtunnel show <agent-name>-tunnel` and confirming the printed Access URL matches.
  6. **Start the agent locally in the background** — same rationale (`run_in_background=true`). The agent MUST be listening before Step 9.7.2c (reconcile endpoint) and 9.7.3 (publish) run; otherwise the published manifest points at a tunnel that 502s every request.
     ```bash
     # Node.js (Express)
     npm run build && node dist/index.js
     # Python (aiohttp)
     python host_agent_server.py
     # .NET (Kestrel)
     dotnet run
     ```
     Confirm the agent printed `Server listening on http://...` (Node.js / Python) or `Now listening on: http://...` (.NET) before continuing. If it fails to bind to the port, surface the verbatim error and stop.
  7. **Store `chosenEndpoint`** = `<tunnel URL>/api/messages` (forward slashes — never `\`). Tell the user verbatim: *"Dev tunnel started at `<URL>` (relay → local HTTP), agent listening on port `<port>`. Both running in the background — leave this session open. Using this endpoint for reconcile + publish."*
  8. **Write `.vscode/` workspace files** so the user can `Ctrl+Shift+B` on subsequent sessions to restart the tunnel + agent without re-running this skill. See [Step 9.7.2f — VS Code workspace files](#step-9-7-2f--vs-code-workspace-files) below for the templates.

- **`runTargetHosting = "cloud"`:** ask the user for the full messaging endpoint URL (must be HTTPS and end in `/api/messages`). If they don't have one yet, point them at the appropriate deploy guide above for their chosen platform. Store as `chosenEndpoint`. Then write `.vscode/` workspace files (see [Step 9.7.2f](#step-9-7-2f--vs-code-workspace-files) — the cloud variant omits the devtunnel task but still includes Publish + Open Dev Portal).

### Step 9.7.2c — Reconcile endpoint with the blueprint (MANDATORY for prod)

For an AI Teammate with `runTarget = prod`, **always** re-assert the messaging endpoint once `chosenEndpoint` is known — do **NOT** skip on an apparent match against `a365.generated.config.json`. That `messagingEndpoint` is a disk value and can be stale or lie about tenant state — dev-tunnel URL rotation on restart, a Teams Graph re-registration that didn't persist, or a reused/copied blueprint (Step 9.7.1 option 1) are the common cases. This is the same "disk presence is not verification" principle the blueprint Reuse/Re-run gate enforces in Step 9.7.1a. The command is idempotent, and `--m365` re-asserts the Teams Graph registration that actually routes Teams to your endpoint — so running it unconditionally costs little and removes a whole class of "Teams never reaches `/api/messages`" failures.

Run it **unconditionally** (this is also the exact value the Dev Portal Notification URL is set to in Step 9.7.5):

  ```bash
  a365 setup blueprint --update-endpoint <chosenEndpoint> --m365
  ```

  **`--m365` is required.** Per [BlueprintSubcommand.cs](https://github.com/microsoft/Agent365-devTools/blob/main/src/Microsoft.Agents.A365.DevTools.Cli/Commands/SetupSubcommands/BlueprintSubcommand.cs), without it `--update-endpoint` silently skips the Teams Graph API re-registration step, leaving Teams routing pointed at the old endpoint. AI Teammate is always M365-integrated — pass `--m365` every time.

  Run it, then re-read `a365.generated.config.json` and confirm `messagingEndpoint` now equals `chosenEndpoint`. Optionally note to the user whether the value changed (informational only — it runs either way).

**Skip this reconciliation ONLY when:**

- `runTarget = local` (AgentsPlayground — no Teams reachability), or
- `chosenEndpoint` is empty or still a placeholder (cloud not yet deployed). In that case **STOP** — do not run `--update-endpoint` with a placeholder (it would register a dead URL). Tell the user to finish deploying and supply the real HTTPS `/api/messages` URL before publishing.

After reconciliation, `a365.generated.config.json` is authoritative — Step 9.7.5 will read `messagingEndpoint` from it and use that exact value in the Teams Developer Portal Notification URL field.

### Step 9.7.2d — Validate environment configuration for the chosen target

Before continuing to publish (prod) or AgentsPlayground (local), verify the project's config file (`.env` for Python/Node.js; `appsettings.json` + `launchSettings.json` for .NET) has the values required by the chosen target. The full canonical list is in [Test agents — Configure agent testing environment](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing) (per-language tabs).

**Common required variables — applies to both Prod and Local:**

| Concern | Python `.env` | Node.js `.env` | .NET `appsettings.json` |
|---|---|---|---|
| Blueprint client ID | `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=<agentBlueprintId>` | `connections__service_connection__settings__clientId=<agentBlueprintId>` | `AgentBluePrint.Settings.ClientId` |
| Blueprint client secret | `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=<agentBlueprintClientSecret>` | `connections__service_connection__settings__clientSecret=<agentBlueprintClientSecret>` | `AgentBluePrint.Settings.ClientSecret` |
| Tenant ID | `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=<tenantId>` | `connections__service_connection__settings__tenantId=<tenantId>` | `AgentBluePrint.Settings.TenantId` |
| Auth handler type | `AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__TYPE=AgenticUserAuthorization` | `agentic_type=agentic` | `AgentApplication.UserAuthorization.Handlers.agentic.Type=AgenticUserAuthorization` |
| Auth handler scopes | `AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__SCOPES=https://graph.microsoft.com/.default` | `agentic_scopes=https://graph.microsoft.com/.default` (or the MCP platform SP scope `ea9ffc3e-…/.default` if the agent uses WorkIQ MCP servers) | `AgentApplication.UserAuthorization.Handlers.agentic.Settings.Scopes` |
| Connection map | `CONNECTIONSMAP_0_SERVICEURL=*` + `CONNECTIONSMAP_0_CONNECTION=SERVICE_CONNECTION` | `connectionsMap__0__serviceUrl=*` + `connectionsMap__0__connection=service_connection` | `ConnectionsMap[0]` |
| LLM (one of) | `OPENAI_API_KEY=...` OR `AZURE_OPENAI_API_KEY=` + `AZURE_OPENAI_ENDPOINT=` + `AZURE_OPENAI_DEPLOYMENT=` + `AZURE_OPENAI_API_VERSION=` | (same) | `AIServices.OpenAI.*` OR `AIServices.AzureOpenAI.*` + `AIServices.UseAzureOpenAI` |
| Observability exporter — value depends on run target | `ENABLE_A365_OBSERVABILITY_EXPORTER=true` for prod / dev tunnel; `=false` for local AgentsPlayground (console-only traces) | (same) — the only env var `@microsoft/opentelemetry` reads; see [A365Configuration.ts](https://github.com/microsoft/opentelemetry-distro-javascript/blob/main/src/a365/configuration/A365Configuration.ts) | `ENABLE_A365_OBSERVABILITY_EXPORTER=true` (prod) / `=false` (local) in app-service env vars or `Logging.OpenTelemetry` |
| Observability agent metadata (stamped by `a365 setup all`; read by AgentDetails wiring → MAC portal grouping) | `agent365Observability__agentId=<agentBlueprintId>` + `__tenantId=<tenantId>` + (optional) `__agentName=` + `__agentDescription=` | (same — case-insensitive env keys; see [ProjectSettingsSyncHelper.cs](https://github.com/microsoft/Agent365-devTools/blob/main/src/Microsoft.Agents.A365.DevTools.Cli/Helpers/ProjectSettingsSyncHelper.cs)) | `Agent365Observability.AgentId` + `.TenantId` + `.AgentName` + `.AgentDescription` |
| Server port | `PORT=3978` | `PORT=3978` | `applicationUrl` in `launchSettings.json` (e.g. `https://localhost:64896;http://localhost:64897`) |

Pull `<agentBlueprintId>`, `<agentBlueprintClientSecret>`, `<tenantId>` from `a365.generated.config.json` (set by Step 9.7.1). For .NET, blueprint client secret is sensitive — prefer `dotnet user-secrets` over committing to `appsettings.json`.

> **Not in this table (and why)** — the following Node.js keys appeared in older skill versions but are NOT consumed by `@microsoft/Agents-for-js` or `@microsoft/opentelemetry`, so the skill must NOT write them as required vars:
> - `USE_AGENTIC_AUTH` — handler selection is in code (`MyAgent.authHandlerName = 'agentic'`); env var is informational only.
> - `agentic_connectionName` — invalid key for the agentic handler (only `type`, `scopes`, `altBlueprintConnectionName` are recognized; `connectionName` is an Azure-Bot-handler legacy alias).
> - `agent365Observability__agentBlueprintId` — CLI writes `__agentId`, not `__agentBlueprintId`. Stray.
> - `agent365Observability__clientId` / `__clientSecret` — never written by the CLI and never read by the distro. Stray.
> - `agent365Observability__sponsorUserId` / `__sponsorUserName` / `__sponsorUserEmail` — S2S-only. For AI Teammate (always `agentic-user`), `CallerDetails` come from the turn context — these env vars are inert.

**For `runTarget = "prod"` — additional verification:**

1. **`a365.generated.config.json` is complete:**
   - **`completed: true`** — if `false`, the OAuth2 permission grants are still pending. Surface the PowerShell script printed by the original `a365 setup all` output and tell the user a Global Administrator must complete the grants before prod can serve traffic.
   - **`resourceConsents` non-empty** — empty means consent hasn't been recorded; same GA handoff applies.
   - `agentBlueprintId`, `agentBlueprintClientSecret`, `tenantId`, `messagingEndpoint` all populated and non-empty.

2. **Prod-only env-var checklist — these MUST be set (in addition to the common table above) and they differ from local-dev defaults.** Verify them in the cloud platform's effective config, not just the local `.env` (use the inspection command in step 3 below):

   | Concern | Python `.env` | Node.js `.env` | .NET `appsettings.json` |
   |---|---|---|---|
   | Active auth handler — must point at agentic in prod | `AUTH_HANDLER_NAME=AGENTIC` (under `# A365 Authentication`). The Python code reads this env var to pick a handler at runtime; empty leaves the agent with no handler and every Teams message fails token exchange. | Not env-driven — `MyAgent.authHandlerName = 'agentic'` is set in code. Verify the constant matches the registered auth handler in `agentic_type=agentic`. | Not env-driven — `AgentApplication:AgenticAuthHandlerName=agentic` lives in `appsettings.json`. Verify the value is `agentic`. |
   | Node.js production mode — required for ANY Teams-reachable hosting (cloud OR dev tunnel) | n/a | `NODE_ENV=production`. Without it, `index.ts` short-circuits to `authConfig = {}` (per the `isProduction ? loadAuthConfigFromEnv() : {}` gate). `authorizeJWT` then no-ops in dev, but `CloudAdapter.process` still needs `authConfig.clientId` to verify Teams' signed activity and authenticate outbound replies — surfacing as silent 401s / audience-mismatch errors. **Smoke signal: boot log reads `for appId undefined`.** This is the most common silent-failure mode for Node.js dev-tunnel projects, because Teams sends real signed activities even when you're running locally. | n/a — .NET uses `IHostEnvironment` + `appsettings.{Environment}.json` |

   For Node.js + `runTargetHosting ∈ {devtunnel, cloud}`: open `.env` and confirm `NODE_ENV=production` is present. If missing or set to `development`, update it before continuing. Confirm `ENABLE_A365_OBSERVABILITY_EXPORTER=true` (the common table's value-by-run-target rule applies). If any other value above is wrong or missing, fix it before continuing to Step 9.7.3.

3. **Environment variables are set at the cloud platform, not just locally.** Local `.env` files do NOT propagate to the cloud — they must be configured in the platform's config:
   - **Azure App Service:** Azure portal → Web App → Settings → Environment Variables, or `az webapp config appsettings set --name <app> --resource-group <rg> --settings KEY=VALUE`. Use [Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) for sensitive secrets. Verify with `az webapp config appsettings list --name <app> --resource-group <rg>`. Full deployment guide: [Deploy agent to Azure](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-azure).
   - **AWS Elastic Beanstalk:** `eb setenv KEY=VALUE`. Verify in EB console under Configuration → Software → Environment properties. Full deployment guide: [Deploy agent to AWS](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-aws).
   - **Google Cloud Run:** `gcloud run services update <service> --region <region> --set-env-vars KEY=VALUE,KEY2=VALUE2`. Verify with `gcloud run services describe <service> --region <region>`. Full deployment guide: [Deploy agent to GCP](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/deploy-agent-gcp).

4. **HTTPS is required.** Bot Framework rejects non-HTTPS messaging endpoints. Azure App Service serves HTTPS by default; AWS Elastic Beanstalk requires an SSL/TLS certificate; Google Cloud Run is HTTPS by default.

5. **Messaging endpoint is reachable:** quick smoke test with `curl <chosenEndpoint>` — anything but a 404 is acceptable (a GET on `/api/messages` typically returns method-not-allowed, which is fine; the POST handler is what Teams uses). Verify the web app is in `"Running"` state:
   - Azure: `az webapp show --name <app> --resource-group <rg> --query state` → expect `"Running"`.
   - AWS: `eb health --refresh` → expect green.
   - GCP: `gcloud run services describe <service> --region <region>` → expect `"Ready"` condition.

If any check fails, STOP and surface the exact failure to the user. Do not continue to Step 9.7.3 until the configuration is complete — publishing a manifest pointing at a misconfigured endpoint will silently break the agent in Teams.

**For `runTarget = "local"` — additional verification:**

1. `.env` (or `appsettings.json` + `launchSettings.json` for .NET) has the agentic-auth values for local testing (from the table above).
2. The local server port matches the chosen URL — typically `PORT=3978` for Python/Node.js, or the `applicationUrl` in `launchSettings.json` for .NET.
3. AgentsPlayground is installed (`agentsplayground --version`); if not: `winget install agentsplayground` (Windows) or `npm install -g @microsoft/m365agentsplayground` (all platforms). Reference: [Test agents using the Microsoft Agent 365 SDK](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing#test-agent-in-agents-playground).
4. For agentic auth in AgentsPlayground: a `.m365agentsplayground.yml` file is present with `bot.id`, `bot.agenticUserId`, `bot.agenticAppId`, and `bot.role: agenticUser`. Reference: [Configure Agents Playground for agentic authentication](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing#configure-agents-playground-for-agentic-authentication).
5. **`BEARER_TOKEN` is local-only.** If `BEARER_TOKEN` or `BEARER_TOKEN_<SERVER_NAME>` is set for local dev (via `a365 develop get-token`), make sure these are NEVER carried into prod cloud config.

**Routing:**
- **`runTarget = "prod"`** → continue with Step 9.7.2f (write VS Code workspace files) then Step 9.7.3 (Verify manifest).
- **`runTarget = "local"`** → skip Steps 9.7.3 – 9.7.6 entirely. Run Step 9.7.2f first (it's useful for local dev too — `Ctrl+Shift+B` becomes "Start Agent + AgentsPlayground"), then jump to Step 9.7.7.

---

### Step 9.7.2f — Workspace files for VS Code AND Claude Code (`.vscode/*` + `.claude/*`)

Write workspace files at the user's project root so subsequent dev sessions don't re-run the skill, and so the chat agent can invoke dev-loop commands **directly without permission prompts** (collapsing 8–10 mid-flow pauses to 0).

**Two surfaces, two file sets** — write both. They cover different chat clients:

| File | Reader | Effect |
|---|---|---|
| `.vscode/tasks.json` | VS Code (Tasks system + Copilot Chat agent mode) | `Ctrl+Shift+B` runs "A365: Start Tunnel + Agent"; Copilot Chat invokes tasks without prompting |
| `.vscode/settings.json` | VS Code (Copilot Chat) | `chat.tools.terminal.autoApprove` skips Allow/Skip on listed commands |
| `.vscode/extensions.json` | VS Code | Recommends Copilot, Claude Code, markdownlint, etc. |
| `.claude/settings.json` | Claude Code (CLI + IDE-embedded) | `permissions.allow` skips permission prompts on listed Bash patterns |

**Idempotency rule:** all four files are additive — if they already exist, merge non-destructively. Never overwrite a user's existing entry. Show a one-line summary: *"Updated .vscode/tasks.json (+5 tasks), .vscode/settings.json (+3 keys), .vscode/extensions.json (+4 recs), .claude/settings.json (+12 allow rules)"*.

**`tasks.json`** — language- and run-target-aware. Pick the `agentCommand` row based on `programmingLanguage` from the detection cache. Omit the *A365: Devtunnel* + *A365: Start Tunnel + Agent* tasks for `runTargetHosting = "cloud"`.

| Language | `agentCommand` |
|---|---|
| `NodeJS` | `npm run build && node dist/index.js` |
| `Python` | `python host_agent_server.py` (or `python3` on macOS/Linux) |
| `DotNet` | `dotnet run` |

```jsonc
{
  "version": "2.0.0",
  "inputs": [
    { "id": "agentName", "type": "promptString", "description": "Agent name (from a365.generated.config.json)", "default": "<agent-name>" }
  ],
  "tasks": [
    {
      "label": "A365: Start Tunnel + Agent",
      "dependsOrder": "parallel",
      "dependsOn": ["A365: Devtunnel", "A365: Agent"],
      "group": { "kind": "build", "isDefault": true },
      "problemMatcher": []
    },
    {
      "label": "A365: Devtunnel",
      "type": "shell",
      "command": "devtunnel host ${input:agentName}-tunnel",
      "isBackground": true,
      "presentation": { "panel": "dedicated", "reveal": "always" },
      "problemMatcher": { "pattern": [{ "regexp": "." }], "background": { "activeOnStart": true, "beginsPattern": "Hosting", "endsPattern": "Listening" } }
    },
    {
      "label": "A365: Agent",
      "type": "shell",
      "command": "<agentCommand from table above>",
      "isBackground": true,
      "presentation": { "panel": "dedicated", "reveal": "always" },
      "problemMatcher": []
    },
    { "label": "A365: Publish",          "type": "shell", "command": "a365 publish",                    "problemMatcher": [] },
    { "label": "A365: Setup All",         "type": "shell", "command": "a365 setup all --aiteammate --m365", "problemMatcher": [] },
    { "label": "A365: Open Dev Portal",   "type": "shell", "command": "start \"\" https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration", "windows": { "command": "start \"\" https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration" }, "problemMatcher": [] }
  ]
}
```

Substitute `<agent-name>` with the agent name from session context; `<agentCommand>` with the language-appropriate row; `<agentBlueprintId>` with the blueprint ID from `a365.generated.config.json` (use a fallback `${env:AGENT_BLUEPRINT_ID}` if the file isn't readable at write-time).

**`settings.json`** — auto-approve known-safe commands so Copilot Chat's agent mode runs them without prompting. Merge with existing keys; never override user-set values.

```jsonc
{
  "chat.tools.terminal.autoApprove": {
    "a365": true,
    "devtunnel": true,
    "dotnet": true,
    "npm": true,
    "node": true,
    "python": true,
    "python3": true
  },
  "chat.agentSkillsLocations": { ".agents/skills": true },
  "files.associations": {
    "*.local.json": "jsonc",
    "a365.config.json": "jsonc",
    "a365.generated.config.json": "jsonc"
  }
}
```

**`extensions.json`** — recommend the toolchain. Language-specific extensions per `programmingLanguage`:

```jsonc
{
  "recommendations": [
    "github.copilot",
    "github.copilot-chat",
    "anthropic.claude-code",
    "davidanson.vscode-markdownlint",
    "editorconfig.editorconfig"
    // + "dbaeumer.vscode-eslint" (NodeJS)
    // + "ms-dotnettools.csharp" (DotNet)
    // + "ms-python.python", "ms-python.vscode-pylance" (Python)
  ]
}
```

**`.claude/settings.json`** — Claude Code's permission allowlist for the same set of commands the VS Code `autoApprove` covers. Merge with existing `permissions.allow` array; deduplicate.

```jsonc
{
  "permissions": {
    "allow": [
      "Bash(a365 *)",
      "Bash(devtunnel *)",
      "Bash(dotnet *)",
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(python *)",
      "Bash(python3 *)",
      "Bash(uv *)",
      "Bash(pip *)",
      "Bash(pip3 *)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(az account show)",
      "Bash(az webapp config appsettings list *)"
    ]
  }
}
```

> ⚠️ The `allow` list deliberately omits destructive commands (`git push`, `git reset --hard`, `az group delete`, `dotnet ef migrations remove`, `npm uninstall`, etc.) — those still prompt. The skill is granting auto-approval for the *known dev loop*, not blanket trust.

**Verification:** after writing, run `code --list-extensions 2>/dev/null` (or just tell the user "open VS Code → Tasks: Run Task → you should see `A365: Start Tunnel + Agent`"). If the user is in VS Code already, suggest `Developer: Reload Window` to pick up the new associations. For Claude Code users, the new permission rules apply on the next prompt — no restart needed.

**Why this matters:** chat agents read these files to decide which commands run without prompts. Without them, every `a365 publish` / `devtunnel host` / `npm run build` triggers an *Allow / Skip* prompt — the #1 source of the mid-flow pauses users reported in 1.0.0. With them, the same commands flow through silently on **both VS Code Copilot Chat AND Claude Code (CLI + IDE)**.

---

## Step 9.7.3 — Verify `manifest.json` (do NOT hand-edit)

**Run only when `runTarget = "prod"`.** Skip entirely for `runTarget = "local"`.


**Glob** for `manifest.json` or `appPackage/manifest.json`.

**The CLI owns this file.** `a365 setup all --aiteammate` (Step 9.7.1) creates or updates the manifest with the correct `$schema` (Teams v1.22+), `manifestVersion`, `bots[0].botId`, `webApplicationInfo.id`, `copilotAgents.customEngineAgents`, and `validDomains` based on `a365.generated.config.json`. `a365 publish` (Step 9.7.4) re-substitutes IDs at package time. **Do NOT hand-write or modify these fields in this step** — let the CLI generate them.

This step is a **read-only verification**. Read the manifest and confirm to the user:

- ✅ File exists at `manifest.json` or `appPackage/manifest.json`
- ✅ `$schema` references a Teams v1.22+ schema
- ✅ `bots[0].botId` is populated (or contains a Teams Toolkit token like `${{TEAMS_APP_ID}}`)
- ✅ `copilotAgents.customEngineAgents` block is present (the AI Teammate marker — distinguishes an AI Teammate from a regular Teams bot)

If anything looks missing or wrong, re-run `a365 setup all --aiteammate` (idempotent) — the CLI will regenerate the missing fields. Do NOT patch them by hand.

For reference, the AI Teammate marker block looks like this (top-level — sibling of `bots`, not nested inside it):

```json
"copilotAgents": {
  "customEngineAgents": [
    { "id": "<agentAppId — same as bots[0].botId>", "type": "bot" }
  ]
}
```

> **Teams Toolkit projects** use token placeholders like `${{TEAMS_APP_ID}}` and `${{AAD_APP_CLIENT_ID}}` instead of literal IDs — Toolkit resolves these during package build. If you see Toolkit tokens, leave them alone.

If `manifest.json` does **not** exist:
> "No `manifest.json` found. If you're using Teams Toolkit it manages this file automatically. Otherwise, re-run `a365 setup all --aiteammate` — the CLI will generate it."

Stop until the user confirms whether to continue.

---

## Step 9.7.4 — Publish (`a365 publish`)

**Run only when `runTarget = "prod"`.** Skip entirely for `runTarget = "local"`.

> ⚠️ **CLI buffering gotcha when invoked from a chat tool.** `a365 publish` is a long-running .NET command that block-buffers its output when stdout is captured (Claude Code Bash tool, Copilot Chat, GitHub Copilot CLI) — progress messages stall and the command looks hung. If a user reports *"the pipe is buffering output"* or has to *"kill and re-run without the pipe"*, that's this issue.
>
> Three remediations in order of preference: (1) `run_in_background: true` for Claude Code's Bash tool, (2) `stdbuf -oL a365 publish` on Linux/macOS/WSL, (3) hand off to a separate terminal with this verbatim message: *"`a365 publish` buffers under chat-tool execution. Please open a new terminal in this project directory, run `a365 publish` there, then paste the final output (the lines mentioning `manifest.zip` / `appPackage.zip` and any warnings) back here."*
>
> See [AGENTS.md § CLI output buffering under chat-tool execution](../../../../../AGENTS.md#cli-output-buffering-under-chat-tool-execution) for the canonical full block — keep this inline summary in sync.

```bash
a365 publish
```

In CLI 1.1+, this command:
1. Reads the manifest and updates `bots[0].botId`, `webApplicationInfo.id`, and the `copilotAgents.customEngineAgents` ID from `a365.generated.config.json` (the CLI handles ID substitution end-to-end; Step 9.7.3 is read-only verification).
2. Packages the manifest + icons into `manifest.zip` (or `appPackage.zip` for Teams Toolkit projects).

`a365 publish` produces a package; it does **not** upload anything and it does **not** register or change the bot messaging endpoint. The endpoint was already registered by `a365 setup all --m365` in Step 9.7.1. Upload of the produced zip to Microsoft 365 Admin Center is a manual step the user (or a Teams Administrator) performs after publish completes.

Use `a365 publish --dry-run` first if you want to preview the manifest ID substitutions without writing files or producing the zip.

| Output | Action |
|--------|--------|
| `"Package created"` / `"manifest.zip written"` | Proceed to upload below |
| `"name.short ... EXCEEDS 30 chars"` warning | The CLI's own length warning fired (see [PublishCommand.cs](https://github.com/microsoft/Agent365-devTools/blob/main/src/Microsoft.Agents.A365.DevTools.Cli/Commands/PublishCommand.cs)) — Step 9.7.1b's pre-flight was bypassed, or this is a reused blueprint from 9.7.1a path 1. The blueprint is already provisioned with a long name. Two remediation paths: (i) edit `a365.generated.config.json#agentBlueprintDisplayName` to a value ≤ 30 chars, then re-run `a365 publish` — the Entra app's display name will mismatch the manifest cosmetically but publish will succeed; (ii) `a365 cleanup --agent-name <name>`, then re-run Step 9.7.1b with a name ≤ 20 chars. |
| `"Manifest validation failed"` (any schema error) | Re-run `a365 setup all --aiteammate` (idempotent) so the CLI regenerates the manifest fields, then retry `a365 publish`. If the error persists, show the CLI output verbatim to the user and report to the A365 CLI team — do NOT hand-edit `manifest.json`. |

**Upload the produced package to Microsoft 365 Admin Center** (this is always a manual step — there is no CLI upload API yet):
> Tell the user: "Upload `manifest.zip` (or `appPackage.zip` for Teams Toolkit projects) at **Microsoft 365 Admin Center → Agents → All agents → Upload custom agent**. Org-wide install requires a Teams Administrator."

**Sideload fallback** (installs for current user only, no Teams Admin role required): upload the same zip `a365 publish` produced via **Teams → Apps → Manage your apps → Upload an app → Upload a custom app**. Do not re-run `a365 publish` for the sideload — the package is already there.

---

## Step 9.7.5 — Verify agent configuration in Teams Developer Portal

**Run only when `runTarget = "prod"`.** Skip entirely for `runTarget = "local"`.

This is normally a **verification**, not a manual configuration. Step 9.7.2c already ran `a365 setup blueprint --update-endpoint <chosenEndpoint> --m365`, and with `--m365` the CLI's [`TeamsGraphBackendConfigurator`](https://github.com/microsoft/Agent365-devTools/blob/main/src/Microsoft.Agents.A365.DevTools.Cli/Services/TeamsGraphBackendConfigurator.cs) calls the MCP Platform `createAgentBlueprint` endpoint (which proxies to Teams Graph) and sets the bot `callbackUri` — the same value the Developer Portal shows as **Notification URL**. So on supported tenants this is **already set** and you only need to confirm it. Reference: [Create agent instance → Configure agent in Teams Developer Portal](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance#1-configure-agent-in-teams-developer-portal).

Walk the user through these steps:

1. Read `agentBlueprintId` and `messagingEndpoint` from `a365.generated.config.json` and show both values to the user.
2. Build the Developer Portal configuration URL and present it to the user:

   ```
   https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration
   ```

   Substitute `<agentBlueprintId>` with the value from step 1.
3. Tell the user to open that URL in their browser and **verify**:
   - **Agent Type** is **API Based**.
   - **Notification URL** equals the `messagingEndpoint` value from `a365.generated.config.json` (e.g. `https://<your-app>.azurewebsites.net/api/messages`).
4. **If both already match → nothing to do.** Note this to the user and continue to Step 9.7.6.
5. **Manual fallback — only if the Notification URL is blank/wrong, or Step 9.7.2c logged** *"Automated messaging endpoint registration is not available for this tenant yet — you'll need to configure it manually"*: set **Agent Type** = **API Based**, set **Notification URL** = the `messagingEndpoint` value, click **Save**, wait for the "Saved successfully" confirmation, then ask the user to confirm before continuing.

> **Automated registration is tenant-dependent.** On tenants where the MCP Platform `createAgentBlueprint` proxy isn't enabled yet, the CLI surfaces the "not available for this tenant" message in Step 9.7.2c — in that case this step is the manual configuration it used to be. Otherwise it's a quick visual confirm.

> **If the user doesn't have access to the Developer Portal:** they must contact their tenant administrator either to grant access or to verify/complete this configuration on their behalf.

> **If the bot messaging endpoint changes later** (e.g. the dev tunnel URL or the Azure Web App URL): re-run `a365 setup blueprint --update-endpoint <new-url> --m365` — that re-registers the Notification URL via Teams Graph. Then return to this Developer Portal page and **verify** it updated (set it by hand only if the tenant lacks automated registration). `--m365` is required — without it the CLI skips the Teams Graph re-registration silently.

---

## Step 9.7.6 — Request an agent instance and wait for admin approval

**Run only when `runTarget = "prod"`.** Skip entirely for `runTarget = "local"`.


The blueprint is registered and the Dev Portal is configured, but **no agent instance exists yet**. A tenant admin must approve an instance before users can interact with the agent in Teams.

1. Tell the user to open Microsoft Teams → **Apps** → search for the agent by name → click **Request Instance** (or **Create Instance**). Teams submits the request to the tenant admin.
2. Give the admin this link to approve:

   ```
   https://admin.cloud.microsoft/#/agents/all/requested
   ```

   The admin reviews and approves the request; Teams then provisions the instance and creates the agent user. This is asynchronous — propagation typically takes a few minutes but can take up to a few hours before the agent user becomes searchable in Teams.
3. Reference: [Create agent instance — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance#2-create-agent-instance).

> **If the Request Instance button is disabled or doesn't work:** Microsoft Agent 365 Frontier may not be enabled for the tenant. The admin must enable it before instances can be created.

---

## Step 9.7.7 — Smoke Test

Guide the user through a quick end-to-end test, branching on `runTarget`:

**For `runTarget = "prod"`:** offer **Option A** (Teams) — requires the agent instance to have been admin-approved in Step 9.7.6. Option B (AgentsPlayground) is also fine as a quick sanity check before the admin approval lands.

**For `runTarget = "local"`:** offer **only Option B** (AgentsPlayground). Teams won't work because publish + Dev Portal + instance request were skipped.

**Option A — Microsoft Teams** (Prod only; if `--m365` was used and the agent instance has been approved):
1. Teams → **Chat** → search for the agent by UPN or display name.
2. Send: `"Hello"` — the agent should respond within a few seconds.
3. Watch terminal/logs for activity handler invocations.

**Option B — AgentsPlayground** (any configuration):
```bash
agentsplayground
```
Connect to `http://localhost:3978/api/messages` (or the dev tunnel URL) and send a test message.

**Terminal log signals to watch for:**
- Node.js: `[A365] Activity received: message`
- .NET: `ActivityHandler: OnMessageActivityAsync called`
- Python: `process_user_message called`
- If observability was added: OTel span lines with `a365.span`

**Troubleshooting:**

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No response in Teams | Dev Portal Notification URL not saved, or it doesn't match the blueprint's `messagingEndpoint` | Re-do Step 9.7.4 at `https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration`: confirm **Agent Type = API Based** and **Notification URL** matches `messagingEndpoint` from `a365.generated.config.json`. If the endpoint itself is wrong, fix with `a365 setup blueprint --update-endpoint <new-url>` first, then update the Dev Portal Notification URL to match. |
| Agent appears in Teams Apps search but `Request Instance` is disabled or no instance after admin approval | Microsoft Agent 365 Frontier not enabled for the tenant | Tenant admin must enable Frontier. See [What is Frontier](https://support.microsoft.com/en-us/topic/what-is-frontier-17c671e0-1906-4d9d-892c-68e11fbff4c7). |
| No welcome / first message from agent in Teams chat | Blueprint missing `Chat.Create` inheritable permission. `Chat.Create` is needed to create a new 1:1 chat; without it the agent can't send the first message until the user initiates one. | Add `Chat.Create` to the blueprint's inheritable permissions (Entra → App registrations → Blueprint app → API permissions), then re-provision the agent instance. See [Configure inheritable permissions](https://learn.microsoft.com/en-us/entra/agent-id/identity-professional/configure-inheritable-permissions-blueprints). |
| `401 Unauthorized` in logs | App ID / secret mismatch | Confirm `MICROSOFT_APP_ID` and `MICROSOFT_APP_PASSWORD` in `.env` match the registered app |
| `Connection refused` on tunnel | Tunnel not running | `devtunnel host <name>` |
| `404` on `/api/messages` | Agent not started | `npm start` / `dotnet run` / `python host_agent_server.py` |
| `HTTP 502 Bad Gateway` from tunnel URL | Port registered as `https` — relay attempts TLS handshake against local plain-HTTP server | `devtunnel port delete <name> -p <port>` then `devtunnel port create <name> -p <port> --protocol http`; restart `devtunnel host <name>` |
| `devtunnel: command not found` after install | Shell PATH not refreshed | Restart the terminal; on Windows also run `refreshenv` if using Chocolatey |


---

