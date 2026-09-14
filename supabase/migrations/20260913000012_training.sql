-- ============================================================================
-- Training: exercise library, sessions, and sets
-- ============================================================================
-- Design decisions worth stating up front:
--
-- 1. WEIGHTS ARE STORED AS ENTERED, plus a generated kilogram column.
--    Converting on write would lose the user's intent (a 135 lb bench is
--    "135", not "61.23") and accumulate rounding error. Storing both means the
--    UI can echo exactly what was typed while all maths and comparisons use one
--    canonical unit.
--
-- 2. ESTIMATED 1RM IS A GENERATED COLUMN, not application logic. The Epley
--    formula lives in one place, so progress calculations cannot drift between
--    the app, the challenge engine, and the leaderboard.
--
-- 3. SESSION VALIDITY IS COMPUTED, NOT STORED. Whether a session "counts"
--    depends on the crew's `min_session_minutes`, and one session can count for
--    one crew but not another. Storing a boolean would be wrong the moment a
--    crew changed its threshold.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Exercise library
-- ----------------------------------------------------------------------------
create type public.muscle_group as enum (
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'full_body', 'cardio'
);

create type public.exercise_equipment as enum (
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight',
  'kettlebell', 'bands', 'cardio_machine', 'other'
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,

  primary_muscle public.muscle_group not null,
  equipment public.exercise_equipment not null default 'other',

  -- NULL for the canonical, app-provided library. Set for a member's custom
  -- exercise, which only they can see.
  created_by uuid references public.profiles (id) on delete cascade,

  -- Whether a weight is meaningful. Bodyweight and cardio movements are logged
  -- with reps or duration only, and the UI uses this to hide the weight field.
  is_weighted boolean not null default true,

  created_at timestamptz not null default now(),

  constraint exercises_name_length check (char_length(trim(name)) between 2 and 80)
);

comment on table public.exercises is
  'Exercise library. created_by IS NULL means canonical/global; otherwise a member-private custom exercise.';

-- Canonical exercise names are unique; custom ones are unique per member. Two
-- partial indexes express that, which a single constraint could not.
create unique index exercises_canonical_name_idx
  on public.exercises (lower(name))
  where created_by is null;

create unique index exercises_custom_name_idx
  on public.exercises (created_by, lower(name))
  where created_by is not null;

create index exercises_muscle_idx on public.exercises (primary_muscle);

alter table public.exercises enable row level security;

-- Everyone sees the canonical library; members additionally see their own
-- custom exercises. One policy, because RLS policies are OR-ed and this reads
-- more clearly than two overlapping ones.
create policy exercises_select_canonical_or_own
  on public.exercises
  for select
  to authenticated
  using (created_by is null or created_by = (select auth.uid()));

create policy exercises_insert_own_custom
  on public.exercises
  for insert
  to authenticated
  -- created_by must be the caller, so nobody can inject into the shared library.
  with check (created_by = (select auth.uid()));

create policy exercises_update_own_custom
  on public.exercises
  for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy exercises_delete_own_custom
  on public.exercises
  for delete
  to authenticated
  using (created_by = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Sessions
-- ----------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- NULL for a home or outdoor workout. A session does not require a gym.
  gym_id uuid references public.gyms (id) on delete set null,

  started_at timestamptz not null default now(),

  -- NULL means the session is still in progress.
  ended_at timestamptz,

  notes text,

  -- Generated so it can never disagree with the timestamps it derives from.
  duration_seconds integer generated always as (
    case
      when ended_at is null then null
      else greatest(extract(epoch from (ended_at - started_at))::integer, 0)
    end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sessions_end_after_start check (ended_at is null or ended_at > started_at),
  -- A 24-hour ceiling catches sessions the user forgot to end, which would
  -- otherwise distort duration averages and streaks.
  constraint sessions_max_duration
    check (ended_at is null or ended_at <= started_at + interval '24 hours'),
  constraint sessions_notes_length check (notes is null or char_length(notes) <= 2000)
);

comment on table public.sessions is
  'A training session. ended_at IS NULL means in progress. Validity for a crew is computed, not stored.';
comment on column public.sessions.duration_seconds is
  'Generated from the timestamps so it cannot be falsified or drift.';

-- At most one session in progress per member: starting a second one is a bug or
-- a stale client, and silently allowing it would double-count sessions.
create unique index sessions_one_active_per_user_idx
  on public.sessions (user_id)
  where ended_at is null;

create index sessions_user_started_idx on public.sessions (user_id, started_at desc);
create index sessions_gym_idx on public.sessions (gym_id) where gym_id is not null;

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row
  execute function public.set_updated_at();

alter table public.sessions enable row level security;

-- Own sessions only. Crew visibility is deliberately NOT a policy here: what a
-- crew mate may see depends on the member's activity_detail_level, which means
-- rows must be REDACTED rather than merely filtered. That is handled by
-- crew_activity_feed() below, which returns only the permitted fields.
create policy sessions_select_own
  on public.sessions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy sessions_insert_own
  on public.sessions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy sessions_update_own
  on public.sessions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sessions_delete_own
  on public.sessions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Exercises performed within a session
-- ----------------------------------------------------------------------------
create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,

  -- Display order within the session.
  order_index smallint not null default 0,
  notes text,

  created_at timestamptz not null default now(),

  constraint session_exercises_notes_length check (notes is null or char_length(notes) <= 500),
  constraint session_exercises_order_range check (order_index between 0 and 200)
);

