# Troubleshooting — Agent 365 Purview DLP

Read the agent's console. Every `processContent` call logs a `[purview] …` line. Judge success
by that line, not by the Purview portal.

## The logs you'll see

| Log line | Meaning |
|----------|---------|
| `[purview] uploadText -> allowed (HTTP 200, 0 policyAction(s), scopeState=notModified, errors=0)` | Request accepted, **no policy matched** (or not propagated / tenant not enabled). |
| `[purview] uploadText -> BLOCKED (HTTP 200, 1 policyAction(s), scopeState=modified, errors=0)` | ✅ Working — content blocked, LLM not called. |
| `[purview] uploadText -> REQUEST ERROR (… errors=1) errors=[{"code":"BadRequest",…}]` | Our **request is malformed** — Purview didn't evaluate. Fix the request (see below). |
| `[purview] uploadText HTTP 403 …InsufficientGraphPermissions` | Token is missing the DLP scope. See "403" below. |
| `[purview] … error … timeout` | Network/timeout → fail‑closed (blocked). |

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `errors=1`, message *"The provided data for Name is invalid"* | The `contentEntry.name` field is missing/empty. | Keep the `name` field in the guard's request body (the template already sets it to `"<AppName> message"`); ensure `PURVIEW_APP_NAME` is non‑empty. |
| `HTTP 403 InsufficientGraphPermissions` | Agentic token lacks `Content.Process.User`, **or** you tried app‑only client‑credentials (blueprint app‑only tokens drop data‑plane roles). | Run `Grant-DelegatedGraphScope.ps1`; ensure the guard uses the **agentic delegated** token (it does — Node.js `GetAgenticUserToken`, Python `exchange_token`, .NET `GetTurnTokenAsync`). Restart the agent. |
| Agent stopped signing in after granting permissions (`AADSTS65001 consent_required`) | Someone ran `az ad app permission admin-consent` on the blueprint app and narrowed the agentic consent. | Re‑run your A365 setup (`a365 setup all …`) to restore consent. Grant the DLP scope with the script (append), never admin‑consent. |
| `0 policyAction(s)`, `errors=0`, forever | Policy not scoped to this app / not propagated / tenant not enabled. | 1) Confirm the policy's **Managed cloud apps** location = this app id. 2) Wait ~1h. 3) Check tenant prerequisites (billing + DSPM for AI) — see the portal guide. |
| Policy `DistributionStatus: Pending` | Unreliable field — shows Pending even for live policies in many tenants. | Ignore it. Judge by the `[purview]` log. |
| Portal won't let you add the AI‑app location to your existing DLP policy | You're mixing it with Exchange/SharePoint/OneDrive/Teams. | Create a **dedicated** AI‑app policy (the script does this). |
| Rule creation fails: `BlockAccess … not allowed for Applications workload` | Wrong action param for AI apps. | Use `-RestrictAccess @(@{setting='UploadText';value='Block'})`, not `-BlockAccess`. |
| Teams shows "This message was blocked" but the agent still replies | That's **Teams message DLP** (a different policy), not the agent gate. | Unrelated to this integration — judge the agent gate by the `[purview]` log. |
| The agent's own LLM refuses (e.g. "I can't repeat card numbers") | Model safety behavior, not the DLP gate. | Not this integration. |

## Fast isolation checklist
1. `PURVIEW_DLP_ENABLED=true`? Agent restarted after env change?
2. `[purview]` line present at all? If not, the gate isn't wired into that handler.
3. `errors=0`? If not, fix the request (usually the `name` field).
4. Token OK (no 403)? If 403, grant the delegated scope.
5. Use a **Luhn‑valid** test value (e.g. credit card `4111 1111 1111 1111`) — invalid numbers won't match the SIT.
6. Still `0 policyAction(s)` with `errors=0`? → policy scope / propagation / tenant enablement (portal guide).
