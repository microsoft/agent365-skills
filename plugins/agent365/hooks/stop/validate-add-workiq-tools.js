#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-add-workiq-tools.js
 *
 * Stop hook validator for the add-workiq-tools skill.
 * Verifies that WorkIQ MCP servers were added via the a365 CLI and that the agent code
 * uses the framework-specific symbols expected by the (programmingLanguage, agentStack)
 * pair recorded in .a365-workspace-detection.local.json.
 *
 * Hard-stop framework pairs (Python LangChain / Claude / CrewAI; Node.js Semantic Kernel /
 * Google ADK) early-exit clean — the skill aborted at Phase 0B framework support guard
 * and no MCP wiring is expected.
 *
 * If the cache is missing or the stack is unrecognized, falls back to a loose
 * language-only check (no regression vs the earlier framework-blind validator).
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { scanProject, filterByName, fileContains } = require('../lib/project-scan');

function runCmd(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 8000 }); } catch { return ''; }
}

// Normalize agentStack labels: "Agent Framework" → "agentframework",
// "Google ADK" → "googleadk", "Azure AI Foundry" → "azureaifoundry", etc.
function normalizeStack(s) {
  return (s || '').toLowerCase().replace(/[\s_-]/g, '');
}

function normalizeLanguage(s) {
  return (s || '').toLowerCase();
}

const cwd  = process.cwd();
const issues = [];

// ── Read detection cache for agentStack + programmingLanguage ────────────────

let agentStack = '';
let cachedLanguage = '';
try {
  const cachePath = path.join(cwd, '.a365-workspace-detection.local.json');
  if (fs.existsSync(cachePath)) {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    agentStack     = normalizeStack(cache.agentStack);
    cachedLanguage = normalizeLanguage(cache.programmingLanguage);
  }
} catch {
  // Cache unreadable — fall through to loose detection
}

// ── Hard-stop pairs: skill exited at Phase 0B; no MCP wiring expected ───────

const HARD_STOP_PAIRS = new Set([
  'python:langchain',
  'python:claude',
  'python:crewai',
  'nodejs:semantickernel',
  'nodejs:googleadk',
]);

if (HARD_STOP_PAIRS.has(`${cachedLanguage}:${agentStack}`)) {
  process.stdout.write(JSON.stringify({
    ok: true,
    note: `Skill exited at Phase 0B framework support guard — (${cachedLanguage}, ${agentStack}) has no Microsoft adapter; no MCP wiring expected.`,
  }));
  process.exit(0);
}

// ── Check 1: ToolingManifest.json exists and contains a WorkIQ server ───────

const manifestPath = path.join(cwd, 'ToolingManifest.json');
let manifestHasWorkIQ = false;
if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries  = Array.isArray(manifest) ? manifest : (manifest.mcpServers ?? []);
    manifestHasWorkIQ = entries.some(entry => {
      const name = (entry.mcpServerName ?? entry.name ?? entry.uniqueName ?? '').toLowerCase();
      return name.includes('workiq') || name.includes('work_iq') || name.includes('mail') ||
             name.includes('calendar') || name.includes('teams') || name.includes('sharepoint') ||
             name.includes('onedrive') || name.includes('word') || name.includes('user') ||
             name.includes('copilot') || name.includes('dataverse');
    });
  } catch {
    issues.push('ToolingManifest.json exists but could not be parsed — file may be malformed');
  }
  if (!manifestHasWorkIQ) {
    issues.push('ToolingManifest.json does not contain any WorkIQ MCP server entries — run: a365 develop add-mcp-servers');
  }
} else {
  issues.push('ToolingManifest.json not found — run: a365 develop list-available to see the catalog, then a365 develop add-mcp-servers "<mcpServerName>" (e.g. "mcp_MailTools")');
}

// ── Detect project type (kept for fallback when cache missing) ──────────────

const allFiles     = scanProject(cwd);
const csprojFiles  = filterByName(allFiles, '.csproj');
const tsFiles      = filterByName(allFiles, '.ts', '.js');
const pkgJsonFiles = filterByName(allFiles, 'package.json');
const pyFiles      = filterByName(allFiles, '.py');
const reqFiles     = filterByName(allFiles, 'requirements.txt', 'pyproject.toml');

const isDotnet = csprojFiles.length > 0;
const isNodejs = !isDotnet && pkgJsonFiles.length > 0 && tsFiles.length > 0;
const isPython = !isDotnet && !isNodejs && (pyFiles.length > 0 || reqFiles.length > 0);

