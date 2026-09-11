// ────────────────────────────────────────────────────────────────────────────
// Microsoft Purview DLP + Audit guard for Microsoft Agent 365 (A365) agents.
//
// Drop-in module: evaluates every agent turn (prompt-in and/or response-out) against
// Microsoft Purview data-loss-prevention (DLP) policies via the Microsoft Graph beta
// `processContent` API, and BLOCKS the turn when a policy says so. `processContent`
// also writes the Purview audit event, so a successful call satisfies auditing too.
//
// This template is generic and driven entirely by environment variables — copy it into
// your agent's source folder (next to your AgentApplication) and wire the two gates in
// (see the skill's SKILL.md "Wire into the agent" step). No values are hard-coded.
//
// ── HOW IT WORKS ─────────────────────────────────────────────────────────────
//  • Token : the agent's AGENTIC DELEGATED Graph token (GetAgenticUserToken), evaluated
//            as `/me` (the agent identity). A365 blueprint apps CANNOT use app-only
//            client-credentials for this — Microsoft Graph strips data-plane roles
//            (e.g. Content.Process.All) from a blueprint app's app-only token.
//  • Scope : input (uploadText) and, if PURVIEW_CHECK_OUTPUT=true, output (downloadText).
//  • Fail  : FAIL-CLOSED by default (PURVIEW_FAIL_MODE=closed) — any error/timeout blocks
//            the turn so content is never processed unverified. Set to `open` to fail-open.
//  • Policy: a Purview DLP policy scoped to THIS agent's Entra app id, under the
//            "Applications" workload (portal: "Managed cloud apps"), with a
//            RestrictAccess=Block rule. See scripts/New-AiAppDlpPolicy.ps1.
//
// ── REQUIRED ENV ─────────────────────────────────────────────────────────────
//   PURVIEW_DLP_ENABLED=true
// The agent app id + display name are AUTO-DISCOVERED from a365.config.json /
// a365.generated.config.json in the project root (cwd) when present — so on an A365 project
// you usually only need PURVIEW_DLP_ENABLED. Override / supply explicitly with:
//   PURVIEW_APP_ID=<agent Entra app (client) id>   // else: a365 config, then A365 connection envs
//   PURVIEW_APP_NAME=<non-empty display name>       // else: a365 config; must be non-empty (see ⚠️ below)
// ── OPTIONAL ENV ─────────────────────────────────────────────────────────────
//   PURVIEW_BLUEPRINT_ID=<agent blueprint id>       // default: PURVIEW_APP_ID
//   PURVIEW_AUTH_HANDLER=agentic                    // the agentic auth handler name on your AgentApplication
//   PURVIEW_FAIL_MODE=closed|open                   // default closed
//   PURVIEW_CHECK_OUTPUT=true|false                 // default true (also gate the model's response)
//   PURVIEW_TIMEOUT_MS=2000                         // per-call hard timeout
//   PURVIEW_DEBUG=false                             // true = log Purview's raw JSON response every turn
//
// ⚠️ CRITICAL: every processContent `contentEntry` MUST include a non-empty `name`. If it is
//    missing, Graph rejects the request with a PERMANENT BadRequest ("The provided data for
//    Name is invalid") returned as HTTP 200 with 0 policyActions — which looks IDENTICAL to a
//    clean "allowed". This guard therefore (a) always sets `name`, and (b) treats any
//    `processingErrors` as a hard failure (fail-closed) and logs them loudly. Do not remove.
// ────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Authorization, TurnContext } from '@microsoft/agents-hosting';
import { AgenticAuthenticationService } from '@microsoft/agents-a365-runtime';

const GRAPH_BASE = 'https://graph.microsoft.com/beta';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const MAX_CONTENT_CHARS = 100_000;

