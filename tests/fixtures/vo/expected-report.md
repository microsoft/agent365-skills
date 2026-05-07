# Observability validation report

**Findings:** 1 error, 1 warning, 0 info across 1 trace.

## trace `aa00000000000000aa00000000000000`

### error · rule-s2s_caller_details_required
- **Span:** `invoke_agent` (`aa00000000000001`)
- **Fix:** S2S agents must populate CallerDetails on InvokeAgentScope.Start(); without it, traces reach the API (200) but stay invisible in the MAC portal.

### warning · rule-resource_service_name_present
- **Span:** `invoke_agent` (`aa00000000000001`)
- **Fix:** service.name resource attribute is missing — set SERVICE_NAME (Node.js/Python) or use_microsoft_opentelemetry(service_name=...).
