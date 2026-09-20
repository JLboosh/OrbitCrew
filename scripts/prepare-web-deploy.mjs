/**
 * Post-processes `expo export -p web` output for static hosting.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * The export is a single-page app: one `index.html` plus a JS bundle, with
 * expo-router doing the routing in the browser. A static host knows nothing about
 * that, so a request for `/session/new` — which is what a refresh, a shared link,
 * or a browser Back button produces — looks for a file that does not exist and
 * returns 404. The app only ever works if you enter through `/`.
 *
 * Every static host solves this the same way, but each with its own file:
 *
 *   * GitHub Pages has no config format at all. It does serve `404.html` for any
 *     unmatched path, so copying `index.html` over it turns the 404 handler into
 *     the SPA fallback. The status code is still 404, which is invisible to a
 *     member but does mean search engines will not index deep links — irrelevant
 *     for an app behind a sign-in.
 *   * Netlify and Cloudflare Pages both read `_redirects`.
 *   * Vercel reads `vercel.json`.
 *
 * All three are written, because they cost nothing and it means switching host is
 * not a code change.
 *
 * Usage: node scripts/prepare-web-deploy.mjs [dist-dir]
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';

function fail(message) {
  console.error(`prepare-web-deploy: ${message}`);
  process.exit(1);
}

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  fail(`no index.html in ${DIST}/. Run \`npm run build:web\` first.`);
}

// ---------------------------------------------------------------------------
// GitHub Pages
// ---------------------------------------------------------------------------
copyFileSync(indexPath, join(DIST, '404.html'));

// Pages runs everything through Jekyll by default, which SKIPS files and folders
// whose names start with an underscore. The entire JS and CSS bundle lives in
// `_expo/`, so without this the deploy succeeds and the site loads nothing at all.
writeFileSync(join(DIST, '.nojekyll'), '');

// ---------------------------------------------------------------------------
// Netlify and Cloudflare Pages
// ---------------------------------------------------------------------------
// 200 rather than 301: the URL must stay as the member typed it so the router can
// read it. A redirect to `/` would throw the route away.
writeFileSync(join(DIST, '_redirects'), '/*    /index.html   200\n');

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------
writeFileSync(
  join(DIST, 'vercel.json'),
  `${JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/index.html' }] }, null, 2)}\n`,
);

// ---------------------------------------------------------------------------
// Sanity checks: the two failures that produce a blank page with no error
// ---------------------------------------------------------------------------
const basePath = (process.env.EXPO_PUBLIC_BASE_PATH ?? '').trim().replace(/\/$/, '');
const html = readFileSync(indexPath, 'utf8');
const branding = JSON.parse(readFileSync(new URL('../branding.json', import.meta.url), 'utf8'));

const baseUrl =
  basePath === '' || basePath === '/' ? '' : basePath.startsWith('/') ? basePath : `/${basePath}`;
const manifestPath = join(DIST, 'manifest.webmanifest');
const manifest = {
  name: branding.displayName,
  short_name: branding.displayName,
  description: branding.tagline,
  start_url: `${baseUrl}/`,
  scope: `${baseUrl}/`,
  display: 'standalone',
  background_color: '#E6F4FE',
  theme_color: '#E6F4FE',
  icons: [
    { src: `${baseUrl}/pwa-icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${baseUrl}/pwa-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const pwaTags = [
  `<link rel="manifest" href="${baseUrl}/manifest.webmanifest">`,
  `<link rel="apple-touch-icon" href="${baseUrl}/pwa-icon-192.png">`,
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="theme-color" content="#E6F4FE">',
].join('');

if (!html.includes('rel="manifest"')) {
  writeFileSync(indexPath, html.replace('</head>', `${pwaTags}</head>`));
  copyFileSync(indexPath, join(DIST, '404.html'));
}

const workerPath = join(DIST, 'maplibre', 'maplibre-gl-worker.js');
if (!existsSync(workerPath)) {
  fail(
    'the MapLibre worker is missing from the export.\n' +
      '  `npm run maplibre:worker` publishes it into public/, and expo copies public/ into\n' +
      '  the output. Without it the map renders a blank canvas and logs nothing.',
  );
}

if (basePath !== '' && basePath !== '/') {
  const prefix = basePath.startsWith('/') ? basePath : `/${basePath}`;
  if (!html.includes(`${prefix}/_expo/`)) {
    fail(
      `EXPO_PUBLIC_BASE_PATH is "${basePath}" but index.html still references /_expo/ at the root.\n` +
        '  The variable has to be set for the BUILD, not just this script, so that\n' +
        '  app.config.ts can pass it to experiments.baseUrl.',
    );
  }
  console.log(`prepare-web-deploy: verified assets are prefixed with ${prefix}`);
} else if (!html.includes('"/_expo/')) {
  console.warn(
    'prepare-web-deploy: index.html does not reference /_expo/ at the root.\n' +
      '  If this build is for a sub-path host, set EXPO_PUBLIC_BASE_PATH and rebuild.',
  );
}

console.log(
  `prepare-web-deploy: ${DIST}/ ready — PWA manifest, offline worker, 404.html, .nojekyll, _redirects, vercel.json`,
);
