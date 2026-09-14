# Handoff: foundation complete

The foundation is done and verified against the live Supabase project. This
document is the contract between the two workstreams so you can build in
parallel without colliding.

## Who owns what

| Area                             | Owner      | Status                                                                |
| -------------------------------- | ---------- | --------------------------------------------------------------------- |
| Auth, profiles, privacy          | Foundation | **Done** — screen built                                               |
| Database schema, RLS, migrations | Foundation | **Done** — 16 migrations applied                                      |
| Navigation shell, design system  | Foundation | **Done**                                                              |
| Typed data-access layer          | Foundation | **Done** for the areas below                                          |
| Sessions + logging               | Lane A     | **Done** — Today + Active Session screens                             |
| Social (friends, crews, invites) | Lane A     | **Done** — Crew screen                                                |
| Ratings + leaderboard            | Lane A     | **Done** — data layer + leaderboard UI                                |
| Gyms + map, gym detail           | Lane B     | **Done** — `src/api/gyms.ts`, Map + Gym detail screens                |
| Stats (PRs, volume, consistency) | Lane B     | **Done** — `src/api/progress.ts`, Progress screen                     |
| Challenges                       | Lane B     | **Done** — `src/api/challenges.ts`, 3 screens under `app/challenges/` |

### Lane B notes

Two decisions worth knowing before you review it:

- **The map is a schematic plot, not a tile map.** Distances and bearings are
  accurate and to scale; streets are not drawn, and the UI says so. MapLibre +
  OpenFreeMap is still the intended stack, and `GymMapViewProps` is the seam —
  see the comment block in `src/components/gyms/GymMapView.tsx`. It was not
  adopted yet because MapLibre is a native module (no Expo Go) and adding any
  dependency without regenerating `package-lock.json` breaks `npm ci` in CI.
- **No new dependencies were added**, including `expo-location`. Nearby search
  therefore uses `navigator.geolocation` where the platform provides it and falls
  back to search-by-name otherwise. `src/lib/deviceLocation.ts` documents the
  three-step swap to `expo-location`; the hook's shape is the contract, so no
  caller changes.

Challenges have no entry point on Today or Crew, because those screens are Lane
A's. `<ActiveChallenges onSeeAll={...} />` is a self-contained card built for
exactly that insertion — one line, no prop plumbing.

## Getting started

```bash
npm install
cp .env.example .env          # fill in URL + anon key
npm run db:status             # confirm migrations are applied
npm run db:types              # regenerate types from the live schema
npm start
```

Seed the database so screens show real data:

```bash
SUPABASE_SERVICE_ROLE_KEY=<key> npm run seed:reset
```

That creates four members (`alex@gymcrew.dev` … password `DevPassword123!`), a
crew with a weekly goal, ten logged sessions with progressive overload, gym
ratings, a friendship, a live check-in, and a crew challenge.

Deliberately, **only Sam has opted into sharing.** Everyone else keeps the
private defaults, which is exactly what you want when testing visibility.

## The rules that are not negotiable

These are enforced by the database and asserted by tests. Do not work around
them in the UI.

1. **Privacy defaults are the most private value.** New members share nothing.
   Any new sharing column must default to private and have a test proving it.
2. **No user coordinates, ever.** `presence` references a `gym_id`. There is no
   latitude/longitude describing where a _person_ is, and there must never be.
3. **Presence expires within 3 hours**, enforced by a `CHECK` constraint. Check-out
   is a `DELETE`, so no location history accumulates.
4. **RLS on every table.** A new table without `ENABLE ROW LEVEL SECURITY` and
   explicit policies is an incomplete change.
5. **Leaderboards rank sessions, consistency, and challenge contribution** —
   never total weight or duration, which favour heavier lifters and people with
   more free time.
6. **Every percentage ships with its measurement.** `exercise_progress()` returns
   the baseline and the current value precisely so you can show
   "135 lb → 185 lb (+37%)" rather than a bare number.
7. **No shaming mechanics.** The weekly spotlight requires both a crew setting
   and per-member opt-in, and never applies to members who hid activity.

## Architecture in one paragraph

Expo + React Native + TypeScript, file-based routing via expo-router. Supabase
provides Postgres, auth, and PostGIS. **Business logic that must not drift lives
in the database**: estimated 1RM and pound-to-kilogram conversion are generated
columns, session validity is a function of the crew's threshold, and privacy
decisions are RLS policies. The app is a client, not the source of truth.

## Data-access layer

All database access goes through `src/api/`. Screens should not import
`supabase` directly.

| Module           | Covers                                      |
| ---------------- | ------------------------------------------- |
| `profile.ts`     | Profile and privacy settings                |
| `sessions.ts`    | Sessions, exercises, sets, check-in/out     |
| `social.ts`      | Friends, blocks, crews, invites, membership |
| `ratings.ts`     | Gym lookup, seven-axis ratings, reports     |
| `leaderboard.ts` | Weekly leaderboard, crew progress, badges   |
| `gyms.ts`        | Nearby search, live presence, friend visits |
| `progress.ts`    | PRs, 1RM, volume, consistency, streaks      |
| `challenges.ts`  | Templates, instances, participation, badges |

All eight modules exist. Shared pure helpers live in `src/lib/`: `units.ts`
(kg/lb display), `geo.ts` (distance + map projection), `openingHours.ts` (an
OSM `opening_hours` reader that reports when it cannot parse), `challengeRules.ts`
(rule descriptions), `errors.ts` (extracting member-facing messages from
`PostgrestError`, which is not an `Error` instance).

## Database contract for Lane B

Everything below exists, is applied, and is verified.

**Gyms and map**

