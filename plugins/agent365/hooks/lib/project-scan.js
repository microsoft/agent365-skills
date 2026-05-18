// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// project-scan.js — shared file-walk helper for stop-hook validators.
//
// Walks the project tree ONCE and returns a single list of file paths,
// honoring a default skip-list (node_modules, build outputs, virtualenvs,
// hidden directories like .git / .venv). Hidden FILES (.env, .env.example)
// are kept; hidden DIRECTORIES are skipped.
//
// Validators import this instead of each re-implementing findFiles().

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'bin', 'obj',
  '__pycache__', '.venv', 'venv',
]);

/**
 * Walk a directory tree once and return every file path encountered.
 *
 * @param {string} root  Directory to scan (typically process.cwd()).
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=5]   Maximum directory depth from root.
 * @param {Set<string>} [opts.skipDirs] Directory names to skip outright.
 * @returns {string[]} Absolute paths of every kept file.
 */
function scanProject(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 5;
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIRS;
  const all = [];

  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip hidden directories (.git, .vs, .venv) and known build / venv dirs.
        if (entry.name.startsWith('.') || skipDirs.has(entry.name)) continue;
        walk(path.join(current, entry.name), depth + 1);
      } else if (entry.isFile()) {
        all.push(path.join(current, entry.name));
      }
    }
  }

  walk(root, 0);
  return all;
}

/**
 * Filter a file list to entries whose basename either equals one of `names`
 * or ends with one of `names` (suffix match). Mirrors the legacy `findFiles`
 * extension-match semantics so existing call sites keep working.
 */
function filterByName(files, ...names) {
  return files.filter(f => {
    const base = path.basename(f);
    return names.some(n => base === n || base.endsWith(n));
  });
}

/** Read a file and return true iff every pattern is found in its contents. */
function fileContains(filePath, ...patterns) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return patterns.every(p => content.includes(p));
  } catch { return false; }
}

/** True iff any file in `files` contains every pattern in `patterns`. */
function anyFileContains(files, ...patterns) {
  return files.some(f => fileContains(f, ...patterns));
}

/** Parse a JSON file; return null on any error. */
function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

module.exports = {
  scanProject,
  filterByName,
  fileContains,
  anyFileContains,
  readJson,
  DEFAULT_SKIP_DIRS,
};
