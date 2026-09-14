-- ============================================================================
-- Progress: personal records, volume, consistency
-- ============================================================================
-- The product rule is that no percentage may be shown unless it traces to a
-- concrete measurement. There is no vague "you improved 200%" anywhere; every
-- figure here derives from a specific, named quantity:
--
--   * estimated 1RM per exercise (Epley, computed in the `sets` table)
--   * training volume in kilograms (weight x reps, warm-ups excluded)
--   * session counts per ISO week in the member's own timezone
--
-- Week boundaries use the MEMBER'S timezone, not UTC. A Sunday-night session in
-- Toronto is already Monday in UTC and would otherwise land in the wrong week,
-- silently breaking both streaks and the Monday leaderboard reset.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Week boundary helper
-- ----------------------------------------------------------------------------
/**
 * The Monday 00:00 that begins the week containing `p_at`, in `p_timezone`.
 *
 * Correct across DST because the arithmetic happens in local time and is then
 * converted back to an absolute instant.
 */
create or replace function public.week_start(p_at timestamptz, p_timezone text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select date_trunc('week', p_at at time zone p_timezone) at time zone p_timezone;
$$;

comment on function public.week_start(timestamptz, text) is
  'Monday 00:00 local time for the week containing the instant. DST-safe.';

-- ----------------------------------------------------------------------------
-- Personal records
-- ----------------------------------------------------------------------------
create type public.record_type as enum (
  'max_weight',        -- Heaviest single set.
  'estimated_1rm',     -- Best Epley estimate.
  'max_reps',          -- Most reps at any weight.
  'max_session_volume' -- Highest volume for the exercise in one session.
);

create table public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  record_type public.record_type not null,

  -- Canonical units: kilograms for weight/volume records, a plain count for reps.
  value numeric(10, 3) not null,

  -- Provenance, so a record can always be traced back to the set that set it.
  set_id uuid references public.sets (id) on delete set null,
  session_id uuid references public.sessions (id) on delete set null,

  achieved_at timestamptz not null default now(),

  -- One current record per member per exercise per type. Beating it updates
  -- this row, so the table stays a leaderboard of bests rather than a log.
  unique (user_id, exercise_id, record_type)
);

comment on table public.personal_records is
  'Current best per member/exercise/type. Maintained by trigger when sets are written.';

create index personal_records_user_idx on public.personal_records (user_id, achieved_at desc);

alter table public.personal_records enable row level security;

create policy personal_records_select_own
  on public.personal_records
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No client write policies: records are derived data, maintained by trigger.
-- Allowing manual insertion would let a member fabricate a PR.

-- ----------------------------------------------------------------------------
-- Baselines for improvement percentages
-- ----------------------------------------------------------------------------
-- "Bench 135 -> 185 = +37%" needs a defensible starting point. Captured once,
-- the first time an exercise is performed, so improvement is measured against
-- where the member actually began rather than a moving window.
create table public.exercise_baselines (
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,

  baseline_1rm_kg numeric(8, 3),
  baseline_at timestamptz not null default now(),

  primary key (user_id, exercise_id)
);

comment on table public.exercise_baselines is
  'First recorded estimated 1RM per exercise. The denominator for improvement percentages.';

alter table public.exercise_baselines enable row level security;

create policy exercise_baselines_select_own
  on public.exercise_baselines
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Record maintenance
-- ----------------------------------------------------------------------------
/**
 * Updates personal records and the baseline when a set is written.
 *
 * Runs in the database rather than the client so records cannot be forged and
 * cannot diverge between the app, the challenge engine, and the leaderboard.
 * Warm-ups are ignored throughout.
 */
create or replace function public.refresh_personal_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_exercise uuid;
  v_session uuid;