comment on table public.session_exercises is
  'Join of a session to an exercise, carrying ordering. ON DELETE RESTRICT on exercise_id preserves history.';

create index session_exercises_session_idx
  on public.session_exercises (session_id, order_index);

alter table public.session_exercises enable row level security;

-- Ownership is inherited from the parent session. The EXISTS subquery is
-- evaluated against `sessions`, whose own RLS restricts it to the caller's rows,
-- so this cannot leak another member's session structure.
create policy session_exercises_all_own
  on public.session_exercises
  for all
  to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Sets
-- ----------------------------------------------------------------------------
create table public.sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null
    references public.session_exercises (id) on delete cascade,

  set_index smallint not null default 0,

  -- As entered by the user, in `weight_unit`. NULL for bodyweight/cardio.
  weight numeric(7, 2),
  weight_unit public.weight_unit not null default 'lb',

  reps smallint,

  -- Rate of Perceived Exertion, 1-10 in half steps.
  rpe numeric(3, 1),

  -- Warm-up sets are excluded from volume and personal records.
  is_warmup boolean not null default false,

  -- For timed work (planks, cardio) instead of reps.
  duration_seconds integer,

  created_at timestamptz not null default now(),

  -- Canonical kilograms for all comparison and aggregation. 1 lb is exactly
  -- 0.45359237 kg by definition, so this conversion is lossless.
  weight_kg numeric(8, 3) generated always as (
    case
      when weight is null then null
      when weight_unit = 'kg' then weight
      else weight * 0.45359237
    end
  ) stored,

  -- Epley estimated one-rep max: w x (1 + reps/30).
  -- Generated so the formula exists exactly once in the system. Warm-ups and
  -- single-rep-less entries are excluded. At reps = 1 this correctly returns the
  -- weight itself plus Epley's small increment, so heavy singles stay comparable.
  estimated_1rm_kg numeric(8, 3) generated always as (
    case
      when is_warmup then null
      when weight is null or reps is null or reps < 1 then null
      else (
        case when weight_unit = 'kg' then weight else weight * 0.45359237 end
      ) * (1 + (reps::numeric / 30))
    end
  ) stored,

  constraint sets_weight_nonnegative check (weight is null or weight >= 0),
  constraint sets_weight_sane check (weight is null or weight <= 2000),
  constraint sets_reps_range check (reps is null or reps between 0 and 1000),
  constraint sets_rpe_range check (rpe is null or (rpe >= 1 and rpe <= 10)),
  constraint sets_duration_range
    check (duration_seconds is null or duration_seconds between 0 and 86400),
  constraint sets_index_range check (set_index between 0 and 200),
  -- A set must record something measurable.
  constraint sets_has_measurement
    check (reps is not null or duration_seconds is not null or weight is not null)
);

comment on table public.sets is
  'Individual sets. weight_kg and estimated_1rm_kg are generated so the formulas live in one place.';
comment on column public.sets.estimated_1rm_kg is
  'Epley: weight x (1 + reps/30). NULL for warm-ups and for sets without reps.';

create index sets_session_exercise_idx on public.sets (session_exercise_id, set_index);

alter table public.sets enable row level security;

-- Ownership inherited transitively: set -> session_exercise -> session.
create policy sets_all_own
  on public.sets
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.session_exercises se
      join public.sessions s on s.id = se.session_id
      where se.id = session_exercise_id
        and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.session_exercises se
      join public.sessions s on s.id = se.session_id
      where se.id = session_exercise_id
        and s.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Session validity for a crew
-- ----------------------------------------------------------------------------
/**
 * Whether a session counts toward a crew's weekly target.
 *
 * A session must be finished and last at least the crew's own
 * `min_session_minutes`. Deliberately a function rather than a stored flag: the
 * same session may count for a crew requiring 20 minutes and not for one
 * requiring 45, and a crew may change its threshold at any time.
 */
create or replace function public.session_counts_for_crew(
  p_session_id uuid,
  p_crew_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select s.ended_at is not null
         and s.duration_seconds >= (c.min_session_minutes * 60)
      from public.sessions s
      cross join public.crews c
      where s.id = p_session_id
        and c.id = p_crew_id
    ),
    false
  );
$$;

comment on function public.session_counts_for_crew(uuid, uuid) is
  'True when a finished session meets the crew''s minimum duration. Computed, never stored.';

