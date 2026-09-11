# Purview Portal Enablement Guide (Agent 365 DLP)

Steps that must (or can) be done in the Microsoft Purview portal / Entra, for the parts that
aren't covered by the scripts in `../scripts/`. Hand this to whoever holds **Compliance
Administrator** + **Global/Application Administrator** in the customer tenant.

---

## 0. Tenant prerequisites (do these first)

DLP for AI apps is a metered Purview capability. If these aren't in place, `processContent`
returns a clean **`0 policyAction(s)`** and nothing ever blocks — with no obvious error.

1. **Licensing** — Microsoft 365 E5 / E5 Compliance (or equivalent) for the users/agents.
2. **Purview pay‑as‑you‑go billing** — an Azure subscription linked to Purview for the metered
   AI/DSPM features. Purview portal → **Settings → Billing** (or DSPM for AI onboarding prompts).
3. **DSPM for AI onboarded** — Purview portal → **DSPM** → **AI observability** (the current
   version, *not* "DSPM for AI (classic)"). Confirm your agent instance appears here.

> Rule of thumb: if you've verified the agent code, the delegated scope, and the policy config,
> and it *still* returns `0 policyAction(s)` with **no `processingErrors`**, the cause is almost
> always one of the three items above.

---

## 1. Delegated Graph scope on the agent (usually via script)

The guard needs the delegated **`Content.Process.User`** scope on the agent's Graph consent.
Preferred: run [`../scripts/Grant-DelegatedGraphScope.ps1`](../scripts/Grant-DelegatedGraphScope.ps1).

If you must do it by hand, **do not** use "Grant admin consent" on the blueprint app's API
permissions page — that can wipe the agent's broad agentic consent and break sign‑in
(`AADSTS65001`). Instead add the delegated permission and consent **only that scope**, or use the
script which appends it to the existing grant.

---

## 2. Create the DLP policy

Preferred: run [`../scripts/New-AiAppDlpPolicy.ps1`](../scripts/New-AiAppDlpPolicy.ps1). To do it
in the portal instead:

1. Purview portal → **Data Loss Prevention → Policies → + Create policy** (or **DSPM → Policies**).
2. **Category/Template:** Custom → Custom policy.
3. **Locations:** turn on **only** the AI‑app location and turn everything else **off**:
   - The location is surfaced as **"Managed cloud apps"** (it maps to the `Applications`
     workload). Edit it and scope to **your agent's Entra app** (search by app name / id).
   - ❗ Do **not** also enable Exchange / SharePoint / OneDrive / Teams in the same policy — the
     portal rejects mixing them with the AI‑app location
     (`ErrorUnsupportedEnforcementPlanesException`). Make it a **dedicated** policy.
4. **Rule → Conditions:** *Content contains* → **Sensitive info types** → e.g. **Credit Card Number**.
5. **Rule → Actions:** **Restrict access or encrypt the content** → **Block**.
   (An *audit / alert‑only* action will **not** block. In the API this shows as
   `RestrictAccess`, not `BlockAccess`.)
6. **Policy mode:** **Turn it on / Enforce** (not simulation/test).
7. Save. Allow up to ~1 hour to propagate.

> The "Microsoft 365 Copilot and Copilot Chat" location is **first‑party Copilot only** — it is
> *not* your custom agent. Use **Managed cloud apps** scoped to your app.

---

## 3. Verify in the portal (optional)

- **Purview → Audit** and **DSPM → AI activities**: prompts/responses evaluated by the agent
  appear here (audit is written by every `processContent` call).
- Don't rely on a policy's **`DistributionStatus`** — many tenants show **`Pending`** even for
  policies that are fully live. Judge success by the agent's `[purview]` log line.

---

## What can / can't be automated

| Task | CLI/script | Portal only |
|------|-----------|-------------|
| Grant delegated `Content.Process.User` | ✅ `Grant-DelegatedGraphScope.ps1` | ✅ |
| Create the AI‑app DLP policy + block rule | ✅ `New-AiAppDlpPolicy.ps1` | ✅ |
| Enable pay‑as‑you‑go billing | ❌ | ✅ Settings → Billing |
| Onboard DSPM for AI | ❌ | ✅ DSPM → AI observability |
| Assign E5/Compliance licenses | ❌ (admin center) | ✅ |
