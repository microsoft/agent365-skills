# Manual end-to-end runbook for the validate-observability skill

The unit tests cover the daemon and validators in isolation. This runbook covers the
full pipeline against a real A365 SDK — too brittle for CI (network + dotnet/python
deps) but worth running before each release.

## Per-language: emit one good and one broken trace, confirm the skill catches the broken one

### .NET

1. From a checkout of any A365-instrumented .NET agent (e.g. the bug-bash demo agent):
       cd path/to/agent
       claude
2. Say: "validate my agent's observability data"
3. The skill should ask you to run a turn. Send a normal user message in AgentsPlayground.
4. Confirm the report shows zero findings.
5. Edit your agent's message handler: remove the InvokeAgentScope.Start() call, rebuild.
6. Run the skill again. Confirm rule-store_publishing_scopes_present fires.
7. Restore the scope; confirm clean again.

### Node.js

(same steps, against any Node.js A365 agent)

### Python

(same steps, against any Python A365 agent)

## What to check before release

- All three languages reach Phase 1B step 6 ("daemon listening on..." prompt) without errors.
- The daemon's PID is recorded in `state.json`.
- After `--stop`, no orphan node processes remain on the chosen port.
- The dev-only config files were restored (diff against the pre-skill `git status`).
- `traces.jsonl` is left intact for post-mortem.

## Pre-release: complete the deferred endpoint-override spike

The one-shot flow (Phase 1B) of the skill cannot run end-to-end until
`plugins/agent365/skills/validate-observability/references/endpoint-override.md`
documents the verified per-language mechanism for redirecting OTLP traffic to
`http://localhost:<port>`. Run Task 0 of the implementation plan to produce that file.
