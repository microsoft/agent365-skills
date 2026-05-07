'use strict';
const fs   = require('fs');
const path = require('path');

function CaptureStore({ captureDir, rotationBytes = 50 * 1024 * 1024 }) {
  fs.mkdirSync(captureDir, { recursive: true });
  const tracesPath = path.join(captureDir, 'traces.jsonl');
  const cursorPath = path.join(captureDir, 'cursor.json');

  function append(entry) {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(tracesPath, line, 'utf8');
    maybeRotate();
  }

  function maybeRotate() {
    let stat;
    try { stat = fs.statSync(tracesPath); } catch { return; }
    if (stat.size < rotationBytes) return;
    let n = 1;
    while (fs.existsSync(`${tracesPath}.${n}`)) n++;
    fs.renameSync(tracesPath, `${tracesPath}.${n}`);
  }

  function readAll() {
    if (!fs.existsSync(tracesPath)) return [];
    const text  = fs.readFileSync(tracesPath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  function readSinceCursor() {
    const cursor = getCursor();
    const all    = readAll();
    // If rotation happened since the last cursor advance, the current file has
    // fewer lines than lastReadCount — treat the cursor as 0 in that case.
    const offset = (cursor.lastReadCount || 0) > all.length ? 0 : (cursor.lastReadCount || 0);
    return all.slice(offset);
  }

  function getCursor() {
    try { return JSON.parse(fs.readFileSync(cursorPath, 'utf8')); }
    catch { return { lastReadCount: 0, lastReadAt: null }; }
  }

  function setCursor(c) {
    fs.writeFileSync(cursorPath, JSON.stringify(c, null, 2));
  }

  function advanceCursor() {
    const all = readAll();
    setCursor({ lastReadCount: all.length, lastReadAt: new Date().toISOString() });
  }

  function close() { /* sync writes; nothing to flush */ }

  return { append, readAll, readSinceCursor, getCursor, setCursor, advanceCursor, close };
}

module.exports = { CaptureStore };
