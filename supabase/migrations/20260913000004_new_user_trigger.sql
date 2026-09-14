-- ============================================================================
-- New-user provisioning trigger
-- ============================================================================
-- Creates a profile AND a privacy_settings row the moment an auth user is
-- created. Both in one trigger, in one transaction, so a user can never exist
-- without private-by-default privacy settings. A missing privacy row would be
-- ambiguous, and ambiguity in a privacy check is a failure mode we refuse to
-- allow.
--
-- The client never inserts these rows; neither table has an INSERT policy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Generate a unique, valid username
-- ----------------------------------------------------------------------------
-- Signup must never fail because of a username collision, so this derives a
-- candidate then deterministically resolves conflicts.
create or replace function public.generate_unique_username(p_seed text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix int := 0;
begin
  -- Strip everything that is not a permitted username character.
  v_base := regexp_replace(coalesce(p_seed, ''), '[^A-Za-z0-9_]', '', 'g');

  -- Guarantee the minimum length of 3 required by the profiles CHECK constraint.
  if char_length(v_base) < 3 then
    v_base := 'lifter' || v_base;
  end if;

  -- Leave room for a numeric suffix within the 24-character limit.
  v_base := substring(v_base from 1 for 18);

  v_candidate := v_base;

  -- Compare as lowercased text rather than citext: the citext equality operator
  -- lives in the `extensions` schema, which is not reachable under the pinned
  -- empty search_path.
  while exists (
    select 1
    from public.profiles
    where lower(username::text) = lower(v_candidate)
  ) loop
    v_suffix := v_suffix + 1;

    -- After a few sequential attempts, switch to randomness to avoid scanning a
    -- long run of taken names (e.g. alex1, alex2, ... alex99).
    if v_suffix <= 5 then
      v_candidate := v_base || v_suffix::text;
    else
      v_candidate := v_base || (floor(random() * 900000) + 100000)::int::text;
    end if;
  end loop;

  return v_candidate;
end;
$$;

comment on function public.generate_unique_username(text) is
  'Derives a collision-free username from a seed so signup cannot fail on a duplicate handle.';

-- ----------------------------------------------------------------------------
-- Trigger function
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
-- SECURITY DEFINER is required: the inserting role during signup is not the new
-- user, and both tables deliberately lack INSERT policies.
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_display_name text;
  v_timezone text;
begin
  -- Prefer a username supplied at signup, otherwise derive one from the email
  -- local part.
  v_username := public.generate_unique_username(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'lifter'
    )
  );

  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    v_username
  );

  -- Only trust a client-supplied timezone if Postgres recognises it; otherwise
  -- fall back to UTC. An invalid value would violate the CHECK constraint and
  -- abort signup.
  v_timezone := nullif(new.raw_user_meta_data ->> 'timezone', '');
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_timezone
  ) then
    v_timezone := 'UTC';
  end if;

  insert into public.profiles (id, username, display_name, timezone)
  values (
    new.id,
    -- Explicit schema-qualified cast: the implicit text -> citext cast is not
    -- reachable under the pinned empty search_path.
    v_username::extensions.citext,
    substring(v_display_name from 1 for 50),
    v_timezone
  );

  -- Privacy defaults come from the column defaults, which are the most private
  -- values. Inserting only the key is deliberate: it means adding a new privacy
  -- column with a private default automatically applies to new users without
  -- touching this function.
  insert into public.privacy_settings (user_id)
  values (new.id);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Provisions a profile and private-by-default privacy_settings row for each new auth user.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
