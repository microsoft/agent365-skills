#!/usr/bin/env node
/**
 * path-guard.js — PreToolUse hook
 *
 * Blocks Write and Edit calls that target files outside the agent project
 * directory or inside the plugin directory itself.
 *
 * Claude Code passes the pending tool call as JSON on stdin:
 *   { "tool_name": "Write", "tool_input": { "file_path": "..." }, ... }
 *
 * Exit codes:
 *   0  → allow (session continues)
 *   2  → block (Claude is told the reason and must stop the tool call)
 */

const fs   = require('fs');
const path = require('path');

// Resolve symlinks and get the OS-canonical path (handles Windows case-insensitivity).
// For new files that don't exist yet, resolve the parent directory instead.
function safeRealpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return path.join(fs.realpathSync.native(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

const cwd        = safeRealpath(process.cwd());
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  ? safeRealpath(path.resolve(process.env.CLAUDE_PLUGIN_ROOT))
  : null;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const { tool_name, tool_input } = payload;

  // Only guard file-write tools
  if (!['Write', 'Edit'].includes(tool_name)) process.exit(0);

  const filePath = tool_input && (tool_input.file_path || tool_input.path);
  if (!filePath) process.exit(0);

  const resolved = safeRealpath(path.resolve(filePath));

  // Block writes into the plugin directory
  if (pluginRoot && resolved.startsWith(pluginRoot + path.sep)) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        `Path guard: refusing to write inside CLAUDE_PLUGIN_ROOT (${pluginRoot}). ` +
        `Skills must only modify files inside the user's agent project.`,
    }));
    process.exit(2);
  }

  // Block writes outside the working directory
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        `Path guard: refusing to write outside the agent project directory. ` +
        `cwd=${cwd}, target=${resolved}`,
    }));
    process.exit(2);
  }

  process.exit(0);
});
