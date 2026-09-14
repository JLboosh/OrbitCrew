-- ============================================================================
-- SECURITY FIX: function EXECUTE grants and caller-scoped predicates
-- ============================================================================
-- BUG 1 (HIGH): revoking from a role does not remove the PUBLIC grant
-- --------------------------------------------------------------------
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Writing
--
--     revoke execute on function public.upsert_osm_gym(...) from anon, authenticated;
--
-- removes nothing useful, because both roles still inherit EXECUTE via PUBLIC.
--
-- `upsert_osm_gym` is SECURITY DEFINER and has no internal authorisation check,
-- so ANY signed-in member could insert or overwrite rows in the shared gym
-- directory — inject fake gyms, move real ones, or rename them. Caught by
-- scripts/verify-gyms.mjs.
--
-- Correct form: revoke from PUBLIC first, then grant only to intended roles.
--
--
-- BUG 2 (MODERATE): relationship predicates leak other people's relationships
-- ---------------------------------------------------------------------------
-- Helpers such as `are_friends(a, b)` and `is_crew_member(crew, user)` are
-- SECURITY DEFINER, so they bypass RLS by design — they have to, or policies
-- that reference them would recurse. But because they accept ARBITRARY ids and
-- were callable by any authenticated member, a member could ask questions about
-- other people: "are these two users friends?", "is this user in that crew?".
--
-- For an app whose core promise is private crews, that is the wrong shape.
-- Exploiting it requires knowing unguessable UUIDs, so severity is moderate
-- rather than critical, but a member does know their crew mates' ids.
--
-- FIX: introduce caller-scoped wrappers that answer only about `auth.uid()`,
-- point every policy at those, and revoke the arbitrary-argument helpers from
-- PUBLIC. The wrappers are SECURITY DEFINER, so they can still call the
-- internal helpers even though callers no longer can.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lock down the gym importer
-- ----------------------------------------------------------------------------
revoke all on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) from public;

grant execute on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) to service_role;

-- Defence in depth: even if the grants are misconfigured again, the function
-- refuses to run for anyone but the service role.
create or replace function public.upsert_osm_gym(
  p_osm_id text,
  p_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_address text default null,
  p_city text default null,
  p_country_code text default null,
  p_opening_hours text default null,
  p_phone text default null,
  p_website text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_jwt_role text;
begin
  -- Read the role claim directly from the request JWT. This is what
  -- auth.role() does internally; inlining it avoids depending on that helper.
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );

  -- current_user is NULL-safe here: when invoked by a trusted server-side
  -- session (e.g. a migration or cron job) there is no JWT at all, and
  -- current_user is a superuser/owner rather than a PostgREST role.
  if v_jwt_role is not null and v_jwt_role <> 'service_role' then
    raise exception 'Gym directory writes are restricted to trusted server-side code'
      using errcode = '42501';
  end if;

  insert into public.gyms (
    osm_id, name, location, address, city, country_code, opening_hours, phone, website, source
  )
  values (
    p_osm_id,
    trim(p_name),
    extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
    p_address,
    p_city,
    upper(nullif(trim(coalesce(p_country_code, '')), '')),
    p_opening_hours,
    p_phone,
    p_website,
    'osm'
  )
  on conflict (osm_id) do update
    set name = excluded.name,
        location = excluded.location,
        address = coalesce(excluded.address, public.gyms.address),
        city = coalesce(excluded.city, public.gyms.city),
        country_code = coalesce(excluded.country_code, public.gyms.country_code),
        opening_hours = coalesce(excluded.opening_hours, public.gyms.opening_hours),
        phone = coalesce(excluded.phone, public.gyms.phone),
        website = coalesce(excluded.website, public.gyms.website)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_osm_gym is
  'Idempotent gym import keyed on osm_id. Service-role only, enforced by grants AND an internal check.';

revoke all on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) from public;
grant execute on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 2. Caller-scoped relationship predicates
-- ----------------------------------------------------------------------------
-- Each answers only about the current user, so it cannot be used to probe
-- other people's relationships.

create or replace function public.caller_in_crew(p_crew_id uuid)
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
      and cm.user_id = (select auth.uid())
  );
$$;

create or replace function public.caller_crew_role(p_crew_id uuid)
returns public.crew_role
language sql
stable
security definer
set search_path = ''
as $$
  select cm.role
  from public.crew_members cm
  where cm.crew_id = p_crew_id
    and cm.user_id = (select auth.uid());
$$;

create or replace function public.caller_is_crew_admin(p_crew_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce is essential: a NULL role for a non-member would otherwise make
  -- PL/pgSQL guards fail open. Same class of bug as migration 000008.
  select coalesce(public.caller_crew_role(p_crew_id) in ('owner', 'admin'), false);
$$;

create or replace function public.is_friend_of_caller(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and f.user_a = least(p_other, (select auth.uid()))
      and f.user_b = greatest(p_other, (select auth.uid()))
  );
$$;

create or replace function public.is_blocked_with_caller(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_other and b.blocked_id = (select auth.uid()))
       or (b.blocker_id = (select auth.uid()) and b.blocked_id = p_other)
  );
$$;

create or replace function public.shares_crew_with_caller(p_other uuid)
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
    where a.user_id = p_other
      and b.user_id = (select auth.uid())
  );
$$;

comment on function public.caller_in_crew(uuid) is
  'Caller-scoped membership test for RLS. Cannot be used to probe other members.';
comment on function public.is_friend_of_caller(uuid) is
  'Caller-scoped friendship test. Cannot reveal relationships between other people.';

-- ----------------------------------------------------------------------------
-- 3. Repoint every policy at the caller-scoped wrappers
-- ----------------------------------------------------------------------------

