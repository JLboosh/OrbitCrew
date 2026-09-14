# Contributor and agent guide

Read this before changing code. `README.md` covers setup; this file covers rules.

## Versioned docs

Expo changes frequently. Consult the exact versioned docs for the installed SDK
(57) at https://docs.expo.dev/versions/v57.0.0/ rather than relying on memory or
older tutorials.

## Non-negotiable product invariants

These are enforced by tests and RLS policies. Do not weaken them for
convenience.

1. **Privacy defaults are opt-out.** New users share nothing. Live presence is
   `off`. Any new sharing field must default to the most private value and have
   a test asserting that default.
2. **No coordinate sharing.** The `presence` table references a `gym_id`. Never
   add latitude/longitude columns describing where a _user_ is.
3. **Presence must expire.** Any presence row requires an `expires_at` no more
   than 3 hours in the future.
4. **RLS on every table.** A new table without `ENABLE ROW LEVEL SECURITY` and
   explicit policies is an incomplete change. Add a test proving a
   non-participant sees zero rows.
5. **No shaming mechanics.** The optional weekly spotlight applies only to
   members who opted in, never to members who hid activity or did not
   participate, and crews can disable it entirely.
6. **Fair leaderboard metrics.** Rank by sessions, consistency, and challenge
   contribution. Do not make total weight or duration a primary universal score.
7. **Progress numbers must be real.** Every percentage traces to a concrete
   measurement (e.g. estimated 1RM via Epley). No vague aggregate "you improved
   200%" figures.

## Testing notes

- **`render` is async in React Native Testing Library v14.** Always
  `await render(<Component />)`. Forgetting the `await` produces the misleading
  error "`render` function has not been called".
- Prefer accessibility-based queries (`getByRole`, `getByLabelText`) over test
  IDs. They assert the screen is usable with a screen reader at the same time.

## Workflow

```bash
npm run verify   # typecheck + lint + test — must pass before pushing
```

- After editing a migration, run `npm run db:reset && npm run db:types`.
- `src/types/database.types.ts` is generated. Never hand-edit it.
- Import through the `@/` alias, not deep relative paths.
- Never hardcode the app name; import `BRANDING.displayName`.

## Secrets

`EXPO_PUBLIC_*` variables are inlined into the shipped JS bundle and are
extractable from the app. The Supabase anon key belongs there (it grants no
authority on its own — RLS does the protecting). A `service_role` key must never
appear in app code, only in Edge Functions.

## Schema changes

Migrations are the source of truth and are append-only once merged. Never edit a
migration that has been applied on a shared environment; add a new one.
