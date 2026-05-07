---
name: validate-observability
version: 1.5.0
description: >
  Validates the OpenTelemetry data an Agent 365 SDK actually emits. Spawns a
  local OTLP/HTTP capture daemon, points the agent's dev-only config at it,
  captures one or more turns, and reports schema violations and common-mistake
  findings (missing CallerDetails, broken baggage propagation, S2S endpoint
  path bugs, etc.) with concrete fix hints. Runs offline; no live A365 tokens
  required. Two flows — live (steady-state iteration) and one-shot (quick verdict).
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional flags: --reset-cursor | --export <file> | --rule <ruleId> | --stop"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  preToolUse:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/preToolUse/path-guard.js
      timeout: 5000
  stop:
    - type: command
      command: node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/validate-validate-observability.js
      timeout: 15000
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Mode was correctly determined (live or one-shot) from .a365-observability-capture/state.json.
        2. If one-shot mode mutated any dev-only config files, the original values were recorded in state.json.
        3. Validation findings were actually printed to the user (or "no findings" was explicitly reported).
        4. If one-shot mode completed, the user was offered the keep-running-or-stop choice.
        If any item failed, return {"ok": false, "reason": "<specific item>"}. Otherwise {"ok": true}.
      timeout: 30000
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

> **Trigger phrases:**
> - "validate my agent's observability data"
> - "check what observability data my agent is sending"
> - "is my a365 telemetry correct"
> - "analyze my last trace"
> - "run an observability data check"

# Validate A365 Observability Data Locally

This skill captures the OTLP traffic your A365 SDK actually emits, runs schema-driven
and common-mistakes validators against it, and reports concrete findings with fix hints.

## Phase 0 — Determine mode

**TaskCreate** — "Determine mode (live vs one-shot)"

**Read** `.a365-observability-capture/state.json`. If absent → **one-shot** (Phase 1B).
If present and the recorded `pid` is alive → **live** (Phase 1A). If present but the
PID is dead, prompt the user: *"A previous capture session is recorded but the daemon
is gone. Reset and start a new session?"* — on yes, delete `state.json` and continue
to one-shot; on no, exit.

## Phase 1A — Live mode

**TaskCreate** — "Read captured spans since cursor; validate; report"

1. **Read** `.a365-observability-capture/cursor.json` for `lastReadCount`.
2. **Read** `.a365-observability-capture/traces.jsonl`. Take entries after `lastReadCount`.
   - If zero new entries: ask the user *"No new spans since last run. Send a turn through your agent now and reply 'go' when ready."* Loop until entries appear.
3. Group entries into traces by `span.traceId`.
4. For each span, run `validators/schema-driven.js → validateSpan`.
5. For each trace, run `validators/common-mistakes.js → validateTrace`.
6. Run `validators/report.js → format` on the merged findings; print the markdown.
7. Advance the cursor.

If `--reset-cursor`: skip step 1, treat all entries as new.
If `--rule <id>`: filter findings to that ruleId only.
If `--export <file>`: also write findings to `<file>` after stripping skill-only fields via `validators/rule-result.js → toUpstreamShape`.

## Phase 1B — One-shot mode

**TaskCreate** — "Detect agent + start daemon + capture one turn + validate + cleanup"

1. **Read** `.a365-workspace-detection.json`. If absent: refuse: *"Run `a365-setup` and `instrument-observability` first."*
2. **Read** `references/endpoint-override.md` and locate the per-language section that matches the agent's language (`.NET` / `Node.js` / `Python`). That section names the exact dev-only file mutations and code patches the skill applies in step 4.
3. Pick a port (default 4318; scan upward if busy via `node -e "require('net').createServer().listen(PORT, ()=>process.exit(0)).on('error',()=>process.exit(1))"`).
4. **Mutate dev-only override config** per `references/endpoint-override.md`. The mutation is the SAME variable in all three languages (`A365_OBSERVABILITY_DOMAIN_OVERRIDE`); only the file and the URL scheme differ:

   - **.NET (HTTPS daemon):** write `Agent365Observability:DomainOverride: "https://localhost:<port>"` into `appsettings.Development.json`. Tell the user to also export `$env:A365_OBSERVABILITY_DOMAIN_OVERRIDE='https://localhost:<port>'` in their terminal before running the agent. Print the self-signed cert-trust instructions:

     ```powershell
     # Option A — trust system-wide (admin):
     Import-Certificate -FilePath ./tests/fixtures/vo/cert.pem -CertStoreLocation Cert:\LocalMachine\Root

     # Option B — process-local (no admin):
     $env:DOTNET_SSL_CERT_FILE = "$pwd/tests/fixtures/vo/cert.pem"
     ```

   - **Node.js (HTTP daemon):** append `A365_OBSERVABILITY_DOMAIN_OVERRIDE=http://localhost:<port>` to `.env.local`.

   - **Python (HTTP daemon):** same as Node.js — append `A365_OBSERVABILITY_DOMAIN_OVERRIDE=http://localhost:<port>` to `.env.local`. Inform the user that the agent will log a "non-HTTPS bearer token" warning per turn — that's expected and harmless in local-test mode.

   Record original values (or "unset") in `state.json`'s `mutations` array. **Never modify** `.env`, `appsettings.json`, or `appsettings.Production.json`.
