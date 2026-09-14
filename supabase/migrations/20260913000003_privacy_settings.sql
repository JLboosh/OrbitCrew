-- ============================================================================
-- Privacy settings
-- ============================================================================
-- The product rule is that the app must feel encouraging, never invasive.
-- Location sharing and progress comparison are opt-in. This table encodes that
-- as data, and every default below is the most private option.
--
-- These defaults are asserted by tests. Do not relax them for convenience.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Who may see that a member is currently checked in
-- ----------------------------------------------------------------------------
-- Live presence is the most sensitive signal in the product because it is
-- real-time and physical. Default is 'nobody'.
create type public.presence_visibility as enum (
  'nobody',          -- Default. Presence is recorded for the user's own history only.
  'friends',         -- Accepted friends only.
  'selected_crews',  -- Only crews the member explicitly opted in (see crew_members).
  'all_crews'        -- Every crew the member belongs to.
);

comment on type public.presence_visibility is
  'Audience for live check-in presence. Defaults to nobody; presence is opt-in.';

-- ----------------------------------------------------------------------------
-- How much workout detail others may see
-- ----------------------------------------------------------------------------
-- Graduated and strictly increasing: each level reveals everything the previous
-- level does, plus more. Ordering matters, so comparisons can use the enum's
-- natural order rather than ad-hoc logic.
create type public.activity_detail_level as enum (
  'trained_only',  -- Default. "Alex trained" — no gym, no duration, no lifts.
  'gym_name',      -- Adds which gym.
  'duration',      -- Adds how long the session lasted.
  'full_detail'    -- Adds exercises, sets, reps, and weights.
);

comment on type public.activity_detail_level is
  'Graduated workout visibility, ordered least to most revealing. Default trained_only.';

create table public.privacy_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- Live presence: OFF by default. This is the core opt-in guarantee.
  presence_visibility public.presence_visibility not null default 'nobody',

  -- Baseline detail level applied to every crew. A crew-specific override may
  -- be set per membership, but it can only ever be MORE private than this.
  default_activity_detail public.activity_detail_level not null default 'trained_only',

  -- Whether friends may see progress summaries (PRs, estimated 1RM, volume,
  -- consistency). Off by default: public progress comparison is opt-in.
  share_progress_summary boolean not null default false,

  -- Whether the member may be found by an EXACT username match in the add-friend
  -- flow. Defaults to true because it is how invitations work at all, and it
  -- permits only exact lookups — never browsing or enumeration of the user list.
  discoverable_by_username boolean not null default true,

  -- Opt-in to the humorous weekly "Motivation Spotlight" badge for the
  -- lowest-ranked participating member. Off by default, and members who hide
  -- activity or do not participate are never eligible regardless of this flag.
  -- This is what keeps a competitive feature from becoming a harassment vector.
  allow_motivation_spotlight boolean not null default false,

  -- Whether this member appears in anonymised, aggregated gym crowd statistics
  -- ("usually busy Tue 5-7 PM"). Aggregate-only and never attributable to an
  -- individual, but still opt-in because it derives from their check-ins.
  contribute_to_crowd_stats boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.privacy_settings is
  'Per-user visibility controls. Every default is the most private option; enforced by RLS elsewhere.';

create trigger privacy_settings_set_updated_at
  before update on public.privacy_settings
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------
-- A member's privacy configuration is private to them. Other members never read
-- this table directly; policies on presence/activity tables consult it via
-- security-definer helper functions instead.
alter table public.privacy_settings enable row level security;

create policy privacy_settings_select_own
  on public.privacy_settings
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy privacy_settings_update_own
  on public.privacy_settings
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No INSERT policy: the row is created by the signup trigger, guaranteeing that
-- every user has private-by-default settings from the moment they exist. A user
-- cannot exist in a state where their privacy row is missing and therefore
-- ambiguous.
-- No DELETE policy: deletion would remove the privacy record while the account
-- still exists, which would fail open.
