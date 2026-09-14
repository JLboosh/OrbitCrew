-- ============================================================================
-- Live presence and the crew activity feed
-- ============================================================================
-- This is the most privacy-sensitive part of the product, so the rules are
-- encoded in the schema rather than left to the UI:
--
--   * NO COORDINATES. A presence row references a `gym_id`. There is no
--     latitude/longitude column describing where a USER is, and there must never
--     be one. Members share "at Waterloo Athletics", never a live position.
--
--   * PRESENCE ALWAYS EXPIRES. `expires_at` is mandatory and capped at 3 hours
--     by a CHECK constraint, so a forgotten check-out cannot broadcast someone's
--     location indefinitely.
--
--   * VISIBILITY IS OFF BY DEFAULT. `privacy_settings.presence_visibility`
--     starts at 'nobody'. Nothing here overrides that.
--
--   * NO PASSIVE HISTORY. Expired rows are deleted, not archived. The product
--     must not accumulate a movement log.
-- ============================================================================

create table public.presence (
  -- One live presence per member. The primary key enforces it: checking into a
  -- second gym replaces the first rather than creating a second location.
  user_id uuid primary key references public.profiles (id) on delete cascade,

  gym_id uuid not null references public.gyms (id) on delete cascade,

  -- Links presence to the training session, so ending the session can clear it.
  session_id uuid references public.sessions (id) on delete cascade,

  started_at timestamptz not null default now(),

  -- Mandatory. Hard-capped at 3 hours below.
  expires_at timestamptz not null,

  -- THE 3-HOUR HARD MAXIMUM, enforced by the database. Even a buggy or hostile
  -- client cannot create presence that outlives this.
  constraint presence_max_three_hours
    check (expires_at > started_at and expires_at <= started_at + interval '3 hours')
);

comment on table public.presence is
  'Live check-in presence. References a gym, never coordinates. Expires within 3 hours, enforced by CHECK.';
comment on column public.presence.expires_at
  is 'Hard-capped at started_at + 3 hours so a forgotten check-out cannot broadcast indefinitely.';

create index presence_gym_idx on public.presence (gym_id);
create index presence_expires_idx on public.presence (expires_at);

-- ----------------------------------------------------------------------------
-- Visibility test
-- ----------------------------------------------------------------------------
/**
 * Whether the CALLER may see a given member's live presence.
 *
 * Resolves the member's chosen audience:
 *   nobody         -> never (the default)
 *   friends        -> accepted friends only
 *   selected_crews -> shared crews where THAT member set share_presence = true
 *   all_crews      -> any shared crew
 *
 * A block hides presence in both directions regardless of the setting.
 * Caller-scoped by design, so it cannot be used to probe whether two other
 * people can see each other.
 */
create or replace function public.can_see_presence_of(p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_mode public.presence_visibility;
begin
  if v_caller is null then
    return false;
  end if;

  -- Members always see their own presence.
  if v_caller = p_target then
    return true;
  end if;

  -- A block overrides every sharing setting.
  if public.is_blocked_with_caller(p_target) then
    return false;
  end if;

  select ps.presence_visibility
  into v_mode
  from public.privacy_settings ps
  where ps.user_id = p_target;

  -- Fail closed: a missing privacy row must never mean "visible".
  if v_mode is null or v_mode = 'nobody' then
    return false;
  end if;

  if v_mode = 'friends' then
    return public.is_friend_of_caller(p_target);
  end if;

  if v_mode = 'all_crews' then
    return public.shares_crew_with_caller(p_target);
  end if;

  if v_mode = 'selected_crews' then
    -- Only crews the TARGET opted into, and which the caller also belongs to.
    return exists (
      select 1
      from public.crew_members target_cm
      join public.crew_members caller_cm on caller_cm.crew_id = target_cm.crew_id
      where target_cm.user_id = p_target
        and target_cm.share_presence
        and caller_cm.user_id = v_caller
    );
  end if;

  return false;
end;
$$;

comment on function public.can_see_presence_of(uuid) is
  'Caller-scoped presence visibility check. Fails closed when privacy settings are missing.';

-- ----------------------------------------------------------------------------
-- RLS: presence
-- ----------------------------------------------------------------------------
alter table public.presence enable row level security;

-- Expired rows are invisible even before the cleanup job removes them, so
-- visibility never depends on how promptly that job runs.
create policy presence_select_permitted
  on public.presence
  for select
  to authenticated
  using (
    expires_at > now()
    and public.can_see_presence_of(user_id)
  );

create policy presence_insert_own
  on public.presence
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy presence_update_own
  on public.presence
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Checking out is a DELETE, which is why no history accumulates.
create policy presence_delete_own
  on public.presence
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Check in / check out
-- ----------------------------------------------------------------------------
/**
 * Checks the caller into a gym, optionally starting a session.
 *
 * An RPC because `expires_at` must be derived from the server clock and clamped
 * server-side. Letting the client supply it would make the 3-hour maximum
 * advisory rather than enforced.
 */
create or replace function public.check_in(
  p_gym_id uuid,
  p_session_id uuid default null,
  p_duration_minutes integer default 120
)
returns public.presence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_minutes integer;
  v_row public.presence;
begin
  if v_user is null then
    raise exception 'Must be signed in to check in' using errcode = '42501';
  end if;

  -- Clamp to the 3-hour policy regardless of what was requested.
  v_minutes := least(greatest(coalesce(p_duration_minutes, 120), 5), 180);

  -- A session, if given, must belong to the caller. Otherwise presence could be
  -- attached to somebody else's workout.
  if p_session_id is not null and not exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.user_id = v_user
  ) then
    raise exception 'That session does not belong to you' using errcode = '42501';
  end if;

  insert into public.presence (user_id, gym_id, session_id, started_at, expires_at)
  values (v_user, p_gym_id, p_session_id, now(), now() + make_interval(mins => v_minutes))
  on conflict (user_id) do update
    set gym_id = excluded.gym_id,
        session_id = excluded.session_id,
        started_at = excluded.started_at,
        expires_at = excluded.expires_at
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.check_out()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.presence where user_id = (select auth.uid());
$$;

