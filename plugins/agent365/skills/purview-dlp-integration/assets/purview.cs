// ────────────────────────────────────────────────────────────────────────────
// Microsoft Purview DLP + Audit guard for Microsoft Agent 365 (A365) agents — .NET.
//
// A365 WorkIQ / DLP — best-effort wiring (verify against SDK source before production).
// Node.js and Python variants of this guard are verified against a live agent; this .NET
// port mirrors their logic and the verified UserAuthorization.GetTurnTokenAsync pattern from
// instrument-observability/references/dotnet-observability.md, but the exact SDK namespaces
// (ITurnContext, UserAuthorization) may differ across SDK versions — adjust the usings.
//
// Drop-in class: evaluates every agent turn (prompt-in and/or response-out) against
// Microsoft Purview DLP policies via the Microsoft Graph beta `processContent` API and
// BLOCKS the turn when a policy matches. `processContent` also writes the Purview audit event.
//
// ── HOW IT WORKS ─────────────────────────────────────────────────────────────
//  • Token : the agent's AGENTIC DELEGATED Graph token via
//            `UserAuthorization.GetTurnTokenAsync(turnContext, handlerName, …)`, evaluated as
//            `/me` (the agent identity). The agentic auth handler MUST be configured with
//            Microsoft Graph `.default` scopes (which carries the delegated Content.Process.User
//            granted on the agent's agentic consent). A365 blueprint apps CANNOT use app-only
//            client-credentials — Graph strips data-plane roles from that token.
//  • Fail  : FAIL-CLOSED by default (PURVIEW_FAIL_MODE=closed) — any error/timeout blocks.
//  • Policy: a Purview DLP policy scoped to THIS agent's Entra app id ("Applications" workload),
//            RestrictAccess=Block. See scripts/New-AiAppDlpPolicy.ps1.
//
// ── REQUIRED ENV ─────────────────────────────────────────────────────────────
//   PURVIEW_DLP_ENABLED=true   (app id / name / blueprint auto-discovered from a365 config)
// See purview.env.example for the full list.
//
// ⚠️ CRITICAL: every processContent contentEntry MUST include a non-empty `name`. Omitting it
//    returns a PERMANENT BadRequest as HTTP 200 with 0 policyActions — identical to a clean
//    "allowed". This guard always sets `name` and treats any processingErrors as fail-closed.
// ────────────────────────────────────────────────────────────────────────────

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Agents.Builder;          // ITurnContext — adjust to your SDK version
using Microsoft.Agents.Builder.App;      // UserAuthorization — adjust to your SDK version

namespace Agent365.Purview;

public sealed record DlpVerdict(bool Blocked, string Decision, string? Detail = null);

public sealed class PurviewGuard
{
    // Zero-DI drop-in singleton. (You can also register it as a DI singleton instead.)
    public static readonly PurviewGuard Instance = new();

    private static readonly HttpClient Http = new();
    private const string GraphBase = "https://graph.microsoft.com/beta";
    private const int MaxContentChars = 100_000;

    private readonly bool _enabled;
    private readonly bool _failClosed;
    private readonly bool _checkOutput;
    private readonly int _timeoutMs;
    private readonly bool _debug;
    private readonly string _appId;
    private readonly string _appName;
    private readonly string _blueprintId;
    private readonly string _authHandlerName;

    public bool IsEnabled => _enabled;
    public bool IsCheckOutput => _checkOutput;

    public PurviewGuard()
    {
        _enabled = EnvBool("PURVIEW_DLP_ENABLED", false);
        _failClosed = !string.Equals(Env("PURVIEW_FAIL_MODE", "closed"), "open", StringComparison.OrdinalIgnoreCase);
        _checkOutput = EnvBool("PURVIEW_CHECK_OUTPUT", true);
        _timeoutMs = int.TryParse(Env("PURVIEW_TIMEOUT_MS", ""), out var t) && t > 0 ? t : 2000;
        _debug = EnvBool("PURVIEW_DEBUG", false);

        var cfg = LoadA365Config();
        _appId = FirstNonEmpty(
            Environment.GetEnvironmentVariable("PURVIEW_APP_ID"),
            cfg.GetValueOrDefault("appId"),
            Environment.GetEnvironmentVariable("CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID"),
            Environment.GetEnvironmentVariable("AGENT_ID")) ?? "";
        _appName = FirstNonEmpty(Environment.GetEnvironmentVariable("PURVIEW_APP_NAME"), cfg.GetValueOrDefault("appName")) is { Length: > 0 } n ? n : "AI Agent";
        _blueprintId = FirstNonEmpty(
            Environment.GetEnvironmentVariable("PURVIEW_BLUEPRINT_ID"),
            cfg.GetValueOrDefault("blueprintId"),
            Environment.GetEnvironmentVariable("AGENT365OBSERVABILITY__AGENTBLUEPRINTID")) ?? _appId;
        _authHandlerName = FirstNonEmpty(
            Environment.GetEnvironmentVariable("PURVIEW_AUTH_HANDLER"),
            Environment.GetEnvironmentVariable("AUTH_HANDLER_NAME")) ?? "agentic";

        if (_enabled && string.IsNullOrEmpty(_appId))
            Console.Error.WriteLine("[purview] PURVIEW_DLP_ENABLED=true but no app id resolved — set PURVIEW_APP_ID " +
                "or run from a folder containing a365.generated.config.json. Every turn will fail-closed.");
    }

