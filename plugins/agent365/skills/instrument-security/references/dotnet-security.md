# .NET — Defender prevention implementation

Implementation of the `Security/` layer for a .NET Agent 365 agent. Read
[defender-webhook.md](defender-webhook.md) first for the endpoint contract,
identity model, and AISession rules.

> ⚠️ **Status: best-effort.** The protocol and auth layers below are direct ports
> of a flow verified end-to-end against the live dev endpoint, and the wire
> contract is language-agnostic — those parts are high confidence. The
> **hook wiring in §5 has not been verified against a running .NET agent.** Mark
> generated adapter code with
> `// A365 Security — best-effort wiring (verify against SDK source before production)`
> and smoke-test before relying on it to block anything.

The code splits into two layers:

| Layer | Files | Framework-specific? |
|---|---|---|
| Core | `SecurityOptions`, `PreventionTokenProvider`, `AiSessionBuilder`, `DefenderClient` | No |
| Adapter | `PreventionMiddleware` / handler wiring | Yes |

---

## 1. NuGet packages

```xml
<PackageReference Include="Microsoft.Identity.Client" Version="4.66.*" />
```

`Microsoft.Extensions.Http`, `Microsoft.Extensions.Options`, and
`System.Text.Json` come with the ASP.NET Core shared framework. No A365-specific
package is required — prevention talks plain HTTPS + Entra.

---

## 2. Configuration

`appsettings.json`:

```jsonc
{
  "DefenderPrevention": {
    "Enabled": true,
    // Override only — the endpoint is a shipped constant.
    "WebhookUrl": "",
    "FailMode": "Open",              // Open | Closed
    "TimeoutSeconds": 10,
    "MaxContentChars": 20000,
    "Hooks": [ "before_agent", "after_agent", "before_tool", "after_tool" ]
  }
}
```

```csharp
// A365 Security — added by instrument-security skill
public sealed class SecurityOptions
{
    public const string SectionName = "DefenderPrevention";

    // Defender third-party prevention endpoint. Override with WebhookUrl.
    public const string DefenderEndpoint =
        "https://prevention.thirdparty.dev.ai.defender.microsoft.com/tp/v1/protection/analyze";

    // The prevention resource the access token is issued FOR — the first-party
    // "Defender for AI Prevention Webhook" application.
    //
    // Note the identifier URI is an https:// form, NOT api:// — requesting
    // api://86a21212-.../.default fails with AADSTS500011 even when the service
    // principal is present, because that URI is not one of the SP's names.
    public const string DefenderResourceAppId = "86a21212-634e-4553-b3d6-e477e4c9d9ec";
    public const string DefenderScope = "https://rtp-a365.ai.defender.microsoft.com/.default";

    // Application role the agent identity must hold to call the prevention
    // endpoint. Granted to the Agent Identity service principal, not the blueprint.
    public const string DefenderAppRole = "AIAgentsRTP.ToolInvocation";

    public bool Enabled { get; set; } = true;
    public string? WebhookUrl { get; set; }
    public string FailMode { get; set; } = "Open";
    public int TimeoutSeconds { get; set; } = 10;
    public int MaxContentChars { get; set; } = 20000;
    public string[] Hooks { get; set; } =
        ["before_agent", "after_agent", "before_tool", "after_tool"];

    public bool FailClosed =>
        string.Equals(FailMode, "Closed", StringComparison.OrdinalIgnoreCase);

    public string ResolvedUrl =>
        !string.IsNullOrWhiteSpace(WebhookUrl) ? WebhookUrl! : DefenderEndpoint;
}
```

Identity values are read from the same environment variables `a365 setup all`
already stamps: `AGENT365_TENANT_ID`, `AGENT365_AGENT_ID` (the Agent Identity /
`agenticAppId`), `AGENT365_BLUEPRINT_ID`, `AGENT365_CLIENT_ID`,
`AGENT365_CLIENT_SECRET`, `AGENT365_USE_MANAGED_IDENTITY`.

---

## 3. Token provider — FMI 3-hop chain

The agent authenticates as **itself**. The blueprint credential is only the start
of the chain; the token that reaches Defender carries the Agent Identity in
`azp`/`oid`.

