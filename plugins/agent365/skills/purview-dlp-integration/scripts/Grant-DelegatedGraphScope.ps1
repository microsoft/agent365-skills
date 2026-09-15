<#
.SYNOPSIS
  Grants the delegated Microsoft Graph scope(s) the DLP guard needs
  (Content.Process.User) onto the agent's EXISTING agentic consent — surgically,
  without disturbing the agent's broad agentic permissions.

.DESCRIPTION
  The guard calls `processContent` with the agent's AGENTIC DELEGATED token, so the agent's
  Graph consent must include `Content.Process.User` (delegated). This script APPENDS that
  scope to the existing AllPrincipals oauth2PermissionGrant for Microsoft Graph on the agent
  app's service principal.

  ⚠️ Why not `az ad app permission admin-consent`?
     Because that rebuilds the delegated grant from the app manifest and can NARROW / wipe the
     agent's broad agentic consent → the agent stops authenticating (AADSTS65001 consent_required).
     Appending to the existing grant (as this script does) is safe and reversible.

  Requires: Azure CLI (az), signed in as an admin who can consent for the tenant
    az login --tenant <tenant-id>

.PARAMETER AppId
  The agent's Entra application (client) id (the blueprint app). Auto-discovered from
  a365.generated.config.json (agentBlueprintId) if omitted. The service principal is resolved
  for this app in the signed-in tenant, including when -AppId overrides the config.

.EXAMPLE
  # From an A365 project folder — app id read from a365 config:
  ./Grant-DelegatedGraphScope.ps1

.EXAMPLE
  ./Grant-DelegatedGraphScope.ps1 -AppId 00000000-1111-2222-3333-444444444444
#>
[CmdletBinding()]
param(
  [string]   $AppId,                            # auto-discovered from a365 config if omitted
  [ValidateSet('Content.Process.User')]
  [string[]] $Scope     = @('Content.Process.User'),
  [string]   $ConfigDir = '.'                    # folder containing a365.config.json / a365.generated.config.json
)

$ErrorActionPreference = 'Stop'
$graphAppId = '00000003-0000-0000-c000-000000000000'

# ── Auto-discover from A365 project config when values aren't passed ──────────
function Get-A365Value {
  param([string]$Dir, [string[]]$Files, [string[]]$Keys)
  foreach ($f in $Files) {
    $p = Join-Path $Dir $f
    if (Test-Path $p) {
      try { $j = Get-Content $p -Raw | ConvertFrom-Json } catch { continue }
      foreach ($k in $Keys) { if (($j.PSObject.Properties.Name -contains $k) -and $j.$k) { return [string]$j.$k } }
    }
  }
  return $null
}
if (-not $AppId) { $AppId = Get-A365Value $ConfigDir @('a365.generated.config.json','a365.config.json') @('agentBlueprintId','botMsaAppId','botId') }
if (-not $AppId) { throw "AppId not provided and not found in a365 config under '$ConfigDir'. Pass -AppId." }

# Resolve the requested app in the signed-in tenant rather than trusting a cached SP id.
$bpSpId = az ad sp show --id $AppId --query id -o tsv
if ($LASTEXITCODE -ne 0 -or -not $bpSpId) { throw "Could not resolve service principal for app $AppId. Check the signed-in tenant." }
$graphSpId = az ad sp show --id $graphAppId --query id -o tsv
if ($LASTEXITCODE -ne 0 -or -not $graphSpId) { throw "Could not resolve the Microsoft Graph service principal." }
Write-Host "Agent SP objectId : $bpSpId"
Write-Host "Graph SP objectId : $graphSpId"

# Find the existing delegated (AllPrincipals) grant to Microsoft Graph.
function Get-GraphGrant {
  $url = "https://graph.microsoft.com/v1.0/servicePrincipals/$bpSpId/oauth2PermissionGrants"
  do {
    $response = az rest --method GET --url $url -o json
    if ($LASTEXITCODE -ne 0) { throw "Could not read the existing Graph delegated grants." }
    $page = $response | ConvertFrom-Json
    $grant = $page.value | Where-Object { $_.resourceId -eq $graphSpId -and $_.consentType -eq 'AllPrincipals' } | Select-Object -First 1
    if ($grant) { return $grant }
    $url = $page.'@odata.nextLink'
  } while ($url)
}
$grant = Get-GraphGrant
$body = $null

if (-not $grant) {
  Write-Host "No existing Graph delegated grant found — creating a new AllPrincipals grant."
  $body = @{ clientId = $bpSpId; consentType = 'AllPrincipals'; resourceId = $graphSpId; scope = ($Scope -join ' ') } | ConvertTo-Json -Compress
  $method = 'POST'
  $url = 'https://graph.microsoft.com/v1.0/oauth2PermissionGrants'
} else {
  $existing = @($grant.scope -split '\s+' | Where-Object { $_ })
  $missing  = @($Scope | Where-Object { $existing -notcontains $_ })
  if ($missing.Count -eq 0) {
    Write-Host "All requested scopes already present. Nothing to do."
  } else {
    $newScope = (($existing + $missing) -join ' ').Trim()
    Write-Host "BEFORE: $($grant.scope)"
    Write-Host "ADDING: $($missing -join ', ')"
    $body = @{ scope = $newScope } | ConvertTo-Json -Compress
    $method = 'PATCH'
    $url = "https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$($grant.id)"
  }
}

if ($body) {
  $tmp = New-TemporaryFile
  try {
    Set-Content -Path $tmp -Value $body -Encoding utf8
    az rest --method $method --url $url --headers "Content-Type=application/json" --body "@$tmp" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Graph delegated grant update failed. No successful grant was verified." }
  } finally {
    Remove-Item $tmp -Force
  }
}

# Verify.
$after = Get-GraphGrant
$missing = @($Scope | Where-Object { ($after.scope -split '\s+') -notcontains $_ })
if (-not $after -or $missing.Count -gt 0) {
  throw "Graph AllPrincipals grant verification failed; scopes still missing: $($missing -join ', '). Re-run after confirming the tenant and permissions."
}
Write-Host "`n=== VERIFY (Graph delegated scopes on agent) ==="
Write-Host $after.scope
Write-Host "`nRestart the agent so it picks up a fresh token, then test."
