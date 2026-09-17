/**
 * Ambient declarations for non-TypeScript modules Metro can resolve but tsc
 * cannot.
 *
 * `GymMapView.web.tsx` imports `maplibre-gl/dist/maplibre-gl.css` for its side
 * effect, which is how the library's own docs ship it and how Metro's web
 * bundler expects to receive it. TypeScript 6 reports a side-effect import with
 * no type declarations as TS2882 rather than ignoring it, so without this the
 * project does not typecheck on a clean install even though it bundles and runs.
 *
 * Deliberately narrow: only stylesheet extensions are declared, so a genuine
 * typo in a JS/TS import path is still an error.
 */

declare module '*.css';
declare module '*.scss';