// ── Check 2: Agent code wiring — framework-scoped when cache present ────────

function checkDotnet() {
  const csFiles = filterByName(allFiles, '.cs');
  let expectedSymbols;
  let symbolDescription;
  let expectedPackage;

  if (agentStack === 'semantickernel') {
    expectedSymbols   = ['AddToolServersToAgentAsync'];
    symbolDescription = 'AddToolServersToAgentAsync (Semantic Kernel — Kernel-mutating call, void return)';
    expectedPackage   = 'Microsoft.Agents.A365.Tooling.Extensions.SemanticKernel';
  } else if (agentStack === 'azureaifoundry') {
    expectedSymbols   = ['IMcpToolRegistrationService', 'GetMcpToolsAsync', 'AddToolServersToAgent'];
    symbolDescription = 'IMcpToolRegistrationService reference (best-effort — no published Foundry sample)';
    expectedPackage   = 'Microsoft.Agents.A365.Tooling.Extensions.AzureAIFoundry';
  } else {
    // Default = Agent Framework (also covers "no cached stack" — preserves current behavior)
    expectedSymbols   = ['GetMcpToolsAsync', 'AddToolServersToAgent', 'IMcpToolRegistrationService'];
    symbolDescription = 'GetMcpToolsAsync or AddToolServersToAgent (Agent Framework)';
    expectedPackage   = 'Microsoft.Agents.A365.Tooling.Extensions.AgentFramework';
  }

  const hasMcpWiring = csFiles.some(f => expectedSymbols.some(sym => fileContains(f, sym)));
  if (!hasMcpWiring) {
    const stackLabel = agentStack ? `.NET ${agentStack}` : '.NET';
    issues.push(`${stackLabel}: No .cs file references ${symbolDescription}`);
  }

  const hasToolingPkg = csprojFiles.some(f => fileContains(f, expectedPackage));
  if (!hasToolingPkg) {
    issues.push(`.NET: ${expectedPackage} not referenced in any .csproj — run: dotnet add package ${expectedPackage}`);
  }
}

function checkNodejs() {
  let extensionImport;
  let stackLabel;

  if (agentStack === 'openai') {
    extensionImport = '@microsoft/agents-a365-tooling-extensions-openai';
    stackLabel = 'Node.js OpenAI';
  } else if (agentStack === 'claude') {
    extensionImport = '@microsoft/agents-a365-tooling-extensions-claude';
    stackLabel = 'Node.js Claude';
  } else if (agentStack === 'langchain') {
    extensionImport = '@microsoft/agents-a365-tooling-extensions-langchain';
    stackLabel = 'Node.js LangChain';
  } else {
    // No cached stack or unrecognized — loose check (current behavior, any extension)
    extensionImport = '@microsoft/agents-a365-tooling-extensions-';
    stackLabel = 'Node.js';
  }

  const hasMcpClient = tsFiles.some(f =>
    fileContains(f, 'addToolServersToAgent') ||
    fileContains(f, 'McpToolRegistrationService')
  );
  if (!hasMcpClient) {
    issues.push(`${stackLabel}: No TS/JS file calls addToolServersToAgent or imports McpToolRegistrationService`);
  }

  const hasExtensionPkg = pkgJsonFiles.some(f => fileContains(f, extensionImport));
  if (!hasExtensionPkg) {
    issues.push(`${stackLabel}: ${extensionImport} package not in package.json — run: npm install ${extensionImport}`);
  }

  // Core package is always required regardless of framework
  const hasCorePkg = pkgJsonFiles.some(f => fileContains(f, '@microsoft/agents-a365-tooling"'));
  if (!hasCorePkg) {
    issues.push('Node.js: @microsoft/agents-a365-tooling (core) not in package.json — run: npm install @microsoft/agents-a365-tooling');
  }
}

