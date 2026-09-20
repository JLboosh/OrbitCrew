/**
 * Registers the offline shell only in exported production builds.
 *
 * `manifest.webmanifest` is written beside the exported app by
 * `prepare-web-deploy.mjs`. Resolving the worker relative to that manifest is
 * important: GitHub Pages hosts this app at `/<repository>/`, rather than at
 * the domain root.
 */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;

  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest?.href) return;

  const workerUrl = new URL('sw.js', manifest.href);
  void navigator.serviceWorker.register(workerUrl).catch(() => {
    // Offline support is progressive enhancement. A failed registration must
    // never prevent the signed-in application from loading.
  });
}
