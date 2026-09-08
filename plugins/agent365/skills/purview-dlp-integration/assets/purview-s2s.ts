// ────────────────────────────────────────────────────────────────────────────
// Microsoft Purview DLP + Audit guard — S2S (app-only) variant for A365 agents.
//
// Use this instead of purview.ts when the agent is an S2S / autonomous agent with NO
// signed-in user and NO @microsoft/agents-hosting AgentApplication (e.g. an Express or
// worker-loop agent authenticating via the A365 FMI client-credentials chain).
//
// ── WHY A SEPARATE GUARD (verified 2026-08-26 in a live tenant) ─────────────
//  The delegated guard (purview.ts) needs an agentic `/me` token, which an S2S agent does
//  not have. The blocker in the base skill — "blueprint app-only tokens get Content.Process
//  stripped" — is REAL for the *blueprint* app, but NOT for the *agent identity*:
//    • Blueprint app-only Graph token  → roles: AgentIdentity.CreateAsManager   (STRIPPED)
//    • Agent-identity FMI Graph token  → roles: Content.Process.All             (RETAINED)
//  So this guard mints the AGENT IDENTITY's Graph token via the FMI 3-hop chain and calls
//  the app-only endpoint  POST /beta/users/{sponsorUserId}/dataSecurityAndGovernance/processContent
//  with an `agents:[aiAgentInfo]` entry (blueprintId) — the "AI Agent" shape from the Graph docs.
//
// ── PREREQUISITE ─────────────────────────────────────────────────────────────
//  Grant the `Content.Process.All` (Application) Graph role to the AGENT IDENTITY service
//  principal (NOT the blueprint) — see scripts/Grant-ContentProcessAppRole.ps1.
//
// ── REQUIRED ENV (auto-read from the A365 `agent365Observability__*` S2S vars) ─
//   PURVIEW_DLP_ENABLED=true
//   agent365Observability__tenantId / __clientId (blueprint) / __agentId (agent identity)
//     / __clientSecret / __agentBlueprintId / __sponsorUserId / __agentName
// ── OPTIONAL ENV ─────────────────────────────────────────────────────────────
//   PURVIEW_APP_ID=<app id the DLP policy is scoped to>  // default: __agentBlueprintId
//   PURVIEW_SPONSOR_USER_ID=<user object id>            // default: __sponsorUserId
//   PURVIEW_FAIL_MODE=closed|open (default closed) / PURVIEW_CHECK_OUTPUT=true
//   PURVIEW_TIMEOUT_MS=5000 / PURVIEW_DEBUG=false
//
// ⚠️ Every contentEntry MUST have a non-empty `name`, else Graph returns a permanent
//    BadRequest that looks like a clean allow. This guard always sets it and treats any
//    `processingErrors` as fail-closed.
// ────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { randomUUID } from "node:crypto";

const TOKEN_HOST = "https://login.microsoftonline.com";
const GRAPH_BASE = "https://graph.microsoft.com/beta";
const FMI_SCOPE = "api://AzureADTokenExchange/.default";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh at 50 min

type DlpActivity = "uploadText" | "downloadText";
type DlpDecision = "allowed" | "blocked" | "error" | "disabled";

export interface DlpVerdict {
  /** True => stop the turn. */
  blocked: boolean;
  decision: DlpDecision;
  detail?: string;
}

interface ProcessContentResponse {
  protectionScopeState?: string;
  policyActions?: Array<Record<string, unknown>>;
  processingErrors?: Array<Record<string, unknown>>;
}

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** A block is any restrictAccess action whose restrictionAction === "block". */
function isBlock(actions?: Array<Record<string, unknown>>): boolean {
  return !!actions?.some((a) => String(a.restrictionAction ?? "").toLowerCase() === "block");
}

export class PurviewS2SGuard {
  private readonly enabled: boolean;
  private readonly failClosed: boolean;
  private readonly checkOutput: boolean;
  private readonly timeoutMs: number;
  private readonly debug: boolean;

  private readonly tenantId: string;
  private readonly blueprintId: string; // FMI Hop 1+2 client
  private readonly agentId: string; // FMI path + Hop 3 client (agent identity)
  private readonly clientSecret: string;
  private readonly appId: string; // applicationLocation / DLP policy scope
  private readonly sponsorUserId: string; // /users/{id} target
  private readonly agentName: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    this.enabled = envBool("PURVIEW_DLP_ENABLED", false);
    this.failClosed = (process.env.PURVIEW_FAIL_MODE ?? "closed").trim().toLowerCase() !== "open";
    this.checkOutput = envBool("PURVIEW_CHECK_OUTPUT", true);
    this.timeoutMs = Number(process.env.PURVIEW_TIMEOUT_MS) || 5000;
    this.debug = envBool("PURVIEW_DEBUG", false);

    this.tenantId = process.env.agent365Observability__tenantId ?? "";
    this.blueprintId = process.env.agent365Observability__clientId ?? "";
    this.agentId = process.env.agent365Observability__agentId ?? "";
    this.clientSecret = process.env.agent365Observability__clientSecret ?? "";
    this.appId =
      process.env.PURVIEW_APP_ID ?? process.env.agent365Observability__agentBlueprintId ?? this.blueprintId;
    this.sponsorUserId =
      process.env.PURVIEW_SPONSOR_USER_ID ?? process.env.agent365Observability__sponsorUserId ?? "";
    this.agentName = (process.env.agent365Observability__agentName ?? "AI Agent").trim() || "AI Agent";

