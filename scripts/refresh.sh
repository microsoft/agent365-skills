#!/usr/bin/env bash
# scripts/refresh.sh — Force-refresh Agent 365 Skills (macOS / Linux)
#
# Use this after `git pull` (if you cloned the repo) or any time you suspect
# the locally-installed plugin is stale. It wipes (only items created by this
# repo — never user-owned content):
#   - the version-check cache (~/.cache/agent365-skills/)
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

# ── 1. Wipe the version-check cache ──────────────────────────────────────────
# Must mirror plugins/agent365/scripts/check-version.js cacheFilePath() exactly:
#   $XDG_CACHE_HOME/version.json                    (if XDG_CACHE_HOME set — any OS)
#   $HOME/.cache/agent365-skills/version.json       (Unix default)
# Otherwise a redirected XDG_CACHE_HOME setting would leave stale cache behind.

if [ -n "${XDG_CACHE_HOME:-}" ]; then
    # check-version.js writes the file directly under XDG_CACHE_HOME (no subfolder).
    cache_dir="$XDG_CACHE_HOME"
    cache_file="$cache_dir/version.json"
    owns_dir=0
else
    cache_dir="$HOME/.cache/agent365-skills"
    cache_file="$cache_dir/version.json"
    owns_dir=1
fi

if [ -f "$cache_file" ]; then
    rm -f "$cache_file"
    printf '  [v] Wiped version-check cache: %s\n' "$cache_file"
    # Only prune the directory if we own it (i.e. it's our agent365-skills subfolder,
    # never XDG_CACHE_HOME itself which belongs to the user/other apps).
    if [ "$owns_dir" -eq 1 ] && [ -d "$cache_dir" ] && [ -z "$(ls -A "$cache_dir" 2>/dev/null)" ]; then
        rmdir "$cache_dir"
    fi
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

# ── 4. Surgically remove the Agent 365 section from .github/copilot-instructions.md ──
# install.js appends Agent 365 skills instructions to the user's file (or
# creates one fresh). The Agent 365 block always starts with an H1:
# "# Agent 365 Skills". This script locates that boundary and removes ONLY
# the Agent 365 section, leaving any other content above it intact. If the
# entire file is Agent 365 content (no other content above the H1), the file
# is deleted outright so the next install.js run creates a fresh copy.

copilot_instr="$(pwd)/.github/copilot-instructions.md"
if [ -f "$copilot_instr" ]; then
    if grep -q '^# Agent 365 Skills' "$copilot_instr" 2>/dev/null; then
        # Use node for safe Unicode-correct string splitting (the H1 has an em-dash
        # in some upstream variants; awk/sed handling can drop bytes on Windows
        # checkouts that round-tripped through CRLF).
        node -e "
            const fs = require('fs');
            const p = '$copilot_instr';
            const c = fs.readFileSync(p, 'utf8');
            const marker = '# Agent 365 Skills';
            let trimmed = null;
            if (c.startsWith(marker)) {
                trimmed = '';
            } else {
                const idx = c.indexOf('\n' + marker);
                if (idx >= 0) trimmed = c.substring(0, idx).replace(/[\s\n]+\$/, '');
            }
            if (trimmed === null) process.exit(2);
            if (trimmed === '') {
                fs.unlinkSync(p);
                process.exit(10);
            } else {
                fs.writeFileSync(p, trimmed + '\n', 'utf8');
                process.exit(11);
            }
        "
        rc=$?
        case "$rc" in
            10)
                printf '  [v] Wiped .github/copilot-instructions.md (file was purely Agent 365 instructions)\n'
                github_dir="$(dirname "$copilot_instr")"
                if [ -z "$(ls -A "$github_dir" 2>/dev/null)" ]; then
                    rmdir "$github_dir"
                fi
                ;;
            11)
                printf '  [v] Removed Agent 365 instructions section from .github/copilot-instructions.md (preserved other content above it)\n'
                ;;
            *)
                printf '  [-] .github/copilot-instructions.md present but Agent 365 H1 not at a clean boundary — left in place\n'
                ;;
        esac
    else
        printf '  [-] .github/copilot-instructions.md present but contains no Agent 365 H1 — left in place\n'
    fi
else
    printf '  [-] No .github/copilot-instructions.md in cwd (already absent)\n'
fi

# .vscode/settings.json is NOT auto-wiped — the installer only adds one key
# (chat.agentSkillsLocations) and user's other VS Code settings live in the
# same file. Removing one key safely would require JSON parsing/serialization
# that risks losing comments and trailing commas. Warn only.

vscode_settings="$(pwd)/.vscode/settings.json"
if [ -f "$vscode_settings" ] && grep -q 'chat\.agentSkillsLocations' "$vscode_settings" 2>/dev/null; then
    printf '\n  [!] .vscode/settings.json contains chat.agentSkillsLocations.\n'
    printf '      Left in place — remove the key by hand if you need a true reset.\n'
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
