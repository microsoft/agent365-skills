// ─────────────────────────────────────────────────────────────────────────────
// WIRING SNIPPET (.NET) — how to add the two DLP gates to an existing A365 agent.
//
// A365 DLP — best-effort wiring (verify against SDK source before production).
// This is a REFERENCE, not a compiled file. Apply these MINIMAL edits to your
// AgentApplication's message handler (OnMessageAsync — the method that calls the LLM),
// and any notification/email handler that also calls the LLM.
// ─────────────────────────────────────────────────────────────────────────────

// 1) Add a using for the guard's namespace at the top of your agent file:
using Agent365.Purview;

// 2) Inside OnMessageAsync you have `turnContext` (ITurnContext), `this.UserAuthorization`
//    (the AgentApplication authorization handler) and the agentic auth handler name (usually
//    from configuration: AgentApplication:AgenticAuthHandlerName, e.g. "agentic"). Resolve the
//    text + caller id:
//
//    var userMessage = turnContext.Activity.Text ?? string.Empty;
//    var authHandlerName = _configuration["AgentApplication:AgenticAuthHandlerName"] ?? "agentic";

// 3) INPUT GATE — evaluate the prompt BEFORE calling the LLM:
if (PurviewGuard.Instance.IsEnabled)
{
    var gate = await PurviewGuard.Instance.EvaluatePromptAsync(
        UserAuthorization, authHandlerName, turnContext, userMessage, cancellationToken);
    if (gate.Blocked)
    {
        await turnContext.SendActivityAsync(
            gate.Decision == "blocked"
                ? "🚫 I can't help with that — your request was blocked by your organization's data-loss-prevention policy."
                : "🚫 I couldn't check this against your organization's data policy, so I've stopped the request. Please try again shortly.",
            cancellationToken: cancellationToken);
        return; // ← the LLM is never called
    }
}

// 4) ... your existing LLM call, e.g.:
//    var answer = await _chatClient.CompleteAsync(userMessage, cancellationToken);

// 5) OUTPUT GATE — evaluate the model's answer BEFORE sending it:
if (PurviewGuard.Instance.IsEnabled && PurviewGuard.Instance.IsCheckOutput)
{
    var outGate = await PurviewGuard.Instance.EvaluateResponseAsync(
        UserAuthorization, authHandlerName, turnContext, answer, cancellationToken);
    if (outGate.Blocked)
    {
        await turnContext.SendActivityAsync(
            outGate.Decision == "blocked"
                ? "🚫 My response was withheld by your organization's data-loss-prevention policy."
                : "🚫 I couldn't check my response against your organization's data policy, so I've withheld it.",
            cancellationToken: cancellationToken);
        return;
    }
}

// 6) ... your existing `await turnContext.SendActivityAsync(answer, cancellationToken: cancellationToken);`