5. **Spawn daemon**:
   - **.NET (HTTPS):** `node ${CLAUDE_PLUGIN_ROOT}/skills/validate-observability/daemon/server.js --port <port> --capture-dir <agent-cwd>/.a365-observability-capture --cert tests/fixtures/vo/cert.pem --key tests/fixtures/vo/key.pem`. If the cert/key fixtures are absent, the skill first runs `bash tests/fixtures/vo/build-tls-fixtures.sh` (or the equivalent on Windows: `tests/fixtures/vo/build-tls-fixtures.ps1` if it exists, else openssl directly).
   - **Node.js / Python (HTTP):** `node ${CLAUDE_PLUGIN_ROOT}/skills/validate-observability/daemon/server.js --port <port> --capture-dir <agent-cwd>/.a365-observability-capture` (no cert flags).

   Capture stdout's first JSON line `{ ready: true, scheme: "http"|"https", port, pid }` within 5 seconds. Write `state.json` with `{ pid, port, scheme, mutations }`.
6. **Prompt**: *"Daemon listening on `http://localhost:<port>`. Run one turn through your agent now (start it normally, send a message in AgentsPlayground, etc.). Reply 'go' when the turn is done."*
7. **On 'go'**: read all entries from `traces.jsonl`. If zero, run the diagnostic checklist (agent restarted? exporter Enabled? `service.name` set? curl the daemon).
8. **Validate + report** (same engine as Phase 1A).
9. **Offer**: *"Keep daemon running for live-mode iteration? [yes / no]"*
   - **yes**: leave state.json + mutations in place; the next skill invocation will land in Phase 1A.
   - **no**: kill daemon (`process.kill(state.pid, 'SIGTERM')`), restore each mutation in `state.mutations` (reverse order), delete `state.json` and `cursor.json`. Keep `traces.jsonl` for post-mortem. Inform the user which files were restored.

## Phase 2 — Explicit teardown (`--stop`)

If invoked with `--stop`:
1. Read `state.json`.
2. If absent: report "no daemon was running" and exit ok.
3. If present: kill the recorded pid (best-effort; ignore ESRCH), restore each mutation, delete `state.json` and `cursor.json`. Print a one-line summary of what was restored.

## Output format

Every run prints the markdown report from `report.js`. With zero findings, print:

```
# Observability validation report

**Findings:** 0 errors, 0 warnings, 0 info. Trace shape matches the upstream schema.
```

## Endpoint override mechanism

The verified per-language mechanism is documented in `references/endpoint-override.md`.
The skill mutates only dev-only files: `.env.local` (Node.js / Python) or
`appsettings.Development.json` (.NET). The redirect uses
`A365_OBSERVABILITY_DOMAIN_OVERRIDE`, an env var all three SDKs already read at
runtime — no code patch required. The A365 exporter stays fully active so the
FMI token chain, baggage attribution, and URL derivation continue to run and
produce traffic the validators can inspect. .NET requires the daemon on HTTPS
(self-signed cert; trust instructions are printed on first run).

If a future SDK release breaks any of these mechanisms, update
`endpoint-override.md` and the corresponding step 4 / step 5 logic.

## Idempotency

- Live-mode invocations are pure reads.
- One-shot invocation while a daemon is already up transitions silently to Phase 1A.
- `--stop` is a no-op when no daemon is running.
- Running this skill never modifies production config files.
