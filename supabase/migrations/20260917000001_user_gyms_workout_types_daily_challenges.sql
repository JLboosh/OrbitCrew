-- ============================================================================
-- Member-submitted gyms, workout types, and the daily challenge
-- ============================================================================
-- Three independent additions, in one migration because they ship together.
--
-- 1. MEMBER-SUBMITTED GYMS. The gyms migration left this explicitly to a
--    "moderated RPC" and the `gym_source` enum already has a 'user' value. This
--    supplies that RPC. There is still no INSERT policy on `public.gyms`: a
--    client cannot write the shared directory directly, only ask a validating,
--    rate-limited, duplicate-checking function to do it.
--
-- 2. WORKOUT TYPES ON SESSIONS. What the member set out to train, chosen before
--    any exercise is picked. Stored on the session rather than inferred from the
--    exercises, because intent and outcome differ: a Chest + Triceps day where
--    only the bench got logged is still a Chest + Triceps day. Legacy sessions
--    keep an empty array and the app infers a label from their exercises, so no
--    history is invalidated.
--
-- 3. THE DAILY CHALLENGE. Added the way the engine was designed to be extended:
--    a row in `challenge_templates`, not a new rule type and not new scoring
--    code. A daily challenge is a one-day personal `session_count` challenge, so
--    `score_challenge_for_user()` already knows how to score it and progress
--    cannot drift from every other challenge.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. Extra gym columns
-- ----------------------------------------------------------------------------
alter table public.gyms
  add column description text,
  add column image_url text,
  add column created_by uuid references public.profiles (id) on delete set null;

comment on column public.gyms.description is
  'Free-text description. Supplied by the member who submitted the gym.';
comment on column public.gyms.image_url is
  'Absolute http(s) link to a photo. Deliberately a URL rather than an upload: the app ships no storage bucket and no image picker, so a link is the option that works identically on web, iOS, and Android.';
comment on column public.gyms.created_by is
  'The member who submitted this gym, for source = ''user''. NULL for imported rows.';

alter table public.gyms
  add constraint gyms_description_length
    check (description is null or char_length(description) <= 1000),
  add constraint gyms_image_url_format
    check (image_url is null or image_url ~ '^https?://[^\s]{3,2000}$');

-- No constraint is added to the pre-existing `website` column. OpenStreetMap
-- records plenty of scheme-less values ("www.example.com"), so a retroactive
-- CHECK would fail validation against rows the importer already wrote. New
-- submissions are validated in `create_user_gym` instead, where a rejection can
-- be explained to the member.

-- Supports the per-member submission rate limit below.
create index gyms_created_by_idx on public.gyms (created_by) where created_by is not null;

-- ----------------------------------------------------------------------------
-- 1b. Name normalisation
-- ----------------------------------------------------------------------------
/**
 * Canonical form of a gym or street name, for duplicate detection.
 *
 * Lowercased, accent-insensitive punctuation stripped, whitespace collapsed, and
 * the filler words that make the same gym look like two different ones removed.
 * "GoodLife Fitness — Waterloo" and "goodlife fitness waterloo" both become
 * "goodlife fitness waterloo".
 *
 * IMMUTABLE so it can be used in an index expression, and deliberately not
 * trigram similarity: `pg_trgm` is another extension to enable and audit, and a
 * deterministic normalisation is easier to reason about when it decides whether
 * a member is allowed to add a gym.
 */
create or replace function public.normalise_place_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_value, '')),
          -- Anything that is not a letter, digit, or space becomes a space.
          '[^a-z0-9]+', ' ', 'g'
        ),
        -- Words that carry no distinguishing information in a gym name.
        '\y(the|a|an|and|of|at|gym|gyms|fitness|centre|center|club|studio|inc|ltd)\y',
        ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function public.normalise_place_name(text) is
  'Deterministic, IMMUTABLE canonical form of a place name, used for duplicate detection.';