```ts
rpc('nearby_gyms', { p_latitude, p_longitude, p_radius_metres, p_limit });
// -> { id, name, latitude, longitude, address, opening_hours, distance_metres }
//    nearest first; limit clamped to 200 server-side

rpc('gym_presence', { p_gym_id }); // already filtered to who you may see
rpc('gym_friend_visits', { p_gym_id }); // { visitor_count, named_visitors }
```

Free stack: `@maplibre/maplibre-react-native` with OpenFreeMap tiles
(`https://tiles.openfreemap.org/styles/liberty`) — no key, no request limits.
MapLibre is native, so **Expo Go will not work**; you need a development build.
Attribution "© OpenStreetMap contributors" is required.

Do **not** call Overpass from the app. Its policy allows ~10k requests/day for
the _entire application_, so per-pan queries would get us blocked. Import in bulk:
`npm run gyms:import -- waterloo`.

**Stats**

```ts
rpc('exercise_progress'); // baseline + current + improvement %
rpc('weekly_training_summary', { p_weeks }); // sessions, volume, durations per week
rpc('training_streak'); // weeks, not days
from('personal_records'); // trigger-maintained; read-only
```

**Challenges**

```ts
from('challenge_templates'); // 6 seeded, matching the spec
(from('challenges'), from('challenge_participants'));
rpc('rescore_challenge', { p_challenge_id }); // idempotent; awards badges
```

The engine is template-driven: adding a challenge type is an `INSERT` into
`challenge_templates`, not a migration. Six rule types are implemented:
`session_count`, `weekly_consistency`, `distinct_gyms`, `time_of_day`,
`crew_session_total`, `exercise_1rm_gain`.

## Verification

```bash
npm run verify                                  # typecheck + lint + 25 unit tests
SUPABASE_SERVICE_ROLE_KEY=<key> npm run verify:db   # 170 checks vs the real database
```

The database suites create real users, sign them in, and assert through normal
authenticated sessions — so RLS is genuinely exercised rather than bypassed.
Run `verify:db` after any migration.

| Suite                | Checks                                                      |
| -------------------- | ----------------------------------------------------------- |
| `verify:db:identity` | 25 — signup trigger, privacy defaults, cross-user isolation |
| `verify:db:social`   | 42 — invite-only crews, roles, friendships, blocks          |
| `verify:db:gyms`     | 38 — PostGIS distance, ratings, 30-day limit                |
| `verify:db:training` | 65 — 1RM maths, presence expiry, leaderboard, challenges    |

## Bugs this verification already caught

Worth reading before you write your own SQL, because two are easy to repeat:

1. **`REVOKE ... FROM authenticated` does nothing on its own.** Postgres grants
   `EXECUTE` to `PUBLIC`, and Supabase adds an explicit `authenticated` grant via
   default privileges. Revoke from all three. A gym-directory write function was
   callable by any member; a fake gym row was genuinely injected during testing.
2. **A NULL-returning predicate fails open in PL/pgSQL.** `is_crew_admin`
   returned NULL for non-members, and `IF NOT (NULL) THEN` skips the branch — so
   a non-member could mint invite codes to a private crew. Always
   `coalesce(..., false)` in an authorisation helper.
3. **`INSERT ... RETURNING` evaluates the SELECT policy before AFTER triggers.**
   Crew creation appeared to fail with an RLS error while actually writing the
   row. Hence the `create_crew` RPC.
4. **SECURITY DEFINER helpers taking arbitrary IDs leak relationships.** Replaced
   with caller-scoped wrappers (`caller_in_crew`, `is_friend_of_caller`, …).
5. **A verification script corrupted real data** by writing test coordinates over
   two real gyms. Verification must not mutate the data it inspects.

## Known gaps

Not bugs, but things nobody has built yet:

- **Realtime is not wired up.** The tables are ready; crew activity and presence
  currently need a refetch.
- **Community crowd patterns** ("usually busy Tue 5–7 PM") are still
  unimplemented, and this is the one gap in Lane B's product surface. They need a
  new `SECURITY DEFINER` function aggregating session start times for members who
  set `contribute_to_crowd_stats`, because `sessions` is own-rows-only under RLS
  and correctly so. It was not added because a migration also requires
  regenerating `src/types/database.types.ts`, which needs the Supabase CLI.
  Gym detail currently shows the member their OWN visit pattern
  (`useMyGymVisitPattern`) and explicitly labels it as not being a crowd forecast.
- **`challenge_participants_insert_self` is looser than it looks.** It checks only
  `user_id = auth.uid()`, not that the challenge is one the caller can see, so
  someone who learned a challenge UUID could enrol in it. Low impact — they still
  cannot read the challenge — but the policy should also require
  `caller_in_crew(challenge.crew_id)` or ownership. Noted in `src/api/challenges.ts`.
- **`purge_expired_presence()` is not scheduled.** RLS already hides expired
  rows, so this is hygiene, but it should run on a schedule (pg_cron) so no
  location history lingers.
- **The weekly spotlight** is modelled in the schema but has no UI.
- **Push notifications, avatar upload, and account deletion** are unimplemented.
  Account deletion cascades correctly at the database level already.
- **No local Docker loop on the original dev machine**, so everything runs against
  the hosted project. Consider a second free Supabase project for staging so one
  person's migration cannot disrupt the other's work.
- **`supabase db reset --linked` destroys all data.** Never run it against the
  shared project. `db push` is additive and safe.

## Conventions

- Import via `@/`, not deep relative paths.
- `npm run verify` must pass before pushing; CI runs the same checks.
- Migrations are append-only once merged. Never edit an applied migration; add a
  new one.
- Regenerate `src/types/database.types.ts` after every schema change.
- Never hardcode the app name — import `BRANDING.displayName`. The product name
  lives only in `branding.json`, and store identifiers are deliberately not
  derived from it so a rebrand never forces a store migration.
