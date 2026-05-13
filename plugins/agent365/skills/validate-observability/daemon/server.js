'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const decoder = require('./otlp-decoder');
const { CaptureStore } = require('./capture-store');

async function startServer({ port = 4318, captureDir = process.cwd(), rotationBytes, cert, key }) {
  if ((cert && !key) || (!cert && key)) {
    throw new Error('startServer: both cert and key are required for HTTPS, or neither for HTTP');
  }
  const store = CaptureStore({ captureDir, rotationBytes });

  const handler = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const ct   = req.headers['content-type'] || '';
      let decoded, wireFormat = 'unknown', decodeError = null;
      try {
        decoded = await decoder.decode(body, ct);
        wireFormat = decoded.wireFormat;
      } catch (e) {
        decodeError = e.message;
      }

      const remoteAddr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      const baseEntry  = { receivedAt: new Date().toISOString(), wireFormat, remoteAddr, urlPath: req.url };

      try {
        if (decodeError) {
          store.append({ ...baseEntry, decodeError, rawBodyB64: body.toString('base64').slice(0, 4096) });
        } else {
          for (const span of decoded.spans) {
            store.append({ ...baseEntry, resource: decoded.resource, scope: decoded.scope, span });
          }
        }
      } catch (e) {
        process.stderr.write(`[validate-observability daemon] persist failure: ${e.message}\n`);
      }

      res.writeHead(200, { 'content-type': 'application/x-protobuf' });
      res.end();   // empty ExportTraceServiceResponse body is wire-compatible
    });
    req.on('error', () => { try { res.writeHead(400); res.end(); } catch {} });
  };

  const server = cert
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, handler)
    : http.createServer(handler);

  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).on('error', reject));
  const actualPort = server.address().port;
  return {
    port: actualPort,
    scheme: cert ? 'https' : 'http',
    close: () => new Promise(r => server.close(() => { store.close(); r(); })),
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

if (require.main === module) {
  const argv = parseArgs(process.argv.slice(2));
  startServer({
    port: Number(argv.port) || 4318,
    captureDir: argv['capture-dir'] || path.join(process.cwd(), '.a365-observability-capture'),
    cert: argv.cert,
    key:  argv.key,
  }).then(s => {
    process.stdout.write(JSON.stringify({ ready: true, scheme: s.scheme, port: s.port, pid: process.pid }) + '\n');
    process.on('SIGTERM', () => s.close().then(() => process.exit(0)));
    process.on('SIGINT',  () => s.close().then(() => process.exit(0)));
  }).catch(e => { console.error(e.message); process.exit(2); });
}

module.exports = { startServer };
