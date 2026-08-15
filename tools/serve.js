#!/usr/bin/env node
// Concurrent static file server for local dev and the e2e/CI webServer.
//
// Replaces `python3 -m http.server`: that one speaks HTTP/1.0 with no
// keep-alive, so every request (index.html, every ES module, every PNG)
// pays its own TCP handshake. Under a loaded machine with Playwright's
// `fullyParallel` workers hammering it at once, that was enough to blow
// past the 15s boot timeout. Node's http server keeps HTTP/1.1 keep-alive
// on by default and handles connections concurrently.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const port = Number(process.argv[2] ?? 8000);
const root = resolve(process.argv[3] ?? '.');

function resolvePath(pathname) {
  const path = normalize(join(root, decodeURIComponent(pathname)));
  if (path !== root && !path.startsWith(root + sep)) return null;
  return path;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const requested = resolvePath(pathname);
  if (!requested) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const path = (await stat(requested)).isDirectory()
      ? join(requested, 'index.html')
      : requested;
    const body = await readFile(path);
    const type = MIME_TYPES[extname(path)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}/`);
});
