#!/usr/bin/env node
// scripts/ensure-skill-version-check.js
// Ensures each SKILL.md in plugins/agent365/skills/:
//   1. Has a `version:` field in YAML frontmatter matching plugin.json
//   2. Has the runtime version-check prompt line immediately after the frontmatter closing ---
//
// Usage:
//   node scripts/ensure-skill-version-check.js          # auto-add / auto-fix (default)
//   node scripts/ensure-skill-version-check.js --check  # check-only; exit 1 if any are missing or wrong

const VERSION_CHECK_LINE =
  '> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.';

'use strict';

const fs = require('fs');
const path = require('path');

const checkOnly = process.argv.includes('--check');
const PLUGIN_JSON = path.join('plugins', 'agent365', '.claude-plugin', 'plugin.json');
const SKILLS_DIR = path.join('plugins', 'agent365', 'skills');

const pluginVersion = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
if (!pluginVersion) {
  console.error('ERROR: could not read version from', PLUGIN_JSON);
  process.exit(1);
}

let missing = 0;
let fixed = 0;

for (const skill of fs.readdirSync(SKILLS_DIR).sort()) {
  const skillMdPath = path.join(SKILLS_DIR, skill, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) continue;

  const content = fs.readFileSync(skillMdPath, 'utf8');

  // Frontmatter must start at line 0 with ---
  if (!content.startsWith('---')) {
    console.error(`ERROR: ${skillMdPath} has no YAML frontmatter`);
    missing++;
    continue;
  }

  // Find closing ---
  const closingIdx = content.indexOf('\n---', 3);
  if (closingIdx === -1) {
    console.error(`ERROR: ${skillMdPath} frontmatter is not closed`);
    missing++;
    continue;
  }

  const frontmatter = content.slice(0, closingIdx);
  const afterFrontmatter = content.slice(closingIdx);

  const versionMatch = frontmatter.match(/^version:\s*(.+)$/m);

  if (versionMatch) {
    const currentVersion = versionMatch[1].trim();
    if (currentVersion === pluginVersion) {
      console.log(`OK: ${skillMdPath} (version: ${pluginVersion})`);
    } else if (checkOnly) {
      console.error(`FAIL: ${skillMdPath} — version '${currentVersion}' != plugin version '${pluginVersion}'`);
      missing++;
    } else {
      const updated = frontmatter.replace(/^version:\s*.+$/m, `version: ${pluginVersion}`);
      fs.writeFileSync(skillMdPath, updated + afterFrontmatter);
      console.log(`Updated ${skillMdPath}: ${currentVersion} → ${pluginVersion}`);
      fixed++;
    }
  } else if (checkOnly) {
    console.error(`FAIL: ${skillMdPath} — missing 'version:' field in frontmatter`);
    missing++;
  } else {
    // Insert version: after the name: line
    const updated = frontmatter.replace(/^(name:.+)$/m, `$1\nversion: ${pluginVersion}`);
    fs.writeFileSync(skillMdPath, updated + afterFrontmatter);
    console.log(`Added version: ${pluginVersion} to ${skillMdPath}`);
    fixed++;
  }

  // ── 2. Ensure runtime check line exists immediately after closing --- ──────
  const currentContent = fs.readFileSync(skillMdPath, 'utf8');
  const hasCheckLine = currentContent.includes(VERSION_CHECK_LINE);

  if (!hasCheckLine) {
    if (checkOnly) {
      console.error(`FAIL: ${skillMdPath} — missing runtime version-check line`);
      missing++;
    } else {
      // Find closing --- and insert the line right after it
      const match = currentContent.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/);
      if (match) {
        const insertPos = match[0].length;
        const updated =
          currentContent.slice(0, insertPos) +
          '\n' + VERSION_CHECK_LINE + '\n' +
          currentContent.slice(insertPos);
        fs.writeFileSync(skillMdPath, updated, 'utf8');
        console.log(`Added runtime check line to ${skillMdPath}`);
        fixed++;
      }
    }
  }
}

if (missing > 0) {
  console.error(`\n${missing} skill(s) need attention. Run without --check to auto-fix.`);
  process.exit(1);
} else if (fixed > 0) {
  console.log(`\nFixed ${fixed} skill(s) — set version: ${pluginVersion}`);
} else {
  console.log(`\nAll skills have version: ${pluginVersion}`);
}
