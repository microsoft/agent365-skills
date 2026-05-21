# Devtunnel Testing + Iterative Debug Loop

Reference for Phase 14 of the `build-a365-agent` skill.

---

## 14.0 — Crank up logging

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
- ✅ `appId` / `clientId` shows the blueprint ID (NOT `undefined` / empty)
- ✅ Bound to `0.0.0.0` (NOT `127.0.0.1` — devtunnel can't reach localhost-only)
- ✅ A365 observability configured (SDK-native or distro)
- 🔐 Auth handler in use (e.g. `AGENTIC`) — NOT "running anonymous"

If `appId` is undefined or the server binds to localhost only, revisit Phase
13.0 — production auth mode is not active.

---

## 14.1 — Sanity checks

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

---

## 14.2 — Iterative test loop

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

---

## 14.3 — Common failure patterns and fixes

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

---

## MCP Tools Not Working (Common Issues)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `rawServers.map is not a function` | `BEARER_TOKEN` empty or unset | Run `a365 develop get-token` to stamp tokens into `.env` |
| 500 from MCP platform discovery | `NODE_ENV=production` causes MCP SDK to skip local manifest | Use `WEBSITE_SITE_NAME=local-devtunnel` instead of `NODE_ENV=production` |
| Tools load but return auth error | Bearer token expired (tokens last ~1 hour) | Re-run `a365 develop get-token` |
| Agent replies but never uses tools | MCP registration failed silently at startup | Check console for "MCP tool registration failed" warning; confirm `ToolingManifest.json` exists and has non-empty `mcpServers` array |
| `adapter.process` Zod crash on empty POST | Teams health probes send malformed activity | Confirm `/api/messages` has try/catch guard (see Phase 8 Activity validation guard) |

---

## 14.4 — Quiet things back down

Once the user confirms the experience is good (round-trip works, observability
spans visible, manager onboarding greeting received), restore quieter levels:

```
A365_OBSERVABILITY_LOG_LEVEL=warn
OTEL_LOG_LEVEL=Info
LOG_LEVEL=INFO
```

Leave `ENABLE_A365_OBSERVABILITY_EXPORTER=true` and (Python only)
`ENABLE_A365_OBSERVABILITY=true` — those are correct for production.

---

## 14.5 — Final summary

Output a final summary listing:
- agent name, language, framework, model provider
- MCP servers wired
- blueprint ID
- devtunnel URL
- Teams Dev Portal endpoint
- which Phase 14 scenarios were verified (round-trip, MCP, EMAIL_NOTIFICATION,
  onboarding greeting)

…then end the skill.
