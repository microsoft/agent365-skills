# Endpoint override mechanism per language

This document records, for each supported A365 SDK target, the verified mechanism the
`validate-observability` skill uses to redirect OTLP traffic from the real A365
endpoint to a localhost listener during local validation.

**Verification source:** static analysis of the official SDK source repos
(`D:\Agent365-dotnet`, `D:\Agent365-nodejs`, `D:\Agent365-python`) on 2026-05-07.

---

## TL;DR — recommended mechanism (all languages)

**Disable the A365 exporter; register a vanilla OTLP-HTTP exporter pointed at
`http://localhost:<port>/v1/traces`.** The skill's capture daemon decodes standard
OTLP (protobuf or JSON), so a vanilla exporter pairs cleanly. `BaggageBuilder`,
`InvokeAgentScope`, `InferenceScope`, and `ExecuteToolScope` all operate at the
OpenTelemetry context layer — they keep working when the A365 exporter is disabled.

The skill's one-shot mode mutates dev-only override files (`.env.local` /
`appsettings.Development.json`) per the per-language sections below. A small
code patch may also be required where noted.

A simpler env-var-only path (`A365_OBSERVABILITY_DOMAIN_OVERRIDE`) exists in all
three SDKs but has caveats per language — see the bottom of this doc.

---

## .NET

**Mechanism:** disable the A365 exporter; register a vanilla `AddOtlpExporter`.

**Why not env-var only:** `Agent365ExporterCore.BuildRequestUri()` explicitly rejects
plaintext `http://` URLs (throws `ArgumentException`). The env-var path can only
target HTTPS, which requires a dev cert on localhost.

**Skill mutations:**

`appsettings.Development.json` — set the exporter flag off. (This file is in
`.gitignore` and is already used by `instrument-observability` for the same purpose.)

```json
{
  "EnableAgent365Exporter": false
}
```

**Required code patch** in the agent's entry point (e.g. `Program.cs`) — wrapped
in a development-only guard so production wiring is untouched. The skill writes
this block alongside the existing `builder.UseMicrosoftOpenTelemetry(...)` call:

```csharp
#if DEBUG
if (builder.Configuration.GetValue<bool>("EnableAgent365Exporter") == false)
{
    builder.Services.AddOpenTelemetry()
        .WithTracing(t => t.AddOtlpExporter(opt =>
        {
            opt.Endpoint = new Uri("http://localhost:4318/v1/traces");
            opt.Protocol = OtlpExportProtocol.HttpProtobuf;
        }));
}
#endif
```

The `#if DEBUG` guard plus the `EnableAgent365Exporter == false` check means the
patch is inert in any build that has the A365 exporter on — which is every
production build by default.

**On teardown:** the skill restores `EnableAgent365Exporter` to its prior value
in `appsettings.Development.json`. The code patch can stay (it's gated behind two
conditions) — or the skill removes it on `--stop` if the dev prefers a clean
file.

---

## Node.js

**Mechanism:** set `ENABLE_A365_OBSERVABILITY_EXPORTER=false`; register a vanilla
`@opentelemetry/exporter-trace-otlp-http` `OTLPTraceExporter` against localhost.

**Why not env-var only:** `Agent365_OBSERVABILITY_DOMAIN_OVERRIDE` works at the
URL level, but the Node.js `Agent365Exporter` posts a *custom* JSON shape to a
*non-standard* path (`/observability/tenants/{tenantId}/agents/{agentId}/traces?api-version=1`),
not standard OTLP-JSON. The skill's daemon expects standard OTLP — switching to a
vanilla exporter sidesteps the wire-format mismatch.

**Skill mutations:**

`.env.local`:

