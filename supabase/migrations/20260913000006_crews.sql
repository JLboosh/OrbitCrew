-- ============================================================================
-- Private, invite-only crews
-- ============================================================================
-- A crew is a closed group. Non-members must not be able to discover that a
-- crew exists, who is in it, what its goals are, or what its members did.
--
-- Each crew owns its timezone, weekly session target, minimum valid session
-- duration, leaderboard metric, and challenges.
--
-- RLS RECURSION NOTE
-- ------------------
-- A policy on `crew_members` that itself queries `crew_members` would recurse
-- infinitely. All membership tests therefore go through SECURITY DEFINER helper
-- functions, which are not subject to RLS. This is the standard fix and the
-- reason those helpers exist.
-- ============================================================================

create type public.crew_role as enum ('owner', 'admin', 'member');

comment on type public.crew_role is
  'owner: full control, exactly one per crew. admin: goals/challenges/members. member: participate.';

-- Metrics that are fair across schedules, body types, and training styles.
-- Total weight lifted and session duration are deliberately absent as primary
-- scores: they favour heavier lifters and people with more free time.
create type public.crew_leaderboard_metric as enum (
  'sessions',
  'consistency_streak',
  'challenge_contribution',
  'points'
);

comment on type public.crew_leaderboard_metric is
  'Primary weekly ranking metric. Excludes weight/duration by design for fairness.';

-- ----------------------------------------------------------------------------
-- Crews
-- ----------------------------------------------------------------------------
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  avatar_url text,

  -- The crew's own timezone. Weekly leaderboards reset Monday 00:00 in THIS
  -- zone, so members in different countries are scored against the same window.
  timezone text not null default 'UTC',

  -- Combined sessions the crew aims for each week (e.g. 36 for 12 members).
  weekly_target_sessions integer not null default 12,

  -- A session must last at least this long to count toward the weekly target.
  -- Per-crew rather than global so a crew of powerlifters and a crew of
  -- runners can set different bars.
  min_session_minutes integer not null default 20,

  leaderboard_metric public.crew_leaderboard_metric not null default 'sessions',

  -- The humorous weekly "Motivation Spotlight" badge. Disabled at crew level by
  -- default, AND requires per-member opt-in. Two independent switches, because a
  -- feature that can single someone out should be hard to turn on by accident.
  spotlight_enabled boolean not null default false,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crews_name_length check (char_length(trim(name)) between 2 and 60),
  constraint crews_description_length check (description is null or char_length(description) <= 500),
  constraint crews_weekly_target_range check (weekly_target_sessions between 1 and 1000),
  -- Upper bound stops a crew from setting an absurd threshold that no session
  -- could satisfy; lower bound keeps "valid session" meaningful.
  constraint crews_min_session_range check (min_session_minutes between 5 and 240),
  constraint crews_timezone_valid check (now() at time zone timezone is not null)
);

comment on table public.crews is
  'Invite-only group with its own timezone, weekly target, leaderboard, and challenges.';

create trigger crews_set_updated_at
  before update on public.crews
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Membership
-- ----------------------------------------------------------------------------
create table public.crew_members (
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.crew_role not null default 'member',

  -- Per-crew visibility override. NULL means "use my global default".
  -- A trigger enforces that this can only ever be MORE private than the global
  -- setting, so joining a crew can never silently widen what a member shares.
  activity_detail_override public.activity_detail_level,

  -- Opt-in presence sharing for this specific crew, used when the member's
  -- global presence_visibility is 'selected_crews'.
  share_presence boolean not null default false,

  joined_at timestamptz not null default now(),

  primary key (crew_id, user_id)
);

comment on table public.crew_members is
  'Crew membership with role and per-crew privacy overrides. Rows are created only by invite redemption.';
comment on column public.crew_members.activity_detail_override is
  'Per-crew visibility. May only be more private than the global default; enforced by trigger.';

create index crew_members_user_idx on public.crew_members (user_id);

-- Exactly one owner per crew.
create unique index crew_members_single_owner_idx
  on public.crew_members (crew_id)
  where role = 'owner';

-- ----------------------------------------------------------------------------
-- Invites
-- ----------------------------------------------------------------------------
create table public.crew_invites (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,

  -- Shareable code. Case-insensitive on redemption.
  code text not null unique,

  created_by uuid references public.profiles (id) on delete set null,

  -- Invites always expire. An immortal invite link is a standing leak.
  expires_at timestamptz not null,

  -- NULL means unlimited uses until expiry.
  max_uses integer,
  uses integer not null default 0,

  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint crew_invites_code_format check (code ~ '^[A-Z0-9]{6,12}$'),
  constraint crew_invites_max_uses_positive check (max_uses is null or max_uses > 0),
  constraint crew_invites_uses_nonnegative check (uses >= 0)
);

