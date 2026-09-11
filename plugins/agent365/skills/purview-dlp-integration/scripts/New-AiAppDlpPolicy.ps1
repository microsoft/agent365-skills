<#
.SYNOPSIS
  Creates a Microsoft Purview DLP policy that blocks sensitive content for a specific
  Agent 365 / custom AI-app, enforced via the Graph `processContent` gate.

.DESCRIPTION
  A365 agents that call `processContent` are evaluated under the Purview "Applications"
  workload, scoped to the agent's Entra app id (portal: "Managed cloud apps" location).
  This script creates a dedicated DLP policy + rule for that app with a RestrictAccess=Block
  action. It intentionally does NOT mix in Exchange/SharePoint/OneDrive/Teams locations,
  because Purview rejects that combination (ErrorUnsupportedEnforcementPlanesException).

  Gotchas this script handles for you (all learned the hard way):
    • location must be Workload=Applications, Location=<AppId>, LocationSource=Entra
    • policy requires  -EnforcementPlanes @('Application')   (NOT 'CopilotExperiences', which is first-party Copilot)
    • the block action is  -RestrictAccess @(@{setting='UploadText';value='Block'})  (NOT -BlockAccess)
    • DownloadText restrict is not supported for this workload → input (prompt) gate only

  Requires: ExchangeOnlineManagement module + Security & Compliance admin. Run:
    Install-Module ExchangeOnlineManagement -Scope CurrentUser

.PARAMETER AppId
  The agent's Entra application (client) id — the same id the agent sends as applicationLocation.
  Auto-discovered from a365.generated.config.json (agentBlueprintId) / a365.config.json if omitted.

.PARAMETER AppName
  Display name for the policy location (free-form). Auto-discovered from a365.config.json
  (agentBlueprintDisplayName / agentDescription) if omitted.

.EXAMPLE
  # From an A365 project folder — app id + name read from a365 config:
  ./New-AiAppDlpPolicy.ps1 -NotifyUser admin@contoso.com

.EXAMPLE
  ./New-AiAppDlpPolicy.ps1 -AppId 00000000-1111-2222-3333-444444444444 -AppName "Contoso HR Agent" `
     -SensitiveInfoType "Credit Card Number","U.S. Social Security Number (SSN)" -NotifyUser admin@contoso.com
#>
[CmdletBinding()]
param(
  [string]   $AppId,                            # auto-discovered from a365 config if omitted
  [string]   $AppName,                          # auto-discovered from a365 config if omitted
  [string]   $PolicyName,
  [string]   $RuleName,
  [string[]] $SensitiveInfoType = @('Credit Card Number'),
  [string]   $NotifyUser        = $null,        # admin UPN to notify on match (recommended by MS: agents are unaware of blocks)
  [string]   $UserPrincipalName = $null,        # UPN to sign in with (optional; speeds up Connect-IPPSSession)
  [switch]   $ListExisting,                     # read-only: list existing DLP policies + whether they cover this app, then exit
  [string]   $ConfigDir         = '.'           # folder containing a365.config.json / a365.generated.config.json
)

$ErrorActionPreference = 'Stop'

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
if (-not $AppId)   { $AppId   = Get-A365Value $ConfigDir @('a365.generated.config.json','a365.config.json') @('agentBlueprintId','botMsaAppId','botId') }
if (-not $AppName) { $AppName = Get-A365Value $ConfigDir @('a365.config.json') @('agentBlueprintDisplayName','agentDescription','agentIdentityDisplayName') }
if (-not $AppId)      { throw "AppId not provided and not found in a365 config under '$ConfigDir'. Pass -AppId." }
if (-not $AppName)    { $AppName = 'AI Agent' }
if (-not $PolicyName) { $PolicyName = "AI Agent DLP - $AppName" }
if (-not $RuleName)   { $RuleName   = "$PolicyName rule" }
Write-Host "Target app: $AppId  ('$AppName')"

# 1) Ensure we're connected to Security & Compliance PowerShell.
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  throw "ExchangeOnlineManagement module not found. Run: Install-Module ExchangeOnlineManagement -Scope CurrentUser"
}
Import-Module ExchangeOnlineManagement -ErrorAction Stop
try {
  Get-DlpCompliancePolicy -ErrorAction Stop | Out-Null
} catch {
  Write-Host "Connecting to Security & Compliance (a sign-in window will open)..."
  if ($UserPrincipalName) { Connect-IPPSSession -UserPrincipalName $UserPrincipalName -ShowBanner:$false }
  else                    { Connect-IPPSSession -ShowBanner:$false }
}

# 1b) -ListExisting: read-only. Show existing DLP policies and whether they already cover THIS app,
#     so the operator can choose an existing policy instead of creating a new one. Then exit.
if ($ListExisting) {
  Write-Host "`n=== Existing DLP policies (coverage for app $AppId) ==="
  $all = @(Get-DlpCompliancePolicy)
  if (-not $all) {
    Write-Host "  (no DLP policies found in this tenant)"
  } else {
    foreach ($p in ($all | Sort-Object Name)) {
      $locStr  = "$($p.Locations)"
      $covered = $locStr -match [regex]::Escape($AppId)
      $hasApps = $locStr -match 'Applications'
      $flag    = if ($covered) { 'COVERS THIS APP' } elseif ($hasApps) { 'Applications loc (other app)' } else { 'no Applications loc' }
      Write-Host ("  {0,-45} Mode={1,-8} -> {2}" -f $p.Name, $p.Mode, $flag)
    }
  }
  Write-Host "`nUse a policy marked 'COVERS THIS APP' as-is (the guard matches by app id)."
  Write-Host "If none cover it, add this app id to a policy's Applications location in the Purview"
  Write-Host "portal, or re-run WITHOUT -ListExisting to create a dedicated policy."
  return
}