begin
  if new.is_warmup then
    return new;
  end if;

  select s.user_id, se.exercise_id, s.id
  into v_user, v_exercise, v_session
  from public.session_exercises se
  join public.sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;

  if v_user is null then
    return new;
  end if;

  -- Baseline: recorded once, on first qualifying set.
  if new.estimated_1rm_kg is not null then
    insert into public.exercise_baselines (user_id, exercise_id, baseline_1rm_kg, baseline_at)
    values (v_user, v_exercise, new.estimated_1rm_kg, now())
    on conflict (user_id, exercise_id) do nothing;
  end if;

  -- Heaviest single set.
  if new.weight_kg is not null then
    insert into public.personal_records
      (user_id, exercise_id, record_type, value, set_id, session_id)
    values (v_user, v_exercise, 'max_weight', new.weight_kg, new.id, v_session)
    on conflict (user_id, exercise_id, record_type) do update
      set value = excluded.value,
          set_id = excluded.set_id,
          session_id = excluded.session_id,
          achieved_at = now()
      where excluded.value > public.personal_records.value;
  end if;

  -- Best estimated 1RM.
  if new.estimated_1rm_kg is not null then
    insert into public.personal_records
      (user_id, exercise_id, record_type, value, set_id, session_id)
    values (v_user, v_exercise, 'estimated_1rm', new.estimated_1rm_kg, new.id, v_session)
    on conflict (user_id, exercise_id, record_type) do update
      set value = excluded.value,
          set_id = excluded.set_id,
          session_id = excluded.session_id,
          achieved_at = now()
      where excluded.value > public.personal_records.value;
  end if;

  -- Most reps in a set.
  if new.reps is not null and new.reps > 0 then
    insert into public.personal_records
      (user_id, exercise_id, record_type, value, set_id, session_id)
    values (v_user, v_exercise, 'max_reps', new.reps, new.id, v_session)
    on conflict (user_id, exercise_id, record_type) do update
      set value = excluded.value,
          set_id = excluded.set_id,
          session_id = excluded.session_id,
          achieved_at = now()
      where excluded.value > public.personal_records.value;
  end if;

  return new;
end;
$$;

create trigger sets_refresh_personal_records
  after insert or update on public.sets
  for each row
  execute function public.refresh_personal_records();

-- ----------------------------------------------------------------------------
-- Progress reporting
-- ----------------------------------------------------------------------------
/**
 * Per-exercise improvement for the caller.
 *
 * Improvement % = (current 1RM - baseline 1RM) / baseline 1RM x 100
 *
 * Both endpoints are returned alongside the percentage so the UI can show the
 * actual numbers ("135 lb -> 185 lb, +37%") rather than a bare figure. A
 * percentage without its inputs is exactly the kind of unverifiable claim this
 * product avoids.
 */
