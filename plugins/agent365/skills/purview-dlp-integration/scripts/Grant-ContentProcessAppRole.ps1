<#
.SYNOPSIS
  Grants the `Content.Process.All` (Application) Microsoft Graph role to an A365 agent's
  AGENT IDENTITY service principal — the prerequisite for the S2S (app-only) Purview DLP guard
  (assets/purview-s2s.ts).

.DESCRIPTION
  The delegated Purview guard uses the agent's `/me` agentic token. An S2S / autonomous agent
  has no signed-in user, so it must call the app-only endpoint
  `/users/{sponsor}/dataSecurityAndGovernance/processContent` with an app-only Graph token.

  Verified 2026-08-26: a *blueprint* app-only token has `Content.Process.*` STRIPPED by Graph,
  but the *agent identity* token minted through the FMI 3-hop chain RETAINS it. So the role must
  be assigned to the AGENT IDENTITY service principal (agenticAppId), NOT the blueprint.

  This adds a single surgical appRoleAssignment (it does NOT run admin-consent, which could
  narrow the agent's existing delegated consent). Idempotent — a re-run is a no-op.

  Requires: az login as an Application Administrator / Privileged Role Administrator (or GA)
  with rights to create appRoleAssignments.

.PARAMETER AgentIdentityAppId
  The agent identity app id (a365.generated.config.json -> `agenticAppId`). Auto-discovered if omitted.

.PARAMETER ConfigDir
  Folder containing a365.generated.config.json (default: current directory).

.EXAMPLE
  ./Grant-ContentProcessAppRole.ps1                 # from the agent project folder
  ./Grant-ContentProcessAppRole.ps1 -AgentIdentityAppId 1a9e680d-....
#>
[CmdletBinding()]
param(
  [string] $AgentIdentityAppId,
  [string] $ConfigDir = '.'
)

$ErrorActionPreference = 'Stop'

# Microsoft Graph resource app id + the Content.Process.All application app-role id (fixed, first-party).
$GraphAppId = '00000003-0000-0000-c000-000000000000'
$ContentProcessAllRoleId = '5ad511bf-571c-4ef6-8c3c-85b94b85df98'

# ── Auto-discover the agent identity app id from a365 config ─────────────────
if (-not $AgentIdentityAppId) {
  $genPath = Join-Path $ConfigDir 'a365.generated.config.json'
  if (Test-Path $genPath) {
    try {
      $gen = Get-Content $genPath -Raw | ConvertFrom-Json
      if ($gen.agenticAppId) { $AgentIdentityAppId = [string]$gen.agenticAppId }
    } catch { }
  }
}
if (-not $AgentIdentityAppId) {
  throw "AgentIdentityAppId not provided and 'agenticAppId' not found in a365.generated.config.json under '$ConfigDir'. Pass -AgentIdentityAppId."
}
Write-Host "Agent identity app id: $AgentIdentityAppId"

# ── Resolve service principal object ids ────────────────────────────────────
$agentSpId = az ad sp show --id $AgentIdentityAppId --query id -o tsv 2>$null
if (-not $agentSpId) { throw "No service principal found for app id $AgentIdentityAppId (is the agent identity provisioned?)." }
$graphSpId = az ad sp show --id $GraphAppId --query id -o tsv
Write-Host "Agent identity SP objectId: $agentSpId"
Write-Host "Microsoft Graph SP objectId: $graphSpId"

# ── Idempotency: is the role already assigned? ──────────────────────────────
$existing = az rest --method GET `
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$agentSpId/appRoleAssignments" `
  --query "value[?appRoleId=='$ContentProcessAllRoleId' && resourceId=='$graphSpId'] | [0].id" -o tsv 2>$null
if ($existing) {
  Write-Host "Content.Process.All already assigned (assignment id: $existing). Nothing to do."
  return
}

# ── Create the surgical appRoleAssignment ───────────────────────────────────
$tmp = New-TemporaryFile
@{ principalId = $agentSpId; resourceId = $graphSpId; appRoleId = $ContentProcessAllRoleId } |
  ConvertTo-Json | Set-Content -Path $tmp -Encoding utf8
try {
  Write-Host "Granting Content.Process.All to the agent identity SP..."
  az rest --method POST `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$agentSpId/appRoleAssignments" `
    --headers "Content-Type=application/json" `
    --body "@$tmp" | Out-String | Write-Host
  Write-Host "Done. The agent identity's FMI Graph token will now carry Content.Process.All."
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}