# 2) Build the AI-app (Managed cloud apps / Applications) location JSON for THIS app.
$loc = "[{`"Workload`":`"Applications`",`"Location`":`"$AppId`",`"LocationDisplayName`":`"$AppName`",`"LocationSource`":`"Entra`",`"LocationType`":`"Individual`",`"Inclusions`":[{`"Type`":`"Tenant`",`"Identity`":`"All`"}]}]"

# 3) Create the policy (idempotent).
if (Get-DlpCompliancePolicy -Identity $PolicyName -ErrorAction SilentlyContinue) {
  Write-Host "Policy already exists: $PolicyName"
} else {
  New-DlpCompliancePolicy -Name $PolicyName -Mode Enable -Locations $loc `
    -EnforcementPlanes @('Application') `
    -Comment "Blocks sensitive content in the '$AppName' AI app (processContent). Scoped to app $AppId." | Out-Null
  Write-Host "Created policy: $PolicyName"
}

Start-Sleep -Seconds 3

# 4) Create the rule (idempotent): SIT condition + RestrictAccess block on the prompt.
if (Get-DlpComplianceRule -Identity $RuleName -ErrorAction SilentlyContinue) {
  Write-Host "Rule already exists: $RuleName"
} else {
  $sit = @($SensitiveInfoType | ForEach-Object { @{ Name = $_ } })
  $ruleParams = @{
    Name                                = $RuleName
    Policy                              = $PolicyName
    ContentContainsSensitiveInformation = $sit
    RestrictAccess                      = @(@{ setting = 'UploadText'; value = 'Block' })
  }
  if ($NotifyUser) { $ruleParams.NotifyUser = @($NotifyUser) }
  New-DlpComplianceRule @ruleParams | Out-Null
  Write-Host "Created rule: $RuleName  (SITs: $($SensitiveInfoType -join ', '))"
}

# 5) Verify.
Write-Host "`n=== VERIFY POLICY ==="
Get-DlpCompliancePolicy -Identity $PolicyName | Format-List Name, Mode, Enabled, Workload, Locations
Write-Host "=== VERIFY RULE ==="
Get-DlpComplianceRule -Identity $RuleName | Format-List Name, ParentPolicyName, Disabled, RestrictAccess

Write-Host "`nDone. Allow up to ~1 hour to propagate, then test."
Write-Host "NOTE: 'DistributionStatus: Pending' is UNRELIABLE — many tenants show Pending even for live"
Write-Host "policies. Judge success only by the agent's [purview] log line, not by DistributionStatus."
