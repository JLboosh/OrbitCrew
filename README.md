# gymcrew

A private, social gym app. Find nearby gyms, log training, and stay accountable
to an invite-only crew.

> **`gymcrew` is a working codename.** The product name lives in exactly one
> place: `DISPLAY_NAME` in [`src/constants/branding.ts`](src/constants/branding.ts).
> Change that line to rebrand. Store identifiers (`com.gymcrew.app`) are
> deliberately _not_ derived from the display name, so a rename never forces an
> App Store / Play Store migration. Those identifiers become permanent on first
> store submission.

## Product principles

These are product requirements, not preferences. They constrain the schema and
the security model:

1. **Encouraging, never invasive.** No feature may shame or expose a member.
2. **Opt-in by default.** Location sharing and progress comparison are off until
   a user explicitly enables them. Defaults are asserted by tests.
3. **Gym names, not coordinates.** The app shares "at Waterloo Athletics", never
   a live GPS position. Home addresses, routes, and passive location history are
   never collected.
4. **Presence expires.** Check-in visibility ends at checkout or after a hard
   3-hour maximum, whichever comes first.
5. **Privacy is enforced in the database.** Row-level security is the boundary,
   not the UI. A bug in a screen must not be able to leak another member's data.
6. **Fair metrics.** Leaderboards rank sessions, consistency, and challenge
   contribution — never total weight or workout duration, which unfairly favour
   certain schedules, body types, and training styles.

## Stack

Every component is free to run. No paid API keys are required.

| Concern       | Choice                                       | Why                                            |
| ------------- | -------------------------------------------- | ---------------------------------------------- |
| App           | Expo + React Native + TypeScript             | One codebase for iOS and Android               |
| Navigation    | expo-router                                  | File-based routing, typed routes               |
| Backend       | Supabase (Postgres, Auth, Realtime, Storage) | Free tier; RLS enforces private crews          |
| Geo queries   | PostGIS                                      | Indexed nearby-gym search                      |
| Map rendering | MapLibre + OpenFreeMap tiles                 | Free, no API key, no request limits            |
| Gym directory | OpenStreetMap via Overpass                   | Free; ingested server-side into our own table  |
| Server logic  | Supabase Edge Functions (Deno)               | Challenge scoring, presence expiry, OSM ingest |
| Data fetching | TanStack Query                               | Caching, retries, loading/error states         |
| Validation    | Zod                                          | Runtime validation at trust boundaries         |

### Why gym data is ingested rather than queried live

The Overpass API's usage policy allows roughly 10,000 requests and 1 GB per day
**for an entire application**, not per user. Querying it on every map pan would
exhaust that budget and get the app blocked. Instead a scheduled Edge Function
ingests gyms into our own PostGIS-indexed `gyms` table, and the app queries that.
This is faster, works when Overpass is down, and keeps us well within the free
usage policy.

## Prerequisites

- **Node 24** (see `.nvmrc`)
- **Supabase CLI** — installed as a dev dependency; `npm run db:*` scripts wrap it
- **Xcode** (iOS simulator) and/or **Android Studio** (Android emulator)
- **Docker Desktop** — optional, only needed for the local database loop

> **Expo Go works for the whole app**, including the map. `maplibre-gl` is a
> browser library and is imported at runtime only by `GymMapView.web.tsx`;
> everywhere else it appears as a type-only import, which is erased at compile
> time. Metro resolves the native map to `GymMapView.tsx`, a schematic plot with no
> native dependencies, and every remaining dependency ships inside Expo Go.
>
> A development build becomes necessary only if `@maplibre/maplibre-react-native`
> is adopted for a real native map — see the seam documented in
> `src/components/gyms/GymMapView.tsx`.

## Setup

This project is currently **linked to the hosted Supabase project `gymApp`**
(ref `tjrnqtzlrkvwgowrlzun`). Migrations are applied there with `db:push`.

