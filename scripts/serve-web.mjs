/**
 * Serves the exported web build the way a static host does.
 *
 * WHY NOT JUST TRUST `npm run web`
 * --------------------------------
 * The dev server is not the artefact that gets deployed. It bundles on demand,
 * serves everything from the root, and answers any path with the app — so it
 * cannot reproduce the two failures that actually break a static deploy: a missing
 * SPA fallback, and asset paths that are wrong for a sub-path host. This serves
 * `dist/` with the same rules a host applies, including honouring
 * EXPO_PUBLIC_BASE_PATH, so a broken deploy is caught locally rather than in
 * production.
 *
 * Deliberately dependency-free — `node:http` only. A dev-server package would be
 * another entry in package-lock.json for something this file does in 80 lines.
 *
 * Usage:
 *   node scripts/serve-web.mjs [dist-dir] [port]
 *   EXPO_PUBLIC_BASE_PATH=/gymCrew-app node scripts/serve-web.mjs
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const PORT = Number(process.argv[3] ?? 4173);

const BASE = (() => {
  const trimmed = (process.env.EXPO_PUBLIC_BASE_PATH ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pbf': 'application/x-protobuf',
  '.map': 'application/json; charset=utf-8',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No index.html in ${DIST}. Run \`npm run build:web\` first.`);
  process.exit(1);
}

function send(res, status, file) {
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    // The bundle filename is content-hashed, so it is safe to cache hard. HTML is
    // not, and a cached index.html pointing at a deleted bundle is a white screen.
    'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  let pathname;
  try {
    ({ pathname } = new URL(req.url ?? '/', 'http://localhost'));
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  // A sub-path host only ever receives requests under the prefix, so anything
  // outside it is a 404 there too — which is exactly the mistake this catches.
  if (BASE && pathname !== BASE && !pathname.startsWith(`${BASE}/`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `Not found. This build is served under ${BASE}/ — try http://localhost:${PORT}${BASE}/`,
    );
    return;
  }

  const relative = BASE ? pathname.slice(BASE.length) || '/' : pathname;

  // Contain the resolved path inside DIST, so `..` cannot read the filesystem.
  const candidate = resolve(join(DIST, normalize(decodeURIComponent(relative))));
  if (candidate !== DIST && !candidate.startsWith(DIST + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    send(res, 200, candidate);
    return;
  }

  // SPA fallback. Served with 200 rather than GitHub Pages' 404 because the status
  // is what a member's browser sees, and 200 is the correct answer for a real route.
  send(res, 200, join(DIST, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Serving ${DIST} at http://localhost:${PORT}${BASE}/`);
  if (BASE) console.log(`Base path: ${BASE} (from EXPO_PUBLIC_BASE_PATH)`);
  console.log('Deep links and refreshes fall back to index.html, as on a static host.');
});