revoke all on function public.normalise_place_name(text) from public;
grant execute on function public.normalise_place_name(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1c. Duplicate detection
-- ----------------------------------------------------------------------------
/**
 * Gyms that might already be the one the member is about to add.
 *
 * Three independent signals, strongest first, because "is this the same gym"
 * has no single answer:
 *
 *   same_name     - identical normalised name within 1.5 km. Two gyms with the
 *                   same name that close are the same gym.
 *   same_address  - identical normalised street address.
 *   similar_name  - one normalised name contains the other within 750 m, e.g.
 *                   "goodlife waterloo" vs "goodlife".
 *   very_close    - any gym within 120 m, i.e. plausibly the same building.
 *
 * SECURITY INVOKER (the default), so the caller's own RLS decides which gyms
 * they may see. A hidden gym is therefore not revealed by this, which is correct:
 * a gym hidden as permanently closed should not block a new submission.
 *
 * Returned rather than merely counted so the UI can name the candidate and let
 * the member open it instead of creating a second copy.
 */
create or replace function public.find_similar_gyms(
  p_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_address text default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  name text,
  address text,
  latitude double precision,
  longitude double precision,
  distance_metres double precision,
  match_reason text,
  is_probable_duplicate boolean
)
language sql
stable
set search_path = ''
as $$
  with origin as (
    select extensions.ST_SetSRID(
             extensions.ST_MakePoint(p_longitude, p_latitude),
             4326
           )::extensions.geography as point
  ),
  wanted as (
    select
      public.normalise_place_name(p_name) as norm_name,
      public.normalise_place_name(p_address) as norm_address
  ),
  candidates as (
    select
      g.id,
      g.name,
      g.address,
      extensions.ST_Y(g.location::extensions.geometry) as latitude,
      extensions.ST_X(g.location::extensions.geometry) as longitude,
      extensions.ST_Distance(g.location, o.point) as distance_metres,
      public.normalise_place_name(g.name) as norm_name,
      public.normalise_place_name(g.address) as norm_address,
      w.norm_name as wanted_name,
      w.norm_address as wanted_address
    from public.gyms g
    cross join origin o
    cross join wanted w
    where g.hidden_at is null
      and extensions.ST_DWithin(g.location, o.point, 1500)
  )
  select
    c.id,
    c.name,
    c.address,
    c.latitude,
    c.longitude,
    c.distance_metres,
    case
      when c.wanted_name is not null and c.norm_name = c.wanted_name
        then 'same_name'
      when c.wanted_address is not null and c.norm_address = c.wanted_address
        then 'same_address'
      when c.wanted_name is not null
       and c.norm_name is not null
       and char_length(c.wanted_name) >= 4
       and c.distance_metres <= 750
       and (position(c.wanted_name in c.norm_name) > 0
            or position(c.norm_name in c.wanted_name) > 0)
        then 'similar_name'
      else 'very_close'
    end as match_reason,
    -- A probable duplicate is one we are confident enough about to require the
    -- member to acknowledge it before a second row is created.
    (
      (c.wanted_name is not null and c.norm_name = c.wanted_name)
      or (c.wanted_address is not null and c.norm_address = c.wanted_address)
    ) as is_probable_duplicate
  from candidates c
  where
    (c.wanted_name is not null and c.norm_name = c.wanted_name)
    or (c.wanted_address is not null and c.norm_address = c.wanted_address)
    or (
      c.wanted_name is not null
      and c.norm_name is not null
      and char_length(c.wanted_name) >= 4
      and c.distance_metres <= 750
      and (position(c.wanted_name in c.norm_name) > 0
           or position(c.norm_name in c.wanted_name) > 0)
    )
    or c.distance_metres <= 120
  order by c.distance_metres
  limit greatest(least(p_limit, 25), 1);
$$;

comment on function public.find_similar_gyms(text, double precision, double precision, text, integer) is
  'Possible duplicates for a gym about to be submitted. Runs as the caller, so RLS still applies.';

revoke all on function public.find_similar_gyms(
  text, double precision, double precision, text, integer
) from public, anon;
grant execute on function public.find_similar_gyms(
  text, double precision, double precision, text, integer
) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1d. Submitting a gym
-- ----------------------------------------------------------------------------
/**
 * Adds a member-submitted gym to the shared directory.
 *
 * WHY AN RPC AND NOT AN INSERT POLICY
 * -----------------------------------
 * `public.gyms` is shared by every member, so a client-side INSERT would let one
 * account vandalise the directory for everyone. This function is the moderated
 * path the original gyms migration promised: it forces `source = 'user'`,
 * records `created_by`, validates every field, rate-limits submissions, and
 * refuses a duplicate. The table still has no INSERT policy.
 *
 * SECURITY DEFINER is therefore load-bearing, which makes the grants below part
 * of the security boundary rather than boilerplate. Postgres grants EXECUTE to
 * PUBLIC by default and Supabase adds an `authenticated` grant of its own, so a
 * `revoke ... from authenticated` alone would leave the function callable — the
 * revoke has to name public, anon, and authenticated. That exact mistake made an
 * earlier gym-directory write function callable by any member.
 *
 * DUPLICATES. A probable duplicate (same normalised name nearby, or the same
 * street address) is rejected unless the caller passes
 * `p_confirm_possible_duplicate`, which the UI only sets after showing the member
 * the candidate. A near-certain duplicate — same normalised name within 400 m —
 * is rejected outright, because at that distance it is not a judgement call.
 */
create or replace function public.create_user_gym(
  p_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_address text default null,
  p_city text default null,
  p_country_code text default null,
  p_description text default null,
  p_website text default null,
  p_image_url text default null,
  p_confirm_possible_duplicate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_country text := nullif(upper(btrim(coalesce(p_country_code, ''))), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_image text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_recent integer;
  v_certain record;
  v_probable record;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Must be signed in to add a gym' using errcode = '42501';
  end if;

  -- ---- Field validation. Stated in member-facing language, because these
  -- ---- messages are shown verbatim by the form.
  if char_length(v_name) < 2 or char_length(v_name) > 200 then
    raise exception 'Give the gym a name between 2 and 200 characters'
      using errcode = '22023';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Pick a location on the map first' using errcode = '22023';
  end if;

  if v_address is not null and char_length(v_address) > 300 then
    raise exception 'That address is too long' using errcode = '22023';
  end if;

  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Keep the description under 1000 characters' using errcode = '22023';
  end if;

  if v_website is not null and v_website !~ '^https?://[^\s]{3,2000}$' then
    raise exception 'The website needs to start with http:// or https://'
      using errcode = '22023';
  end if;

  if v_image is not null and v_image !~ '^https?://[^\s]{3,2000}$' then
    raise exception 'The image link needs to start with http:// or https://'
      using errcode = '22023';
  end if;

  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'Country code must be two letters, e.g. CA' using errcode = '22023';
  end if;

  -- ---- Rate limit. Adding a gym is a rare, deliberate act; five a day is far
  -- ---- more than a real member needs and low enough to make bulk spam useless.
  select count(*) into v_recent
  from public.gyms g
  where g.created_by = v_user
    and g.created_at > now() - interval '24 hours';

  if v_recent >= 5 then
    raise exception 'You have added five gyms today. Try again tomorrow.'
      using errcode = '22023';
  end if;

  -- ---- Near-certain duplicate: never allowed, not even with confirmation.
  select g.id, g.name into v_certain
  from public.gyms g
  where g.hidden_at is null
    and public.normalise_place_name(g.name) is not null
    and public.normalise_place_name(g.name) = public.normalise_place_name(v_name)
    and extensions.ST_DWithin(
          g.location,
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(p_longitude, p_latitude), 4326
          )::extensions.geography,
          400
        )
  limit 1;

  if v_certain.id is not null then
    raise exception '% is already in the directory at this location', v_certain.name
      using errcode = '23505';
  end if;

  -- ---- Probable duplicate: allowed only once the member has seen it.
  if not coalesce(p_confirm_possible_duplicate, false) then
    -- Asks for ten and filters here, rather than asking for one: the function
    -- orders by distance, so a limit of 1 could return the nearest unrelated gym
    -- and miss the probable duplicate 300 m further out.
    select s.id, s.name into v_probable
    from public.find_similar_gyms(v_name, p_latitude, p_longitude, v_address, 10) s
    where s.is_probable_duplicate
    limit 1;

    if v_probable.id is not null then
      raise exception '% looks like the same gym. Confirm to add it anyway.', v_probable.name
        using errcode = '23505';
    end if;
  end if;

  insert into public.gyms (
    name, location, address, city, country_code,
    description, website, image_url, source, created_by
  )
  values (
    v_name,
    extensions.ST_SetSRID(
      extensions.ST_MakePoint(p_longitude, p_latitude), 4326
    )::extensions.geography,
    v_address,
    v_city,
    v_country,
    v_description,
    v_website,
    v_image,
    -- Forced, not taken from the caller: a client cannot mint a 'verified' gym.
    'user',
    v_user
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_user_gym is
  'Moderated path for member-submitted gyms: validates, rate-limits, and refuses duplicates. The gyms table has no INSERT policy by design.';

-- Naming all three is required. A revoke from `authenticated` alone leaves the
-- PUBLIC grant in place and the function stays callable.
revoke all on function public.create_user_gym(
  text, double precision, double precision, text, text, text, text, text, text, boolean
) from public, anon;
grant execute on function public.create_user_gym(
  text, double precision, double precision, text, text, text, text, text, text, boolean
) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Workout types on sessions
-- ----------------------------------------------------------------------------
alter table public.sessions
  add column workout_categories text[] not null default '{}'::text[];

comment on column public.sessions.workout_categories is
  'What the member chose to train, e.g. {chest,triceps}. Empty for sessions logged before workout types existed; the app infers a label from their exercises instead.';

-- Validated against a fixed vocabulary rather than a foreign key: these are
-- presentation categories owned by the app, and a CHECK keeps the constraint
-- visible in one place. Values deliberately mirror `muscle_group` where they
-- overlap, so exercise filtering is a direct mapping.
alter table public.sessions
  add constraint sessions_workout_categories_valid check (
    array_length(workout_categories, 1) is null
    or (
      array_length(workout_categories, 1) <= 4
      and workout_categories <@ array[
        'legs', 'arms', 'chest', 'back', 'shoulders', 'core', 'cardio',
        'full_body', 'custom',
        'quads', 'hamstrings', 'glutes', 'calves', 'biceps', 'triceps', 'forearms'
      ]::text[]
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Exercise notes
-- ----------------------------------------------------------------------------
alter table public.exercises
  add column description text;

comment on column public.exercises.description is
  'Optional note the member wrote when creating a custom exercise, e.g. setup or cues.';

alter table public.exercises
  add constraint exercises_description_length
    check (description is null or char_length(description) <= 500);

-- ----------------------------------------------------------------------------
-- 3b. Filling gaps in the canonical library
-- ----------------------------------------------------------------------------
-- The workout-type picker filters the library down to one muscle group at a
-- time, which exposed movements a member would expect to find there and did not.
-- Added as canonical rows (created_by IS NULL) so everyone gets them.
insert into public.exercises (name, primary_muscle, equipment, is_weighted) values
  ('Cable Crossover', 'chest', 'cable', true),
  ('Decline Bench Press', 'chest', 'barbell', true),
  ('Straight-Arm Pulldown', 'back', 'cable', true),
  ('Chest-Supported Row', 'back', 'machine', true),
  ('Front Raise', 'shoulders', 'dumbbell', true),
  ('Arnold Press', 'shoulders', 'dumbbell', true),
  ('Upright Row', 'shoulders', 'barbell', true),
  ('Skull Crusher', 'triceps', 'barbell', true),
  ('Concentration Curl', 'biceps', 'dumbbell', true),
  ('Cable Curl', 'biceps', 'cable', true),
  ('Wrist Curl', 'forearms', 'dumbbell', true),
  ('Farmer''s Carry', 'forearms', 'dumbbell', true),
  ('Ab Wheel Rollout', 'core', 'other', false),
  ('Side Plank', 'core', 'bodyweight', false),
  ('Dead Bug', 'core', 'bodyweight', false),
  ('Goblet Squat', 'quads', 'kettlebell', true),
  ('Hack Squat', 'quads', 'machine', true),
  ('Step-Up', 'quads', 'dumbbell', true),
  ('Good Morning', 'hamstrings', 'barbell', true),
  ('Nordic Curl', 'hamstrings', 'bodyweight', false),
  ('Glute Bridge', 'glutes', 'bodyweight', false),
  ('Cable Kickback', 'glutes', 'cable', true),
  ('Seated Calf Raise', 'calves', 'machine', true),
  ('Jump Rope', 'cardio', 'other', false),
  ('Incline Walk', 'cardio', 'cardio_machine', false),
  ('Assault Bike', 'cardio', 'cardio_machine', false)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 4. The daily challenge
-- ----------------------------------------------------------------------------
-- A one-day personal `session_count` challenge. No new rule type, no new scoring
-- branch: `score_challenge_for_user()` already counts finished sessions inside a
-- window, and the window here is one day in the MEMBER'S OWN timezone.
--
-- WHY ONE ROW PER MEMBER PER DAY rather than a single perpetual challenge:
-- progress, completion, and the reset are then exactly what they are for every
-- other challenge, and "did I do it on Tuesday" is answerable from
-- `challenge_participants` without inventing a second progress model.
insert into public.challenge_templates
  (key, name, description, rule_type, default_rule, default_scope,
   default_duration_days, badge_key, badge_emoji)
values
  ('daily_session',
   'Daily Challenge',
   'Train once today. Resets tomorrow morning.',
   'session_count',
   '{"target": 1}'::jsonb,
   'personal',
   1,
   -- No badge_key on purpose: a badge earned every single day stops meaning
   -- anything, and `rescore_challenge` skips the award entirely when it is NULL.
   null,
   '🔥')
on conflict (key) do nothing;

/**
 * One daily challenge per member per calendar day.
 *
 * The day is carried in the rule as `{"day": "2026-09-17"}` and indexed from
 * there rather than derived from `starts_at`. Deriving it would need
 * `starts_at at time zone timezone`, which is STABLE rather than IMMUTABLE
 * because `timezone` is a column, and Postgres will not index a stable
 * expression. Carrying the member's local date explicitly also makes the row
 * self-describing.
 *
 * This is what makes "make sure today's challenge exists" safe to call from two
 * devices at once: the loser of the race gets a unique violation and re-reads.
 */
create unique index challenges_one_daily_per_owner_day_idx
  on public.challenges (owner_id, template_key, (rule ->> 'day'))
  where template_key = 'daily_session' and owner_id is not null;

-- Supports "my daily challenges, newest first", which the streak line reads.
create index challenges_owner_template_idx
  on public.challenges (owner_id, template_key, starts_at desc)
  where owner_id is not null;
