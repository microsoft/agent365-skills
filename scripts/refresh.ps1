# scripts/refresh.ps1 — Force-refresh Agent 365 Skills (Windows / PowerShell)
#
# Use this after `git pull` (if you cloned the repo) or any time you suspect
# the locally-installed plugin is stale. It wipes the version-check cache and
# any project-local detection caches in the current directory, then prints the
# exact install command for your chat client.
#
# Usage:
#   ./scripts/refresh.ps1
#
# One-liner from anywhere:
#   iwr https://raw.githubusercontent.com/microsoft/agent365-skills/main/scripts/refresh.ps1 | iex

$ErrorActionPreference = 'Stop'

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

# ── 2. Wipe any project-local detection caches in the current directory ──────

$detectionCache = Join-Path (Get-Location) '.a365-workspace-detection.local.json'
if (Test-Path -LiteralPath $detectionCache) {
    Remove-Item -LiteralPath $detectionCache -Force
    Write-Host "  [v] Wiped project detection cache: $detectionCache"
} else {
    Write-Host "  [-] No project detection cache in cwd (already absent)"
}

# ── 3. Report the currently-installed plugin version (best-effort) ───────────

$pluginJson = $null
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

# ── 4. Print the install command for each supported client ──────────────────

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
Write-Host 'After reinstalling, restart your session so the new plugin.json loads.' -ForegroundColor Gray