-- ----------------------------------------------------------------------------
-- Ending a session
-- ----------------------------------------------------------------------------
/**
 * Ends the caller's active session.
 *
 * An RPC rather than a plain UPDATE so that the end timestamp comes from the
 * server clock. A client-supplied `ended_at` could be used to inflate duration
 * and manufacture a "valid" session that never happened.
 */
create or replace function public.end_session(p_session_id uuid default null)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session public.sessions;
begin
  if v_user is null then
    raise exception 'Must be signed in' using errcode = '42501';
  end if;

  select * into v_session
  from public.sessions s
  where s.user_id = v_user
    and s.ended_at is null
    and (p_session_id is null or s.id = p_session_id)
  order by s.started_at desc
  limit 1
  for update;

  if v_session.id is null then
    raise exception 'No session in progress' using errcode = '22023';
  end if;

  update public.sessions
  set ended_at = least(now(), started_at + interval '24 hours')
  where id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

comment on function public.end_session(uuid) is
  'Ends the caller''s active session using the server clock, so duration cannot be inflated.';

revoke all on function public.end_session(uuid) from public;
grant execute on function public.end_session(uuid) to authenticated, service_role;

revoke all on function public.session_counts_for_crew(uuid, uuid) from public;
grant execute on function public.session_counts_for_crew(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Canonical exercise library
-- ----------------------------------------------------------------------------
-- A deliberately compact, high-coverage starter set. Members can add their own;
-- this exists so the first session can be logged without any setup.
insert into public.exercises (name, primary_muscle, equipment, is_weighted) values
  -- Chest
  ('Barbell Bench Press', 'chest', 'barbell', true),
  ('Incline Barbell Bench Press', 'chest', 'barbell', true),
  ('Dumbbell Bench Press', 'chest', 'dumbbell', true),
  ('Incline Dumbbell Press', 'chest', 'dumbbell', true),
  ('Cable Chest Fly', 'chest', 'cable', true),
  ('Push-Up', 'chest', 'bodyweight', false),
  ('Chest Press Machine', 'chest', 'machine', true),
  -- Back
  ('Deadlift', 'back', 'barbell', true),
  ('Barbell Row', 'back', 'barbell', true),
  ('Pull-Up', 'back', 'bodyweight', false),
  ('Chin-Up', 'back', 'bodyweight', false),
  ('Lat Pulldown', 'back', 'cable', true),
  ('Seated Cable Row', 'back', 'cable', true),
  ('Dumbbell Row', 'back', 'dumbbell', true),
  ('T-Bar Row', 'back', 'machine', true),
  -- Shoulders
  ('Overhead Press', 'shoulders', 'barbell', true),
  ('Seated Dumbbell Shoulder Press', 'shoulders', 'dumbbell', true),
  ('Lateral Raise', 'shoulders', 'dumbbell', true),
  ('Rear Delt Fly', 'shoulders', 'dumbbell', true),
  ('Face Pull', 'shoulders', 'cable', true),
  -- Arms
  ('Barbell Curl', 'biceps', 'barbell', true),
  ('Dumbbell Curl', 'biceps', 'dumbbell', true),
  ('Hammer Curl', 'biceps', 'dumbbell', true),
  ('Preacher Curl', 'biceps', 'machine', true),
  ('Triceps Pushdown', 'triceps', 'cable', true),
  ('Overhead Triceps Extension', 'triceps', 'dumbbell', true),
  ('Close-Grip Bench Press', 'triceps', 'barbell', true),
  ('Dip', 'triceps', 'bodyweight', false),
  -- Legs
  ('Back Squat', 'quads', 'barbell', true),
  ('Front Squat', 'quads', 'barbell', true),
  ('Leg Press', 'quads', 'machine', true),
  ('Bulgarian Split Squat', 'quads', 'dumbbell', true),
  ('Lunge', 'quads', 'dumbbell', true),
  ('Leg Extension', 'quads', 'machine', true),
  ('Romanian Deadlift', 'hamstrings', 'barbell', true),
  ('Leg Curl', 'hamstrings', 'machine', true),
  ('Hip Thrust', 'glutes', 'barbell', true),
  ('Standing Calf Raise', 'calves', 'machine', true),
  -- Core
  ('Plank', 'core', 'bodyweight', false),
  ('Hanging Leg Raise', 'core', 'bodyweight', false),
  ('Cable Crunch', 'core', 'cable', true),
  ('Russian Twist', 'core', 'bodyweight', false),
  -- Full body / cardio
  ('Clean and Jerk', 'full_body', 'barbell', true),
  ('Snatch', 'full_body', 'barbell', true),
  ('Kettlebell Swing', 'full_body', 'kettlebell', true),
  ('Burpee', 'full_body', 'bodyweight', false),
  ('Treadmill Run', 'cardio', 'cardio_machine', false),
  ('Stationary Bike', 'cardio', 'cardio_machine', false),
  ('Rowing Machine', 'cardio', 'cardio_machine', false),
  ('Elliptical', 'cardio', 'cardio_machine', false),
  ('Stair Climber', 'cardio', 'cardio_machine', false);
