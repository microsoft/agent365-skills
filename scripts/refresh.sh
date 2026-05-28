#!/usr/bin/env bash
# scripts/refresh.sh — Force-refresh Agent 365 Skills (macOS / Linux)
#
# Use this after `git pull` (if you cloned the repo) or any time you suspect
# the locally-installed plugin is stale. It wipes:
#   - the version-check cache (~/.cache/agent365-skills/)
#   - the project-local detection cache (.a365-workspace-detection.local.json)
#   - the per-project plugin copies under .agents/skills/<plugin-skill>/
#
# Then prints the exact reinstall command for your chat client.
#
# Usage:
#   ./scripts/refresh.sh
#
# One-liner from anywhere:
#   curl -fsSL https://raw.githubusercontent.com/microsoft/agent365-skills/main/scripts/refresh.sh | bash

set -euo pipefail

# Plugin-owned skill names — must match the directories in plugins/agent365/skills/.
# Only these are deleted from .agents/skills/ — anything else in that directory
# is treated as the user's own content and left alone.
plugin_skills=(
    a365-setup
    make-ai-teammate
    make-a365-agent
    add-workiq-tools
    instrument-observability
    test-local
)

printf '\033[1;36mAgent 365 Skills — refresh\033[0m\n\n'

# ── 1. Wipe the version-check cache (~/.cache/agent365-skills) ───────────────

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/agent365-skills"
if [ -d "$cache_dir" ]; then
    rm -rf "$cache_dir"
    printf '  [v] Wiped version-check cache: %s\n' "$cache_dir"
else
    printf '  [-] No version-check cache to wipe (already absent)\n'
fi

# ── 2. Wipe project-local detection cache ────────────────────────────────────

detection_cache="$(pwd)/.a365-workspace-detection.local.json"
if [ -f "$detection_cache" ]; then
    rm -f "$detection_cache"
    printf '  [v] Wiped project detection cache: %s\n' "$detection_cache"
else
    printf '  [-] No project detection cache in cwd (already absent)\n'
fi

# ── 3. Wipe per-project plugin copies under .agents/skills/ ──────────────────

agents_skills_dir="$(pwd)/.agents/skills"
if [ -d "$agents_skills_dir" ]; then
    wiped=()
    for skill in "${plugin_skills[@]}"; do
        skill_dir="$agents_skills_dir/$skill"
        if [ -d "$skill_dir" ]; then
            rm -rf "$skill_dir"
            wiped+=("$skill")
        fi
    done
    if [ "${#wiped[@]}" -gt 0 ]; then
        printf '  [v] Wiped .agents/skills/ plugin copies: %s\n' "$(IFS=,; echo "${wiped[*]}" | sed 's/,/, /g')"
    else
        printf '  [-] .agents/skills/ exists but has no plugin copies to wipe\n'
    fi
    # If .agents/skills/ is empty now, prune it (and .agents if also empty)
    if [ -z "$(ls -A "$agents_skills_dir" 2>/dev/null)" ]; then
        rmdir "$agents_skills_dir"
        agents_dir="$(dirname "$agents_skills_dir")"
        if [ -z "$(ls -A "$agents_dir" 2>/dev/null)" ]; then
            rmdir "$agents_dir"
        fi
    fi
else
    printf '  [-] No .agents/skills/ in cwd (already absent)\n'
fi

# ── 4. Warn about per-project install artifacts left in place ────────────────
# .github/copilot-instructions.md and .vscode/settings.json may contain user
# content alongside ours — we don't touch them automatically.

copilot_instr="$(pwd)/.github/copilot-instructions.md"
if [ -f "$copilot_instr" ] && grep -q 'Agent 365 Skills' "$copilot_instr" 2>/dev/null; then
    printf '\n  [!] .github/copilot-instructions.md contains an Agent 365 block.\n'
    printf '      Left in place — may contain your own content alongside ours.\n'
    printf '      To force-replace from upstream, delete the file and re-run install.js.\n'
fi

vscode_settings="$(pwd)/.vscode/settings.json"
if [ -f "$vscode_settings" ] && grep -q 'chat\.agentSkillsLocations' "$vscode_settings" 2>/dev/null; then
    printf '\n  [!] .vscode/settings.json contains chat.agentSkillsLocations.\n'
    printf '      Left in place — your own VS Code settings are alongside the plugin key.\n'
fi

# ── 5. Report the currently-installed plugin version (best-effort) ───────────

plugin_json=""
for candidate in \
    "$(pwd)/plugins/agent365/.claude-plugin/plugin.json" \
    "$(dirname "$0")/../plugins/agent365/.claude-plugin/plugin.json"
do
    if [ -f "$candidate" ]; then
        plugin_json="$candidate"
        break
    fi
done

if [ -n "$plugin_json" ]; then
    installed_version=$(node -e "console.log(require('$plugin_json').version)" 2>/dev/null || true)
    if [ -n "$installed_version" ]; then
        printf '\n\033[1;32mInstalled plugin version: %s\033[0m\n' "$installed_version"
    else
        printf '\n\033[1;33mCould not read %s (skipping version report)\033[0m\n' "$plugin_json"
    fi
else
    printf '\n\033[1;33mNo local plugin.json found — refresh only wiped the host-level cache.\033[0m\n'
fi

# ── 6. Print the install command for each supported client ──────────────────

printf '\n\033[1;36mNext: reinstall the plugin in your chat client to pull the latest:\033[0m\n\n'
printf '  Claude Code:\n'
printf '    /plugin update agent365@agent365-skills\n'
printf '    (or, if not installed:  /plugin install agent365@agent365-skills)\n\n'
printf '  GitHub Copilot CLI:\n'
printf '    gh skill add microsoft/agent365-skills\n\n'
printf '  All clients (rebuilds .agents/skills/ via the installer):\n'
printf '    node scripts/install.js\n\n'
printf '\033[2mAfter reinstalling, restart your session so the new plugin.json loads.\033[0m\n'
