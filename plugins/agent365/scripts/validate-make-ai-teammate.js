#!/usr/bin/env node
/**
 * validate-make-ai-teammate.js
 *
 * Stop hook validator for the make-ai-teammate skill.
 * Detects the project language (Node.js / .NET / Python) and validates
 * that the full AI Teammate hosting layer was added correctly.
 *
 * Scope: hosting layer, agent class, client factory, token cache, packages.
 * Observability (AddAgenticTracingExporter, ObservabilityManager, etc.) and
 * WorkIQ tooling (McpToolRegistrationService, ToolingManifest.json) are owned
 * by instrument-observability and add-workiq-tools — not validated here.
 *
 * Exit codes:
 *   0  → ok: true  (session may end)
 *   1  → ok: false (session blocked, reason shown to user)
 */

const fs   = require('fs');
const path = require('path');

function findFiles(dir, extensions, maxDepth = 5) {
  const results = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'bin', 'obj', '.git', '__pycache__', '.venv'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (extensions.some(e => entry.name.endsWith(e))) results.push(full);
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

const cwd    = process.cwd();
const issues = [];

// ── Detect language ─────────────────────────────────────────────────────────

const hasCsproj      = findFiles(cwd, ['.csproj']).length > 0;
const hasPyproject   = fs.existsSync(path.join(cwd, 'pyproject.toml'));
const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));

let language = 'nodejs';
if (hasCsproj)          language = 'dotnet';
else if (hasPyproject)  language = 'python';
else if (hasPackageJson) language = 'nodejs';

// ── Node.js validations ─────────────────────────────────────────────────────

if (language === 'nodejs') {
  const tsFiles   = findFiles(cwd, ['.ts']).filter(f => !f.includes('node_modules'));
  const jsonFiles = findFiles(cwd, ['package.json']).filter(f => !f.includes('node_modules'));

  // Hosting layer — src/index.ts
  const indexFile = path.join(cwd, 'src', 'index.ts');
  if (fs.existsSync(indexFile)) {
    if (!fileContains(indexFile, 'CloudAdapter'))
      issues.push('src/index.ts exists but does not use CloudAdapter — hosting layer incomplete');
    if (!fileContains(indexFile, '/api/messages'))
      issues.push('src/index.ts is missing the /api/messages endpoint');
    if (!fileContains(indexFile, '/api/health'))
      issues.push('src/index.ts is missing the /api/health endpoint');
    if (!fileContains(indexFile, 'authorizeJWT'))
      issues.push('src/index.ts is missing authorizeJWT middleware');
    if (!fileContains(indexFile, 'configDotenv') && !fileContains(indexFile, 'dotenv'))
      issues.push('src/index.ts does not load .env — configDotenv() must be the first line');
  } else {
    issues.push('src/index.ts not found — hosting layer was not added');
  }

  // Agent class — AgentApplication with notification + lifecycle handlers
  if (!anyFileContains(tsFiles, 'AgentApplication'))
    issues.push('No TypeScript file extends AgentApplication — agent class not added');
  if (!anyFileContains(tsFiles, 'onAgentNotification'))
    issues.push('onAgentNotification handler not found — notification routing not wired');
  if (!anyFileContains(tsFiles, 'InstallationUpdate'))
    issues.push('InstallationUpdate handler not found — lifecycle events not wired');
  if (!anyFileContains(tsFiles, "agents-a365-notifications"))
    issues.push("import '@microsoft/agents-a365-notifications' not found — notification deserialization will break at runtime");

  // Client factory — getClient() wrapping existing LLM
  const clientFile = path.join(cwd, 'src', 'client.ts');
  if (fs.existsSync(clientFile)) {
    if (!fileContains(clientFile, 'getClient'))
      issues.push('src/client.ts exists but is missing getClient() factory function');
  } else {
    issues.push('src/client.ts not found — client factory was not added');
  }

  // Token cache
  const tokenCacheFile = path.join(cwd, 'src', 'token-cache.ts');
  if (!fs.existsSync(tokenCacheFile)) {
    issues.push('src/token-cache.ts not found');
  } else if (!fileContains(tokenCacheFile, 'createAgenticTokenCacheKey')) {
    issues.push('src/token-cache.ts is missing createAgenticTokenCacheKey export');
  }

  // Required packages
  const pkgFile = jsonFiles.find(f => path.basename(f) === 'package.json' && !f.includes('/src/'));
  if (pkgFile) {
    for (const pkg of ['@microsoft/agents-hosting', '@microsoft/agents-a365-notifications']) {
      if (!fileContains(pkgFile, pkg))
        issues.push(`${pkg} not found in package.json — run: npm install ${pkg}`);
    }
  } else {
    issues.push('package.json not found');
  }

  // tsconfig module resolution
  const tsconfigFile = path.join(cwd, 'tsconfig.json');
  if (fs.existsSync(tsconfigFile)) {
    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigFile, 'utf8'));
      const opts = tsconfig.compilerOptions ?? {};
      if (opts.module !== 'node16' && opts.module !== 'Node16')
        issues.push('tsconfig.json: "module" is not "node16" — this will break @microsoft/agents-* imports');
      if (opts.moduleResolution !== 'node16' && opts.moduleResolution !== 'Node16')
        issues.push('tsconfig.json: "moduleResolution" is not "node16"');
    } catch {
      issues.push('tsconfig.json exists but cannot be parsed');
    }
  } else {
    issues.push('tsconfig.json not found');
  }
}

// ── .NET validations ────────────────────────────────────────────────────────