function checkPython() {
  // Symbol is the same (add_tool_servers_to_agent) across all Python extensions —
  // the difference is the extension package name. SK and Foundry are best-effort
  // (no published sample) so use looser symbol checks.
  let expectedPackage;
  let stackLabel;
  let looseSymbolOnly = false;

  if (agentStack === 'agentframework') {
    expectedPackage = 'microsoft-agents-a365-tooling-extensions-agentframework';
    stackLabel = 'Python Agent Framework';
  } else if (agentStack === 'openai') {
    expectedPackage = 'microsoft-agents-a365-tooling-extensions-openai';
    stackLabel = 'Python OpenAI';
  } else if (agentStack === 'googleadk') {
    expectedPackage = 'microsoft-agents-a365-tooling-extensions-googleadk';
    stackLabel = 'Python Google ADK';
  } else if (agentStack === 'semantickernel') {
    expectedPackage = 'microsoft-agents-a365-tooling-extensions-semantickernel';
    stackLabel = 'Python Semantic Kernel (best-effort)';
    looseSymbolOnly = true;
  } else if (agentStack === 'azureaifoundry') {
    expectedPackage = 'microsoft-agents-a365-tooling-extensions-azureaifoundry';
    stackLabel = 'Python Azure AI Foundry (best-effort)';
    looseSymbolOnly = true;
  } else {
    // No cached stack — preserve current loose behavior: just check core tooling
    expectedPackage = 'microsoft-agents-a365-tooling';
    stackLabel = 'Python';
    looseSymbolOnly = true;
  }

  if (!looseSymbolOnly) {
    const hasMcpWiring = pyFiles.some(f =>
      fileContains(f, 'add_tool_servers_to_agent') ||
      fileContains(f, 'McpToolRegistrationService')
    );
    if (!hasMcpWiring) {
      issues.push(`${stackLabel}: No .py file calls add_tool_servers_to_agent or imports McpToolRegistrationService`);
    }
  } else {
    // Best-effort: at least require some tooling reference
    const hasAnyToolingRef = pyFiles.some(f =>
      fileContains(f, 'microsoft_agents_a365') ||
      fileContains(f, 'McpToolRegistrationService') ||
      fileContains(f, 'add_tool_servers_to_agent')
    );
    if (!hasAnyToolingRef) {
      issues.push(`${stackLabel}: No .py file references microsoft_agents_a365.tooling or McpToolRegistrationService`);
    }
  }

  const expectedPackageUnderscore = expectedPackage.replace(/-/g, '_');
  const hasExtensionPkg = reqFiles.some(f =>
    fileContains(f, expectedPackage) ||
    fileContains(f, expectedPackageUnderscore)
  );
  if (!hasExtensionPkg) {
    issues.push(`${stackLabel}: ${expectedPackage} not in requirements.txt or pyproject.toml — append it (pip install does NOT update those files)`);
  }
}

if (isDotnet) checkDotnet();
if (isNodejs) checkNodejs();
if (isPython) checkPython();

// ── Check 3: a365 develop list-configured shows WorkIQ servers ──────────────
// (best-effort — skip if a365 CLI not installed or not authenticated)

const a365Version = process.env.VALIDATE_SKIP_EXEC ? '' : runCmd('a365 --version');
if (a365Version) {
  const configured = runCmd('a365 develop list-configured');
  if (configured && configured.trim()) {
    const hasWorkIQInCli = configured.toLowerCase().includes('workiq') ||
                           configured.toLowerCase().includes('work iq') ||
                           configured.toLowerCase().includes('mail') ||
                           configured.toLowerCase().includes('calendar') ||
                           configured.toLowerCase().includes('teams') ||
                           configured.toLowerCase().includes('sharepoint');
    if (!hasWorkIQInCli && !issues.some(i => i.includes('ToolingManifest'))) {
      console.warn('[validate-add-workiq-tools] Warning: a365 develop list-configured did not show WorkIQ servers');
    }
  }
}

// ── Build check ─────────────────────────────────────────────────────────────

function runBuild(cmd, timeoutMs) {
  try {
    const out = execSync(cmd, { cwd, timeout: timeoutMs, stdio: 'pipe' }).toString();
    return { ok: true, output: out };
  } catch (e) {
    const out = [(e.stdout || '').toString(), (e.stderr || '').toString()].join('\n').trim();
    return { ok: false, output: out.slice(0, 400) };
  }
}

if (!process.env.VALIDATE_SKIP_EXEC) {
  if (isDotnet) {
    const result = runBuild('dotnet build --no-restore -v minimal', 25000);
    if (!result.ok || !result.output.includes('Build succeeded')) {
      issues.push('dotnet build --no-restore failed — fix compilation errors before ending the session');
    }
  } else if (isNodejs) {
    const result = runBuild('npx tsc --noEmit', 15000);
    if (!result.ok) {
      issues.push('TypeScript compilation failed (tsc --noEmit) — fix errors before ending the session');
    }
  }
}
// Python has no compilation step.

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, reason: issues.join('; ') }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
