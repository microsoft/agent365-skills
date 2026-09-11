# ────────────────────────────────────────────────────────────────────────────
# Microsoft Purview DLP + Audit guard for Microsoft Agent 365 (A365) agents — PYTHON.
#
# Drop-in module: evaluates every agent turn (prompt-in and/or response-out) against
# Microsoft Purview data-loss-prevention (DLP) policies via the Microsoft Graph beta
# `processContent` API, and BLOCKS the turn when a policy says so. `processContent`
# also writes the Purview audit event, so a successful call satisfies auditing too.
#
# This template is generic and driven entirely by environment variables — copy it into
# your agent's source folder (next to your AgentApplication / AgentInterface) and wire
# the two gates in (see the skill's wiring-snippet.py). No values are hard-coded.
#
# ── HOW IT WORKS ─────────────────────────────────────────────────────────────
#  • Token : the agent's AGENTIC DELEGATED Graph token, acquired via the A365
#            Authorization handler — `await authorization.exchange_token(context,
#            scopes=[GRAPH_SCOPE], auth_handler_id=<handler>)` — evaluated as `/me`
#            (the agent identity). A365 blueprint apps CANNOT use app-only
#            client-credentials for this — Microsoft Graph strips data-plane roles
#            (e.g. Content.Process.All) from a blueprint app's app-only token.
#  • Scope : input (uploadText) and, if PURVIEW_CHECK_OUTPUT=true, output (downloadText).
#  • Fail  : FAIL-CLOSED by default (PURVIEW_FAIL_MODE=closed) — any error/timeout blocks
#            the turn so content is never processed unverified. Set to `open` to fail-open.
#  • Policy: a Purview DLP policy scoped to THIS agent's Entra app id, under the
#            "Applications" workload (portal: "Managed cloud apps"), with a
#            RestrictAccess=Block rule. See scripts/New-AiAppDlpPolicy.ps1.
#
# ── REQUIRED ENV ─────────────────────────────────────────────────────────────
#   PURVIEW_DLP_ENABLED=true
# The agent app id + display name are AUTO-DISCOVERED from a365.config.json /
# a365.generated.config.json in the project root (cwd) when present — so on an A365 project
# you usually only need PURVIEW_DLP_ENABLED. Override / supply explicitly with
# PURVIEW_APP_ID / PURVIEW_APP_NAME. See purview.env.example for the full list.
#
# ⚠️ CRITICAL: every processContent `contentEntry` MUST include a non-empty `name`. If it is
#    missing, Graph rejects the request with a PERMANENT BadRequest returned as HTTP 200 with
#    0 policyActions — which looks IDENTICAL to a clean "allowed". This guard therefore (a)
#    always sets `name`, and (b) treats any `processingErrors` as a hard failure (fail-closed)
#    and logs them loudly. Do not remove.
#
# Dependencies: httpx (already present in A365 Python agents). No azure-identity / Graph SDK.
# ────────────────────────────────────────────────────────────────────────────

import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.getcwd(), ".env"), override=False)

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/beta"
GRAPH_SCOPE = "https://graph.microsoft.com/.default"
MAX_CONTENT_CHARS = 100_000


@dataclass
class DlpVerdict:
    blocked: bool          # True => stop the turn
    decision: str          # "allowed" | "blocked" | "error" | "disabled"
    detail: str | None = None


def _env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _load_a365_config() -> dict:
    """Best-effort read of A365 project config from cwd so an A365 agent needs almost no env."""
    out: dict = {}
    for file in ("a365.generated.config.json", "a365.config.json"):
        try:
            with open(file, "r", encoding="utf-8-sig") as f:
                j = json.load(f)
        except Exception:
            continue
        out.setdefault("appId", j.get("agentBlueprintId") or j.get("botMsaAppId") or j.get("botId"))
        out.setdefault("blueprintId", j.get("agentBlueprintId"))
        out.setdefault("appName", j.get("agentBlueprintDisplayName") or j.get("agentDescription") or j.get("agentIdentityDisplayName"))
        out.setdefault("tenantId", j.get("tenantId"))
    return out