type DlpActivity = 'uploadText' | 'downloadText';
type DlpDecision = 'allowed' | 'blocked' | 'error' | 'disabled';

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
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** A block is any restrictAccess action whose restrictionAction === "block". */
function isBlock(actions?: Array<Record<string, unknown>>): boolean {
  return !!actions?.some(
    (a) => String((a as Record<string, unknown>).restrictionAction ?? '').toLowerCase() === 'block',
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Best-effort read of A365 project config so an A365 agent needs almost no extra env.
 * Reads a365.generated.config.json + a365.config.json from the current working directory
 * (the project root the agent starts from). Missing/unreadable files are ignored.
 */
interface A365Discovered {
  appId?: string;
  appName?: string;
  blueprintId?: string;
  tenantId?: string;
}
function loadA365Config(): A365Discovered {
  const out: A365Discovered = {};
  for (const file of ['a365.generated.config.json', 'a365.config.json']) {
    try {
      const j = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as Record<string, unknown>;
      out.appId ??= (j.agentBlueprintId ?? j.botMsaAppId ?? j.botId) as string | undefined;
      out.blueprintId ??= j.agentBlueprintId as string | undefined;
      out.appName ??= (j.agentBlueprintDisplayName ?? j.agentDescription ?? j.agentIdentityDisplayName) as string | undefined;
      out.tenantId ??= j.tenantId as string | undefined;
    } catch {
      /* file missing or unreadable — ignore */
    }
  }
  return out;
}

export class PurviewGuard {
  private readonly enabled: boolean;
  private readonly failClosed: boolean;
  private readonly checkOutput: boolean;
  private readonly timeoutMs: number;
  private readonly debug: boolean;
  private readonly appId: string;
  private readonly appName: string;
  private readonly blueprintId: string;
  private readonly authHandlerName: string;

  constructor() {
    this.enabled = envBool('PURVIEW_DLP_ENABLED', false);
    // Fail-closed unless explicitly set to "open".
    this.failClosed = (process.env.PURVIEW_FAIL_MODE ?? 'closed').trim().toLowerCase() !== 'open';
    this.checkOutput = envBool('PURVIEW_CHECK_OUTPUT', true);
    this.timeoutMs = Number(process.env.PURVIEW_TIMEOUT_MS) || 2000;
    this.debug = envBool('PURVIEW_DEBUG', false);

    // The agent's Entra app (client) id. Used as the DLP applicationLocation AND as the
    // aiAgentInfo.identifier fallback. Precedence: explicit env > a365 config > A365 connection env.
    const cfg = loadA365Config();
    this.appId =
      process.env.PURVIEW_APP_ID ??
      cfg.appId ??
      process.env.connections__service_connection__settings__clientId ??
      process.env.agent_id ??
      '';
    // MUST be non-empty (used for the required content-entry `name`).
    this.appName = (process.env.PURVIEW_APP_NAME ?? cfg.appName ?? '').trim() || 'AI Agent';
    this.blueprintId =
      process.env.PURVIEW_BLUEPRINT_ID ??
      cfg.blueprintId ??
      process.env.agent365Observability__agentBlueprintId ??
      this.appId;
    this.authHandlerName = process.env.PURVIEW_AUTH_HANDLER ?? 'agentic';

    if (this.enabled && !this.appId) {
      console.warn(
        '[purview] PURVIEW_DLP_ENABLED=true but no app id resolved — set PURVIEW_APP_ID or run from a ' +
          'folder containing a365.generated.config.json (agentBlueprintId). Every turn will fail-closed.',
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
  evaluatePrompt(
    authorization: Authorization,
    userId: string,
    text: string,
    ctx: TurnContext,
  ): Promise<DlpVerdict> {
    return this.evaluate(authorization, 'uploadText', 0, userId, text, ctx);
  }

  /** Evaluate the model's response BEFORE it's sent back to the user. */
  evaluateResponse(
    authorization: Authorization,
    userId: string,
    text: string,
    ctx: TurnContext,
  ): Promise<DlpVerdict> {
    return this.evaluate(authorization, 'downloadText', 1, userId, text, ctx);
  }

  private failVerdict(detail: string): DlpVerdict {
    // Fail-closed => block; fail-open => allow. Decision captured either way.
    return { blocked: this.failClosed, decision: 'error', detail };
  }

  private async evaluate(
    authorization: Authorization,
    activity: DlpActivity,
    sequenceNumber: number,
    _userId: string,
    text: string,
    ctx: TurnContext,
  ): Promise<DlpVerdict> {
    if (!this.enabled) return { blocked: false, decision: 'disabled' };
    if (!this.appId) return this.failVerdict('missing PURVIEW_APP_ID');

    const reqId = randomUUID();
    try {
      const token = await this.getToken(authorization, ctx);
      const body = this.buildBody(activity, sequenceNumber, text, ctx);
      // Evaluate under the AGENT identity (/me). The agentic delegated token represents the
      // agent, so /users/{other} would be unauthorized.
      const res = await this.postWithTimeout(
        `${GRAPH_BASE}/me/dataSecurityAndGovernance/processContent`,
        token,
        reqId,
        body,
      );

      if (!res.ok) {
        const errText = await safeText(res);
        console.error(`[purview] ${activity} HTTP ${res.status} reqId=${reqId}: ${errText.slice(0, 300)}`);
        return this.failVerdict(`graph ${res.status}`);
      }
      // 202/204 => accepted, no inline decision.
      if (res.status === 202 || res.status === 204) {
        console.log(`[purview] ${activity} -> allowed (HTTP ${res.status}, no content) reqId=${reqId}`);
        return { blocked: false, decision: 'allowed' };
      }

      const json = (await res.json()) as ProcessContentResponse;
      const actions = json.policyActions ?? [];
      const errs = json.processingErrors ?? [];
      const summary = `HTTP ${res.status}, ${actions.length} policyAction(s), scopeState=${json.protectionScopeState ?? 'n/a'}, errors=${errs.length}`;

      // ⚠️ A permanent BadRequest here means OUR REQUEST is malformed — Purview did NOT evaluate
      // the content. Treat as a failure (fail-closed) instead of a silent "allow", and log it.
      if (errs.length) {
        console.error(`[purview] ${activity} -> REQUEST ERROR (${summary}) errors=${JSON.stringify(errs).slice(0, 500)} reqId=${reqId}`);
        return this.failVerdict(`processingErrors: ${JSON.stringify(errs).slice(0, 200)}`);
      }

      if (isBlock(actions)) {
        console.warn(`[purview] ${activity} -> BLOCKED (${summary}) reqId=${reqId}`);
        return { blocked: true, decision: 'blocked', detail: 'restrictAccess/block' };
      }

      console.log(
        `[purview] ${activity} -> allowed (${summary})${this.debug ? ` raw=${JSON.stringify(json).slice(0, 700)}` : ''} reqId=${reqId}`,
      );
      return { blocked: false, decision: 'allowed' };
    } catch (err) {
      const msg = (err as Error).name === 'AbortError' ? `timeout after ${this.timeoutMs}ms` : (err as Error).message;
      console.error(`[purview] ${activity} error reqId=${reqId}: ${msg}`);
      return this.failVerdict(msg);
    }
  }

  private async getToken(authorization: Authorization, ctx: TurnContext): Promise<string> {
    // Agent-identity (agentic delegated) Graph token — carries the delegated
    // Content.Process.User scope granted on the agent's agentic consent.
    const token = await AgenticAuthenticationService.GetAgenticUserToken(
      authorization,
      this.authHandlerName,
      ctx,
      [GRAPH_SCOPE],
    );
    if (!token) throw new Error('failed to acquire agentic Graph token (is the agentic auth handler name correct?)');
    return token;
  }

  private async postWithTimeout(url: string, token: string, reqId: string, body: unknown): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Client-Request-Id': reqId,
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private buildBody(activity: DlpActivity, sequenceNumber: number, text: string, ctx: TurnContext) {
    const recipient = ctx.activity?.recipient as Record<string, unknown> | undefined;
    const agentId = (recipient?.agenticAppId as string) ?? this.appId;
    const blueprintId = this.blueprintId || (recipient?.agenticAppBlueprintId as string) || this.appId;

    const truncated = text.length > MAX_CONTENT_CHARS;
    const now = new Date().toISOString();

    return {
      contentToProcess: {
        contentEntries: [
          {
            '@odata.type': 'microsoft.graph.processConversationMetadata',
            identifier: randomUUID(),
            content: {
              '@odata.type': 'microsoft.graph.textContent',
              data: truncated ? text.slice(0, MAX_CONTENT_CHARS) : text,
            },
            agents: [
              {
                '@odata.type': 'microsoft.graph.aiAgentInfo',
                blueprintId,
                identifier: agentId,
                name: this.appName,
                version: '1.0',
              },
            ],
            // ⚠️ REQUIRED non-empty name — omitting it => permanent BadRequest "Name is invalid".
            name: `${this.appName} message`,
            correlationId: (ctx.activity?.conversation?.id as string) ?? randomUUID(),
            sequenceNumber,
            isTruncated: truncated,
            createdDateTime: now,
            modifiedDateTime: now,
            contentCategory: 'ai',
          },
        ],
        activityMetadata: { activity }, // input=uploadText, output=downloadText
        integratedAppMetadata: { name: this.appName, version: '1.0.0' },
        protectedAppMetadata: {
          name: this.appName,
          version: '1.0.0',
          applicationLocation: {
            '@odata.type': 'microsoft.graph.policyLocationApplication',
            value: this.appId, // must match the app id in your DLP policy location
          },
        },
      },
    };
  }
}

/** Singleton — import { purviewGuard } from './purview.js'. */
export const purviewGuard = new PurviewGuard();
