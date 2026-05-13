#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';
const fs   = require('fs');
const path = require('path');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function main() {
  const cwd       = process.cwd();
  const stateFile = path.join(cwd, '.a365-observability-capture', 'state.json');
  if (!fs.existsSync(stateFile)) {
    console.log(JSON.stringify({ ok: true }));
    return;
  }
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (e) {
    console.log(JSON.stringify({ ok: false, reason: `state.json parse error: ${e.message}` }));
    return;
  }
  const alive = state.pid && pidAlive(state.pid);
  const hasMutations = Array.isArray(state.mutations) && state.mutations.length > 0;
  if (!alive && hasMutations) {
    console.log(JSON.stringify({
      ok: false,
      reason: `daemon dead (pid ${state.pid}) but ${state.mutations.length} dev-config mutation(s) still recorded — run validate-observability --stop to clean up`,
    }));
    return;
  }
  console.log(JSON.stringify({ ok: true }));
}

main();
