# Endpoint override mechanism per language

Verified mechanism for the `validate-observability` skill to redirect OTLP traffic
from the production A365 endpoint to the local capture daemon while **keeping the
A365 exporter active**. The A365 exporter's FMI token chain, baggage attribution,
URL derivation, and custom headers must be exercised — that's exactly what the
validation flow needs to inspect.

**Verification source:** static analysis of the official SDK source repos on disk
(`D:\Agent365-dotnet`, `D:\Agent365-nodejs`, `D:\Agent365-python`) on 2026-05-07.

---

## TL;DR — single mechanism, three small per-language differences

All three A365 SDKs read **`A365_OBSERVABILITY_DOMAIN_OVERRIDE`** at runtime and
substitute its value for the production domain in the derived URL. Setting it to
the daemon's loopback URL is sufficient to redirect traffic — no code patch, no
re-wiring of the exporter, no auth changes. The daemon must speak HTTPS for .NET
(the .NET exporter rejects `http://` schemes) and may use HTTP for Node.js / Python.

The daemon's existing OTLP-JSON decoder (Task 3) handles the body verbatim — all
three SDKs send standard-shaped `{resourceSpans: [{resource, scopeSpans:[{scope, spans:[...]}]}]}`
JSON. The path differs slightly between SDKs (`/otlp/` segment present in .NET +
Python, absent in Node.js) — the daemon accepts any POST URL by design.

---

## .NET

**Required: HTTPS daemon.** `Agent365ExporterCore.BuildRequestUri` throws
`ArgumentException("Plaintext HTTP endpoints are not supported...")` on any
`http://` URL (Agent365ExporterCore.cs:111). The skill must spawn the daemon with
`--cert/--key` and `A365_OBSERVABILITY_DOMAIN_OVERRIDE=https://localhost:<port>`.

**Skill mutation — `appsettings.Development.json`:**

```json
{
  "Agent365Observability": {
    "DomainOverride": "https://localhost:4318"
  }
}
```

The .NET SDK reads the env var directly via `Environment.GetEnvironmentVariable("A365_OBSERVABILITY_DOMAIN_OVERRIDE")`
(Agent365ExporterCore.cs:144). Configuration-binding is not used by the exporter,
so the skill writes the env var into `appsettings.Development.json` AND ensures
it's exported into the agent's process environment. The simplest cross-platform
move: set the env var in the launchSettings or via `Environment.SetEnvironmentVariable`
in `Program.cs` under `#if DEBUG` — but that's a code change. The cleanest
config-only path is exporting the env var in the developer's shell before
running the agent.

**Skill mutation summary:**

1. Write `Agent365Observability:DomainOverride: "https://localhost:<port>"` into `appsettings.Development.json`.
2. Print: *"Set `$env:A365_OBSERVABILITY_DOMAIN_OVERRIDE='https://localhost:<port>'` in your terminal before running the agent."*
3. Print cert-trust instructions:
   - **PowerShell (admin):** `Import-Certificate -FilePath ./tests/fixtures/vo/cert.pem -CertStoreLocation Cert:\LocalMachine\Root`
   - **Or set `$env:DOTNET_SSL_CERT_FILE='./tests/fixtures/vo/cert.pem'`** (alternative; agent process picks up the cert without modifying the trust store)

**Body the daemon receives:** standard OTLP-JSON `ExportTraceServiceRequest` (Agent365ExporterCore.cs:142, ExportFormatter.cs:87-99).
**URL path:** `https://localhost:<port>/observability/tenants/{tenantId}/otlp/agents/{agentId}/traces?api-version=1` (or `/observabilityService/...` when `UseS2SEndpoint=true`).
**Headers:** `Authorization: Bearer <FMI token>`, `Content-Type: application/json`. No `x-ms-tenant-id`.

---

## Node.js

**HTTP or HTTPS — both accepted.** The Node.js exporter does not require
`https://`. The skill spawns the daemon on HTTP for simplicity.

**Skill mutation — `.env.local`:**

```dotenv
A365_OBSERVABILITY_DOMAIN_OVERRIDE=http://localhost:4318
```

