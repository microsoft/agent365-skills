#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Standalone open-standard runner for the a365-code-validator skill.
// Keep this dependency-free so it works after scripts/install.js copies only
// SKILL.md + references/ into .agents/skills/.

'use strict';

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const skipDirs = new Set(['node_modules', 'dist', 'bin', 'obj', '__pycache__', '.venv', 'venv']);
const files = [];

function walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (full.includes(path.join('plugins', 'agent365', 'hooks')) ||
        full.includes(path.join('plugins', 'agent365', 'skills', 'a365-code-validator'))) {
      continue;
    }
    if (entry.isDirectory()) {
      const lowerName = entry.name.toLowerCase();
      if (entry.name.startsWith('.') || skipDirs.has(entry.name) || lowerName === 'tests' || lowerName === 'test' || lowerName === '__tests__') continue;
      walk(full, depth + 1);
    } else if (entry.isFile() && !entry.name.includes('a365-code-validator')) {
      files.push(full);
    }
  }
}

walk(cwd);

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function rel(file) {
  return path.relative(cwd, file).replace(/\\/g, '/');
}

function byName(...names) {
  return files.filter(f => names.some(n => path.basename(f) === n || path.basename(f).endsWith(n)));
}

function anyContains(list, pattern) {
  return list.some(f => read(f).includes(pattern));
}

function anyMatches(list, regex) {
  return list.some(f => regex.test(read(f)));
}

const findings = [];
function add(severity, id, message, file) {
  findings.push({ severity, id, message, file: file ? rel(file) : undefined });
}

const py = byName('.py');
const ts = byName('.ts', '.js');
const req = byName('requirements.txt', 'pyproject.toml');
const pkg = byName('package.json');
const env = byName('.env', '.env.example', '.env.production', '.env.local');
const cs = byName('.cs');
const csproj = byName('.csproj');
const appsettings = byName('appsettings.json', 'appsettings.Development.json');

function envTrue(name) {
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(true|1|yes)\\s*$`, 'im');
  return env.some(f => re.test(read(f)));
}

function envFalse(name) {
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(false|0|no)\\s*$`, 'im');
  return env.some(f => re.test(read(f)));
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function callBlocks(content, name) {
  const blocks = [];
  let index = 0;
  const needle = `${name}(`;
  while ((index = content.indexOf(needle, index)) !== -1) {
    const start = index;
    let depth = 0;
    let end = -1;
    for (let i = index + name.length; i < content.length; i++) {
      if (content[i] === '(') depth++;
      if (content[i] === ')') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) break;
    blocks.push(content.slice(start, end));
    index = end;
  }
  return blocks;
}

