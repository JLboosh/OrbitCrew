-- ============================================================================
-- Profiles
-- ============================================================================
-- One row per authenticated user, holding the app-level identity that
-- `auth.users` does not (username, display name, avatar, preferences).
--
-- Rows are created automatically by a trigger on signup (see the new-user
-- trigger migration), never by the client.
-- ============================================================================

create table public.profiles (
  -- Shares the primary key with auth.users. ON DELETE CASCADE means deleting
  -- the auth user erases the profile, which is required for a credible
  -- account-deletion / GDPR story.
  id uuid primary key references auth.users (id) on delete cascade,

  -- Case-insensitive and unique: the handle friends search for.
  username extensions.citext not null unique,

  display_name text not null,
  avatar_url text,
  bio text,

  -- Preferred unit for entering and displaying weights.
  weight_unit public.weight_unit not null default 'lb',

  -- IANA timezone (e.g. 'America/Toronto'). Needed so that time-of-day
  -- challenges such as "Early Bird" and Monday leaderboard resets are scored in
  -- the member's own local time rather than UTC.
  timezone text not null default 'UTC',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 3-24 chars, letters/digits/underscore. Bounded to keep handles
  -- human-readable and to avoid unbounded index keys.
  constraint profiles_username_format
    check (username::text ~ '^[A-Za-z0-9_]{3,24}$'),

  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 50),

  constraint profiles_bio_length
    check (bio is null or char_length(bio) <= 300),

  -- Validated against the server's timezone database, so an invalid string
  -- cannot silently break challenge scoring later.
  constraint profiles_timezone_valid
    check (now() at time zone timezone is not null)
);

comment on table public.profiles is
  'App-level user identity. One row per auth.users row, created by trigger on signup.';
comment on column public.profiles.timezone is
  'IANA timezone used to score time-of-day challenges and weekly resets in local time.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------
-- Deny by default: enabling RLS with no permissive policy blocks all access,
-- then each policy below re-opens the narrowest useful path.
--
-- Visibility of OTHER members' profiles is intentionally NOT granted here. It
-- is added by the social-graph migration once friendships and crew membership
-- exist to gate it. Until then a user can only see themselves.
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT policy: profiles are created solely by the signup trigger.
-- No DELETE policy: profiles are removed by cascade from auth.users, so a
-- client cannot orphan its own auth account by deleting just the profile.

-- Index supporting case-insensitive prefix search for the "add friend" flow.
-- The unique constraint already indexes equality; this supports LIKE patterns.
create index profiles_username_search_idx
  on public.profiles (username extensions.citext_pattern_ops);
