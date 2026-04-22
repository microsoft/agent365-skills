#!/usr/bin/env node
/**
 * validate-make-ai-teammate.js
 *
 * Stop hook validator for the make-ai-teammate skill.
 * Checks that the full AI Teammate hosting layer was added to a Node.js agent.
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
      if (['node_modules', 'dist', 'bin', 'obj'].includes(entry.name)) continue;
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

const tsFiles   = findFiles(cwd, ['.ts']).filter(f => !f.includes('node_modules'));
const jsonFiles = findFiles(cwd, ['package.json']).filter(f => !f.includes('node_modules'));

// ── Check 1: Hosting layer — index.ts ───────────────────────────────────────

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

// ── Check 2: Agent class ────────────────────────────────────────────────────

const agentHasApp = anyFileContains(tsFiles, 'AgentApplication');
if (!agentHasApp) {
  issues.push('No TypeScript file extends AgentApplication — agent class not added');
}

const agentHasNotification = anyFileContains(tsFiles, 'onAgentNotification');
if (!agentHasNotification) {
  issues.push('onAgentNotification handler not found — notification routing not wired');
}

const agentHasInstall = anyFileContains(tsFiles, 'InstallationUpdate');
if (!agentHasInstall) {
  issues.push('InstallationUpdate handler not found — lifecycle events not wired');
}

const agentHasNotifImport = anyFileContains(tsFiles, "agents-a365-notifications");
if (!agentHasNotifImport) {
  issues.push("import '@microsoft/agents-a365-notifications' not found — notification deserialization will break");
}

// ── Check 3: Client factory + observability ─────────────────────────────────

const clientHasObservability = anyFileContains(tsFiles, 'ObservabilityManager');
if (!clientHasObservability) {
  issues.push('ObservabilityManager not found — observability not initialized');
}

const clientHasToolService = anyFileContains(tsFiles,
  'McpToolRegistrationService', 'addToolServersToAgent');
if (!clientHasToolService) {
  issues.push('McpToolRegistrationService / addToolServersToAgent not found — WorkIQ tools not wired');
}

const clientHasInferenceScope = anyFileContains(tsFiles, 'InferenceScope');
if (!clientHasInferenceScope) {
  issues.push('InferenceScope not found in client — LLM calls are not wrapped with telemetry');
}

// ── Check 4: Token cache ────────────────────────────────────────────────────

const tokenCacheFile = path.join(cwd, 'src', 'token-cache.ts');
if (!fs.existsSync(tokenCacheFile)) {
  issues.push('src/token-cache.ts not found');
} else {
  if (!fileContains(tokenCacheFile, 'createAgenticTokenCacheKey')) {
    issues.push('src/token-cache.ts is missing createAgenticTokenCacheKey export');
  }
}

// ── Check 5: ToolingManifest.json ───────────────────────────────────────────

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
    issues.push('ToolingManifest.json exists but cannot be parsed');
  }
}

// ── Check 6: Required packages in package.json ──────────────────────────────

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

// ── Check 7: tsconfig.json module resolution ────────────────────────────────

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

// ── Result ──────────────────────────────────────────────────────────────────

if (issues.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, reason: issues.join('; ') }));
  process.exit(1);
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
