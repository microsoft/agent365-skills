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

**Do NOT trust `has_setup` from the cache alone** — `a365.generated.config.json` may have been created or deleted since the cache was last refreshed. Re-check now:

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

Branch on the answer:

- **1 (Reuse):** Skip the rest of Step 9.7.1 entirely. Read `agentBlueprintId` and `messagingEndpoint` from `a365.generated.config.json` and jump to Step 9.7.2. Update the detection cache field `has_setup = true` if it wasn't already.
- **2 (Re-run):** Continue with the setup-all flow below (Step 9.7.1b). The CLI will detect the existing blueprint and reuse the ID.
- **3 (Fresh):** Run `a365 cleanup --agent-name <name>` first with an explicit *"Type yes to confirm destructive cleanup"* gate. Only after cleanup succeeds, continue with the setup-all flow below.

**Otherwise** (no `a365.generated.config.json` on disk, or `agentBlueprintId` empty) → no existing blueprint, continue with the setup-all flow below.

### Step 9.7.1b — Run setup-all (when reached from 9.7.1a paths 2, 3, or "no blueprint")

Ask the user for the **agent name** (reuse from session context if available, otherwise ask). Then show a dry-run first:

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

- **`runTargetHosting = "devtunnel"`:** if no `https://...devtunnels.ms` URL is present in `a365.generated.config.json`, walk the user through the canonical Dev Tunnel setup ([reference](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels)):

  ```bash
  # 1. Sign in
  devtunnel user login
  # 2. Create a persistent tunnel — returns a tunnel ID
  devtunnel create --allow-anonymous
  # 3. Configure the tunnel port (3978 for Python/Node.js, 5000 for .NET if used)
  devtunnel port create <tunnel-id> -p 3978
  # 4. Start hosting (leave running in a separate terminal)
  devtunnel host <tunnel-id>
  ```

  The host command prints a tunnel URL like `https://abc123xyz.devtunnels.ms:3978`. Ask the user to paste it. Append `/api/messages` and store as `chosenEndpoint`. Verify the tunnel is active by running `devtunnel list` and confirming **Host Connections** is `>0`.

- **`runTargetHosting = "cloud"`:** ask the user for the full messaging endpoint URL (must be HTTPS and end in `/api/messages`). If they don't have one yet, point them at the appropriate deploy guide above for their chosen platform. Store as `chosenEndpoint`.

### Step 9.7.2c — Reconcile endpoint with the blueprint

Compare `chosenEndpoint` against the `messagingEndpoint` recorded in `a365.generated.config.json` (set by `a365 setup all --m365` in Step 9.7.1).

- **If they match:** nothing to do. Note this to the user.
- **If they differ:** the blueprint's messaging endpoint must be updated to the chosen one — this is also what the Dev Portal Notification URL will be set to in Step 9.7.5:

  ```bash
  a365 setup blueprint --update-endpoint <chosenEndpoint>
  ```

  Run it, then re-read `a365.generated.config.json` and confirm `messagingEndpoint` now equals `chosenEndpoint`.

After reconciliation, `a365.generated.config.json` is authoritative — Step 9.7.5 will read `messagingEndpoint` from it and use that exact value in the Teams Developer Portal Notification URL field.

### Step 9.7.2d — Validate environment configuration for the chosen target

Before continuing to publish (prod) or AgentsPlayground (local), verify the project's config file (`.env` for Python/Node.js; `appsettings.json` + `launchSettings.json` for .NET) has the values required by the chosen target. The full canonical list is in [Test agents — Configure agent testing environment](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/testing) (per-language tabs).

**Common required variables — applies to both Prod and Local:**

