# scripts/refresh.ps1 — Force-refresh Agent 365 Skills (Windows / PowerShell)
#
# Use this after `git pull` (if you cloned the repo) or any time you suspect
# the locally-installed plugin is stale. It wipes (only items created by this
# repo — never user-owned content):
#   - the version-check cache ($LOCALAPPDATA/agent365-skills/)
#   - the project-local detection cache (.a365-workspace-detection.local.json)
#   - the per-project Agent 365 skills under .agents/skills/<plugin-skill>/
#     (only the 6 plugin-owned skills; any other subdir is left alone)
#   - the Agent 365 instructions section in .github/copilot-instructions.md
#     (surgically removed via the "# Agent 365 Skills" H1 marker — other
#     content above the marker is preserved)
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

# ── 1. Wipe the version-check cache ──────────────────────────────────────────
# Must mirror plugins/agent365/scripts/check-version.js cacheFilePath() exactly:
#   $XDG_CACHE_HOME/version.json                                    (if XDG_CACHE_HOME set — any OS)
#   $HOME/AppData/Local/agent365-skills/version.json                (Windows default)
#   $HOME/.cache/agent365-skills/version.json                       (Unix default)
# Otherwise a redirected XDG_CACHE_HOME setting would leave stale cache behind.

if ($env:XDG_CACHE_HOME) {
    # check-version.js writes the file directly under XDG_CACHE_HOME (no subfolder).
    $cacheDir  = $env:XDG_CACHE_HOME
    $cacheFile = Join-Path $cacheDir 'version.json'
    $ownsDir   = $false
} else {
    $cacheDir  = Join-Path $env:LOCALAPPDATA 'agent365-skills'
    $cacheFile = Join-Path $cacheDir 'version.json'
    $ownsDir   = $true
}

if (Test-Path -LiteralPath $cacheFile) {
    Remove-Item -LiteralPath $cacheFile -Force
    Write-Host "  [v] Wiped version-check cache: $cacheFile"
    # Only prune the directory if we own it (i.e. it's our agent365-skills subfolder,
    # never XDG_CACHE_HOME itself which belongs to the user/other apps).
    if ($ownsDir -and (Test-Path -LiteralPath $cacheDir) `
        -and ((Get-ChildItem -LiteralPath $cacheDir -Force | Measure-Object).Count -eq 0)) {
        Remove-Item -LiteralPath $cacheDir -Force
    }
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

# ── 4. Surgically remove the Agent 365 section from .github/copilot-instructions.md ──
# install.js appends Agent 365 skills instructions to the user's file (or
# creates one fresh). The Agent 365 block always starts with an H1:
# "# Agent 365 Skills". This script locates that boundary and removes ONLY
# the Agent 365 section, leaving any other content above it intact. If the
# entire file is Agent 365 content (no other content above the H1), the file
# is deleted outright so the next install.js run creates a fresh copy.

$copilotInstr = Join-Path (Get-Location) '.github\copilot-instructions.md'
if (Test-Path -LiteralPath $copilotInstr) {
    $content = Get-Content -LiteralPath $copilotInstr -Raw
    $marker = '# Agent 365 Skills'
    $newlineMarker = "`n$marker"

    $trimmed = $null
    if ($content.StartsWith($marker)) {
        # Entire file starts with the Agent 365 H1 — file is purely Agent 365 instructions.
        $trimmed = ''
    } else {
        $idx = $content.IndexOf($newlineMarker)
        if ($idx -ge 0) {
            # Non-Agent-365 content above, Agent 365 instructions below.
            # Keep only the non-Agent-365 content.
            $trimmed = $content.Substring(0, $idx).TrimEnd([char[]]@("`r", "`n", " ", "`t"))
        }
    }

    if ($null -ne $trimmed) {
        if ($trimmed -eq '') {
            Remove-Item -LiteralPath $copilotInstr -Force
            Write-Host "  [v] Wiped .github/copilot-instructions.md (file was purely Agent 365 instructions)"
            $githubDir = Split-Path $copilotInstr -Parent
            if ((Get-ChildItem -LiteralPath $githubDir -Force | Measure-Object).Count -eq 0) {
                Remove-Item -LiteralPath $githubDir -Force
            }
        } else {
            Set-Content -LiteralPath $copilotInstr -Value ($trimmed + "`n") -NoNewline
            Write-Host "  [v] Removed Agent 365 instructions section from .github/copilot-instructions.md (preserved other content above it)"
        }
    } else {
        Write-Host "  [-] .github/copilot-instructions.md present but contains no Agent 365 H1 — left in place"
    }
} else {
    Write-Host "  [-] No .github/copilot-instructions.md in cwd (already absent)"
}

# .vscode/settings.json is NOT auto-wiped — the installer only adds one key
# (chat.agentSkillsLocations) and user's other VS Code settings live in the
# same file. Removing one key safely would require JSON parsing/serialization
# that risks losing comments and trailing commas. Warn only.

$vscodeSettings = Join-Path (Get-Location) '.vscode\settings.json'
if (Test-Path -LiteralPath $vscodeSettings) {
    $vsContent = Get-Content -LiteralPath $vscodeSettings -Raw
    if ($vsContent -match 'chat\.agentSkillsLocations') {
        Write-Host ''
        Write-Host "  [!] .vscode/settings.json contains chat.agentSkillsLocations."
        Write-Host "      Left in place — remove the key by hand if you need a true reset."
    }
}

# ── 5. Report the currently-installed plugin version (best-effort) ───────────

# Use explicit foreach so the result is unambiguously a single path — piping
# through Where-Object collapses to a scalar string when only one item matches,
# and then $arr[0] indexes the first character instead of the first element.

$pluginJson = $null
foreach ($candidate in @(
    (Join-Path (Get-Location) 'plugins\agent365\.claude-plugin\plugin.json'),
    (Join-Path $PSScriptRoot '..\plugins\agent365\.claude-plugin\plugin.json')
)) {
    if (Test-Path -LiteralPath $candidate) {
        $pluginJson = $candidate
        break
    }
}

if ($null -ne $pluginJson) {
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
