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
  a365.generated.config.json (agentBlueprintId) if omitted; the agent SP object id is likewise
  read from a365.generated.config.json (agentBlueprintServicePrincipalObjectId) to skip an az lookup.

.EXAMPLE
  # From an A365 project folder — app id + SP object id read from a365 config:
  ./Grant-DelegatedGraphScope.ps1

.EXAMPLE
  ./Grant-DelegatedGraphScope.ps1 -AppId 00000000-1111-2222-3333-444444444444
#>
[CmdletBinding()]
param(
  [string]   $AppId,                            # auto-discovered from a365 config if omitted
  [string[]] $Scope     = @('Content.Process.User', 'ProtectionScopes.Compute.User'),
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

# Prefer the agent SP object id straight from a365.generated.config.json (saves an az lookup).
$bpSpId    = Get-A365Value $ConfigDir @('a365.generated.config.json') @('agentBlueprintServicePrincipalObjectId')
if (-not $bpSpId) { $bpSpId = az ad sp show --id $AppId --query id -o tsv }
$graphSpId = az ad sp show --id $graphAppId --query id -o tsv
if (-not $bpSpId)    { throw "Could not resolve service principal for app $AppId. Is it provisioned in this tenant?" }
if (-not $graphSpId) { throw "Could not resolve the Microsoft Graph service principal." }
Write-Host "Agent SP objectId : $bpSpId"
Write-Host "Graph SP objectId : $graphSpId"

# Find the existing delegated (AllPrincipals) grant to Microsoft Graph.
$grants = (az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$bpSpId/oauth2PermissionGrants" | ConvertFrom-Json).value
$g = $grants | Where-Object { $_.resourceId -eq $graphSpId } | Select-Object -First 1

if (-not $g) {
  Write-Host "No existing Graph delegated grant found — creating a new AllPrincipals grant."
  $body = @{ clientId = $bpSpId; consentType = 'AllPrincipals'; resourceId = $graphSpId; scope = ($Scope -join ' ') } | ConvertTo-Json -Compress
  $tmp = New-TemporaryFile; Set-Content -Path $tmp -Value $body -Encoding utf8
  az rest --method POST --url "https://graph.microsoft.com/v1.0/oauth2PermissionGrants" --headers "Content-Type=application/json" --body "@$tmp" | Out-Null
  Remove-Item $tmp -Force
  Write-Host "Created grant with scopes: $($Scope -join ', ')"
} else {
  $existing = @($g.scope -split '\s+' | Where-Object { $_ })
  $missing  = $Scope | Where-Object { $existing -notcontains $_ }
  if ($missing.Count -eq 0) {
    Write-Host "All requested scopes already present. Nothing to do."
  } else {
    $newScope = (($existing + $missing) -join ' ').Trim()
    Write-Host "BEFORE: $($g.scope)"
    Write-Host "ADDING: $($missing -join ', ')"
    $body = @{ scope = $newScope } | ConvertTo-Json -Compress
    $tmp = New-TemporaryFile; Set-Content -Path $tmp -Value $body -Encoding utf8
    az rest --method PATCH --url "https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$($g.id)" --headers "Content-Type=application/json" --body "@$tmp" | Out-Null
    Remove-Item $tmp -Force
    Write-Host "AFTER : $newScope"
  }
}

# Verify.
Start-Sleep -Seconds 2
$after = (az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$bpSpId/oauth2PermissionGrants" | ConvertFrom-Json).value |
  Where-Object { $_.resourceId -eq $graphSpId } | Select-Object -First 1
Write-Host "`n=== VERIFY (Graph delegated scopes on agent) ==="
Write-Host $after.scope
foreach ($s in $Scope) {
  $has = ($after.scope -split '\s+') -contains $s
  Write-Host ("{0,-32} -> {1}" -f $s, ($(if ($has) { 'PRESENT' } else { 'MISSING' })))
}
Write-Host "`nRestart the agent so it picks up a fresh token, then test."