| Concern | Python `.env` | Node.js `.env` | .NET `appsettings.json` |
|---|---|---|---|
| Agentic auth flag | `USE_AGENTIC_AUTH=true` | `USE_AGENTIC_AUTH=true` | (built-in via `AgentApplication`) |
| Blueprint client ID | `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=<agentBlueprintId>` | `connections__service_connection__settings__clientId=<agentBlueprintId>` | `AgentBluePrint.Settings.ClientId` |
| Blueprint client secret | `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=<agentBlueprintClientSecret>` | `connections__service_connection__settings__clientSecret=<agentBlueprintClientSecret>` | `AgentBluePrint.Settings.ClientSecret` |
| Tenant ID | `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=<tenantId>` | `connections__service_connection__settings__tenantId=<tenantId>` | `AgentBluePrint.Settings.TenantId` |
| Auth handler type | `AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__TYPE=AgenticUserAuthorization` | `agentic_type=agentic` | `AgentApplication.UserAuthorization.Handlers.agentic.Type=AgenticUserAuthorization` |
| Auth handler scopes | `AGENTAPPLICATION__USERAUTHORIZATION__HANDLERS__AGENTIC__SETTINGS__SCOPES=https://graph.microsoft.com/.default` | `agentic_scopes=https://graph.microsoft.com/.default` | `AgentApplication.UserAuthorization.Handlers.agentic.Settings.Scopes` |
| Connection map | `CONNECTIONSMAP_0_SERVICEURL=*` + `CONNECTIONSMAP_0_CONNECTION=SERVICE_CONNECTION` | `connectionsMap__0__serviceUrl=*` + `connectionsMap__0__connection=service_connection` | `ConnectionsMap[0]` |
| LLM (one of) | `OPENAI_API_KEY=...` OR `AZURE_OPENAI_API_KEY=` + `AZURE_OPENAI_ENDPOINT=` + `AZURE_OPENAI_DEPLOYMENT=` + `AZURE_OPENAI_API_VERSION=` | (same) | `AIServices.OpenAI.*` OR `AIServices.AzureOpenAI.*` + `AIServices.UseAzureOpenAI` |
| MCP endpoint | `MCP_PLATFORM_ENDPOINT=` (optional; defaults to prod) | (same) | `MCP_PLATFORM_ENDPOINT` in `launchSettings.json` env vars |
| Observability | `ENABLE_A365_OBSERVABILITY_EXPORTER=true` + `A365_OBSERVABILITY_LOG_LEVEL=info` | (same) | (same in `appsettings.json`) |
| Server port | `PORT=3978` | `PORT=3978` | `applicationUrl` in `launchSettings.json` (e.g. `https://localhost:64896;http://localhost:64897`) |

Pull `<agentBlueprintId>`, `<agentBlueprintClientSecret>`, `<tenantId>` from `a365.generated.config.json` (set by Step 9.7.1). For .NET, blueprint client secret is sensitive — prefer `dotnet user-secrets` over committing to `appsettings.json`.

**For `runTarget = "prod"` — additional verification:**

1. **`a365.generated.config.json` is complete:**
   - **`completed: true`** — if `false`, the OAuth2 permission grants are still pending. Surface the PowerShell script printed by the original `a365 setup all` output and tell the user a Global Administrator must complete the grants before prod can serve traffic.
   - **`resourceConsents` non-empty** — empty means consent hasn't been recorded; same GA handoff applies.
   - `agentBlueprintId`, `agentBlueprintClientSecret`, `tenantId`, `messagingEndpoint` all populated and non-empty.