```
Blueprint (client secret or managed identity)
  └─ Hop 1+2: client_credentials + fmi_path=<agentId> → FMI assertion
     └─ Agent Identity
        └─ Hop 3: client_assertion → prevention token
```

MSAL.NET supports the FMI path natively via `.WithFmiPath()`, so unlike Node.js
and Python this does not need a hand-rolled token-endpoint POST.

```csharp
// A365 Security — added by instrument-security skill
using System.Collections.Concurrent;
using Microsoft.Identity.Client;

public interface IPreventionTokenProvider
{
    /// <summary>Returns a bearer token, or empty string on any failure.</summary>
    Task<string> GetTokenAsync(CancellationToken ct = default);
}

public sealed class PreventionTokenProvider : IPreventionTokenProvider
{
    private const string FmiScope = "api://AzureADTokenExchange/.default";
    private static readonly TimeSpan ExpiryBuffer = TimeSpan.FromMinutes(5);

    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly ILogger<PreventionTokenProvider> _log;
    private string? _token;
    private DateTimeOffset _expiresAt = DateTimeOffset.MinValue;

    public PreventionTokenProvider(ILogger<PreventionTokenProvider> log) => _log = log;

    public async Task<string> GetTokenAsync(CancellationToken ct = default)
    {
        if (_token is not null && DateTimeOffset.UtcNow < _expiresAt - ExpiryBuffer)
            return _token;

        await _lock.WaitAsync(ct);
        try
        {
            if (_token is not null && DateTimeOffset.UtcNow < _expiresAt - ExpiryBuffer)
                return _token;

            var tenantId = Environment.GetEnvironmentVariable("AGENT365_TENANT_ID");
            var agentId = Environment.GetEnvironmentVariable("AGENT365_AGENT_ID");
            var blueprintId = Environment.GetEnvironmentVariable("AGENT365_CLIENT_ID")
                              ?? Environment.GetEnvironmentVariable("AGENT365_BLUEPRINT_ID");
            var secret = Environment.GetEnvironmentVariable("AGENT365_CLIENT_SECRET");

            if (string.IsNullOrEmpty(tenantId) || string.IsNullOrEmpty(agentId) ||
                string.IsNullOrEmpty(blueprintId))
            {
                _log.LogWarning(
                    "[defender] prevention identity not configured; token unavailable");
                return string.Empty;
            }

            var authority = $"https://login.microsoftonline.com/{tenantId}";

            // Hop 1+2 — blueprint credential + fmi_path -> assertion for the agent.
            var blueprintApp = ConfidentialClientApplicationBuilder
                .Create(blueprintId)
                .WithClientSecret(secret)
                .WithAuthority(authority)
                .Build();

            var fmi = await blueprintApp
                .AcquireTokenForClient([FmiScope])
                .WithFmiPath(agentId)
                .ExecuteAsync(ct);

            // Hop 3 — agent identity presents the assertion for the prevention token.
            var agentApp = ConfidentialClientApplicationBuilder
                .Create(agentId)
                .WithClientAssertion(fmi.AccessToken)
                .WithAuthority(authority)
                .Build();

            var result = await agentApp
                .AcquireTokenForClient([SecurityOptions.DefenderScope])
                .ExecuteAsync(ct);

            _token = result.AccessToken;
            _expiresAt = result.ExpiresOn;
            _log.LogInformation("[defender] prevention token acquired for agent {AgentId}", agentId);
            return _token;
        }
        catch (Exception ex)
        {
            // Never throw: an auth outage must not take the agent down. The caller
            // applies the configured fail mode instead.
            _log.LogWarning(ex, "[defender] prevention token acquisition failed");
            return string.Empty;
        }
        finally
        {
            _lock.Release();
        }
    }
}
```

A token without a `roles` claim containing `AIAgentsRTP.ToolInvocation` means the
app role was never granted — see the SKILL's grant phase. The call will still be
made and will fail authorization at the webhook.

---

## 4. AISession builder and client

The JSON contract is identical across languages — see
[defender-webhook.md](defender-webhook.md) §3 for the full schema and the rules
that are easy to get wrong (`sessionContext` must be non-null; `environment.agent.id`
must set the `a365` case; omit `entra` unless a non-empty `objectId` is configured).

