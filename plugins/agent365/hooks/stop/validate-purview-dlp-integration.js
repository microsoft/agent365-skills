#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-purview-dlp-integration.js
 *
 * Read-only static scanner for the purview-dlp-integration skill. It reports
 * whether the Purview DLP guard was copied in, wired into a message handler,
 * and enabled — but it deliberately returns ok:true (report-first) because the
 * findings are advisory: the skill supports a legitimate "skip policy" / "start
 * with PURVIEW_DLP_ENABLED=false" bring-up state, and it is additive to the
 * customer's agent. Blocking here would punish valid partial integrations.
 *
 * Output: { ok: true, findingCount, findings } — same shape as
 * validate-a365-code-validator.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  scanProject,
  filterByName,
} = require('../lib/project-scan');

const cwd = process.cwd();

function isTestPath(filePath) {
  const parts = filePath.split(path.sep).map(p => p.toLowerCase());
  return parts.includes('tests') || parts.includes('test') || parts.includes('__tests__');
}

// When the validator runs against this repo (npm run validate) rather than a
// customer agent project, exclude the skill's own template assets and the hooks
// tree so it never reports on itself.
const allFiles = scanProject(cwd, { maxDepth: 7 })
  .filter(f => !path.basename(f).includes('validate-purview-dlp-integration'))
  .filter(f => !f.includes(path.join('plugins', 'agent365', 'hooks')))
  .filter(f => !f.includes(path.join('plugins', 'agent365', 'skills', 'purview-dlp-integration')))
  .filter(f => !isTestPath(f));

const codeFiles = filterByName(allFiles, '.ts', '.js', '.py', '.cs');
const csprojFiles = filterByName(allFiles, '.csproj');
const envFiles = filterByName(allFiles, '.env', '.env.local', '.env.production', '.env.development');
const appSettingsFiles = filterByName(allFiles, 'appsettings.json', 'appsettings.Development.json', 'appsettings.Production.json');

const findings = [];

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function rel(filePath) {
  return path.relative(cwd, filePath).replace(/\\/g, '/');
}

function add(severity, id, message, filePath = '') {
  findings.push({
    severity,
    id,
    message,
    file: filePath ? rel(filePath) : undefined,
  });
}

function envHasTruthy(name) {
  const truthy = new RegExp(`^\\s*${name}\\s*=\\s*(true|1|yes)\\s*$`, 'im');
  return envFiles.some(f => truthy.test(read(f)));
}

function envHasFalsy(name) {
  const falsy = new RegExp(`^\\s*${name}\\s*=\\s*(false|0|no)\\s*$`, 'im');
  return envFiles.some(f => falsy.test(read(f)));
}

function envHasAny(name) {
  const any = new RegExp(`^\\s*${name}\\s*=`, 'im');
  return envFiles.some(f => any.test(read(f)));
}

// The guard is the ONLY module that calls the Graph `processContent` API, so a
// code file containing `processContent` + a Purview marker is the guard itself.
// A file that references the guard symbol but does NOT call processContent is a
// wiring / handler site.
const GUARD_SYMBOL = /\b(purviewGuard|purview_guard|PurviewGuard)\b/;

const guardFiles = codeFiles.filter(f => {
  const c = read(f);
  return c.includes('processContent') && (
    c.includes('PURVIEW_DLP_ENABLED') || c.includes('[purview]') || GUARD_SYMBOL.test(c)
  );
});

const wiredFiles = codeFiles.filter(f => {
  if (guardFiles.includes(f)) return false;
  const c = read(f);
  return GUARD_SYMBOL.test(c);
});

const envHasPurview = envHasAny('PURVIEW_DLP_ENABLED') || envFiles.some(f => /PURVIEW_/i.test(read(f)));

const purviewPresent = guardFiles.length > 0 || wiredFiles.length > 0 || envHasPurview;

// Detect the customer agent language (for tailored messages only).
const isDotnet = csprojFiles.length > 0;

if (purviewPresent) {
  // 1) Guard copied in?
  if (guardFiles.length === 0) {
    add(
      'high',
      'purview-guard-file-missing',
      'Purview wiring or env vars are present but no guard module (the file that calls the Graph processContent API) was found. Copy assets/purview.ts | purview.py | purview.cs into the agent source.'
    );
  }

  // 2) Guard wired into a handler?
  if (guardFiles.length > 0 && wiredFiles.length === 0) {
    add(
      'high',
      'purview-guard-not-wired',
      'The Purview guard module was added but no message handler references purviewGuard / purview_guard / PurviewGuard. Add the INPUT gate before the LLM call (and the OUTPUT gate before the reply) per the wiring snippet.',
      guardFiles[0]
    );
  }

  // 3) DLP flag configured?
  if (!envHasAny('PURVIEW_DLP_ENABLED')) {
    if (isDotnet) {
      add(
        'medium',
        'purview-env-flag-missing-dotnet',
        'PURVIEW_DLP_ENABLED was not found in any .env file. For .NET this may be set in launchSettings.json / appsettings / the host app settings instead — confirm the DLP gate is switched on where this agent reads configuration.'
      );
    } else {
      add(
        'medium',
        'purview-env-flag-missing',
        'PURVIEW_DLP_ENABLED was not appended to any .env file. Add it (start with false, flip to true once the DLP policy exists) so the guard can turn the gate on.'
      );
    }
  } else if (envHasFalsy('PURVIEW_DLP_ENABLED') && !envHasTruthy('PURVIEW_DLP_ENABLED')) {
    add(
      'low',
      'purview-dlp-disabled',
      'PURVIEW_DLP_ENABLED is set to false. This is the expected initial "bring-up" state — flip it to true once a matching Purview DLP policy exists and has propagated.'
    );
  }

  // 4) Guidance-only heads-up for .NET best-effort port.
  if (isDotnet && guardFiles.length > 0) {
    add(
      'low',
      'purview-dotnet-best-effort',
      'The .NET guard is a best-effort port — verify the ITurnContext / UserAuthorization namespaces (and PurviewGuard.EvaluatePromptAsync signature) against your SDK version before production.'
    );
  }
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

process.stdout.write(JSON.stringify({
  ok: true,
  findingCount: findings.length,
  findings,
}, null, 2));