create or replace function public.exercise_progress()
returns table (
  exercise_id uuid,
  exercise_name text,
  baseline_1rm_kg numeric,
  current_1rm_kg numeric,
  improvement_percent numeric,
  achieved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.name,
    b.baseline_1rm_kg,
    pr.value,
    case
      -- Guard against divide-by-zero for a baseline of 0 (bodyweight entries).
      when b.baseline_1rm_kg is null or b.baseline_1rm_kg <= 0 then null
      else round(((pr.value - b.baseline_1rm_kg) / b.baseline_1rm_kg) * 100, 1)
    end,
    pr.achieved_at
  from public.personal_records pr
  join public.exercises e on e.id = pr.exercise_id
  left join public.exercise_baselines b
    on b.user_id = pr.user_id and b.exercise_id = pr.exercise_id
  where pr.user_id = (select auth.uid())
    and pr.record_type = 'estimated_1rm'
  order by pr.achieved_at desc;
$$;

comment on function public.exercise_progress() is
  'Per-exercise 1RM improvement for the caller, returning both endpoints so the number is verifiable.';

/**
 * Training volume and session statistics per ISO week, in the caller's timezone.
 *
 * Volume counts working sets only: sum(weight_kg x reps).
 */
create or replace function public.weekly_training_summary(p_weeks integer default 12)
returns table (
  week_start timestamptz,
  session_count bigint,
  total_volume_kg numeric,
  total_duration_seconds bigint,
  avg_duration_seconds numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with tz as (
    select coalesce(
      (select p.timezone from public.profiles p where p.id = (select auth.uid())),
      'UTC'
    ) as name
  ),
  finished as (
    select
      s.id,
      s.duration_seconds,
      public.week_start(s.started_at, tz.name) as wk
    from public.sessions s
    cross join tz
    where s.user_id = (select auth.uid())
      and s.ended_at is not null
      and s.started_at >= now() - make_interval(weeks => greatest(p_weeks, 1))
  ),
  volume as (
    select
      f.id as session_id,
      coalesce(sum(st.weight_kg * st.reps), 0) as vol
    from finished f
    join public.session_exercises se on se.session_id = f.id
    join public.sets st on st.session_exercise_id = se.id
    where not st.is_warmup
      and st.weight_kg is not null
      and st.reps is not null
    group by f.id
  )
  select
    f.wk,
    count(distinct f.id)::bigint,
    round(coalesce(sum(v.vol), 0), 2),
    coalesce(sum(f.duration_seconds), 0)::bigint,
    round(avg(f.duration_seconds), 0)
  from finished f
  left join volume v on v.session_id = f.id
  group by f.wk
  order by f.wk desc;
$$;

comment on function public.weekly_training_summary(integer) is
  'Sessions, volume, and durations per week in the caller''s local timezone.';

/**
 * Current and longest streak of consecutive weeks containing at least one
 * finished session, in the caller's timezone.
 *
 * Weeks rather than days: a rest day is part of training, and a daily streak
 * would punish sensible programming. That is a product decision, not a
 * technical one.
 */
create or replace function public.training_streak()
returns table (
  current_streak_weeks integer,
  longest_streak_weeks integer,
  last_session_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_current integer := 0;
  v_longest integer := 0;
  v_run integer := 0;
  v_prev timestamptz;
  v_this_week timestamptz;
  r record;
begin
  select coalesce(p.timezone, 'UTC') into v_tz
  from public.profiles p where p.id = (select auth.uid());
  v_tz := coalesce(v_tz, 'UTC');

  v_this_week := public.week_start(now(), v_tz);

  for r in
    select distinct public.week_start(s.started_at, v_tz) as wk
    from public.sessions s
    where s.user_id = (select auth.uid())
      and s.ended_at is not null
    order by wk desc
  loop
    if v_prev is null then
      v_run := 1;
      -- A streak is only "current" if it includes this week or last week;
      -- otherwise it has already been broken.
      if r.wk >= v_this_week - interval '7 days' then
        v_current := 1;
      end if;
    elsif r.wk = v_prev - interval '7 days' then
      v_run := v_run + 1;
      if v_current > 0 then
        v_current := v_current + 1;
      end if;
    else
      v_run := 1;
    end if;

    v_longest := greatest(v_longest, v_run);
    v_prev := r.wk;
  end loop;

  return query
    select
      v_current,
      v_longest,
      (select max(s.started_at) from public.sessions s
       where s.user_id = (select auth.uid()) and s.ended_at is not null);
end;
$$;

comment on function public.training_streak() is
  'Consecutive-week training streak in the caller''s timezone. Weeks, not days, so rest days do not break it.';

revoke all on function public.exercise_progress() from public;
grant execute on function public.exercise_progress() to authenticated, service_role;

revoke all on function public.weekly_training_summary(integer) from public;
grant execute on function public.weekly_training_summary(integer) to authenticated, service_role;

revoke all on function public.training_streak() from public;
grant execute on function public.training_streak() to authenticated, service_role;

revoke all on function public.week_start(timestamptz, text) from public;
grant execute on function public.week_start(timestamptz, text) to authenticated, service_role;
