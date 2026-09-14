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

> **Expo Go will not work for the map screens.** MapLibre is a native module, so
> a development build is required. Everything else runs in Expo Go.

## Setup

This project is currently **linked to the hosted Supabase project `gymApp`**
(ref `tjrnqtzlrkvwgowrlzun`). Migrations are applied there with `db:push`.

```bash
npm install                # install dependencies
cp .env.example .env       # then fill in the project URL and anon key
npm run db:status          # show which migrations are applied remotely
npm run db:types           # regenerate types from the live schema
npm start                  # start the Expo dev server
```

Get the URL and anon key from the Supabase dashboard under
Project Settings → API, or via `npx supabase projects api-keys`.

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
| `npm run ios` / `android`                                        | Launch on a simulator/emulator                                |
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
  (tabs)/                 Today, Crew, Map*, Progress*, Profile
  session/active.tsx      workout logging
  gym/[id].tsx            gym detail (partial*)
src/
  api/                    typed data-access layer - all database access
  auth/                   session state
  components/ui/          accessible primitives
  config/                 runtime-validated environment
  constants/branding.ts   the single place the app name lives
  lib/                    Supabase client, React Query config
  test-utils/             shared test render helper
  theme/                  colours, spacing, typography
  types/                  generated database types (do not hand-edit)
supabase/migrations/      16 numbered migrations (the source of truth)
scripts/                  verification, seeding, OSM import
docs/HANDOFF.md           lane ownership and database contract

* placeholder, owned by the gyms/map + stats workstream
```

See [docs/HANDOFF.md](docs/HANDOFF.md) for who owns what and the full database
contract.

## Conventions

- Import via the `@/` alias (maps to `src/`) rather than deep relative paths.
- `npm run verify` must pass before pushing; CI runs the same checks.
- Never hardcode the app name — import `BRANDING.displayName`.
- Never put secrets in `EXPO_PUBLIC_*`; those values ship inside the app bundle.
- Every table gets RLS enabled and an explicit policy. No table is left open.
