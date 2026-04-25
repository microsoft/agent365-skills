#!/usr/bin/env node
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

function findFiles(dir, extensions, maxDepth = 5) {
  const results = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (extensions.some(e => entry.name === e || entry.name.endsWith(e))) results.push(full);
    }
  }
  walk(dir, 0);
  return results;
}

function fileContains(filePath, ...patterns) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return patterns.every(p => content.includes(p));
  } catch { return false; }
}

function anyFileContains(files, ...patterns) {
  return files.some(f => fileContains(f, ...patterns));
}

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

const csprojFiles = findFiles(cwd, ['.csproj']);
const tsFiles     = findFiles(cwd, ['.ts', '.js']).filter(f => !f.includes('node_modules'));
const jsonFiles   = findFiles(cwd, ['.json']).filter(f =>
  f.endsWith('package.json') && !f.includes('node_modules'));
const pyFiles     = findFiles(cwd, ['.py']).filter(f =>
  !f.includes('__pycache__') && !f.includes('.venv') && !f.includes('/venv/'));
const reqFiles    = findFiles(cwd, ['requirements.txt', 'pyproject.toml']);

const isDotnet  = csprojFiles.length > 0;
const isNodejs  = !isDotnet && jsonFiles.length > 0 && tsFiles.length > 0;
const isPython  = !isDotnet && !isNodejs && (
  pyFiles.length > 0 ||
  reqFiles.some(f => f.endsWith('requirements.txt') || f.endsWith('pyproject.toml'))
);

// ── Check 2: Agent code is wired to load MCP tools ──────────────────────────

if (isDotnet) {
  const csFiles = findFiles(cwd, ['.cs']).filter(f => !f.includes('obj') && !f.includes('bin'));

  const hasMcpWiring = anyFileContains(csFiles,
    'GetMcpToolsAsync', 'AddToolServersToAgentAsync', 'IMcpToolRegistrationService');
  if (!hasMcpWiring) {
    issues.push('.NET: No .cs file calls GetMcpToolsAsync, AddToolServersToAgentAsync, or registers IMcpToolRegistrationService');
  }

  const hasToolingPkg = csprojFiles.some(f => fileContains(f, 'Microsoft.Agents.A365.Tooling'));
  if (!hasToolingPkg) {
    issues.push('.NET: Microsoft.Agents.A365.Tooling package is not referenced in any .csproj — run: dotnet add package Microsoft.Agents.A365.Tooling.Extensions.AgentFramework --prerelease');
  }
}

if (isNodejs) {
  const hasMcpClient = anyFileContains(tsFiles, 'A365McpToolClient', 'getToolsAsync', 'addToolServersToAgent', 'agents-a365-tooling', 'McpToolRegistrationService');
  if (!hasMcpClient) {
    issues.push('Node.js: No TypeScript/JS file uses McpToolRegistrationService, A365McpToolClient, or imports agents-a365-tooling');
  }

  const hasToolingPkg = jsonFiles.some(f => fileContains(f, 'agents-a365-tooling'));
  if (!hasToolingPkg) {
    issues.push('Node.js: @microsoft/agents-a365-tooling is not in package.json — run: npm install @microsoft/agents-a365-tooling');
  }
}

if (isPython) {
  const hasMcpWiring = anyFileContains(pyFiles,
    'get_mcp_tools_async', 'add_tool_servers_to_agent', 'McpToolRegistrationService');
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

const a365Version = runCmd('a365 --version');
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

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, reason: issues.join('; ') }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
