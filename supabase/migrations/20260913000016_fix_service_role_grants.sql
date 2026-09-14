-- ============================================================================
-- SECURITY FIX: revoking from PUBLIC is not enough on Supabase
-- ============================================================================
-- THE BUG
-- -------
-- Migration 000011 fixed one half of this problem: PostgreSQL grants EXECUTE on
-- new functions to PUBLIC, so `revoke ... from authenticated` alone is a no-op.
--
-- But Supabase ALSO configures default privileges along the lines of
--
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- so every new function receives an EXPLICIT grant to `authenticated` as well.
-- Revoking from PUBLIC does not remove an explicit role grant, which means
-- `purge_expired_presence()` — intended to be server-side only — was callable by
-- any signed-in member. Caught by scripts/verify-training.mjs.
--
-- Being able to purge expired presence is low severity on its own (RLS already
-- hides expired rows, and the data is deleted either way). What matters is the
-- PATTERN: any function meant to be service-role only must be revoked from
-- `public`, `anon`, AND `authenticated`, and should additionally guard itself.
--
-- `upsert_osm_gym` was affected identically, but its internal JWT role check
-- blocked the call, which is precisely why that check was added. Defence in
-- depth is what kept a grant mistake from becoming an exploitable hole.
--
-- RULE FOR THIS CODEBASE: a service-role-only function needs BOTH
--   1. revoke all ... from public, anon, authenticated;
--   2. an internal check that raises if the JWT role is not service_role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Presence cleanup: server-side only
-- ----------------------------------------------------------------------------
create or replace function public.purge_expired_presence()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_jwt_role text;
begin
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );

  -- NULL means there is no JWT at all, i.e. a trusted server session such as a
  -- migration or a pg_cron job. A present-but-wrong role is a client call.
  if v_jwt_role is not null and v_jwt_role <> 'service_role' then
    raise exception 'Presence cleanup is restricted to trusted server-side code'
      using errcode = '42501';
  end if;

  delete from public.presence where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_expired_presence() is
  'Deletes expired presence. Service-role only, enforced by grants AND an internal check.';

revoke all on function public.purge_expired_presence() from public, anon, authenticated;
grant execute on function public.purge_expired_presence() to service_role;

-- ----------------------------------------------------------------------------
-- 2. Gym importer: close the grant half of the hole too
-- ----------------------------------------------------------------------------
-- The internal check already blocked member calls; this makes the grants agree
-- with the intent so the function is not merely defended but unreachable.
revoke all on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 3. Withdraw arbitrary-argument helpers from `authenticated` as well
-- ----------------------------------------------------------------------------
-- Migration 000011 revoked these from PUBLIC so members could not probe other
-- people's relationships, but the explicit `authenticated` grant survived. The
-- caller-scoped wrappers remain available and are what every policy uses.
revoke all on function public.are_friends(uuid, uuid) from anon, authenticated;
revoke all on function public.is_blocked_either_way(uuid, uuid) from anon, authenticated;
revoke all on function public.share_any_crew(uuid, uuid) from anon, authenticated;
revoke all on function public.is_crew_member(uuid, uuid) from anon, authenticated;
revoke all on function public.is_crew_admin(uuid, uuid) from anon, authenticated;
revoke all on function public.crew_role_of(uuid, uuid) from anon, authenticated;
revoke all on function public.friendship_pair(uuid, uuid) from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Withdraw everything client-facing from `anon`
-- ----------------------------------------------------------------------------
-- None of these are meaningful before sign-in, and several are SECURITY DEFINER.
-- Unauthenticated callers should not reach them at all.
revoke all on function public.find_profile_by_username(text) from anon;
revoke all on function public.create_crew(text, text, integer, integer, text) from anon;
revoke all on function public.create_crew_invite(uuid, integer, integer) from anon;
revoke all on function public.redeem_crew_invite(text) from anon;
revoke all on function public.nearby_gyms(double precision, double precision, integer, integer)
  from anon;
revoke all on function public.caller_in_crew(uuid) from anon;
revoke all on function public.caller_crew_role(uuid) from anon;
revoke all on function public.caller_is_crew_admin(uuid) from anon;
revoke all on function public.is_friend_of_caller(uuid) from anon;
revoke all on function public.is_blocked_with_caller(uuid) from anon;
revoke all on function public.shares_crew_with_caller(uuid) from anon;
revoke all on function public.can_see_presence_of(uuid) from anon;
revoke all on function public.check_in(uuid, uuid, integer) from anon;
revoke all on function public.check_out() from anon;
revoke all on function public.gym_presence(uuid) from anon;
revoke all on function public.gym_friend_visits(uuid) from anon;
revoke all on function public.end_session(uuid) from anon;
revoke all on function public.session_counts_for_crew(uuid, uuid) from anon;
revoke all on function public.exercise_progress() from anon;
revoke all on function public.weekly_training_summary(integer) from anon;
revoke all on function public.training_streak() from anon;
revoke all on function public.week_start(timestamptz, text) from anon;
revoke all on function public.score_challenge_for_user(uuid, uuid) from anon;
revoke all on function public.rescore_challenge(uuid) from anon;
revoke all on function public.crew_weekly_leaderboard(uuid, integer) from anon;
revoke all on function public.crew_weekly_progress(uuid) from anon;