// Distro-call checks shared verbatim by both stop hooks and the standalone scanner. An option counts
// only where the SDK reads it: in the `a365` options object passed to useMicrosoftOpenTelemetry
// (Node.js), as a keyword argument of use_microsoft_opentelemetry (Python), or on `.Agent365` in the
// UseMicrosoftOpenTelemetry options callback (.NET). A variable is followed one level to its
// initializer in the same file. Comments are ignored, so a commented-out option, an unused import, or
// an unrelated object does not count. Unresolvable options are treated as unwired; there is no
// whole-file fallback.
const DISTRO_CALLS = {
  node: { call: 'useMicrosoftOpenTelemetry', comments: /\/\*[\s\S]*?\*\/|(^|[\s,{;(])\/\/[^\n]*/gm },
  python: { call: 'use_microsoft_opentelemetry', comments: /(^|\s)#[^\n]*/gm },
  dotnet: { call: 'UseMicrosoftOpenTelemetry', comments: /\/\*[\s\S]*?\*\/|(^|[\s,{;(])\/\/[^\n]*/gm },
};

const TOKEN_RESOLVER_OPTION = {
  node: /[{,]\s*tokenResolver\s*(?=[,}])|\btokenResolver\s*:/,
  python: /\ba365_(?:contextual_)?token_resolver\s*=(?!=)|['"]a365_(?:contextual_)?token_resolver['"]\s*:/,
  dotnet: /\.\s*Agent365\s*\.\s*(?:Exporter\s*\.\s*)?(?:Contextual)?TokenResolver\s*=(?!=)/,
};

const S2S_ROUTE_OPTION = {
  node: /\buseS2SEndpoint\s*:\s*true\b/,
  python: /\ba365_use_s2s_endpoint\s*=\s*True\b|['"]a365_use_s2s_endpoint['"]\s*:\s*True\b/,
  dotnet: /\.\s*Agent365\s*\.\s*(?:Exporter\s*\.\s*)?UseS2SEndpoint\s*=\s*true\b/,
};

function stripComments(content, language) {
  return content.replace(DISTRO_CALLS[language].comments, '$1');
}

// Returns the text from the bracket at `open` through its matching close bracket.
function bracketBlock(content, open) {
  const close = { '(': ')', '{': '}', '[': ']' }[content[open]];
  let depth = 0;
  for (let i = open; close && i < content.length; i++) {
    if (content[i] === content[open]) depth++;
    else if (content[i] === close && --depth === 0) return content.slice(open, i + 1);
  }
  return '';
}

// Returns the parenthesized arguments of every `name(...)` call in `content`.
function callArguments(content, name) {
  const calls = [];
  for (let index = content.indexOf(`${name}(`); index !== -1; index = content.indexOf(`${name}(`, index + 1)) {
    calls.push(bracketBlock(content, index + name.length));
  }
  return calls;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The `{...}` or `(...)` initializers assigned to `name` in `content`.
function initializerBlocks(content, name) {
  const initializer = new RegExp(`(?:^|[^\\w$])${escapeRegExp(name)}\\s*(?::[^=\\n]*)?=\\s*(?:dict\\s*)?([({])`, 'gm');
  const blocks = [];
  for (let m = initializer.exec(content); m; m = initializer.exec(content)) {
    blocks.push(bracketBlock(content, m.index + m[0].length - 1));
  }
  return blocks;
}

// Initializers of the variables `text` references, plus Python `name["key"] = value` entries.
function referencedInitializers(content, text, language) {
  const blocks = [];
  for (const name of new Set(text.match(/[A-Za-z_$][\w$]*/g) || [])) {
    blocks.push(...initializerBlocks(content, name));
    if (language === 'python') {
      const keyAssignment = new RegExp(`\\b${escapeRegExp(name)}\\s*\\[\\s*(['"][^'"\\n]+['"])\\s*\\]\\s*=(?!=)\\s*([^\\n]*)`, 'g');
      for (let m = keyAssignment.exec(content); m; m = keyAssignment.exec(content)) blocks.push(`${m[1]}: ${m[2]}`);
    }
  }
  return blocks;
}

// Python: the call's own keyword arguments. Nested calls and literals are dropped, except `**{...}`
// and `**dict(...)` spreads, whose entries are keyword arguments too.
function pythonKeywordArguments(args) {
  let keywords = '';
  for (let i = 1; i < args.length - 1; i++) {
    const group = '([{'.includes(args[i]) ? bracketBlock(args, i) : '';
    if (group) {
      if (/\*\*\s*(?:dict\s*)?$/.test(args.slice(1, i))) keywords += group;
      i += group.length - 1;
    } else {
      keywords += args[i];
    }
  }
  return keywords;
}

function stripOuterGroup(text) {
  const trimmed = text.trim();
  if (!'({['.includes(trimmed[0] || '')) return trimmed;
  const block = bracketBlock(trimmed, 0);
  return block && block.length === trimmed.length ? trimmed.slice(1, -1) : trimmed;
}

function splitTopLevel(text) {
  const fields = [];
  const inner = stripOuterGroup(text);
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      fields.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(inner.slice(start));
  return fields.map(field => field.trim()).filter(Boolean);
}

function directOptionMatches(field, language, option) {
  const direct = field.trim();
  if (language === 'node') {
    if (option === S2S_ROUTE_OPTION.node) {
      return /^(?:useS2SEndpoint|['"]useS2SEndpoint['"])\s*:\s*true\b/.test(direct);
    }
    if (option === TOKEN_RESOLVER_OPTION.node) {
      return /^(?:tokenResolver|['"]tokenResolver['"])\s*(?::|$)/.test(direct);
    }
    return false;
  }
  if (language === 'python') {
    const match = direct.match(/^(?:['"])?(a365_(?:contextual_)?token_resolver|a365_use_s2s_endpoint)(?:['"])?\s*(=|:)\s*([\s\S]*)$/);
    if (!match) return false;
    return option.test(`${match[1]}=${match[3]}`) || option.test(`"${match[1]}": ${match[3]}`);
  }
  return option.test(direct);
}

function directPropertyValue(field, propertyName) {
  const direct = field.trim();
  const quoted = `(?:${escapeRegExp(propertyName)}|['"]${escapeRegExp(propertyName)}['"])`;
  const match = direct.match(new RegExp(`^${quoted}\\s*(?::\\s*([\\s\\S]*))?$`));
  if (!match) return { present: false, value: '' };
  return { present: true, value: match[1] === undefined ? null : match[1].trim() };
}

function objectPropertyValues(content, text, propertyName, seen = new Set()) {
  const values = [];
  for (const field of splitTopLevel(text)) {
    const spread = field.match(/^(?:\.\.\.|\*\*)\s*([A-Za-z_$][\w$]*)$/);
    if (spread && !seen.has(spread[1])) {
      seen.add(spread[1]);
      for (const init of initializerBlocks(content, spread[1])) {
        values.push(...objectPropertyValues(content, init, propertyName, seen));
      }
      continue;
    }
    const inlineSpread = field.match(/^\*\*\s*(?:dict\s*)?([({])/);
    if (inlineSpread) {
      const block = bracketBlock(field, inlineSpread.index + inlineSpread[0].length - 1);
      if (block) values.push(...objectPropertyValues(content, block, propertyName, seen));
      continue;
    }
    const property = directPropertyValue(field, propertyName);
    if (property.present) values.push(property.value);
  }
  return values;
}

function booleanLiteral(value) {
  if (value === null) return 'dynamic';
  const trimmed = value.trim();
  if (/^true$/.test(trimmed)) return 'true';
  if (/^false$/.test(trimmed)) return 'false';
  return 'dynamic';
}

function objectPassesOption(content, text, language, option, seen = new Set()) {
  return splitTopLevel(text).some(field => {
    const spread = field.match(/^(?:\.\.\.|\*\*)\s*([A-Za-z_$][\w$]*)$/);
    if (spread && !seen.has(spread[1])) {
      seen.add(spread[1]);
      return initializerBlocks(content, spread[1]).some(init => objectPassesOption(content, init, language, option, seen));
    }
    const inlineSpread = field.match(/^\*\*\s*(?:dict\s*)?([({])/);
    if (inlineSpread) {
      const block = bracketBlock(field, inlineSpread.index + inlineSpread[0].length - 1);
      return block ? objectPassesOption(content, block, language, option, seen) : false;
    }
    return directOptionMatches(field, language, option);
  });
}

// Node.js: the `a365` options objects in `text`, inline (`a365: {...}`), by variable (`a365: options`),
// or shorthand (`{ a365 }`). `readable` means the options object was visible; unreadable values
// are conservatively active, while readable options with no `a365` key are inactive.
function a365Objects(content, text) {
  const objects = [];
  let unreadable = false;
  const property = /(?:^|[{,\s])a365\s*:\s*/g;
  for (let m = property.exec(text); m; m = property.exec(text)) {
    const at = m.index + m[0].length;
    if (text[at] === '{') {
      objects.push(bracketBlock(text, at));
      continue;
    }
    const value = text.slice(at).match(/^[A-Za-z_$][\w$.]*(\s*\()?/);
    if (!value || value[1]) {
      unreadable = true;
      continue;
    }
    const initializers = initializerBlocks(content, value[0]);
    if (initializers.length === 0) unreadable = true;
    objects.push(...initializers);
  }
  if (/[{,]\s*a365\s*(?=[,}])/.test(text)) {
    const initializers = initializerBlocks(content, 'a365');
    if (initializers.length === 0) unreadable = true;
    objects.push(...initializers);
  }
  return { objects, readable: !unreadable };
}

function nodeOptionsTexts(outside, args) {
  const values = splitTopLevel(args);
  if (values.length === 0) return { texts: [], unreadable: false };
  const first = values[0].trim();
  if (!first) return { texts: [], unreadable: false };
  if (first[0] === '{') return nodeObjectTexts(outside, first, new Set());
  const identifier = first.match(/^[A-Za-z_$][\w$]*$/);
  if (identifier) return nodeIdentifierTexts(outside, identifier[0], new Set());
  return { texts: [], unreadable: true };
}

// An options object plus the same-file objects its top-level spreads resolve to. Any other spread
// (a call, a member access, an import) makes the options unreadable.
function nodeObjectTexts(outside, text, seen) {
  const result = { texts: [text], unreadable: false };
  for (const field of splitTopLevel(text)) {
    if (!field.startsWith('...')) continue;
    const name = field.slice(3).trim().match(/^[A-Za-z_$][\w$]*$/);
    const spread = name ? nodeIdentifierTexts(outside, name[0], seen) : { texts: [], unreadable: true };
    result.texts.push(...spread.texts);
    result.unreadable = result.unreadable || spread.unreadable;
  }
  return result;
}

function nodeIdentifierTexts(outside, name, seen) {
  if (seen.has(name)) return { texts: [], unreadable: false };
  seen.add(name);
  const objects = initializerBlocks(outside, name).filter(block => block.startsWith('{'));
  if (objects.length === 0) return { texts: [], unreadable: true };
  const result = { texts: [], unreadable: false };
  for (const object of objects) {
    const nested = nodeObjectTexts(outside, object, seen);
    result.texts.push(...nested.texts);
    result.unreadable = result.unreadable || nested.unreadable;
  }
  return result;
}

// True when a distro call in `files` passes an option matching `option`.
function distroCallMatches(files, language, option) {
  const { call } = DISTRO_CALLS[language];
  return files.some(file => {
    const content = stripComments(read(file), language);
    for (let index = content.indexOf(`${call}(`); index !== -1; index = content.indexOf(`${call}(`, index + 1)) {
      const open = index + call.length;
      const args = bracketBlock(content, open);
      // Variables are initialized outside the call. Hiding the call keeps Python keyword arguments,
      // which look like assignments, from being read as initializers.
      const outside = content.slice(0, open) + ' '.repeat(args.length) + content.slice(open + args.length);
      if (callPassesOption(content, outside, args, language, option)) return true;
    }
    return false;
  });
}

function callPassesOption(content, outside, args, language, option) {
  if (language === 'dotnet') {
    if (!args.includes('=>') || !/\bAgent365\b/.test(args)) return false;
    return [args, ...referencedInitializers(outside, args, language)].some(text => option.test(text));
  }
  const texts = [language === 'python' ? pythonKeywordArguments(args) : args, ...referencedInitializers(outside, args, language)];
  if (language === 'python') return texts.some(text => objectPassesOption(outside, text, language, option));
  const objects = [];
  for (const text of nodeOptionsTexts(outside, args).texts) {
    objects.push(...a365Objects(outside, text).objects);
  }
  return objects.some(object => objectPassesOption(outside, object, language, option));
}

function nodeDistroCallStates(files) {
  const states = [];
  const { call } = DISTRO_CALLS.node;
  for (const file of files) {
    const content = stripComments(read(file), 'node');
    for (let index = content.indexOf(`${call}(`); index !== -1; index = content.indexOf(`${call}(`, index + 1)) {
      const open = index + call.length;
      const args = bracketBlock(content, open);
      const outside = content.slice(0, open) + ' '.repeat(args.length) + content.slice(open + args.length);
      const options = nodeOptionsTexts(outside, args);
      const texts = options.texts;
      const resolved = texts.map(text => a365Objects(outside, text));
      const objects = resolved.flatMap(result => result.objects);
      if (objects.length === 0) {
        states.push({ file, active: options.unreadable || resolved.some(result => !result.readable), exporter: 'dynamic', hasRoute: false, hasResolver: false });
        continue;
      }
      for (const object of objects) {
        const enabledValues = objectPropertyValues(outside, object, 'enabled');
        const enabled = enabledValues.length ? booleanLiteral(enabledValues.at(-1)) : 'false';
        const exporterValues = objectPropertyValues(outside, object, 'enableObservabilityExporter');
        const exporter = exporterValues.length ? booleanLiteral(exporterValues.at(-1)) : 'absent';
        states.push({
          file,
          active: enabled !== 'false',
          exporter,
          hasRoute: objectPassesOption(outside, object, 'node', S2S_ROUTE_OPTION.node),
          hasResolver: objectPassesOption(outside, object, 'node', TOKEN_RESOLVER_OPTION.node),
        });
      }
    }
  }
  return states;
}

function distroCallHasResolver(files, language) {
  return distroCallMatches(files, language, TOKEN_RESOLVER_OPTION[language]);
}

function distroCallUsesS2SRoute(files, language) {
  return distroCallMatches(files, language, S2S_ROUTE_OPTION[language]);
}

// Whole-file scans that ignore comments, so a documented legacy call is not reported.
function codeMatches(files, language, regex) {
  return files.some(file => regex.test(stripComments(read(file), language)));
}

function topLevelArgumentCount(args) {
  const text = args.trim().replace(/^\(/, '').replace(/\)$/, '');
  if (!text.trim()) return 0;
  let count = 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      count++;
    }
  }
  return count;
}

function codeCallMatches(files, language, name, matcher) {
  return files.some(file => callArguments(stripComments(read(file), language), name)
    .some(args => typeof matcher === 'function' ? matcher(args) : matcher.test(args)));
}


function validatePython() {
  const hasPackage = req.some(f => read(f).includes('microsoft-opentelemetry'));
  const hasDistro = anyContains(py, 'use_microsoft_opentelemetry');
  const hasEnableA365 = anyContains(py, 'enable_a365');
  const exporterTrue = anyMatches(py, /\ba365_enable_observability_exporter\s*=\s*True\b/);
  const exporterFalse = anyMatches(py, /\ba365_enable_observability_exporter\s*=\s*False\b/);
  const exporterEnv = envTrue('ENABLE_A365_OBSERVABILITY_EXPORTER') || envTrue('EnableAgent365Exporter');
  const s2sTrue = distroCallUsesS2SRoute(py, 'python');
  const s2sFalse = distroCallMatches(py, 'python', /\ba365_use_s2s_endpoint\s*=\s*False\b|['"]a365_use_s2s_endpoint['"]\s*:\s*False\b/);
  const s2sEnv = envTrue('A365_USE_S2S_ENDPOINT');
  const s2sIntent = anyContains(py, 'a365_contextual_token_resolver') ||
    anyContains(py, 'agent_source_identity') ||
    anyContains(py, 'AgentIdentityTokenResolver') ||
    s2sEnv;

  if (hasPackage && !hasDistro) {
    add('high', 'python-missing-distro-init', 'microsoft-opentelemetry is installed but no use_microsoft_opentelemetry() call was found.', req.find(f => read(f).includes('microsoft-opentelemetry')));
  }
  if (hasDistro && hasEnableA365 && exporterFalse) {
    add('critical', 'python-exporter-explicitly-disabled', 'Python passes a365_enable_observability_exporter=False; A365 backend export is disabled.', py.find(f => /a365_enable_observability_exporter\s*=\s*False\b/.test(read(f))));
  } else if (hasDistro && hasEnableA365 && !exporterTrue && !exporterEnv) {
    add('critical', 'python-exporter-not-enabled', 'Python enables A365 but does not explicitly enable the observability exporter and no truthy exporter env was found.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  } else if (hasDistro && hasEnableA365 && !exporterTrue && exporterEnv) {
    add('medium', 'python-exporter-env-dependent', 'Python does not pass a365_enable_observability_exporter=True in code and depends on runtime env ENABLE_A365_OBSERVABILITY_EXPORTER/EnableAgent365Exporter being true.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  }

  if (envFalse('ENABLE_A365_OBSERVABILITY_EXPORTER') || envFalse('EnableAgent365Exporter')) {
    add('high', 'exporter-env-disabled', 'An env file explicitly disables A365 export. This is fine for local console-only runs, but production/MAC Activity requires the exporter to be true.');
  }
  // Every auth mode exports over the S2S route; the legacy delegated route rejects app-only
  // tokens and needs admin consent. Contextual/agent-identity resolvers imply S2S intent too.
  const expectsS2S = hasDistro && (hasEnableA365 || s2sIntent);
  if (expectsS2S && s2sFalse) {
    add('critical', 'python-s2s-endpoint-disabled', 'Python passes a365_use_s2s_endpoint=False. A365 export must use the S2S route in every auth mode; the delegated route rejects app-only tokens and needs admin consent.', py.find(f => /a365_use_s2s_endpoint\s*=\s*False\b/.test(read(f))));
  } else if (expectsS2S && !s2sTrue && s2sEnv) {
    add('medium', 'python-s2s-endpoint-env-dependent', 'Python depends on A365_USE_S2S_ENDPOINT=true in env to select the S2S route. Prefer a365_use_s2s_endpoint=True in code.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  } else if (expectsS2S && !s2sTrue && !s2sEnv) {
    add('high', 'python-s2s-endpoint-not-set', 'Python does not set a365_use_s2s_endpoint=True (or A365_USE_S2S_ENDPOINT=true), so export uses the legacy delegated route. Every auth mode must export over the S2S route with an app-only token.', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  }
  if (expectsS2S && !exporterFalse && !distroCallHasResolver(py, 'python')) {
    add('high', 'python-obs-token-resolver-missing', 'use_microsoft_opentelemetry() has no a365_token_resolver (or a365_contextual_token_resolver), so the S2S route gets no app-only token and the exporter drops spans. Pass an app-only resolver (instrument-observability app_token_resolver.py for obo / agentic-user, or the S2S token-service cache).', py.find(f => read(f).includes('use_microsoft_opentelemetry')));
  }
  for (const file of py) {
    const content = stripComments(read(file), 'python');
    const delegated = callBlocks(content, 'exchange_token').some(block => /observability/i.test(block)) ||
      /(?<!\bdef\s+)\bcache_agentic_token\s*\(/.test(content) ||
      /\ba365_token_resolver\s*=\s*(?:lambda\b[^:\n]*:\s*)?[^,)\n]*\b(get_cached_agentic_token|AgenticTokenCache|get_observability_token)\b/.test(content);
    if (delegated) {
      add('high', 'python-obs-delegated-token', 'Telemetry uses a delegated (OBO) token (exchange_token for the observability scope, cache_agentic_token, or an AgenticTokenCache / get_cached_agentic_token resolver). The S2S route rejects delegated tokens; acquire an app-only token for the agent identity instead (instrument-observability app-only resolver).', file);
    }
  }
  const prefetchFile = py.find(f => callBlocks(stripComments(read(f), 'python'), 'prefetch').some(block => /self\.connection_manager/.test(block)));
  if (prefetchFile && !codeMatches(py, 'python', /\bself\.connection_manager\s*=/)) {
    add('high', 'python-obs-prefetch-connection-missing', 'The app-only token prefetch uses self.connection_manager, but no file assigns it. CloudAdapter does not expose its connection manager, so every prefetch fails and no spans export. Store the MsalConnectionManager passed to CloudAdapter on the host.', prefetchFile);
  }

  for (const file of py) {
    for (const block of callBlocks(read(file), 'a365_request_scope')) {
      if (block.includes('blueprint_id') && !/\bagent_id\s*=/.test(block)) {
        add('critical', 'python-blueprint-as-agent-id', 'a365_request_scope passes blueprint_id but no agent_id; gen_ai.agent.id can become the Blueprint ID.', file);
      }
    }
  }

  const hasSemantic = anyContains(py, 'InvokeAgentScope') ||
    anyContains(py, 'InferenceScope') ||
    anyContains(py, 'ExecuteToolScope') ||
    anyContains(py, 'gen_ai.operation.name') ||
    anyContains(py, 'invoke_agent') ||
    anyContains(py, 'execute_tool') ||
    anyContains(py, 'output_messages');
  if (hasDistro && !hasSemantic) {
    add('medium', 'python-no-explicit-a365-semantic-spans', 'No explicit supported A365 semantic spans found; MAC Activity needs invoke_agent/chat/execute_tool/output_messages.');
  }

  const pythonText = py.map(read).join('\n');
  const hasInvoke = /InvokeAgentScope|gen_ai\.operation\.name['"]?\s*[:=]|invoke_agent/.test(pythonText);
  const hasExecuteTool = /ExecuteToolScope|execute_tool/.test(pythonText);
  const hasAgentName = /gen_ai\.agent\.name|\bagent_name\s*=|AgentDetails\s*\([^)]*agent_name/s.test(pythonText);
  const hasConversation = /gen_ai\.conversation\.id|\bconversation_id\s*=|\.conversation_id\s*\(/.test(pythonText);
  const hasChannel = /microsoft\.channel\.name|\bchannel_name\s*=|\.channel_name\s*\(/.test(pythonText);
  const hasInputMessages = /gen_ai\.input\.messages|record_input_messages|Request\s*\(\s*content\s*=/.test(pythonText);
  const hasOutputMessages = /gen_ai\.output\.messages|record_output_messages|record_response/.test(pythonText);
  const hasAgentUser = /microsoft\.agent\.user\.id|\bagent_user_oid\s*=|\.agent_user_id\s*\(/.test(pythonText);

  if (hasDistro && hasInvoke && !hasAgentName) add('medium', 'python-missing-agent-name', 'No gen_ai.agent.name/AgentDetails agent_name signal found. Admin/reporting surfaces may show a GUID or blank agent name.');
  if (hasDistro && hasInvoke && !hasConversation) add('medium', 'python-missing-conversation-id', 'No gen_ai.conversation.id/conversation_id signal found. Reportable runs need a conversation or logical run ID.');
  if (hasDistro && hasInvoke && !hasChannel) add('medium', 'python-missing-channel-name', 'No microsoft.channel.name/channel_name signal found. Activity/reporting surfaces need a channel such as msteams, web, icm, or scheduler.');
  if (hasDistro && hasInvoke && !hasInputMessages) add('medium', 'python-missing-input-messages', 'No gen_ai.input.messages/record_input_messages signal found for invoke/chat spans.');
  if (hasDistro && hasInvoke && !hasOutputMessages) add('medium', 'python-missing-output-messages', 'No gen_ai.output.messages/record_output_messages/record_response signal found for invoke/chat/output spans.');
  if (hasDistro && hasExecuteTool) {
    const hasToolCallId = /gen_ai\.tool\.call\.id|tool_call_id/.test(pythonText);
    const hasToolArgs = /gen_ai\.tool\.call\.arguments|arguments\s*=/.test(pythonText);
    const hasToolResult = /gen_ai\.tool\.call\.result|record_response/.test(pythonText);
    if (!hasToolCallId || !hasToolArgs || !hasToolResult) add('medium', 'python-incomplete-tool-span-details', 'execute_tool spans found, but tool call id/arguments/result are not all visible. Tool activity can be incomplete.');
  }
  if (hasDistro && /a365_contextual_token_resolver/.test(pythonText) && /user\.id|\buser_oid\b/.test(pythonText) && !hasAgentUser) {
    add('medium', 'python-obo-agent-user-attribute-missing', 'Code uses contextual token resolution and user.id/user_oid, but no microsoft.agent.user.id/agent_user_oid signal is visible. OBO/Agent-User export may never trigger.');
  }
  if (hasDistro && /OPERATIONS\s*=\s*\[[^\]]*['"]inference['"]|gen_ai\.operation\.name[\s\S]{0,300}['"]inference['"]/.test(pythonText)) {
    add('medium', 'python-direct-inference-operation-name', 'Code appears to emit gen_ai.operation.name=inference directly. Public docs use chat for LLM spans; direct inference operations may not classify as expected.');
  }
}

function validateNode() {
  const hasPackage = pkg.some(f => read(f).includes('@microsoft/opentelemetry'));
  const hasDistro = anyContains(ts, 'useMicrosoftOpenTelemetry');
  const nodeStates = nodeDistroCallStates(ts);
  const hasEnabled = nodeStates.some(state => state.active);
  const exporterTrue = nodeStates.some(state => state.active && (state.exporter === 'true' || state.exporter === 'dynamic'));
  const exporterFalse = nodeStates.some(state => state.active && state.exporter === 'false');
  const exporterEnv = envTrue('ENABLE_A365_OBSERVABILITY_EXPORTER');

  if (hasPackage && !hasDistro) {
    add('high', 'node-missing-distro-init', '@microsoft/opentelemetry is installed but no useMicrosoftOpenTelemetry() call was found.', pkg.find(f => read(f).includes('@microsoft/opentelemetry')));
  }
  if (hasDistro && hasEnabled && exporterFalse) {
    add('critical', 'node-exporter-explicitly-disabled', 'Node code sets enableObservabilityExporter:false; A365 backend export is disabled.', (nodeStates.find(state => state.active && state.exporter === 'false') || {}).file);
  } else if (hasDistro && hasEnabled && !exporterTrue && !exporterEnv) {
    add('critical', 'node-exporter-not-enabled', 'Node code enables A365 but does not enable the exporter and no truthy exporter env was found.', ts.find(f => read(f).includes('useMicrosoftOpenTelemetry')));
  }
  const hasIdentity = anyContains(ts, 'BaggageBuilder') || anyContains(ts, 'InvokeAgentScope') || anyContains(ts, 'configureA365Hosting');
  if (hasDistro && hasEnabled && !hasIdentity) {
    add('high', 'node-missing-identity-scope', 'No BaggageBuilder/InvokeAgentScope/configureA365Hosting usage found; spans may lack agent identity.');
  }
  // Every auth mode exports over the S2S route with an app-only token.
  if (hasDistro && hasEnabled && !nodeStates.some(state => state.active && state.hasRoute)) {
    add('high', 'node-obs-delegated-route', 'Node code does not set useS2SEndpoint: true, so A365 export uses the legacy delegated route. Every auth mode must export over the S2S route with an app-only tokenResolver.', ts.find(f => read(f).includes('useMicrosoftOpenTelemetry')));
  }
  if (hasDistro && hasEnabled && !exporterFalse && !nodeStates.some(state => state.active && state.hasResolver)) {
    add('high', 'node-obs-token-resolver-missing', 'useMicrosoftOpenTelemetry() has no a365 tokenResolver, so the S2S route gets no app-only token. Pass an app-only tokenResolver (instrument-observability app-token-resolver.ts for obo / agentic-user, or the S2S token service).', ts.find(f => read(f).includes('useMicrosoftOpenTelemetry')));
  }
  for (const file of ts) {
    const content = stripComments(read(file), 'node');
    if (codeCallMatches([file], 'node', 'refreshObservabilityToken', () => true) ||
        codeCallMatches([file], 'node', 'RefreshObservabilityToken', args => topLevelArgumentCount(args) >= 4) ||
        /AgenticTokenCacheInstance\s*\.\s*getObservabilityToken\s*\(/.test(content)) {
      add('high', 'node-obs-delegated-token', 'Telemetry uses a delegated (OBO) token (refreshObservabilityToken(...) or a four-argument RefreshObservabilityToken(...) call, or AgenticTokenCacheInstance.getObservabilityToken). The S2S route rejects delegated tokens; use an app-only tokenResolver for the agent identity instead.', file);
    }
  }
  const hasSemantic = anyContains(ts, 'InvokeAgentScope') ||
    anyContains(ts, 'InferenceScope') ||
    anyContains(ts, 'ExecuteToolScope') ||
    anyContains(ts, 'gen_ai.operation.name') ||
    anyContains(ts, 'invoke_agent') ||
    anyContains(ts, 'execute_tool') ||
    anyContains(ts, 'output_messages');
  if (hasDistro && hasEnabled && !hasSemantic) {
    add('medium', 'node-no-explicit-a365-semantic-spans', 'No explicit supported A365 semantic spans found; baggage alone is not enough for MAC Activity.');
  }
}

function validateDotnet() {
  const hasPackage = csproj.some(f => read(f).includes('Microsoft.OpenTelemetry') || read(f).includes('Microsoft.Agents.A365.Observability'));
  const hasWiring = anyContains(cs, 'UseMicrosoftOpenTelemetry') || anyContains(cs, 'AddA365Tracing');
  if (hasPackage && !hasWiring) {
    add('high', 'dotnet-missing-observability-wiring', 'A365/.NET packages are referenced but no UseMicrosoftOpenTelemetry/AddA365Tracing wiring was found.', csproj.find(f => read(f).includes('Microsoft.OpenTelemetry') || read(f).includes('Microsoft.Agents.A365.Observability')));
  }
  const withExporter = appsettings.filter(f => read(f).includes('EnableAgent365Exporter'));
  const prodSettings = withExporter.filter(f => !path.basename(f).toLowerCase().includes('development'));
  const disabled = prodSettings.find(f => /"EnableAgent365Exporter"\s*:\s*false/i.test(read(f)));
  if (hasWiring && disabled) {
    add('high', 'dotnet-exporter-disabled', 'Production appsettings has EnableAgent365Exporter:false.', disabled);
  } else if (hasWiring && withExporter.length === 0) {
    add('medium', 'dotnet-exporter-config-missing', 'No EnableAgent365Exporter setting found. .NET exporter defaults can be console-only unless production config sets it true.');
  }
  if (hasWiring && !anyContains(cs, 'InvokeAgentScope')) {
    add('medium', 'dotnet-no-invoke-agent-scope', 'No InvokeAgentScope found; MAC Activity needs an invoke_agent parent span.');
  }
  // Every auth mode exports over the S2S route with an app-only token.
  if (anyContains(cs, 'UseMicrosoftOpenTelemetry') && !distroCallUsesS2SRoute(cs, 'dotnet')) {
    add('high', 'dotnet-obs-delegated-route', 'UseMicrosoftOpenTelemetry is wired without UseS2SEndpoint = true, so A365 export uses the legacy delegated route. Set o.Agent365.UseS2SEndpoint = true (o.Agent365.Exporter.UseS2SEndpoint on Microsoft.OpenTelemetry 1.0.2 and earlier) with an app-only TokenResolver in every auth mode.', cs.find(f => read(f).includes('UseMicrosoftOpenTelemetry')));
  }
  if (anyContains(cs, 'UseMicrosoftOpenTelemetry') && !distroCallHasResolver(cs, 'dotnet')) {
    add('high', 'dotnet-obs-token-resolver-missing', 'UseMicrosoftOpenTelemetry is wired without o.Agent365.TokenResolver, so the S2S route gets no app-only token (the distro default token cache holds delegated tokens). Set TokenResolver to an app-only resolver (instrument-observability AgentAppTokenResolver for obo / agentic-user, or the ServiceTokenCache from ObservabilityTokenService for s2s).', cs.find(f => read(f).includes('UseMicrosoftOpenTelemetry')));
  }
  for (const file of cs) {
    const content = stripComments(read(file), 'dotnet');
    if (callBlocks(content, 'RegisterObservability').some(block => block.includes('AgenticTokenStruct')) ||
        /\bnew\s+AgenticTokenStruct\s*[({]|IExporterTokenCache\s*<\s*AgenticTokenStruct\s*>\s*\??\s+[A-Za-z_]\w*/.test(content)) {
      add('high', 'dotnet-obs-delegated-token', 'Telemetry uses a delegated (OBO) token (RegisterObservability with AgenticTokenStruct, new AgenticTokenStruct(...), or an IExporterTokenCache<AgenticTokenStruct> dependency). The S2S route rejects delegated tokens; wire an app-only TokenResolver for the agent identity instead.', file);
    }
  }
}

function validateSetupArtifacts() {
  const generated = readJsonSafe(path.join(cwd, 'a365.generated.config.json'));
  if (!generated) return;
  if (generated.completed === false) {
    add('medium', 'a365-generated-config-incomplete', 'a365.generated.config.json has completed:false. Setup may be partial; verify consent/resource grants before expecting MAC Activity.', path.join(cwd, 'a365.generated.config.json'));
  }
  if (generated.agentBlueprintId && generated.agenticAppId && generated.agentBlueprintId === generated.agenticAppId) {
    add('critical', 'blueprint-id-used-as-agent-id', 'a365.generated.config.json has identical blueprint and agentic app IDs. Verify runtime gen_ai.agent.id uses the agent instance/source agent ID, not the blueprint ID.', path.join(cwd, 'a365.generated.config.json'));
  }
  const staticConfig = readJsonSafe(path.join(cwd, 'a365.config.json'));
  const detection = readJsonSafe(path.join(cwd, '.a365-workspace-detection.local.json')) || {};
  const agentType = String(detection.agentType || '').toLowerCase();
  const isSystemAgent = agentType === 'system-agent' || (!agentType && staticConfig && staticConfig.aiTeammate === false);
  if (isSystemAgent && generated.agentBlueprintId && generated.agenticAppId && !generated.agentRegistrationId) {
    add('medium', 'agent-registration-not-recorded', 'a365.generated.config.json has an agent identity but no agentRegistrationId. The S2S route authorizes registered agent instances without an OtelWrite grant; an unregistered instance gets 403 insufficient_scope. Run a365 setup all --agent-registration-only (idempotent).', path.join(cwd, 'a365.generated.config.json'));
  }
}

validatePython();
validateNode();
validateDotnet();
validateSetupArtifacts();

const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
process.stdout.write(JSON.stringify({ ok: true, findingCount: findings.length, findings }, null, 2));