class PurviewGuard:
    def __init__(self) -> None:
        self.enabled = _env_bool("PURVIEW_DLP_ENABLED", False)
        # Fail-closed unless explicitly set to "open".
        self.fail_closed = (os.getenv("PURVIEW_FAIL_MODE", "closed").strip().lower() != "open")
        self.check_output = _env_bool("PURVIEW_CHECK_OUTPUT", True)
        self.timeout_ms = int(os.getenv("PURVIEW_TIMEOUT_MS") or 2000)
        self.debug = _env_bool("PURVIEW_DEBUG", False)

        cfg = _load_a365_config()
        self.app_id = (
            os.getenv("PURVIEW_APP_ID")
            or cfg.get("appId")
            or os.getenv("CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID")
            or os.getenv("AGENT_ID")
            or ""
        )
        self.app_name = (os.getenv("PURVIEW_APP_NAME") or cfg.get("appName") or "").strip() or "AI Agent"
        self.blueprint_id = (
            os.getenv("PURVIEW_BLUEPRINT_ID")
            or cfg.get("blueprintId")
            or os.getenv("AGENT365OBSERVABILITY__AGENTBLUEPRINTID")
            or self.app_id
        )
        self.auth_handler_name = os.getenv("PURVIEW_AUTH_HANDLER") or os.getenv("AUTH_HANDLER_NAME") or "agentic"

        if self.enabled and not self.app_id:
            logger.warning(
                "[purview] PURVIEW_DLP_ENABLED=true but no app id resolved — set PURVIEW_APP_ID or run from a "
                "folder containing a365.generated.config.json (agentBlueprintId). Every turn will fail-closed."
            )

    @property
    def is_enabled(self) -> bool:
        return self.enabled

    @property
    def is_check_output(self) -> bool:
        return self.check_output

    async def evaluate_prompt(self, authorization, auth_handler_name, user_id, text, context) -> DlpVerdict:
        """Evaluate the user's prompt BEFORE it reaches the LLM."""
        return await self._evaluate(authorization, auth_handler_name, "uploadText", 0, user_id, text, context)

    async def evaluate_response(self, authorization, auth_handler_name, user_id, text, context) -> DlpVerdict:
        """Evaluate the model's response BEFORE it's sent back to the user."""
        return await self._evaluate(authorization, auth_handler_name, "downloadText", 1, user_id, text, context)

    def _fail(self, detail: str) -> DlpVerdict:
        # Fail-closed => block; fail-open => allow.
        return DlpVerdict(blocked=self.fail_closed, decision="error", detail=detail)

    @staticmethod
    def _is_block(actions) -> bool:
        return any(
            str(a.get("restrictionAction", "")).lower() == "block"
            for a in (actions or [])
            if isinstance(a, dict)
        )

    async def _evaluate(self, authorization, auth_handler_name, activity, sequence_number, _user_id, text, context) -> DlpVerdict:
        if not self.enabled:
            return DlpVerdict(blocked=False, decision="disabled")
        if not self.app_id:
            return self._fail("missing PURVIEW_APP_ID")

        req_id = str(uuid.uuid4())
        try:
            token = await self._get_token(authorization, auth_handler_name, context)
            body = self._build_body(activity, sequence_number, text, context)
            async with httpx.AsyncClient(timeout=self.timeout_ms / 1000.0) as client:
                res = await client.post(
                    f"{GRAPH_BASE}/me/dataSecurityAndGovernance/processContent",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "Client-Request-Id": req_id,
                    },
                    json=body,
                )

            if res.status_code >= 400:
                err_text = (res.text or "")[:300]
                logger.error("[purview] %s HTTP %s reqId=%s: %s", activity, res.status_code, req_id, err_text)
                return self._fail(f"graph {res.status_code}")

            # 202/204 => accepted, no inline decision.
            if res.status_code in (202, 204):
                logger.info("[purview] %s -> allowed (HTTP %s, no content) reqId=%s", activity, res.status_code, req_id)
                return DlpVerdict(blocked=False, decision="allowed")

            data = res.json()
            actions = data.get("policyActions") or []
            errs = data.get("processingErrors") or []
            summary = (
                f"HTTP {res.status_code}, {len(actions)} policyAction(s), "
                f"scopeState={data.get('protectionScopeState', 'n/a')}, errors={len(errs)}"
            )

            # A permanent BadRequest here means OUR REQUEST is malformed — fail-closed, don't silently allow.
            if errs:
                logger.error("[purview] %s -> REQUEST ERROR (%s) errors=%s reqId=%s",
                             activity, summary, json.dumps(errs)[:500], req_id)
                return self._fail(f"processingErrors: {json.dumps(errs)[:200]}")

            if self._is_block(actions):
                logger.warning("[purview] %s -> BLOCKED (%s) reqId=%s", activity, summary, req_id)
                return DlpVerdict(blocked=True, decision="blocked", detail="restrictAccess/block")

            raw = f" raw={json.dumps(data)[:700]}" if self.debug else ""
            logger.info("[purview] %s -> allowed (%s)%s reqId=%s", activity, summary, raw, req_id)
            return DlpVerdict(blocked=False, decision="allowed")

        except httpx.TimeoutException:
            logger.error("[purview] %s error reqId=%s: timeout after %sms", activity, req_id, self.timeout_ms)
            return self._fail(f"timeout after {self.timeout_ms}ms")
        except Exception as err:  # noqa: BLE001
            logger.error("[purview] %s error reqId=%s: %s", activity, req_id, err)
            return self._fail(str(err))

    async def _get_token(self, authorization, auth_handler_name, context) -> str:
        """Agent-identity (agentic delegated) Graph token — carries the delegated
        Content.Process.User scope granted on the agent's agentic consent. Uses the same
        exchange_token call the A365 host uses for observability."""
        handler = auth_handler_name or self.auth_handler_name
        resp = await authorization.exchange_token(context, scopes=[GRAPH_SCOPE], auth_handler_id=handler)
        token = getattr(resp, "token", None) or (resp if isinstance(resp, str) else None)
        if not token:
            raise RuntimeError("failed to acquire agentic Graph token (is the agentic auth handler name correct?)")
        return token

    def _build_body(self, activity, sequence_number, text, context) -> dict:
        recipient = getattr(getattr(context, "activity", None), "recipient", None)
        agent_id = getattr(recipient, "agentic_app_id", None) or self.app_id
        blueprint_id = self.blueprint_id or getattr(recipient, "agentic_app_blueprint_id", None) or self.app_id

        truncated = len(text) > MAX_CONTENT_CHARS
        now = datetime.now(timezone.utc).isoformat()
        conv = getattr(getattr(context, "activity", None), "conversation", None)
        correlation_id = getattr(conv, "id", None) or str(uuid.uuid4())

        return {
            "contentToProcess": {
                "contentEntries": [
                    {
                        "@odata.type": "microsoft.graph.processConversationMetadata",
                        "identifier": str(uuid.uuid4()),
                        "content": {
                            "@odata.type": "microsoft.graph.textContent",
                            "data": text[:MAX_CONTENT_CHARS] if truncated else text,
                        },
                        "agents": [
                            {
                                "@odata.type": "microsoft.graph.aiAgentInfo",
                                "blueprintId": blueprint_id,
                                "identifier": agent_id,
                                "name": self.app_name,
                                "version": "1.0",
                            }
                        ],
                        # ⚠️ REQUIRED non-empty name — omitting it => permanent BadRequest "Name is invalid".
                        "name": f"{self.app_name} message",
                        "correlationId": correlation_id,
                        "sequenceNumber": sequence_number,
                        "isTruncated": truncated,
                        "createdDateTime": now,
                        "modifiedDateTime": now,
                        "contentCategory": "ai",
                    }
                ],
                "activityMetadata": {"activity": activity},  # input=uploadText, output=downloadText
                "integratedAppMetadata": {"name": self.app_name, "version": "1.0.0"},
                "protectedAppMetadata": {
                    "name": self.app_name,
                    "version": "1.0.0",
                    "applicationLocation": {
                        "@odata.type": "microsoft.graph.policyLocationApplication",
                        "value": self.app_id,  # must match the app id in your DLP policy location
                    },
                },
            }
        }


# Singleton — import: from purview import purview_guard
purview_guard = PurviewGuard()