```bash
npm install                # install dependencies
cp .env.example .env       # then fill in the project URL and anon key
npm run db:status          # show which migrations are applied remotely
npm run db:push            # REQUIRED: apply migration 17 (see below)
npm run db:types           # regenerate types from the live schema
npm start                  # start the Expo dev server
npm run web                # or run it in a browser on localhost:8081
```

Get the URL and anon key from the Supabase dashboard under
Project Settings → API, or via `npx supabase projects api-keys`.

> ### `db:push` is not optional right now
>
> Migration `20260917000001_user_gyms_workout_types_daily_challenges.sql` adds
> `sessions.workout_categories`, the `create_user_gym` / `find_similar_gyms`
> RPCs, and the `daily_session` challenge template. Until it is applied:
>
> - **starting a workout fails outright** — the insert references a column that
>   does not exist yet, and the error surfaces as a bare Postgres message;
> - the daily challenge cannot be created, so its card shows its error state;
> - the Add Gym button leads to a form whose submit always fails.
>
> Run `npm run db:status` first to check. If migration 17 is missing remotely,
> `npm run db:push` applies it — additive and safe on a shared project.

### A note on `src/types/database.ts`

Generated types are regenerated from a live database, which is not available in
every environment where this code is compiled. So the additions from migration 17
are declared by hand in [`src/types/database.ts`](src/types/database.ts) and
merged onto the generated `database.types.ts`, which stays untouched. Everything
in the app imports `Database` from `@/types/database`.

After running `npm run db:types` against a database that has migration 17
applied, the hand-written declarations in that file are redundant and should be
deleted, leaving a plain re-export. Nothing else has to change — no other module
imports `database.types` directly.

### Applying schema changes

```bash
npm run db:push            # apply new migrations to the linked project
npm run db:types           # ALWAYS regenerate types afterwards
npm run verify:db          # re-run the RLS and privacy-default checks
```

`verify:db` needs a service-role key, which must never be committed:

```bash
SUPABASE_SERVICE_ROLE_KEY=<key> npm run verify:db
```

> **Caution:** the linked project is a shared environment. `db push` is additive
> and safe, but `supabase db reset --linked` **destroys all data** — avoid it.
> Once you both have test data in there, consider either Docker for a local loop
> (`npm run db:start`) or a second free Supabase project for staging, so one
> person's migration cannot disrupt the other's work.

### Optional: local database loop

With Docker Desktop installed:

```bash
npm run db:start           # start local Supabase; prints a local URL + anon key
npm run db:reset           # apply all migrations from scratch, then seed
npm run db:types:local     # generate types from the local schema
```

## Scripts

| Script                                                           | Purpose                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm start`                                                      | Expo dev server                                               |
| `npm run web`                                                    | Dev server in a browser on `localhost:8081`                   |
| `npm run ios` / `android`                                        | Launch on a simulator/emulator                                |
| `npm run build:web`                                              | Production web export into `dist/`, ready to deploy           |
| `npm run serve:web`                                              | Serve `dist/` the way a static host does, to check a build    |
| `npm run verify`                                                 | **Typecheck + lint + test. Run before every push.**           |
| `npm run verify:db`                                              | 170 checks against the real database (needs service-role key) |
| `npm run verify:db:identity` / `:social` / `:gyms` / `:training` | Individual suites                                             |
| `npm run seed` / `seed:reset`                                    | Populate development data                                     |
| `npm run gyms:import -- waterloo`                                | Import gyms from OpenStreetMap                                |
| `npm run typecheck`                                              | `tsc --noEmit`                                                |
| `npm run lint` / `lint:fix`                                      | ESLint (warnings are errors)                                  |
| `npm run format` / `format:check`                                | Prettier                                                      |
| `npm test` / `test:watch`                                        | Jest                                                          |
| `npm run db:push`                                                | Apply migrations to the linked project                        |
| `npm run db:status`                                              | Show which migrations are applied                             |
| `npm run db:types`                                               | Regenerate `src/types/database.types.ts`                      |

**After changing any migration, re-run `npm run db:types`.** The generated types
are the contract the app compiles against.

## Project layout

```
app/                      expo-router routes
  (auth)/                 sign-in, sign-up
  (tabs)/                 Today, Crew, Map, Progress, Profile
  session/new.tsx         "What are you training?" - step one of a workout
  session/active.tsx      workout tracking: exercises, sets, notes, finish
  session/[id].tsx        a finished workout in full
  gym/[id].tsx            gym detail
  gym/new.tsx             add a gym, with map pin-drop and duplicate warnings
  challenges/daily.tsx    today's challenge