```csharp
// A365 Security — added by instrument-security skill
public sealed record DefenderDecision(bool Block, string? Reason, bool Evaluated);

public sealed class DefenderClient
{
    private readonly HttpClient _http;
    private readonly IPreventionTokenProvider _tokens;
    private readonly SecurityOptions _opts;
    private readonly ILogger<DefenderClient> _log;

    public DefenderClient(
        HttpClient http,
        IPreventionTokenProvider tokens,
        IOptions<SecurityOptions> opts,
        ILogger<DefenderClient> log)
    {
        _http = http;
        _tokens = tokens;
        _opts = opts.Value;
        _log = log;
    }

    /// <summary>
    /// Evaluates a session. NEVER throws — transport, auth, and protocol errors
    /// are folded into a decision whose Block value follows the fail mode.
    /// </summary>
    public async Task<DefenderDecision> EvaluateAsync(object session, CancellationToken ct = default)
    {
        if (!_opts.Enabled) return new DefenderDecision(false, null, false);

        try
        {
            var token = await _tokens.GetTokenAsync(ct);
            if (string.IsNullOrEmpty(token))
                return new DefenderDecision(_opts.FailClosed, "no prevention token", false);

            using var req = new HttpRequestMessage(HttpMethod.Post, _opts.ResolvedUrl);
            req.Headers.Authorization = new("Bearer", token);
            req.Content = JsonContent.Create(session);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(_opts.TimeoutSeconds));

            using var res = await _http.SendAsync(req, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                // 401/403 here usually means the app role is missing or the webhook
                // has not allow-listed this resource yet.
                _log.LogWarning("[defender] prevention returned {Status}", (int)res.StatusCode);
                return new DefenderDecision(_opts.FailClosed, $"http {(int)res.StatusCode}", false);
            }

            var body = await res.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
            return ParseDecision(body);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "[defender] prevention call failed");
            return new DefenderDecision(_opts.FailClosed, ex.Message, false);
        }
    }
}
```

See [defender-webhook.md](defender-webhook.md) §4 for the verdict shape that
`ParseDecision` must handle, including the fail-open case where the response
carries no verdicts at all.

---

## 5. Wiring the hooks

> ⚠️ **Best-effort from here down.** Verify against the SDK before production.

.NET A365 agents do not expose the same four-callback surface Google ADK does.
Map the inspection points onto whichever of these the agent actually uses:

| Inspection point | Likely seam |
|---|---|
| `before_agent` | Start of the `OnMessageAsync` / turn handler, before invoking the model |
| `after_agent` | Just before sending the reply — replace the outgoing text on block |
| `before_tool` | A wrapper around the tool/function invocation, or `AIFunctionFactory` middleware |
| `after_tool` | The same wrapper, on the returned result |

Two rules that carry over from the verified implementation and are not optional:

1. **Compose, don't append.** If a hook already exists, wrap it rather than
   registering a second one — with any first-wins dispatch, appending after a
   handler that already returns a value silently disables prevention.
2. **Blocking must short-circuit before the side effect.** A `before_tool` check
   that runs after the tool has executed is not prevention, it is logging.

Preserve any existing observability anchors (`BaggageBuilder`, `InvokeAgentScope`)
when editing a shared handler — do not restructure them out.

---

## 6. Registration

```csharp
// A365 Security — added by instrument-security skill
builder.Services.Configure<SecurityOptions>(
    builder.Configuration.GetSection(SecurityOptions.SectionName));
builder.Services.AddSingleton<IPreventionTokenProvider, PreventionTokenProvider>();
builder.Services.AddHttpClient<DefenderClient>();
```

---

## 7. Verifying

1. Confirm the token carries the role — decode it and check
   `roles` contains `AIAgentsRTP.ToolInvocation`. No role means the grant phase
   did not complete.
2. Send a benign turn; confirm the agent behaves exactly as before.
3. Send a turn that should trip a rule; confirm the block path replaces the
   response and the tool never runs.
4. Confirm a forced failure (bad URL) follows the configured fail mode rather
   than throwing.
