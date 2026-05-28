# scripts/refresh.ps1 — Force-refresh Agent 365 Skills (Windows / PowerShell)
#
# Use this after `git pull` (if you cloned the repo) or any time you suspect
# the locally-installed plugin is stale. It wipes:
#   - the version-check cache ($LOCALAPPDATA/agent365-skills/)
#   - the project-local detection cache (.a365-workspace-detection.local.json)
#   - the per-project plugin copies under .agents/skills/<plugin-skill>/
#
# Then prints the exact reinstall command for your chat client.
#
# Usage:
#   ./scripts/refresh.ps1
#
# One-liner from anywhere:
#   iwr https://raw.githubusercontent.com/microsoft/agent365-skills/main/scripts/refresh.ps1 | iex

$ErrorActionPreference = 'Stop'

# Plugin-owned skill names — must match the directories in plugins/agent365/skills/.
# Only these are deleted from .agents/skills/ — anything else in that directory
# is treated as the user's own content and left alone.
$pluginSkills = @(
    'a365-setup',
    'make-ai-teammate',
    'make-a365-agent',
    'add-workiq-tools',
    'instrument-observability',
    'test-local'
)

Write-Host 'Agent 365 Skills — refresh' -ForegroundColor Cyan
Write-Host ''

# ── 1. Wipe the version-check cache (LOCALAPPDATA\agent365-skills) ───────────

$cacheDir = Join-Path $env:LOCALAPPDATA 'agent365-skills'
if (Test-Path -LiteralPath $cacheDir) {
    Remove-Item -LiteralPath $cacheDir -Recurse -Force
    Write-Host "  [v] Wiped version-check cache: $cacheDir"
} else {
    Write-Host "  [-] No version-check cache to wipe (already absent)"
}

# ── 2. Wipe project-local detection cache ────────────────────────────────────

$detectionCache = Join-Path (Get-Location) '.a365-workspace-detection.local.json'
if (Test-Path -LiteralPath $detectionCache) {
    Remove-Item -LiteralPath $detectionCache -Force
    Write-Host "  [v] Wiped project detection cache: $detectionCache"
} else {
    Write-Host "  [-] No project detection cache in cwd (already absent)"
}

# ── 3. Wipe per-project plugin copies under .agents/skills/ ──────────────────

$agentsSkillsDir = Join-Path (Get-Location) '.agents\skills'
if (Test-Path -LiteralPath $agentsSkillsDir) {
    $wiped = @()
    foreach ($skill in $pluginSkills) {
        $skillDir = Join-Path $agentsSkillsDir $skill
        if (Test-Path -LiteralPath $skillDir) {
            Remove-Item -LiteralPath $skillDir -Recurse -Force
            $wiped += $skill
        }
    }
    if ($wiped.Count -gt 0) {
        Write-Host "  [v] Wiped .agents/skills/ plugin copies: $($wiped -join ', ')"
    } else {
        Write-Host "  [-] .agents/skills/ exists but has no plugin copies to wipe"
    }
    # If .agents/skills/ is empty now, prune it (and .agents if also empty)
    if ((Get-ChildItem -LiteralPath $agentsSkillsDir -Force | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath $agentsSkillsDir -Force
        $agentsDir = Split-Path $agentsSkillsDir -Parent
        if ((Get-ChildItem -LiteralPath $agentsDir -Force | Measure-Object).Count -eq 0) {
            Remove-Item -LiteralPath $agentsDir -Force
        }
    }
} else {
    Write-Host "  [-] No .agents/skills/ in cwd (already absent)"
}

# ── 4. Warn about per-project install artifacts left in place ────────────────
# .github/copilot-instructions.md and .vscode/settings.json may contain user
# content alongside ours — we don't touch them automatically. Warn so the user
# can git-restore if they want fully fresh copies.

$copilotInstr = Join-Path (Get-Location) '.github\copilot-instructions.md'
if (Test-Path -LiteralPath $copilotInstr) {
    $content = Get-Content -LiteralPath $copilotInstr -Raw
    if ($content -match 'Agent 365 Skills') {
        Write-Host ''
        Write-Host "  [!] .github/copilot-instructions.md contains an Agent 365 block."
        Write-Host "      Left in place — may contain your own content alongside ours."
        Write-Host "      To force-replace from upstream, delete the file and re-run install.js."
    }
}

$vscodeSettings = Join-Path (Get-Location) '.vscode\settings.json'
if (Test-Path -LiteralPath $vscodeSettings) {
    $vsContent = Get-Content -LiteralPath $vscodeSettings -Raw
    if ($vsContent -match 'chat\.agentSkillsLocations') {
        Write-Host ''
        Write-Host "  [!] .vscode/settings.json contains chat.agentSkillsLocations."
        Write-Host "      Left in place — your own VS Code settings are alongside the plugin key."
    }
}

# ── 5. Report the currently-installed plugin version (best-effort) ───────────

$candidates = @(
    (Join-Path (Get-Location) 'plugins\agent365\.claude-plugin\plugin.json'),
    (Join-Path $PSScriptRoot '..\plugins\agent365\.claude-plugin\plugin.json')
) | Where-Object { Test-Path -LiteralPath $_ }

if ($candidates.Count -gt 0) {
    $pluginJson = $candidates[0]
    try {
        $installedVersion = (Get-Content -LiteralPath $pluginJson -Raw | ConvertFrom-Json).version
        Write-Host ''
        Write-Host "Installed plugin version: $installedVersion" -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host "Could not read $pluginJson (skipping version report)" -ForegroundColor Yellow
    }
} else {
    Write-Host ''
    Write-Host 'No local plugin.json found — refresh only wiped the host-level cache.' -ForegroundColor Yellow
}

# ── 6. Print the install command for each supported client ──────────────────

Write-Host ''
Write-Host 'Next: reinstall the plugin in your chat client to pull the latest:' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Claude Code:'
Write-Host '    /plugin update agent365@agent365-skills'
Write-Host '    (or, if not installed:  /plugin install agent365@agent365-skills)'
Write-Host ''
Write-Host '  GitHub Copilot CLI:'
Write-Host '    gh skill add microsoft/agent365-skills'
Write-Host ''
Write-Host '  All clients (rebuilds .agents/skills/ via the installer):'
Write-Host '    node scripts/install.js'
Write-Host ''
Write-Host 'After reinstalling, restart your session so the new plugin.json loads.' -ForegroundColor Gray