src/
  api/                    typed data-access layer - all database access
    dailyChallenge.ts     get-or-create today's challenge, per member per day
  auth/                   session state, and the cross-account cache reset
  components/ui/          accessible primitives
  components/workouts/    type picker, exercise picker, set editor, history row
  config/                 runtime-validated environment
  constants/branding.ts   the single place the app name lives
  lib/
    workoutTypes.ts       workout categories <-> muscle groups, legacy inference
    localDay.ts           timezone-correct day boundaries for the daily challenge
    exerciseEntry.ts      which fields a set row asks for
  test-utils/             shared test render helper
  theme/                  colours, spacing, typography, light/dark preference
  types/
    database.types.ts     generated (never hand-edit)
    database.ts           generated + migration 17's additions; import this
supabase/migrations/      17 numbered migrations (the source of truth)
scripts/                  verification, seeding, OSM import
docs/HANDOFF.md           lane ownership and database contract
```

See [docs/HANDOFF.md](docs/HANDOFF.md) for who owns what and the full database
contract.

## Deploying

Everything below is free. The build is a static single-page app, so any static
host works.

```bash
npm run build:web          # export to dist/, then add the host config files
npm run serve:web          # serve dist/ locally exactly as a host would
```

`serve:web` is worth using before every deploy: the dev server bundles on demand
and answers any path with the app, so it cannot reproduce the two failures that
actually break a static deploy — a missing SPA fallback, and asset paths that are
wrong for a sub-path host.

### GitHub Pages (free, already wired up)

`.github/workflows/deploy-web.yml` builds and publishes on every push to `main`.
Two one-time steps, neither of which can be done from the repo:

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions**, add `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`.

It then serves at `https://<user>.github.io/<repo>/`. The workflow sets
`EXPO_PUBLIC_BASE_PATH` from the repo name automatically, because Pages serves a
project repo from a sub-path and every absolute asset path — plus the MapLibre
worker URL — has to carry that prefix.

> **Pages is only free on a public repo.** On a private one it needs GitHub Pro.
> The `dist/` output is host-agnostic, so use Cloudflare Pages or Netlify instead
> (both free for private repos, both serve at the root, so leave
> `EXPO_PUBLIC_BASE_PATH` unset).

### Any other static host

`npm run build:web` writes the config each one looks for, so switching host is not
a code change:

| Host                      | Uses                     | Base path    |
| ------------------------- | ------------------------ | ------------ |
| GitHub Pages              | `404.html` + `.nojekyll` | `/<repo>`    |
| Netlify, Cloudflare Pages | `_redirects`             | unset (root) |
| Vercel                    | `vercel.json`            | unset (root) |

Point the host at `dist/`, set the two `EXPO_PUBLIC_SUPABASE_*` variables in its
build settings, and use `npm run build:web` as the build command.

### Is the anon key safe in the bundle?

Yes, and it has to be there — `EXPO_PUBLIC_*` values are inlined at build time.
The anon key grants no authority by itself; row-level security is what protects
member data. A `service_role` key must never be used here, in a repo secret, or in
a host's build settings: it bypasses RLS completely.

### What this costs

|                                                        |                                                           |
| ------------------------------------------------------ | --------------------------------------------------------- |
| Static hosting (Pages / Cloudflare / Netlify / Vercel) | **Free**                                                  |
| GitHub Actions on a public repo                        | **Free**, unlimited                                       |
| Supabase                                               | **Free tier** — 500 MB database, 50k monthly active users |
| OpenFreeMap tiles and fonts                            | **Free**, no key, no request cap                          |
| OpenStreetMap gym data                                 | **Free**, ODbL, attribution required (already rendered)   |