comment on function public.check_out() is
  'Removes the caller''s presence. A delete, not an archive: no location history is kept.';

/**
 * Deletes expired presence rows.
 *
 * RLS already hides expired rows, so this is hygiene rather than the security
 * boundary — but it matters: it guarantees the table never becomes a history of
 * where members have been. Intended to run on a schedule (pg_cron or an Edge
 * Function).
 */
create or replace function public.purge_expired_presence()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.presence where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_expired_presence() is
  'Deletes expired presence. Ensures no passive location history accumulates.';

-- Ending a session clears any presence attached to it, so checking out is not a
-- separate thing the member must remember to do.
create or replace function public.clear_presence_on_session_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    delete from public.presence
    where user_id = new.user_id
      and (session_id = new.id or session_id is null);
  end if;
  return new;
end;
$$;

create trigger sessions_clear_presence_on_end
  after update on public.sessions
  for each row
  execute function public.clear_presence_on_session_end();

revoke all on function public.check_in(uuid, uuid, integer) from public;
grant execute on function public.check_in(uuid, uuid, integer) to authenticated, service_role;

revoke all on function public.check_out() from public;
grant execute on function public.check_out() to authenticated, service_role;

revoke all on function public.can_see_presence_of(uuid) from public;
grant execute on function public.can_see_presence_of(uuid) to authenticated, service_role;

-- Cleanup is server-side only.
revoke all on function public.purge_expired_presence() from public;
grant execute on function public.purge_expired_presence() to service_role;

-- ----------------------------------------------------------------------------
-- Who is at a gym right now
-- ----------------------------------------------------------------------------
/**
 * Opted-in members currently checked into a gym, filtered to those the caller is
 * permitted to see. Returns display information only — never coordinates.
 */
create or replace function public.gym_presence(p_gym_id uuid)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username::text, p.display_name, p.avatar_url, pr.started_at
  from public.presence pr
  join public.profiles p on p.id = pr.user_id
  where pr.gym_id = p_gym_id
    and pr.expires_at > now()
    and public.can_see_presence_of(pr.user_id)
    and pr.user_id <> (select auth.uid())
  order by pr.started_at desc;
$$;

comment on function public.gym_presence(uuid) is
  'Members visible to the caller who are checked into a gym right now.';

revoke all on function public.gym_presence(uuid) from public;
grant execute on function public.gym_presence(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Friend visit history for a gym
-- ----------------------------------------------------------------------------
/**
 * How many of the caller's friends and crew mates have trained at a gym.
 *
 * Returns an aggregate count plus names only for members who share at least the
 * 'gym_name' detail level. Someone whose visibility is 'trained_only'
 * contributes to the count but is never named — the aggregate is not a loophole
 * around their setting.
 */
create or replace function public.gym_friend_visits(p_gym_id uuid)
returns table (
  visitor_count bigint,
  named_visitors jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with relevant as (
    select distinct
      s.user_id,
      coalesce(
        (select ps.default_activity_detail
         from public.privacy_settings ps
         where ps.user_id = s.user_id),
        'trained_only'
      ) as detail
    from public.sessions s
    where s.gym_id = p_gym_id
      and s.ended_at is not null
      and s.user_id <> (select auth.uid())
      and (
        public.is_friend_of_caller(s.user_id)
        or public.shares_crew_with_caller(s.user_id)
      )
      and not public.is_blocked_with_caller(s.user_id)
  )
  select
    count(*)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object('user_id', r.user_id, 'display_name', p.display_name)
      ) filter (where r.detail <> 'trained_only'),
      '[]'::jsonb
    )
  from relevant r
  join public.profiles p on p.id = r.user_id;
$$;

comment on function public.gym_friend_visits(uuid) is
  'Count of friends/crew mates who trained at a gym, naming only those who share gym-level detail.';

revoke all on function public.gym_friend_visits(uuid) from public;
grant execute on function public.gym_friend_visits(uuid) to authenticated, service_role;
