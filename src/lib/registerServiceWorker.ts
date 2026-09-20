/**
 * Native fallback for the web service-worker registration.
 *
 * Metro selects `registerServiceWorker.web.ts` for browsers. Keeping this
 * no-op module means the root layout can call one function on every platform
 * without putting browser globals in the native bundle.
 */
export function registerServiceWorker(): void {}
