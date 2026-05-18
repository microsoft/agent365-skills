#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/**
 * validate-add-workiq-tools.js
 *
 * Stop hook validator for the add-workiq-tools skill.
 * Checks that WorkIQ MCP servers were added via the a365 CLI and wired in agent code.
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

const cwd  = process.cwd();
const issues = [];

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
  issues.push('ToolingManifest.json not found — run: a365 develop add-mcp-servers "Work IQ Mail" (or other servers)');
}

// ── Detect project type ─────────────────────────────────────────────────────
// Single walk; bucket by extension/name afterwards.

const allFiles    = scanProject(cwd);
const csprojFiles = filterByName(allFiles, '.csproj');
const tsFiles     = filterByName(allFiles, '.ts', '.js');
const pkgJsonFiles = filterByName(allFiles, 'package.json');
const pyFiles     = filterByName(allFiles, '.py');
const reqFiles    = filterByName(allFiles, 'requirements.txt', 'pyproject.toml');

const isDotnet  = csprojFiles.length > 0;
const isNodejs  = !isDotnet && pkgJsonFiles.length > 0 && tsFiles.length > 0;
const isPython  = !isDotnet && !isNodejs && (pyFiles.length > 0 || reqFiles.length > 0);

// ── Check 2: Agent code is wired to load MCP servers ──────────────────────────

if (isDotnet) {
  const csFiles = filterByName(allFiles, '.cs');

  const hasMcpWiring = csFiles.some(f =>
    fileContains(f, 'GetMcpToolsAsync') ||
    fileContains(f, 'AddToolServersToAgentAsync') ||
    fileContains(f, 'IMcpToolRegistrationService')
  );
  if (!hasMcpWiring) {
    issues.push('.NET: No .cs file calls GetMcpToolsAsync, AddToolServersToAgentAsync, or registers IMcpToolRegistrationService');
  }

  const hasToolingPkg = csprojFiles.some(f => fileContains(f, 'Microsoft.Agents.A365.Tooling'));
  if (!hasToolingPkg) {
    issues.push('.NET: Microsoft.Agents.A365.Tooling package is not referenced in any .csproj — run: dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework');
  }
}

if (isNodejs) {
  const hasMcpClient = tsFiles.some(f =>
    fileContains(f, 'A365McpToolClient') ||
    fileContains(f, 'getToolsAsync') ||
    fileContains(f, 'addToolServersToAgent') ||
    fileContains(f, 'agents-a365-tooling') ||
    fileContains(f, 'McpToolRegistrationService')
  );
  if (!hasMcpClient) {
    issues.push('Node.js: No TypeScript/JS file uses McpToolRegistrationService, A365McpToolClient, or imports agents-a365-tooling');
  }

  const hasToolingPkg = pkgJsonFiles.some(f => fileContains(f, 'agents-a365-tooling'));
  if (!hasToolingPkg) {
    issues.push('Node.js: @microsoft/agents-a365-tooling is not in package.json — run: npm install @microsoft/agents-a365-tooling');
  }
}

if (isPython) {
  const hasMcpWiring = pyFiles.some(f =>
    fileContains(f, 'get_mcp_tools_async') ||
    fileContains(f, 'add_tool_servers_to_agent') ||
    fileContains(f, 'McpToolRegistrationService')
  );
  if (!hasMcpWiring) {
    issues.push('Python: No .py file calls get_mcp_tools_async, add_tool_servers_to_agent, or imports McpToolRegistrationService');
  }

  const hasToolingPkg = reqFiles.some(f =>
    fileContains(f, 'microsoft-agents-a365-tooling') ||
    fileContains(f, 'microsoft_agents_a365_tooling'));
  if (!hasToolingPkg) {
    issues.push('Python: microsoft-agents-a365-tooling is not in requirements.txt or pyproject.toml — run: pip install microsoft-agents-a365-tooling');
  }
}

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
      // Only flag if manifest check also failed
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