if (language === 'dotnet') {
  const csFiles = findFiles(cwd, ['.cs']);

  // Program.cs — hosting layer (no observability or WorkIQ — those are downstream skills)
  const programFile = path.join(cwd, 'Program.cs');
  if (fs.existsSync(programFile)) {
    if (!fileContains(programFile, 'AddAgent<'))
      issues.push('Program.cs is missing AddAgent<T>() — agent not registered with DI container');
    if (!fileContains(programFile, '/api/messages'))
      issues.push('Program.cs is missing /api/messages endpoint');
    if (!fileContains(programFile, '/api/health'))
      issues.push('Program.cs is missing /api/health endpoint');
  } else {
    issues.push('Program.cs not found — hosting layer was not added');
  }

  // Agent class — dual isAgenticOnly handlers, GetClientAgent()
  if (!anyFileContains(csFiles, 'AgentApplication'))
    issues.push('No .cs file extends AgentApplication — agent class not added');
  if (!anyFileContains(csFiles, 'ActivityTypes.InstallationUpdate'))
    issues.push('InstallationUpdate handler not found — lifecycle events not wired');
  if (!anyFileContains(csFiles, 'ActivityTypes.Message'))
    issues.push('Message handler not found in agent class');
  if (!anyFileContains(csFiles, 'isAgenticOnly'))
    issues.push('isAgenticOnly parameter not found — dual auth registration (agentic + OBO) not configured');
  if (!anyFileContains(csFiles, 'GetClientAgent'))
    issues.push('GetClientAgent() not found — LLM wiring into agent class is incomplete');

  // Required NuGet packages (hosting + notifications only; tooling/observability are downstream)
  const csprojFiles = findFiles(cwd, ['.csproj']);
  if (csprojFiles.length > 0) {
    for (const pkg of ['Microsoft.Agents.A365.Notifications', 'Microsoft.Agents.Hosting.AspNetCore']) {
      if (!anyFileContains(csprojFiles, pkg))
        issues.push(`${pkg} not found in .csproj — add with: dotnet add package ${pkg} --prerelease`);
    }
  } else {
    issues.push('.csproj file not found');
  }

  // appsettings.json — auth + token validation config
  const appsettingsFile = path.join(cwd, 'appsettings.json');
  if (fs.existsSync(appsettingsFile)) {
    if (!fileContains(appsettingsFile, 'AgentApplication'))
      issues.push('appsettings.json is missing AgentApplication section');
    if (!fileContains(appsettingsFile, 'TokenValidation'))
      issues.push('appsettings.json is missing TokenValidation section');
  } else {
    issues.push('appsettings.json not found — A365 auth configuration is required');
  }
}

// ── Python validations ──────────────────────────────────────────────────────

if (language === 'python') {
  // host_agent_server.py — hosting layer
  const hostFile = path.join(cwd, 'host_agent_server.py');
  if (fs.existsSync(hostFile)) {
    if (!fileContains(hostFile, 'CloudAdapterAiohttp'))
      issues.push('host_agent_server.py is missing CloudAdapterAiohttp — hosting layer incomplete');
    if (!fileContains(hostFile, '/api/messages'))
      issues.push('host_agent_server.py is missing /api/messages route');
    if (!fileContains(hostFile, '/api/health'))
      issues.push('host_agent_server.py is missing /api/health route');
    if (!fileContains(hostFile, 'on_agent_notification'))
      issues.push('on_agent_notification handler not found — notification routing not wired');
  } else {
    issues.push('host_agent_server.py not found — hosting layer was not added');
  }

  // agent.py — AgentInterface implementation
  const agentFile = path.join(cwd, 'agent.py');
  if (fs.existsSync(agentFile)) {
    if (!fileContains(agentFile, 'AgentInterface') && !fileContains(agentFile, 'process_user_message'))
      issues.push('agent.py does not implement AgentInterface / process_user_message — agent class incomplete');
    if (!fileContains(agentFile, '_sanitize_display_name'))
      issues.push('agent.py is missing _sanitize_display_name() — prompt injection guard not added');
    if (!fileContains(agentFile, 'token_resolver'))
      issues.push('agent.py is missing token_resolver() — A365 observability token callback not wired');
  } else {
    issues.push('agent.py not found — agent implementation was not added');
  }

  // token_cache.py
  const tokenCacheFile = path.join(cwd, 'token_cache.py');
  if (!fs.existsSync(tokenCacheFile)) {
    issues.push('token_cache.py not found');
  } else if (!fileContains(tokenCacheFile, 'cache_agentic_token')) {
    issues.push('token_cache.py is missing cache_agentic_token function');
  }

  // agent_interface.py
  if (!fs.existsSync(path.join(cwd, 'agent_interface.py')))
    issues.push('agent_interface.py not found — AgentInterface ABC is required');

  // Required packages (hosting + notifications only; tooling/observability are downstream)
  if (hasPyproject) {
    for (const pkg of [
      'microsoft_agents_a365_notifications',
      'microsoft_agents_a365_runtime',
      'microsoft-agents-hosting-aiohttp',
    ]) {
      if (!fileContains(path.join(cwd, 'pyproject.toml'), pkg))
        issues.push(`${pkg} not found in pyproject.toml — add it to [project] dependencies`);
    }
  }
}

// ── a365.config.json (all languages) — Phase 9 creates this ─────────────────

const a365Config = path.join(cwd, 'a365.config.json');
if (!fs.existsSync(a365Config)) {
  issues.push('a365.config.json not found — Phase 9 (Register with Agent 365) may not have completed');
} else {
  try {
    const cfg = JSON.parse(fs.readFileSync(a365Config, 'utf8'));
    if (!cfg.messagingEndpoint)
      issues.push('a365.config.json is missing messagingEndpoint field');
    if (!cfg.managerEmail)
      issues.push('a365.config.json is missing managerEmail field');
  } catch {
    issues.push('a365.config.json exists but cannot be parsed as JSON');
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
