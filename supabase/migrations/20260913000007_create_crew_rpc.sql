-- ============================================================================
-- Crew creation RPC
-- ============================================================================
-- WHY THIS EXISTS
-- ---------------
-- Creating a crew via a plain `INSERT ... RETURNING` cannot work, and the
-- failure is subtle enough to be worth recording:
--
--   1. `crews_select_member` requires membership to see a crew.
--   2. Owner membership is created by an AFTER INSERT trigger.
--   3. PostgreSQL evaluates the RETURNING clause's SELECT policy BEFORE AFTER
--      triggers fire.
--
-- So at the moment RETURNING is evaluated the creator is not yet a member, the
-- row is invisible to them, and PostgREST reports
-- "new row violates row-level security policy". The row was actually written;
-- only the read-back failed. That is a confusing failure to inherit.
--
-- Rather than paper over it with an extra SELECT policy, crew creation now has
-- one sanctioned path, exactly like joining does via redeem_crew_invite().
-- The direct INSERT policy is removed so there is no second, broken route.
-- ============================================================================

drop policy if exists crews_insert_self_as_creator on public.crews;

create or replace function public.create_crew(
  p_name text,
  p_timezone text default 'UTC',
  p_weekly_target_sessions integer default 12,
  p_min_session_minutes integer default 20,
  p_description text default null
)
returns public.crews
language plpgsql
-- SECURITY DEFINER so the crew row and its owner membership are both created
-- and returned in one call, without depending on policy/trigger ordering.
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_crew public.crews;
begin
  if v_user is null then
    raise exception 'Must be signed in to create a crew'
      using errcode = '42501';
  end if;

  -- Validate the timezone explicitly: the CHECK constraint would otherwise
  -- abort with a message that does not explain which input was wrong.
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown timezone: %', p_timezone
      using errcode = '22023';
  end if;

  insert into public.crews (
    name,
    description,
    timezone,
    weekly_target_sessions,
    min_session_minutes,
    created_by
  )
  values (
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    p_timezone,
    p_weekly_target_sessions,
    p_min_session_minutes,
    v_user
  )
  returning * into v_crew;

  -- The on_crew_created trigger has now added the owner membership, so the
  -- caller can immediately see the crew through normal RLS afterwards.
  return v_crew;
end;
$$;

comment on function public.create_crew(text, text, integer, integer, text) is
  'The only client path to create a crew. Returns the crew with the caller enrolled as owner.';

revoke execute on function public.create_crew(text, text, integer, integer, text) from anon;
