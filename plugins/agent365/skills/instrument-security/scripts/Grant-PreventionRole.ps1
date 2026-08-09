# Grant the Defender prevention app role to an agent blueprint.
#
# 'a365 setup all' does not grant this role yet, so it must be granted out of band.
#
# SELF-RETIRING: the first thing this does is check whether the role is already
# granted. Once the A365 SDK grants it as part of 'a365 setup all', this script
# becomes a silent no-op and the calling phase can be deleted.
#
# Three operations, all idempotent:
#   1. Provision the prevention resource service principal in the tenant.
#   2. Add the resource to the blueprint's required access + inheritable permissions.
#   3. Assign the app role to the BLUEPRINT service principal, so every agent
#      identity minted from that blueprint inherits it through the FMI chain.
#
# Usage (from the agent project folder, after 'a365 setup all'):
#   ./Grant-PreventionRole.ps1
#   ./Grant-PreventionRole.ps1 -WhatIf          # report state, change nothing
#   ./Grant-PreventionRole.ps1 -Json            # machine-readable result
#
# Exit codes: 0 = granted or already granted, 2 = needs an administrator, 1 = error.

[CmdletBinding(SupportsShouldProcess)]
param(
    # Defaults to agentBlueprintServicePrincipalObjectId in a365.generated.config.json.
    [string]$BlueprintServicePrincipalObjectId,

    # "Defender for AI Prevention Webhook" — the resource agents request a token for.
    [string]$PreventionResourceAppId = "86a21212-634e-4553-b3d6-e477e4c9d9ec",

    [string]$AppRoleValue = "AIAgentsRTP.ToolInvocation",

    [string]$GeneratedConfigPath = "a365.generated.config.json",

    # Emit a single JSON object instead of prose, for skills that parse the result.
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$result = [ordered]@{
    status              = "unknown"   # already-granted | granted | needs-grant | needs-admin | error
    alreadyGranted      = $false
    resourceProvisioned = $false
    roleAssigned        = $false
    blueprintSpObjectId = $null
    appRoleValue        = $AppRoleValue
    message             = $null
}

function Complete-Run {
    param([string]$Status, [string]$Message, [int]$ExitCode)
    $result.status = $Status
    $result.message = $Message
    if ($Json) {
        [pscustomobject]$result | ConvertTo-Json -Compress
    }
    else {
        Write-Host $Message
    }
    exit $ExitCode
}

function Write-Step {
    param([string]$Message)
    if (-not $Json) { Write-Host "  - $Message" }
}

try {
    # ── Resolve the blueprint service principal ────────────────────────────
    if (-not $BlueprintServicePrincipalObjectId) {
        if (-not (Test-Path $GeneratedConfigPath)) {
            Complete-Run "error" "$GeneratedConfigPath not found. Run 'a365 setup all' first, or pass -BlueprintServicePrincipalObjectId." 1
        }

        $generated = Get-Content $GeneratedConfigPath -Raw | ConvertFrom-Json
        $BlueprintServicePrincipalObjectId = $generated.agentBlueprintServicePrincipalObjectId

        if (-not $BlueprintServicePrincipalObjectId) {
            Complete-Run "error" "agentBlueprintServicePrincipalObjectId missing from $GeneratedConfigPath. Re-run 'a365 setup all'." 1
        }
    }
    $result.blueprintSpObjectId = $BlueprintServicePrincipalObjectId

    # ── Fast path: is the role already granted? ────────────────────────────
    # Once the A365 SDK grants this during 'a365 setup all', every run stops here.
    $preventionSp = az ad sp show --id $PreventionResourceAppId --query "{id:id}" -o json 2>$null | ConvertFrom-Json

    $appRoleId = $null
    if ($preventionSp) {
        $result.resourceProvisioned = $true
        $appRoleId = az ad sp show --id $PreventionResourceAppId `
            --query "appRoles[?value=='$AppRoleValue'].id | [0]" -o tsv 2>$null

        if ($appRoleId) {
            $existing = az rest --method GET `
                --url "https://graph.microsoft.com/v1.0/servicePrincipals/$BlueprintServicePrincipalObjectId/appRoleAssignments" `
                --query "value[?appRoleId=='$appRoleId'] | [0].id" -o tsv 2>$null

            if ($existing) {
                $result.alreadyGranted = $true
                $result.roleAssigned = $true
                Complete-Run "already-granted" `
                    "'$AppRoleValue' is already granted to blueprint $BlueprintServicePrincipalObjectId. Nothing to do." 0
            }
        }
    }

    if ($WhatIfPreference) {
        Complete-Run "needs-grant" `
            "'$AppRoleValue' is NOT granted to blueprint $BlueprintServicePrincipalObjectId. Re-run without -WhatIf to grant it." 0
    }

    if (-not $Json) {
        Write-Host "Granting '$AppRoleValue' to blueprint SP $BlueprintServicePrincipalObjectId"
    }

    # ── Step 1: resource service principal must exist in this tenant ───────
    # Without it the token request fails AADSTS500011 even though the app id is
    # correct — the resource is simply unknown to the tenant.
    if (-not $preventionSp) {
        Write-Step "Provisioning resource service principal for $PreventionResourceAppId"
        $createOutput = az ad sp create --id $PreventionResourceAppId --query "{id:id}" -o json 2>&1
        if ($LASTEXITCODE -ne 0) {
            Complete-Run "needs-admin" (
                "Could not provision the prevention resource service principal — this needs an " +
                "administrator. Ask a Global Administrator to run:`n" +
                "  az ad sp create --id $PreventionResourceAppId`n" +
                "then re-run this script.`nDetail: $createOutput") 2
        }
        $preventionSp = $createOutput | ConvertFrom-Json
        $result.resourceProvisioned = $true
    }
    else {
        Write-Step "Resource service principal already present"
    }
    $preventionSpObjectId = $preventionSp.id

    # ── Step 2: inheritable permissions on the blueprint ───────────────────
    # The CLI owns this shape, so use it rather than hand-rolling requiredResourceAccess.
    Write-Step "Configuring inheritable permissions via 'a365 setup permissions custom'"
    $permOutput = a365 setup permissions custom `
        --resource-app-id $PreventionResourceAppId `
        --scopes $AppRoleValue 2>&1
    if ($LASTEXITCODE -ne 0) {
        Complete-Run "error" "'a365 setup permissions custom' failed:`n$permOutput" 1
    }

    # ── Step 3: app role assignment on the blueprint SP ────────────────────
    # Inheritable permissions alone do NOT produce a `roles` claim — this
    # assignment is what actually authorizes the call.
    if (-not $appRoleId) {
        $appRoleId = az ad sp show --id $PreventionResourceAppId `
            --query "appRoles[?value=='$AppRoleValue'].id | [0]" -o tsv 2>$null
    }
    if (-not $appRoleId) {
        Complete-Run "error" (
            "App role '$AppRoleValue' not found on $PreventionResourceAppId. " +
            "Verify the role name against the app registration.") 1
    }

    Write-Step "Assigning app role $AppRoleValue"
    $bodyPath = Join-Path ([System.IO.Path]::GetTempPath()) "prevention-role-$([guid]::NewGuid()).json"
    @{
        principalId = $BlueprintServicePrincipalObjectId
        resourceId  = $preventionSpObjectId
        appRoleId   = $appRoleId
    } | ConvertTo-Json -Compress | Out-File $bodyPath -Encoding ascii -NoNewline

    try {
        $assignOutput = az rest --method POST `
            --url "https://graph.microsoft.com/v1.0/servicePrincipals/$BlueprintServicePrincipalObjectId/appRoleAssignments" `
            --headers "Content-Type=application/json" `
            --body "@$bodyPath" 2>&1
        $assignExit = $LASTEXITCODE
    }
    finally {
        Remove-Item $bodyPath -Force -ErrorAction SilentlyContinue
    }

    if ($assignExit -ne 0) {
        # Treat a concurrent/duplicate assignment as success.
        if ("$assignOutput" -match "already exists") {
            $result.alreadyGranted = $true
            $result.roleAssigned = $true
            Complete-Run "already-granted" "'$AppRoleValue' was already granted. Nothing to do." 0
        }

        Complete-Run "needs-admin" (
            "Could not assign the app role — this needs an administrator. Ask a Global " +
            "Administrator to run:`n" +
            "  az rest --method POST --url ```n" +
            "    `"https://graph.microsoft.com/v1.0/servicePrincipals/$BlueprintServicePrincipalObjectId/appRoleAssignments`" ```n" +
            "    --headers `"Content-Type=application/json`" ```n" +
            "    --body '{`"principalId`":`"$BlueprintServicePrincipalObjectId`",`"resourceId`":`"$preventionSpObjectId`",`"appRoleId`":`"$appRoleId`"}'`n" +
            "Detail: $assignOutput") 2
    }

    $result.roleAssigned = $true
    Complete-Run "granted" (
        "Granted '$AppRoleValue' to blueprint $BlueprintServicePrincipalObjectId.`n" +
        "Agent identities minted from this blueprint now inherit it through the FMI chain.`n" +
        "Verify by decoding an agent's prevention token — 'roles' must contain the value.`n" +
        "Entra propagation can take up to a minute; a token cached before the grant will not have it.") 0
}
catch {
    Complete-Run "error" "Unexpected failure: $($_.Exception.Message)" 1
}