The SDK reads this in `ObservabilityConfiguration.ts:52` and uses it as-is in
`Agent365Exporter.ts:172-185`. No code patch.

**Body the daemon receives:** standard OTLP-JSON (Agent365Exporter.ts:188, 295-336).
**URL path:** `http://localhost:<port>/observability/tenants/{tenantId}/agents/{agentId}/traces?api-version=1` (NO `/otlp/` segment — Node.js SDK builds the path differently from .NET / Python).
**Headers:** `Authorization: Bearer <token>`, `x-ms-tenant-id: <tid>`, `Content-Type: application/json`.

---

## Python

**HTTP or HTTPS — both accepted (HTTP triggers a warning).** Skill uses HTTP for
simplicity, same as Node.js.

**Skill mutation — `.env.local`:**

```dotenv
A365_OBSERVABILITY_DOMAIN_OVERRIDE=http://localhost:4318
```

The SDK reads this in `exporters/utils.py:149-206` and uses it in
`agent365_exporter.py:96-99`. The agent process logs a warning about
non-HTTPS bearer-token transport — that's expected for local-test mode and is
not actionable.

**Body the daemon receives:** OTLP-JSON-compatible (agent365_exporter.py:234-268).
Field names are camelCase canonical OTLP. Built via `json.dumps()`, posted via
`requests.post()` (agent365_exporter.py:15, 62, 169).
**URL path:** `http://localhost:<port>/observability/tenants/{tenantId}/otlp/agents/{agentId}/traces?api-version=1` (or `/observabilityService/...` for S2S).
**Headers:** `Authorization: Bearer <FMI token>`, `Content-Type: application/json`. No `x-ms-tenant-id`.

---

## What the daemon needs (already implemented)

- **HTTPS support** — `--cert` and `--key` flags on `server.js` (commit `72bf98a`).
- **OTLP-JSON decoder** — `otlp-decoder.js` accepts `application/json` bodies and yields the uniform shape (Task 3, commit `c3e6ee2`).
- **Any-URL POST** — the server stores `req.url` as `urlPath` in the JSONL line and accepts any path. Differences between `/otlp/`-present and absent are preserved for downstream `rule-otlp_path_canonical` to inspect.

The skill's existing common-mistakes rule pack already inspects:
- `rule-s2s_endpoint_path` — checks `urlPath` for `/observability/` vs `/observabilityService/`
- `rule-otlp_path_canonical` — flags spans where `urlPath` contains `/otlp/` (Node.js / .NET SDK bug)
- `rule-fmi_token_audience` — checks `microsoft.a365.exporter.token_aud` resource attribute when present

These rules now operate on real Agent365Exporter output, not on a vanilla-OTel substitute.

---

## Citations

- **.NET:** `D:\Agent365-dotnet\src\Observability\Runtime\Tracing\Exporters\Agent365ExporterCore.cs:92-93` (URL paths), `:111` (HTTPS-only enforcement), `:142` (content-type), `:144` (env-var read), `:170` (Authorization header). `ExportFormatter.cs:87-99` (body construction), `:351-472` (camelCase serialization).
- **Node.js:** `D:\Agent365-nodejs\packages\agents-a365-observability\src\tracing\exporter\Agent365Exporter.ts:172-185` (URL composition), `:188` (content-type), `:215` (Authorization), `:224` (`x-ms-tenant-id`), `:295-336` (body shape). `src\configuration\ObservabilityConfiguration.ts:52` (env-var read).
- **Python:** `D:\Agent365-python\libraries\microsoft-agents-a365-observability-core\microsoft_agents_a365\observability\core\exporters\agent365_exporter.py:15, 62, 109, 111, 119, 169, 234-268` (HTTP, body, headers). `exporters\utils.py:149-206, 209-232` (env-var, URL composition).

---

## Resolved spec gap

This file resolves spec §12 open question 1 of the validate-observability design
(`docs/superpowers/specs/2026-05-06-validate-observability-skill-design.md`). The
SKILL.md Phase 1B step 4 mutations are now backed by verified per-language
mechanisms.