```dotenv
ENABLE_A365_OBSERVABILITY_EXPORTER=false
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

**Required code patch** in the agent's entry point (e.g. `index.ts`) — also
DEV-guarded:

```ts
if (process.env.ENABLE_A365_OBSERVABILITY_EXPORTER === 'false' && process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const { BatchSpanProcessor }  = await import('@opentelemetry/sdk-trace-base');
  const { OTLPTraceExporter }   = await import('@opentelemetry/exporter-trace-otlp-http');
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  })));
  provider.register();
}
// useMicrosoftOpenTelemetry({ ... }) is called as normal afterwards;
// with the A365 exporter disabled, the vanilla exporter is what actually flushes.
```

**On teardown:** the skill removes the three `.env.local` lines it added (or
restores their previous values). The code patch can stay — it's a no-op when
the env vars are unset.

---

## Python

**Mechanism:** disable the A365 exporter; rely on the SDK's built-in
`ENABLE_OTLP_EXPORTER` path (which honors standard OTel env vars natively).

**Why this is cleanest for Python:** the SDK already wires a vanilla
`OTLPSpanExporter()` when `ENABLE_OTLP_EXPORTER=true` is set
(`config.py` lines 210-215). The exporter respects `OTEL_EXPORTER_OTLP_ENDPOINT`
and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` per OpenTelemetry SDK defaults. No code
patch is required in the agent.

**Skill mutations:**

`.env.local`:

```dotenv
ENABLE_A365_OBSERVABILITY_EXPORTER=false
ENABLE_OTLP_EXPORTER=true
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
```

**No code patch required.** `BaggageBuilder` and `InvokeAgentScope` use standard
OpenTelemetry context APIs and operate independently of the exporter — they keep
working with the disabled-A365 + enabled-OTLP combination.

**On teardown:** the skill removes the three `.env.local` lines it added.

---

## Alternative: env-var-only path (limited)

All three SDKs read `A365_OBSERVABILITY_DOMAIN_OVERRIDE` at runtime. Setting it
to a localhost URL redirects the A365 exporter's POST without a code patch. This
is the simplest mechanism on the wire, but it has hard caveats:

| Language | env-var-only works? | Why / why not |
|---|---|---|
| .NET | **No** | Exporter rejects `http://` schemes (`Agent365ExporterCore.cs:105`). Would require HTTPS-to-localhost with a dev cert. |
| Node.js | **Partial** | Works at URL level. Body is custom A365 JSON, not standard OTLP — daemon would need an A365-JSON decoder branch (not built in v1). |
| Python | **Yes** | Body is the A365 shape but Python's flag activates a separate vanilla OTLP exporter; it bypasses the issue. Setting both `A365_OBSERVABILITY_DOMAIN_OVERRIDE` and the OTel env vars is redundant — prefer the OTel-env-var path. |

**Recommendation:** use the per-language sections above. Revisit `A365_OBSERVABILITY_DOMAIN_OVERRIDE`
only if v2 of this skill ships an A365-JSON decoder branch.

---

## Citations

- **.NET:** `D:\Agent365-dotnet\src\Observability\Runtime\Tracing\Exporters\Agent365ExporterCore.cs:105` (HTTP rejection), `:144` (env-var override), `Builder.cs:62` (`EnableAgent365Exporter` flag), `Builder.cs:124` (console fallback when disabled).
- **Node.js:** `D:\Agent365-nodejs\packages\agents-a365-observability\src\tracing\exporter\Agent365Exporter.ts:172-185, 245` (custom JSON path), `src\configuration\ObservabilityConfiguration.ts:52` (env-var override), `src\tracing\exporter\utils.ts:163-183` (URL resolution).
- **Python:** `D:\Agent365-python\libraries\microsoft-agents-a365-observability-core\microsoft_agents_a365\observability\core\config.py:210-215` (`ENABLE_OTLP_EXPORTER` gate, standard OTel env-var support), `exporters\utils.py:149-206` (`A365_OBSERVABILITY_DOMAIN_OVERRIDE`), `middleware\baggage_builder.py` (independent of exporter).

---

## Resolved spec gap

This file resolves spec §12 open question 1 of the validate-observability design
(`docs/superpowers/specs/2026-05-06-validate-observability-skill-design.md`). The
skill's `SKILL.md` Phase 1B step 2 should now use the per-language sections above
rather than its previous fallback prompt asking the user to set up the override
manually. A follow-up commit to `SKILL.md` makes that change.