    if (this.enabled && (!this.tenantId || !this.agentId || !this.blueprintId || !this.sponsorUserId)) {
      console.warn(
        "[purview] PURVIEW_DLP_ENABLED=true but S2S config incomplete (need tenantId, agentId, " +
          "blueprintId, sponsorUserId). Every turn will fail-closed.",
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
  get isCheckOutput(): boolean {
    return this.checkOutput;
  }

  /** Evaluate the user's prompt BEFORE it reaches the LLM. */
  evaluatePrompt(text: string): Promise<DlpVerdict> {
    return this.evaluate("uploadText", text);
  }
  /** Evaluate the model's response BEFORE it's used/sent. */
  evaluateResponse(text: string): Promise<DlpVerdict> {
    return this.evaluate("downloadText", text);
  }

  private failVerdict(detail: string): DlpVerdict {
    return { blocked: this.failClosed, decision: "error", detail };
  }

  // ── FMI 3-hop token (Blueprint → FMI path → Agent Identity → Graph) ─────────
  private async getGraphToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) return this.cachedToken;
    const authority = `${TOKEN_HOST}/${this.tenantId}/oauth2/v2.0/token`;

    // Hop 1+2: Blueprint (client secret) → T1 via FMI path. MSAL doesn't serialize fmi_path,
    // so use a direct form POST (same workaround as the observability token service).
    const r12 = await fetch(authority, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.blueprintId,
        client_secret: this.clientSecret,
        scope: FMI_SCOPE,
        grant_type: "client_credentials",
        fmi_path: this.agentId,
      }).toString(),
    });
    if (!r12.ok) throw new Error(`FMI hop1+2 failed (${r12.status}): ${await r12.text()}`);
    const t1 = ((await r12.json()) as { access_token?: string }).access_token;
    if (!t1) throw new Error("FMI hop1+2 returned no access_token");

    // Hop 3: Agent Identity uses T1 as a client assertion → Graph app-only token.
    const r3 = await fetch(authority, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.agentId,
        client_assertion: t1,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        scope: GRAPH_SCOPE,
        grant_type: "client_credentials",
      }).toString(),
    });
    if (!r3.ok) throw new Error(`FMI hop3 (Graph) failed (${r3.status}): ${await r3.text()}`);
    const token = ((await r3.json()) as { access_token?: string }).access_token;
    if (!token) throw new Error("FMI hop3 returned no access_token");

    this.cachedToken = token;
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  private async evaluate(activity: DlpActivity, text: string): Promise<DlpVerdict> {
    if (!this.enabled) return { blocked: false, decision: "disabled" };
    if (!text?.trim()) return { blocked: false, decision: "allowed" };

    let token: string;
    try {
      token = await this.getGraphToken();
    } catch (err) {
      const detail = `token acquisition failed: ${(err as Error).message}`;
      console.error(`[purview] ${activity} -> ${this.failClosed ? "BLOCKED" : "allowed"} (${detail})`);
      return this.failVerdict(detail);
    }

    const now = new Date().toISOString().replace(/\.\d+Z$/, "");
    const body = {
      contentToProcess: {
        contentEntries: [
          {
            "@odata.type": "microsoft.graph.processConversationMetadata",
            identifier: randomUUID(),
            content: { "@odata.type": "microsoft.graph.textContent", data: text },
            agents: [
              {
                "@odata.type": "microsoft.graph.aiAgentInfo",
                blueprintId: this.appId,
                identifier: this.agentId,
                name: this.agentName,
                version: "1.0",
              },
            ],
            name: `${this.agentName} ${activity}`, // REQUIRED non-empty name
            correlationId: randomUUID(),
            sequenceNumber: activity === "uploadText" ? 0 : 1,
            isTruncated: false,
            createdDateTime: now,
            modifiedDateTime: now,
          },
        ],
        activityMetadata: { activity },
        deviceMetadata: {
          operatingSystemSpecifications: { operatingSystemPlatform: "Linux", operatingSystemVersion: "unknown" },
          ipAddress: "127.0.0.1",
        },
        protectedAppMetadata: {
          name: this.agentName,
          version: "1.0",
          applicationLocation: { "@odata.type": "microsoft.graph.policyLocationApplication", value: this.appId },
        },
        integratedAppMetadata: { name: this.agentName, version: "1.0" },
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${GRAPH_BASE}/users/${this.sponsorUserId}/dataSecurityAndGovernance/processContent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Client-Request-Id": randomUUID(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        console.error(`[purview] ${activity} -> ${this.failClosed ? "BLOCKED" : "allowed"} (${detail})`);
        return this.failVerdict(detail);
      }

      const json = (await res.json()) as ProcessContentResponse;
      if (this.debug) console.log(`[purview] ${activity} raw:`, JSON.stringify(json));

      if (json.processingErrors && json.processingErrors.length > 0) {
        const detail = `processingErrors=${JSON.stringify(json.processingErrors)}`;
        console.error(`[purview] ${activity} -> ${this.failClosed ? "BLOCKED" : "allowed"} (${detail})`);
        return this.failVerdict(detail);
      }

      const actions = json.policyActions ?? [];
      const blocked = isBlock(actions);
      console.log(
        `[purview] ${activity} -> ${blocked ? "BLOCKED" : "allowed"} ` +
          `(HTTP 200, ${actions.length} policyAction(s), scopeState=${json.protectionScopeState ?? "?"}, errors=0)`,
      );
      return blocked
        ? { blocked: true, decision: "blocked", detail: `${actions.length} policyAction(s)` }
        : { blocked: false, decision: "allowed" };
    } catch (err) {
      const detail =
        (err as Error).name === "AbortError" ? `timeout after ${this.timeoutMs}ms` : (err as Error).message;
      console.error(`[purview] ${activity} -> ${this.failClosed ? "BLOCKED" : "allowed"} (${detail})`);
      return this.failVerdict(detail);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const purviewGuard = new PurviewS2SGuard();