-- profiles
drop policy if exists profiles_select_friends on public.profiles;
create policy profiles_select_friends
  on public.profiles
  for select
  to authenticated
  using (
    public.is_friend_of_caller(id)
    and not public.is_blocked_with_caller(id)
  );

drop policy if exists profiles_select_crew_mate on public.profiles;
create policy profiles_select_crew_mate
  on public.profiles
  for select
  to authenticated
  using (
    public.shares_crew_with_caller(id)
    and not public.is_blocked_with_caller(id)
  );

-- friendships: the "other party" is whichever side is not the caller.
drop policy if exists friendships_insert_request on public.friendships;
create policy friendships_insert_request
  on public.friendships
  for insert
  to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select auth.uid()) in (user_a, user_b)
    and status = 'pending'
    and not public.is_blocked_with_caller(
      case when user_a = (select auth.uid()) then user_b else user_a end
    )
  );

-- crews
drop policy if exists crews_select_member on public.crews;
create policy crews_select_member
  on public.crews
  for select
  to authenticated
  using (public.caller_in_crew(id));

drop policy if exists crews_update_admin on public.crews;
create policy crews_update_admin
  on public.crews
  for update
  to authenticated
  using (public.caller_is_crew_admin(id))
  with check (public.caller_is_crew_admin(id));

drop policy if exists crews_delete_owner on public.crews;
create policy crews_delete_owner
  on public.crews
  for delete
  to authenticated
  using (public.caller_crew_role(id) = 'owner');

-- crew_members
drop policy if exists crew_members_select_co_member on public.crew_members;
create policy crew_members_select_co_member
  on public.crew_members
  for select
  to authenticated
  using (public.caller_in_crew(crew_id));

drop policy if exists crew_members_update_own_preferences on public.crew_members;
create policy crew_members_update_own_preferences
  on public.crew_members
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and role = public.caller_crew_role(crew_id)
  );

drop policy if exists crew_members_update_admin_manages_roles on public.crew_members;
create policy crew_members_update_admin_manages_roles
  on public.crew_members
  for update
  to authenticated
  using (public.caller_is_crew_admin(crew_id) and role <> 'owner')
  with check (public.caller_is_crew_admin(crew_id) and role <> 'owner');

drop policy if exists crew_members_delete_self_or_admin on public.crew_members;
create policy crew_members_delete_self_or_admin
  on public.crew_members
  for delete
  to authenticated
  using (
    role <> 'owner'
    and (user_id = (select auth.uid()) or public.caller_is_crew_admin(crew_id))
  );

-- crew_invites
drop policy if exists crew_invites_select_admin on public.crew_invites;
create policy crew_invites_select_admin
  on public.crew_invites
  for select
  to authenticated
  using (public.caller_is_crew_admin(crew_id));

drop policy if exists crew_invites_insert_admin on public.crew_invites;
create policy crew_invites_insert_admin
  on public.crew_invites
  for insert
  to authenticated
  with check (
    public.caller_is_crew_admin(crew_id)
    and created_by = (select auth.uid())
  );

drop policy if exists crew_invites_update_admin on public.crew_invites;
create policy crew_invites_update_admin
  on public.crew_invites
  for update
  to authenticated
  using (public.caller_is_crew_admin(crew_id))
  with check (public.caller_is_crew_admin(crew_id));

-- ----------------------------------------------------------------------------
-- 4. Withdraw the arbitrary-argument helpers from clients
-- ----------------------------------------------------------------------------
-- Still used internally by SECURITY DEFINER functions (which run as the owner
-- and are unaffected by these grants), but no longer callable over the API.
revoke all on function public.are_friends(uuid, uuid) from public;
revoke all on function public.is_blocked_either_way(uuid, uuid) from public;
revoke all on function public.share_any_crew(uuid, uuid) from public;
revoke all on function public.is_crew_member(uuid, uuid) from public;
revoke all on function public.is_crew_admin(uuid, uuid) from public;
revoke all on function public.crew_role_of(uuid, uuid) from public;
revoke all on function public.friendship_pair(uuid, uuid) from public;

-- ----------------------------------------------------------------------------
-- 5. Correct the grants on the remaining client-facing RPCs
-- ----------------------------------------------------------------------------
-- These previously used `revoke ... from anon`, which was a no-op for the same
-- PUBLIC-grant reason. Revoke from PUBLIC, then grant deliberately.
revoke all on function public.find_profile_by_username(text) from public;
grant execute on function public.find_profile_by_username(text) to authenticated, service_role;

revoke all on function public.create_crew(text, text, integer, integer, text) from public;
grant execute on function public.create_crew(text, text, integer, integer, text)
  to authenticated, service_role;

revoke all on function public.create_crew_invite(uuid, integer, integer) from public;
grant execute on function public.create_crew_invite(uuid, integer, integer)
  to authenticated, service_role;

revoke all on function public.redeem_crew_invite(text) from public;
grant execute on function public.redeem_crew_invite(text) to authenticated, service_role;

revoke all on function public.nearby_gyms(double precision, double precision, integer, integer)
  from public;
grant execute on function public.nearby_gyms(double precision, double precision, integer, integer)
  to authenticated, service_role;

grant execute on function public.caller_in_crew(uuid) to authenticated, service_role;
grant execute on function public.caller_crew_role(uuid) to authenticated, service_role;
grant execute on function public.caller_is_crew_admin(uuid) to authenticated, service_role;
grant execute on function public.is_friend_of_caller(uuid) to authenticated, service_role;
grant execute on function public.is_blocked_with_caller(uuid) to authenticated, service_role;
grant execute on function public.shares_crew_with_caller(uuid) to authenticated, service_role;
