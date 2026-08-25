// ─────────────────────────────────────────────────────────────────────────────
// WIRING SNIPPET — how to add the two DLP gates to an existing A365 agent.
//
// This is a REFERENCE, not a compiled file. Apply these MINIMAL edits to your
// AgentApplication's message handler (and any notification/email handler that
// calls the LLM). Everything else stays the same.
// ─────────────────────────────────────────────────────────────────────────────

// 1) Import the guard at the top of your agent file:
import { purviewGuard } from './purview.js';

// 2) Inside your message handler, `context` is the TurnContext and `this.authorization`
//    is the AgentApplication's authorization handler. Resolve the caller id once:
//
//    const userId = context.activity.from?.aadObjectId ?? '';
//    const userMessage = context.activity.text?.trim() ?? '';

// 3) INPUT GATE — evaluate the prompt BEFORE calling the LLM:
if (purviewGuard.isEnabled) {
  const gate = await purviewGuard.evaluatePrompt(this.authorization, userId, userMessage, context);
  if (gate.blocked) {
    await context.sendActivity(
      gate.decision === 'blocked'
        ? "🚫 I can't help with that — your request was blocked by your organization's data-loss-prevention policy."
        : "🚫 I couldn't check this against your organization's data policy, so I've stopped the request. Please try again shortly.",
    );
    return; // ← the LLM is never called
  }
}

// 4) ... your existing LLM call, e.g.:
//    const answer = await model.invoke(userMessage);

// 5) OUTPUT GATE — evaluate the model's answer BEFORE sending it:
if (purviewGuard.isEnabled && purviewGuard.isCheckOutput) {
  const outGate = await purviewGuard.evaluateResponse(this.authorization, userId, answer, context);
  if (outGate.blocked) {
    await context.sendActivity(
      outGate.decision === 'blocked'
        ? "🚫 My response was withheld by your organization's data-loss-prevention policy."
        : "🚫 I couldn't check my response against your organization's data policy, so I've withheld it.",
    );
    return;
  }
}

// 6) ... your existing `await context.sendActivity(answer);`