**What is not free:** native app store distribution. Apple charges $99/year and
Google $25 once, and no amount of configuration avoids that. EAS Build has a free
tier but it only produces the binary — it does not cover the store accounts.

For putting the app on a phone for free, use **Expo Go**:

```bash
npx expo start --tunnel    # scan the QR code with Expo Go
```

The README previously said Expo Go would not work because of MapLibre. That is no
longer true: MapLibre is only imported by `GymMapView.web.tsx`, and Metro resolves
the native map to `GymMapView.tsx`, a schematic plot with no native dependencies.
Every remaining dependency ships inside Expo Go.

> **Supabase free projects pause after about a week of inactivity** and need a
> click in the dashboard to wake. Worth knowing before concluding a deploy is
> broken.

## What to test

Seed first, so there is real data to look at:

```bash
SUPABASE_SERVICE_ROLE_KEY=<key> npm run seed:reset
```

That creates `alex@`, `sam@`, `jordan@`, and `riley@gymcrew.dev`, all with
password `DevPassword123!`. **Sign in as more than one of them.** Only Sam has
opted into sharing, only Alex and Jordan are friends, and Riley's one session is
deliberately too short to count — the differences between them are the point.

**The workout flow.** Start a workout → pick a type → pick exercises → log sets →
finish. Worth checking specifically:

- Picking **Legs** shows leg exercises, not the whole library.
- Two categories combine: Chest + Arms, or Chest + Triceps via "individual muscle
  groups". Full Body replaces the selection rather than adding to it.
- **+ Add set** copies the previous set's numbers, and the values are edited in
  place rather than through a separate form. Edits save on blur.
- **+ Add custom exercise** saves to your account — it is still there in the next
  workout, and only you can see it.
- Finishing shows a summary, and the crew goal, leaderboard, progress charts, and
  challenge progress all move.

**Workout history.** Every finished workout shows its type and emoji; tapping one
opens every set, rep, weight, and note. Sessions logged by the seed script predate
workout types, so their type is inferred from the exercises and labelled "from
exercises" — that is correct behaviour, not a gap.

**Dark mode.** Profile → Appearance. System / Light / Dark, persisted across
restarts. The map, progress bars, badges, charts, and avatars all follow it.

**Add a gym.** Explore → Add a gym. Drop a pin, then try adding something with a
name and location close to a gym that already exists — it should warn and offer to
open the existing one instead, and refuse outright if the name matches within
400 m.

**The daily challenge.** It should appear for every account, including one in no
crew. Progress moves when you finish a qualifying session (20+ minutes), and the
window is your profile's timezone — Riley is in `America/Vancouver`, everyone else
in `America/Toronto`.

### Known gaps

Honest list, so nobody files these as bugs:

- **Gym photos are a URL, not an upload.** There is no storage bucket and no image
  picker dependency, so the field takes a link.
- **There is no friend activity feed.** Finishing a workout correctly updates the
  crew goal, leaderboard, gym visit counts, challenges, and personal stats, but
  there is no screen listing what friends have been doing. Building one needs a new
  `SECURITY DEFINER` function that redacts per each member's
  `activity_detail_level`, since `sessions` is own-rows-only under RLS. See
  `docs/HANDOFF.md`.
- **Realtime is still not wired up**, so crew activity and presence need a refetch.
- **The daily challenge deliberately has no daily streak.** Streaks are counted in
  weeks throughout the app, because a daily streak punishes rest days.

## Conventions

- Import via the `@/` alias (maps to `src/`) rather than deep relative paths.
- `npm run verify` must pass before pushing; CI runs the same checks.
- Never hardcode the app name — import `BRANDING.displayName`.
- Never put secrets in `EXPO_PUBLIC_*`; those values ship inside the app bundle.
- Every table gets RLS enabled and an explicit policy. No table is left open.
- Line endings are pinned to LF by `.gitattributes`. Prettier is configured for
  LF and runs as an ESLint rule, so a CRLF checkout — the Windows default with
  `core.autocrlf=true` — fails `npm run lint` on every source file.