    /// <summary>Evaluate the user's prompt BEFORE it reaches the LLM.</summary>
    public Task<DlpVerdict> EvaluatePromptAsync(UserAuthorization authorization, string authHandlerName, ITurnContext turnContext, string text, CancellationToken ct = default)
        => EvaluateAsync(authorization, authHandlerName, "uploadText", 0, text, turnContext, ct);

    /// <summary>Evaluate the model's response BEFORE it's sent back to the user.</summary>
    public Task<DlpVerdict> EvaluateResponseAsync(UserAuthorization authorization, string authHandlerName, ITurnContext turnContext, string text, CancellationToken ct = default)
        => EvaluateAsync(authorization, authHandlerName, "downloadText", 1, text, turnContext, ct);

    private DlpVerdict Fail(string detail) => new(_failClosed, "error", detail);

    private async Task<DlpVerdict> EvaluateAsync(UserAuthorization authorization, string authHandlerName, string activity, int seq, string text, ITurnContext turnContext, CancellationToken ct)
    {
        if (!_enabled) return new DlpVerdict(false, "disabled");
        if (string.IsNullOrEmpty(_appId)) return Fail("missing PURVIEW_APP_ID");

        var reqId = Guid.NewGuid().ToString();
        try
        {
            var token = await GetTokenAsync(authorization, authHandlerName, turnContext, ct);
            var body = BuildBody(activity, seq, text, turnContext);

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(_timeoutMs);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{GraphBase}/me/dataSecurityAndGovernance/processContent");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            req.Headers.TryAddWithoutValidation("Client-Request-Id", reqId);
            req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

            using var res = await Http.SendAsync(req, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                Console.Error.WriteLine($"[purview] {activity} HTTP {(int)res.StatusCode} reqId={reqId}: {Trunc(await SafeRead(res), 300)}");
                return Fail($"graph {(int)res.StatusCode}");
            }
            if (res.StatusCode is HttpStatusCode.Accepted or HttpStatusCode.NoContent)
            {
                Console.WriteLine($"[purview] {activity} -> allowed (HTTP {(int)res.StatusCode}, no content) reqId={reqId}");
                return new DlpVerdict(false, "allowed");
            }

            var json = await res.Content.ReadAsStringAsync(cts.Token);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var actions = root.TryGetProperty("policyActions", out var pa) && pa.ValueKind == JsonValueKind.Array ? pa : default;
            var errs = root.TryGetProperty("processingErrors", out var pe) && pe.ValueKind == JsonValueKind.Array ? pe : default;
            int actionCount = actions.ValueKind == JsonValueKind.Array ? actions.GetArrayLength() : 0;
            int errCount = errs.ValueKind == JsonValueKind.Array ? errs.GetArrayLength() : 0;
            var scopeState = root.TryGetProperty("protectionScopeState", out var ss) ? ss.GetString() : "n/a";
            var summary = $"HTTP {(int)res.StatusCode}, {actionCount} policyAction(s), scopeState={scopeState}, errors={errCount}";

            // A permanent BadRequest here means OUR REQUEST is malformed — fail-closed, don't silently allow.
            if (errCount > 0)
            {
                Console.Error.WriteLine($"[purview] {activity} -> REQUEST ERROR ({summary}) errors={Trunc(errs.GetRawText(), 500)} reqId={reqId}");
                return Fail($"processingErrors: {Trunc(errs.GetRawText(), 200)}");
            }
            if (IsBlock(actions))
            {
                Console.WriteLine($"[purview] {activity} -> BLOCKED ({summary}) reqId={reqId}");
                return new DlpVerdict(true, "blocked", "restrictAccess/block");
            }
            Console.WriteLine($"[purview] {activity} -> allowed ({summary}){(_debug ? $" raw={Trunc(json, 700)}" : "")} reqId={reqId}");
            return new DlpVerdict(false, "allowed");
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine($"[purview] {activity} error reqId={reqId}: timeout after {_timeoutMs}ms");
            return Fail($"timeout after {_timeoutMs}ms");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[purview] {activity} error reqId={reqId}: {ex.Message}");
            return Fail(ex.Message);
        }
    }