comment on table public.crew_invites is
  'Time-limited crew invite codes. Redemption happens through an RPC so non-members never read this table.';

create index crew_invites_crew_idx on public.crew_invites (crew_id);

-- ----------------------------------------------------------------------------
-- Membership helper functions (SECURITY DEFINER: bypass RLS, prevent recursion)
-- ----------------------------------------------------------------------------
create or replace function public.is_crew_member(p_crew_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.crew_members cm
    where cm.crew_id = p_crew_id
      and cm.user_id = coalesce(p_user_id, (select auth.uid()))
  );
$$;

comment on function public.is_crew_member(uuid, uuid) is
  'Membership test for RLS. SECURITY DEFINER to avoid infinite policy recursion on crew_members.';

create or replace function public.crew_role_of(p_crew_id uuid, p_user_id uuid default null)
returns public.crew_role
language sql
stable
security definer
set search_path = ''
as $$
  select cm.role
  from public.crew_members cm
  where cm.crew_id = p_crew_id
    and cm.user_id = coalesce(p_user_id, (select auth.uid()));
$$;

create or replace function public.is_crew_admin(p_crew_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.crew_role_of(p_crew_id, p_user_id) in ('owner', 'admin');
$$;

comment on function public.is_crew_admin(uuid, uuid) is
  'True for owner or admin. Admins may set goals, run challenges, and manage members.';

/** True when both users share at least one crew. Used for profile visibility. */
create or replace function public.share_any_crew(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.crew_members a
    join public.crew_members b on a.crew_id = b.crew_id
    where a.user_id = p_one
      and b.user_id = p_two
  );
$$;

-- ----------------------------------------------------------------------------
-- Owner membership is created with the crew
-- ----------------------------------------------------------------------------
-- Without this the creator would be locked out of their own crew: every SELECT
-- policy requires membership, so an ownerless crew would be invisible to
-- everyone, including its author.
create or replace function public.handle_new_crew()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crew_members (crew_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_crew_created
  after insert on public.crews
  for each row
  when (new.created_by is not null)
  execute function public.handle_new_crew();

-- ----------------------------------------------------------------------------
-- Per-crew overrides may only tighten privacy
-- ----------------------------------------------------------------------------
create or replace function public.enforce_crew_detail_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_global public.activity_detail_level;
begin
  if new.activity_detail_override is null then
    return new;
  end if;

  select ps.default_activity_detail
  into v_global
  from public.privacy_settings ps
  where ps.user_id = new.user_id;

  -- Enum comparison relies on declaration order, which is least to most
  -- revealing. An override more revealing than the global default is clamped
  -- rather than rejected, so a legitimate update never fails outright.
  if v_global is not null and new.activity_detail_override > v_global then
    new.activity_detail_override := v_global;
  end if;

  return new;
end;
$$;

create trigger crew_members_clamp_detail_override
  before insert or update on public.crew_members
  for each row
  execute function public.enforce_crew_detail_override();

-- ----------------------------------------------------------------------------
-- RLS: crews
-- ----------------------------------------------------------------------------
alter table public.crews enable row level security;

-- Members only. A non-member cannot learn that a crew exists.
create policy crews_select_member
  on public.crews
  for select
  to authenticated
  using (public.is_crew_member(id));

-- Anyone may create a crew, but must record themselves as the creator so the
-- owner-membership trigger cannot be used to seed someone else's crew.
create policy crews_insert_self_as_creator
  on public.crews
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- Goals, challenges, and settings are admin territory.
create policy crews_update_admin
  on public.crews
  for update
  to authenticated
  using (public.is_crew_admin(id))
  with check (public.is_crew_admin(id));

-- Only the owner may delete a crew, since it destroys everyone's history.
create policy crews_delete_owner
  on public.crews
  for delete
  to authenticated
  using (public.crew_role_of(id) = 'owner');

-- ----------------------------------------------------------------------------
-- RLS: crew_members
-- ----------------------------------------------------------------------------
alter table public.crew_members enable row level security;

create policy crew_members_select_co_member
  on public.crew_members
  for select
  to authenticated
  using (public.is_crew_member(crew_id));

-- No INSERT policy. Membership is granted exclusively by redeem_crew_invite(),
-- which is what makes crews genuinely invite-only rather than invite-by-
-- convention.

-- A member may edit their OWN row (privacy overrides, presence opt-in) but must
-- not change their own role. Admins manage roles through the separate policy.
create policy crew_members_update_own_preferences
  on public.crew_members
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and role = public.crew_role_of(crew_id, (select auth.uid()))
  );

create policy crew_members_update_admin_manages_roles
  on public.crew_members
  for update
  to authenticated
  using (
    public.is_crew_admin(crew_id)
    -- An admin cannot modify the owner's row.
    and role <> 'owner'
  )
  with check (
    public.is_crew_admin(crew_id)
    -- Nor promote anyone to owner; ownership transfer is a deliberate,
    -- separate operation.
    and role <> 'owner'
  );

-- Members may leave; admins may remove others. The owner cannot be removed.
create policy crew_members_delete_self_or_admin
  on public.crew_members
  for delete
  to authenticated
  using (
    role <> 'owner'
    and (
      user_id = (select auth.uid())
      or public.is_crew_admin(crew_id)
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: crew_invites
-- ----------------------------------------------------------------------------
alter table public.crew_invites enable row level security;

-- Only admins see invite codes. Members do not need them, and non-members must
-- never be able to read or guess-check codes by querying the table.
create policy crew_invites_select_admin
  on public.crew_invites
  for select
  to authenticated
  using (public.is_crew_admin(crew_id));

create policy crew_invites_insert_admin
  on public.crew_invites
  for insert
  to authenticated
  with check (
    public.is_crew_admin(crew_id)
    and created_by = (select auth.uid())
  );

-- Revoking is an UPDATE (setting revoked_at) rather than a DELETE, preserving
-- the audit trail of who invited whom.
create policy crew_invites_update_admin
  on public.crew_invites
  for update
  to authenticated
  using (public.is_crew_admin(crew_id))
  with check (public.is_crew_admin(crew_id));

-- ----------------------------------------------------------------------------
-- Extend profile visibility to crew mates
-- ----------------------------------------------------------------------------
create policy profiles_select_crew_mate
  on public.profiles
  for select
  to authenticated
  using (
    public.share_any_crew(id, (select auth.uid()))
    and not public.is_blocked_either_way(id, (select auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- Invite creation and redemption
-- ----------------------------------------------------------------------------

/**
 * Generates a crew invite code.
 *
 * Uses pgcrypto's CSPRNG rather than random(), because an invite code is a
 * capability: anyone holding it can join a private group. Excludes visually
 * ambiguous characters (0/O, 1/I) so codes can be read aloud reliably.
 */
create or replace function public.create_crew_invite(
  p_crew_id uuid,
  p_expires_in_hours integer default 168,
  p_max_uses integer default null
)
returns public.crew_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_invite public.crew_invites;
  v_attempt int := 0;
begin
  if not public.is_crew_admin(p_crew_id) then
    raise exception 'Only crew admins may create invites'
      using errcode = '42501';
  end if;

  if p_expires_in_hours < 1 or p_expires_in_hours > 8760 then
    raise exception 'Invite expiry must be between 1 hour and 1 year'
      using errcode = '22023';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := '';

    for _i in 1..8 loop
      v_code := v_code || substr(
        v_alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)),
        1
      );
    end loop;

    begin
      insert into public.crew_invites (crew_id, code, created_by, expires_at, max_uses)
      values (
        p_crew_id,
        v_code,
        (select auth.uid()),
        now() + make_interval(hours => p_expires_in_hours),
        p_max_uses
      )
      returning * into v_invite;

      return v_invite;
    exception
      when unique_violation then
        -- Astronomically unlikely; retry rather than fail the request.
        if v_attempt >= 5 then
          raise;
        end if;
    end;
  end loop;
end;
$$;

comment on function public.create_crew_invite(uuid, integer, integer) is
  'Admin-only. Creates a CSPRNG invite code with a mandatory expiry.';

/**
 * Redeems an invite code and joins the caller to the crew.
 *
 * SECURITY DEFINER because the caller is by definition NOT yet a member, so no
 * RLS policy could permit them to read the invite or insert their membership.
 * All validation happens here, which is why crew_members has no INSERT policy.
 */
create or replace function public.redeem_crew_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.crew_invites;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Must be signed in to redeem an invite'
      using errcode = '42501';
  end if;

  select * into v_invite
  from public.crew_invites
  where code = upper(trim(p_code))
  for update;

  -- A single generic message for every failure mode below. Distinguishing
  -- "expired" from "no such code" would let an attacker probe which codes exist.
  if v_invite.id is null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now()
     or (v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses)
  then
    raise exception 'That invite code is not valid'
      using errcode = '22023';
  end if;

  -- Already a member: succeed idempotently rather than erroring, so tapping an
  -- invite link twice is harmless.
  if public.is_crew_member(v_invite.crew_id, v_user) then
    return v_invite.crew_id;
  end if;

  insert into public.crew_members (crew_id, user_id, role)
  values (v_invite.crew_id, v_user, 'member');

  update public.crew_invites
  set uses = uses + 1
  where id = v_invite.id;

  return v_invite.crew_id;
end;
$$;

comment on function public.redeem_crew_invite(text) is
  'Joins the caller to a crew via invite code. The only path to crew membership.';

revoke execute on function public.create_crew_invite(uuid, integer, integer) from anon;
revoke execute on function public.redeem_crew_invite(text) from anon;
