# ─────────────────────────────────────────────────────────────────────────────
# WIRING SNIPPET (PYTHON) — how to add the two DLP gates to an existing A365 agent.
#
# This is a REFERENCE, not an importable module. Apply these MINIMAL edits to your
# agent's message handler (the method that calls the LLM — e.g. process_user_message
# on your AgentInterface, or the on_message handler), and any notification/email
# handler that also calls the LLM. Everything else stays the same.
# ─────────────────────────────────────────────────────────────────────────────

# 1) Import the guard at the top of your agent file:
from purview import purview_guard  # noqa: E402

# 2) Inside your message handler you already receive the A365 Authorization handler, the
#    auth-handler name, and the TurnContext. (In the AgentInterface pattern the signature is
#    `process_user_message(self, message, auth, auth_handler_name, context)`.) Resolve the caller id:
#
#    from_prop = getattr(getattr(context, "activity", None), "from_property", None)
#    user_id = (getattr(from_prop, "aad_object_id", None) or getattr(from_prop, "id", None) or "") if from_prop else ""


# Optional helper for the user-facing block/withhold messages:
def _dlp_block_message(verdict, phase: str) -> str:
    if verdict.decision == "blocked":
        return (
            "🚫 I can't help with that — your request was blocked by your organization's data-loss-prevention policy."
            if phase == "input"
            else "🚫 My response was withheld by your organization's data-loss-prevention policy."
        )
    return (
        "🚫 I couldn't check this against your organization's data policy, so I've stopped the request. Please try again shortly."
        if phase == "input"
        else "🚫 I couldn't check my response against your organization's data policy, so I've withheld it."
    )


# 3) INPUT GATE — evaluate the prompt BEFORE calling the LLM:
if purview_guard.is_enabled:
    gate = await purview_guard.evaluate_prompt(auth, auth_handler_name, user_id, message, context)
    if gate.blocked:
        return _dlp_block_message(gate, "input")  # ← the LLM is never called

# 4) ... your existing LLM call, e.g.:
#    reply = await self._agent.run(session_id, message)

# 5) OUTPUT GATE — evaluate the model's answer BEFORE returning / sending it:
if purview_guard.is_enabled and purview_guard.is_check_output:
    out_gate = await purview_guard.evaluate_response(auth, auth_handler_name, user_id, reply, context)
    if out_gate.blocked:
        return _dlp_block_message(out_gate, "output")

# 6) ... your existing `return reply` (or `await context.send_activity(reply)`).