    private async Task<string> GetTokenAsync(UserAuthorization authorization, string authHandlerName, ITurnContext turnContext, CancellationToken ct)
    {
        // Agent-identity (agentic delegated) Graph token. The token uses the agentic auth handler's
        // CONFIGURED scopes — that handler MUST include Microsoft Graph .default (carrying the delegated
        // Content.Process.User granted on the agent's agentic consent). Mirrors the verified
        // UserAuthorization.GetTurnTokenAsync signature from instrument-observability.
        var handler = string.IsNullOrEmpty(authHandlerName) ? _authHandlerName : authHandlerName;
        var token = await authorization.GetTurnTokenAsync(turnContext, handler, cancellationToken: ct);
        if (string.IsNullOrEmpty(token))
            throw new InvalidOperationException("failed to acquire agentic Graph token (is the agentic auth handler name correct?)");
        return token;
    }

    private object BuildBody(string activity, int seq, string text, ITurnContext turnContext)
    {
        // For per-instance MAC grouping resolve turnContext.Activity.GetAgenticInstanceId(); the app id is a safe default.
        var agentId = _appId;
        var convId = turnContext?.Activity?.Conversation?.Id ?? Guid.NewGuid().ToString();
        bool truncated = text.Length > MaxContentChars;
        var nowIso = DateTime.UtcNow.ToString("o");
        var data = truncated ? text.Substring(0, MaxContentChars) : text;

        // Dictionary (not anonymous type) so JSON keys can be "@odata.type".
        return new Dictionary<string, object?>
        {
            ["contentToProcess"] = new Dictionary<string, object?>
            {
                ["contentEntries"] = new object[]
                {
                    new Dictionary<string, object?>
                    {
                        ["@odata.type"] = "microsoft.graph.processConversationMetadata",
                        ["identifier"] = Guid.NewGuid().ToString(),
                        ["content"] = new Dictionary<string, object?>
                        {
                            ["@odata.type"] = "microsoft.graph.textContent",
                            ["data"] = data,
                        },
                        ["agents"] = new object[]
                        {
                            new Dictionary<string, object?>
                            {
                                ["@odata.type"] = "microsoft.graph.aiAgentInfo",
                                ["blueprintId"] = _blueprintId,
                                ["identifier"] = agentId,
                                ["name"] = _appName,
                                ["version"] = "1.0",
                            },
                        },
                        // ⚠️ REQUIRED non-empty name — omitting it => permanent BadRequest "Name is invalid".
                        ["name"] = $"{_appName} message",
                        ["correlationId"] = convId,
                        ["sequenceNumber"] = seq,
                        ["isTruncated"] = truncated,
                        ["createdDateTime"] = nowIso,
                        ["modifiedDateTime"] = nowIso,
                        ["contentCategory"] = "ai",
                    },
                },
                ["activityMetadata"] = new Dictionary<string, object?> { ["activity"] = activity }, // input=uploadText, output=downloadText
                ["integratedAppMetadata"] = new Dictionary<string, object?> { ["name"] = _appName, ["version"] = "1.0.0" },
                ["protectedAppMetadata"] = new Dictionary<string, object?>
                {
                    ["name"] = _appName,
                    ["version"] = "1.0.0",
                    ["applicationLocation"] = new Dictionary<string, object?>
                    {
                        ["@odata.type"] = "microsoft.graph.policyLocationApplication",
                        ["value"] = _appId, // must match the app id in your DLP policy location
                    },
                },
            },
        };
    }

    private static bool IsBlock(JsonElement actions)
    {
        if (actions.ValueKind != JsonValueKind.Array) return false;
        foreach (var a in actions.EnumerateArray())
            if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty("restrictionAction", out var ra)
                && string.Equals(ra.GetString(), "block", StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    private static Dictionary<string, string?> LoadA365Config()
    {
        var outp = new Dictionary<string, string?>();
        foreach (var file in new[] { "a365.generated.config.json", "a365.config.json" })
        {
            try
            {
                if (!File.Exists(file)) continue;
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                var r = doc.RootElement;
                outp["appId"] = outp.GetValueOrDefault("appId") ?? Str(r, "agentBlueprintId") ?? Str(r, "botMsaAppId") ?? Str(r, "botId");
                outp["blueprintId"] = outp.GetValueOrDefault("blueprintId") ?? Str(r, "agentBlueprintId");
                outp["appName"] = outp.GetValueOrDefault("appName") ?? Str(r, "agentBlueprintDisplayName") ?? Str(r, "agentDescription") ?? Str(r, "agentIdentityDisplayName");
                outp["tenantId"] = outp.GetValueOrDefault("tenantId") ?? Str(r, "tenantId");
            }
            catch { /* missing / unreadable — ignore */ }
        }
        return outp;
    }

    private static string? Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static string? FirstNonEmpty(params string?[] vals) => vals.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
    private static string Env(string name, string def) { var v = Environment.GetEnvironmentVariable(name); return string.IsNullOrEmpty(v) ? def : v; }
    private static bool EnvBool(string name, bool def)
    {
        var v = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(v)) return def;
        return v.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    }
    private static async Task<string> SafeRead(HttpResponseMessage r) { try { return await r.Content.ReadAsStringAsync(); } catch { return ""; } }
    private static string Trunc(string s, int n) => string.IsNullOrEmpty(s) || s.Length <= n ? s ?? "" : s.Substring(0, n);
}
