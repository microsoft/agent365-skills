#!/usr/bin/env bash
# scripts/refresh.sh — Force-refresh Agent 365 Skills (macOS / Linux)
#
# Use this after `git pull` (if you cloned the repo) or any time you suspect
# the locally-installed plugin is stale. It wipes the version-check cache and
# any project-local detection caches in the current directory, then prints the
# exact install command for your chat client.
#
# Usage:
#   ./scripts/refresh.sh
#
# One-liner from anywhere:
#   curl -fsSL https://raw.githubusercontent.com/microsoft/agent365-skills/main/scripts/refresh.sh | bash

set -euo pipefail

printf '\033[1;36mAgent 365 Skills — refresh\033[0m\n\n'

# ── 1. Wipe the version-check cache (~/.cache/agent365-skills) ───────────────

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/agent365-skills"
if [ -d "$cache_dir" ]; then
    rm -rf "$cache_dir"
    printf '  [v] Wiped version-check cache: %s\n' "$cache_dir"
else
    printf '  [-] No version-check cache to wipe (already absent)\n'
fi

# ── 2. Wipe any project-local detection cache in the current directory ──────

detection_cache="$(pwd)/.a365-workspace-detection.local.json"
if [ -f "$detection_cache" ]; then
    rm -f "$detection_cache"
    printf '  [v] Wiped project detection cache: %s\n' "$detection_cache"
else
    printf '  [-] No project detection cache in cwd (already absent)\n'
fi

# ── 3. Report the currently-installed plugin version (best-effort) ───────────

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

# ── 4. Print the install command for each supported client ──────────────────

printf '\n\033[1;36mNext: reinstall the plugin in your chat client to pull the latest:\033[0m\n\n'
printf '  Claude Code:\n'
printf '    /plugin update agent365@agent365-skills\n'
printf '    (or, if not installed:  /plugin install agent365@agent365-skills)\n\n'
printf '  GitHub Copilot CLI:\n'
printf '    gh skill add microsoft/agent365-skills\n\n'
printf '\033[2mAfter reinstalling, restart your session so the new plugin.json loads.\033[0m\n'
