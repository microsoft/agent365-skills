#!/usr/bin/env node
/**
 * validate-make-ai-teammate.js
 *
 * Stop hook validator for the make-ai-teammate skill.
 * Detects the project language (Node.js / .NET / Python) and validates
 * that the full AI Teammate hosting layer was added.
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

const hasCsproj     = findFiles(cwd, ['.csproj']).length > 0;
const hasPyproject  = fs.existsSync(path.join(cwd, 'pyproject.toml'));
const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));

let language = 'nodejs'; // default
if (hasCsproj) {
  language = 'dotnet';
} else if (hasPyproject) {
  language = 'python';
} else if (hasPackageJson) {
  language = 'nodejs';
}

// ── Validate: ToolingManifest.json (all languages) ──────────────────────────

const manifestFile = path.join(cwd, 'ToolingManifest.json');
if (!fs.existsSync(manifestFile)) {
  issues.push('ToolingManifest.json not found — run add-workiq-tools skill to configure MCP servers');
} else {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!Array.isArray(manifest.mcpServers)) {
      issues.push('ToolingManifest.json is missing mcpServers array');
    }
  } catch {
    issues.push('ToolingManifest.json exists but cannot be parsed as JSON');
  }
}

// ── Node.js validations ─────────────────────────────────────────────────────

if (language === 'nodejs') {
  const tsFiles   = findFiles(cwd, ['.ts']).filter(f => !f.includes('node_modules'));
  const jsonFiles = findFiles(cwd, ['package.json']).filter(f => !f.includes('node_modules'));

  // Check 1: Hosting layer — index.ts
  const indexFile = path.join(cwd, 'src', 'index.ts');
  if (fs.existsSync(indexFile)) {
    if (!fileContains(indexFile, 'CloudAdapter')) {
      issues.push('src/index.ts exists but does not use CloudAdapter — hosting layer incomplete');
    }
    if (!fileContains(indexFile, '/api/messages')) {
      issues.push('src/index.ts is missing the /api/messages endpoint');
    }
    if (!fileContains(indexFile, '/api/health')) {
      issues.push('src/index.ts is missing the /api/health endpoint');
    }
    if (!fileContains(indexFile, 'authorizeJWT')) {
      issues.push('src/index.ts is missing authorizeJWT middleware');
    }
    if (!fileContains(indexFile, 'configDotenv') && !fileContains(indexFile, 'dotenv')) {
      issues.push('src/index.ts does not load .env — configDotenv() must be first line');
    }
  } else {
    issues.push('src/index.ts not found — hosting layer was not added');
  }

  // Check 2: Agent class
  if (!anyFileContains(tsFiles, 'AgentApplication')) {
    issues.push('No TypeScript file extends AgentApplication — agent class not added');
  }
  if (!anyFileContains(tsFiles, 'onAgentNotification')) {
    issues.push('onAgentNotification handler not found — notification routing not wired');
  }
  if (!anyFileContains(tsFiles, 'InstallationUpdate')) {
    issues.push('InstallationUpdate handler not found — lifecycle events not wired');
  }
  if (!anyFileContains(tsFiles, "agents-a365-notifications")) {
    issues.push("import '@microsoft/agents-a365-notifications' not found — notification deserialization will break");
  }

  // Check 3: Client factory + observability
  if (!anyFileContains(tsFiles, 'ObservabilityManager')) {
    issues.push('ObservabilityManager not found — observability not initialized');
  }
  if (!anyFileContains(tsFiles, 'McpToolRegistrationService', 'addToolServersToAgent')) {
    issues.push('McpToolRegistrationService / addToolServersToAgent not found — WorkIQ tools not wired');
  }
  if (!anyFileContains(tsFiles, 'InferenceScope')) {
    issues.push('InferenceScope not found in client — LLM calls are not wrapped with telemetry');
  }

  // Check 4: Token cache
  const tokenCacheFile = path.join(cwd, 'src', 'token-cache.ts');
  if (!fs.existsSync(tokenCacheFile)) {
    issues.push('src/token-cache.ts not found');
  } else {
    if (!fileContains(tokenCacheFile, 'createAgenticTokenCacheKey')) {
      issues.push('src/token-cache.ts is missing createAgenticTokenCacheKey export');
    }
  }

  // Check 5: Required packages in package.json
  const pkgFile = jsonFiles.find(f => path.basename(f) === 'package.json' && !f.includes('/src/'));
  if (pkgFile) {
    const required = [
      '@microsoft/agents-hosting',
      '@microsoft/agents-a365-observability',
      '@microsoft/agents-a365-notifications',
    ];
    for (const pkg of required) {
      if (!fileContains(pkgFile, pkg)) {
        issues.push(`${pkg} not found in package.json dependencies`);
      }
    }
  } else {
    issues.push('package.json not found');
  }

  // Check 6: tsconfig.json module resolution
  const tsconfigFile = path.join(cwd, 'tsconfig.json');
  if (fs.existsSync(tsconfigFile)) {
    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigFile, 'utf8'));
      const opts = tsconfig.compilerOptions ?? {};
      if (opts.module !== 'node16' && opts.module !== 'Node16') {
        issues.push('tsconfig.json: "module" is not "node16" — this will break @microsoft/agents-* imports');
      }
      if (opts.moduleResolution !== 'node16' && opts.moduleResolution !== 'Node16') {
        issues.push('tsconfig.json: "moduleResolution" is not "node16"');
      }
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

  // Check 1: Program.cs — hosting layer
  const programFile = path.join(cwd, 'Program.cs');
  if (fs.existsSync(programFile)) {
    if (!fileContains(programFile, 'AddAgenticTracingExporter')) {
      issues.push('Program.cs is missing AddAgenticTracingExporter — A365 observability exporter not configured');
    }
    if (!fileContains(programFile, 'AddA365Tracing')) {
      issues.push('Program.cs is missing AddA365Tracing — A365 tracing provider not configured');
    }
    if (!fileContains(programFile, 'AddAgent<')) {
      issues.push('Program.cs is missing AddAgent<T>() — agent not registered with DI container');
    }
    if (!fileContains(programFile, '/api/messages')) {
      issues.push('Program.cs is missing /api/messages endpoint');
    }
    if (!fileContains(programFile, '/api/health')) {
      issues.push('Program.cs is missing /api/health endpoint');
    }
    if (!fileContains(programFile, 'IMcpToolRegistrationService') &&
        !fileContains(programFile, 'McpToolRegistrationService')) {
      issues.push('Program.cs is missing IMcpToolRegistrationService registration — WorkIQ tools not wired');
    }
  } else {
    issues.push('Program.cs not found — hosting layer was not added');
  }

  // Check 2: Agent class
  if (!anyFileContains(csFiles, 'AgentApplication')) {
    issues.push('No .cs file extends AgentApplication — agent class not added');
  }
  if (!anyFileContains(csFiles, 'ActivityTypes.InstallationUpdate')) {
    issues.push('InstallationUpdate handler not found in agent class — lifecycle events not wired');
  }
  if (!anyFileContains(csFiles, 'ActivityTypes.Message')) {
    issues.push('Message handler not found in agent class');
  }
  if (!anyFileContains(csFiles, 'isAgenticOnly')) {
    issues.push('isAgenticOnly parameter not found — dual auth registration (agentic + OBO) not configured');
  }

  // Check 3: Required NuGet packages in .csproj
  const csprojFiles = findFiles(cwd, ['.csproj']);
  if (csprojFiles.length > 0) {
    const required = [
      'Microsoft.Agents.A365.Notifications',
      'Microsoft.Agents.A365.Tooling.Extensions.AgentFramework',
      'Microsoft.Agents.A365.Observability.Extensions.AgentFramework',
    ];
    for (const pkg of required) {
      if (!anyFileContains(csprojFiles, pkg)) {
        issues.push(`${pkg} not found in .csproj — add with: dotnet add package ${pkg} --prerelease`);
      }
    }
  } else {
    issues.push('.csproj file not found');
  }

  // Check 4: appsettings.json
  const appsettingsFile = path.join(cwd, 'appsettings.json');
  if (fs.existsSync(appsettingsFile)) {
    if (!fileContains(appsettingsFile, 'AgentApplication')) {
      issues.push('appsettings.json is missing AgentApplication section');
    }
    if (!fileContains(appsettingsFile, 'TokenValidation')) {
      issues.push('appsettings.json is missing TokenValidation section');
    }
  } else {
    issues.push('appsettings.json not found — A365 auth configuration is required');
  }
}

// ── Python validations ──────────────────────────────────────────────────────

if (language === 'python') {
  const pyFiles = findFiles(cwd, ['.py']);

  // Check 1: host_agent_server.py — hosting layer
  const hostFile = path.join(cwd, 'host_agent_server.py');
  if (fs.existsSync(hostFile)) {
    if (!fileContains(hostFile, 'CloudAdapterAiohttp')) {
      issues.push('host_agent_server.py is missing CloudAdapterAiohttp — hosting layer incomplete');
    }
    if (!fileContains(hostFile, '/api/messages')) {
      issues.push('host_agent_server.py is missing /api/messages route');
    }
    if (!fileContains(hostFile, '/api/health')) {
      issues.push('host_agent_server.py is missing /api/health route');
    }
    if (!fileContains(hostFile, 'on_agent_notification') && !anyFileContains(pyFiles, 'on_agent_notification')) {
      issues.push('on_agent_notification handler not found — notification routing not wired');
    }
  } else {
    issues.push('host_agent_server.py not found — hosting layer was not added');
  }

  // Check 2: agent.py — agent interface implementation
  const agentFile = path.join(cwd, 'agent.py');
  if (fs.existsSync(agentFile)) {
    if (!fileContains(agentFile, 'AgentInterface') && !fileContains(agentFile, 'process_user_message')) {
      issues.push('agent.py does not implement AgentInterface / process_user_message — agent class incomplete');
    }
    if (!fileContains(agentFile, 'McpToolRegistrationService') &&
        !anyFileContains(pyFiles, 'McpToolRegistrationService')) {
      issues.push('McpToolRegistrationService not found — WorkIQ tools not wired');
    }
  } else {
    issues.push('agent.py not found — agent implementation was not added');
  }

  // Check 3: token_cache.py
  const tokenCacheFile = path.join(cwd, 'token_cache.py');
  if (!fs.existsSync(tokenCacheFile)) {
    issues.push('token_cache.py not found');
  } else {
    if (!fileContains(tokenCacheFile, 'cache_agentic_token')) {
      issues.push('token_cache.py is missing cache_agentic_token function');
    }
  }

  // Check 4: agent_interface.py
  const interfaceFile = path.join(cwd, 'agent_interface.py');
  if (!fs.existsSync(interfaceFile)) {
    issues.push('agent_interface.py not found — AgentInterface ABC is required');
  }

  // Check 5: Required packages in pyproject.toml
  if (hasPyproject) {
    const required = [
      'microsoft_agents_a365_tooling',
      'microsoft_agents_a365_notifications',
      'microsoft_agents_a365_observability',
      'microsoft-agents-hosting-aiohttp',
    ];
    for (const pkg of required) {
      if (!fileContains(path.join(cwd, 'pyproject.toml'), pkg)) {
        issues.push(`${pkg} not found in pyproject.toml dependencies`);
      }
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