2. **Prod-only env-var checklist — these MUST be set (in addition to the common table above) and they differ from local-dev defaults.** Verify them in the cloud platform's effective config, not just the local `.env` (use the inspection command in step 3 below):

   | Concern | Python `.env` | Node.js `.env` | .NET `appsettings.json` |
   |---|---|---|---|
   | Active auth handler — must point at agentic in prod | `AUTH_HANDLER_NAME=AGENTIC` (under `# A365 Authentication`). The Python code reads this env var to pick a handler at runtime; empty leaves the agent with no handler and every Teams message fails token exchange. | Not env-driven — `MyAgent.authHandlerName = 'agentic'` is set in code. Verify the constant matches the registered auth handler in `agentic_type=agentic`. | Not env-driven — `AgentApplication:AgenticAuthHandlerName=agentic` lives in `appsettings.json`. Verify the value is `agentic`. |
   | A365 observability exporter — must be true in prod (false would mean console-only / no traces in Agent 365 portal or Defender) | `ENABLE_A365_OBSERVABILITY_EXPORTER=true` | `ENABLE_A365_OBSERVABILITY_EXPORTER=true` (or `a365.enableObservabilityExporter: true` in code) | `ENABLE_A365_OBSERVABILITY_EXPORTER=true` in app-service env vars (or `Logging.OpenTelemetry` config wiring) |

   If any value is wrong or missing, fix it before continuing to Step 9.7.3.

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
- **`runTarget = "prod"`** → continue with Step 9.7.3 (Verify manifest) and the full publish / Dev Portal / instance pipeline. Dev Portal Notification URL (Step 9.7.5) = the reconciled `messagingEndpoint`.
- **`runTarget = "local"`** → skip Steps 9.7.3 – 9.7.6 entirely. Jump directly to Step 9.7.7 — AgentsPlayground only.

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
| `"Manifest validation failed"` (any schema error) | Re-run `a365 setup all --aiteammate` (idempotent) so the CLI regenerates the manifest fields, then retry `a365 publish`. If the error persists, show the CLI output verbatim to the user and report to the A365 CLI team — do NOT hand-edit `manifest.json`. |

**Upload the produced package to Microsoft 365 Admin Center** (this is always a manual step — there is no CLI upload API yet):
> Tell the user: "Upload `manifest.zip` (or `appPackage.zip` for Teams Toolkit projects) at **Microsoft 365 Admin Center → Agents → All agents → Upload custom agent**. Org-wide install requires a Teams Administrator."

**Sideload fallback** (installs for current user only, no Teams Admin role required): upload the same zip `a365 publish` produced via **Teams → Apps → Manage your apps → Upload an app → Upload a custom app**. Do not re-run `a365 publish` for the sideload — the package is already there.

---

## Step 9.7.5 — Configure agent in Teams Developer Portal (REQUIRED)

**Run only when `runTarget = "prod"`.** Skip entirely for `runTarget = "local"`.


This is a **required manual step**. Without it, Teams will not deliver messages to the agent — the agent will appear in search results but not respond to any message. The CLI does not do this for you. Reference: [Create agent instance → Configure agent in Teams Developer Portal](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/create-instance#1-configure-agent-in-teams-developer-portal).

Walk the user through these exact steps:

1. Read `agentBlueprintId` and `messagingEndpoint` from `a365.generated.config.json` and show both values to the user.
2. Build the Developer Portal configuration URL and present it to the user:

   ```
   https://dev.teams.microsoft.com/tools/agent-blueprint/<agentBlueprintId>/configuration
   ```

   Substitute `<agentBlueprintId>` with the value from step 1.
3. Tell the user to open that URL in their browser, then:
   - Set **Agent Type** to **API Based**.
   - Set **Notification URL** to the `messagingEndpoint` value from `a365.generated.config.json` (e.g. `https://<your-app>.azurewebsites.net/api/messages`).
   - Click **Save** and wait for the "Saved successfully" confirmation.
4. Ask the user to confirm they've saved before continuing.

> **If the user doesn't have access to the Developer Portal:** they must contact their tenant administrator either to grant access or to complete this configuration on their behalf. This cannot be done via the CLI.

> **If the bot messaging endpoint changes later** (e.g. the dev tunnel URL or the Azure Web App URL): update the blueprint via `a365 setup blueprint --update-endpoint <new-url>`, then return to this Developer Portal page and update the Notification URL to match. Both must agree.

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
| `Connection refused` on tunnel | Tunnel not running | `devtunnel host <name> --port 3978` |
| `404` on `/api/messages` | Agent not started | `npm start` / `dotnet run` / `python host_agent_server.py` |


---

