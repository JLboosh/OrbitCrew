-- ============================================================================
-- Challenge engine and weekly leaderboard
-- ============================================================================
-- CHALLENGES ARE DATA, NOT CODE
-- -----------------------------
-- Each challenge references a TEMPLATE describing how to score it, plus a JSONB
-- rule holding its parameters. Adding "complete 4 sessions/week for 6 weeks"
-- is then an INSERT, not a migration and an app release.
--
-- One scoring function interprets every template, so progress is calculated
-- identically for personal and crew challenges and cannot drift between them.
--
-- TIMEZONES
-- ---------
-- Time-of-day rules ("before 9 AM", "between 3-7 PM") are evaluated in the
-- CREW's timezone for crew challenges and the MEMBER's for personal ones, so
-- nobody is scored against a clock they do not live in.
-- ============================================================================

create type public.challenge_scope as enum ('personal', 'crew');

create type public.challenge_rule_type as enum (
  'session_count',        -- N qualifying sessions in the window.
  'weekly_consistency',   -- N sessions per week for W consecutive weeks.
  'distinct_gyms',        -- Train at N different gyms.
  'time_of_day',          -- N sessions starting within an hour range.
  'crew_session_total',   -- Crew collectively completes N sessions.
  'exercise_1rm_gain'     -- Improve an exercise's estimated 1RM by N percent.
);

comment on type public.challenge_rule_type is
  'Scoring strategy. The rule JSONB supplies parameters; one engine interprets all of them.';

create type public.challenge_visibility as enum ('private', 'crew', 'friends');

-- ----------------------------------------------------------------------------
-- Templates
-- ----------------------------------------------------------------------------
create table public.challenge_templates (
  key text primary key,
  name text not null,
  description text not null,
  rule_type public.challenge_rule_type not null,

  -- Default parameters, overridable per challenge instance.
  default_rule jsonb not null default '{}'::jsonb,

  default_scope public.challenge_scope not null default 'personal',
  default_duration_days integer not null default 28,

  -- Awarded on completion.
  badge_key text,
  badge_emoji text,

  created_at timestamptz not null default now(),

  constraint challenge_templates_duration_range
    check (default_duration_days between 1 and 365)
);

comment on table public.challenge_templates is
  'Reusable challenge definitions. New challenge types are rows here, not new code.';

alter table public.challenge_templates enable row level security;

-- Templates are the shared catalogue, readable by every member.
create policy challenge_templates_select_all
  on public.challenge_templates
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Challenge instances
-- ----------------------------------------------------------------------------
create table public.challenges (
  id uuid primary key default gen_random_uuid(),

  template_key text references public.challenge_templates (key) on delete set null,

  scope public.challenge_scope not null,

  -- Exactly one of these is set, enforced below.
  crew_id uuid references public.crews (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete cascade,

  name text not null,
  description text,

  rule_type public.challenge_rule_type not null,
  -- Concrete parameters, e.g. {"target": 3, "weeks": 4}.
  rule jsonb not null default '{}'::jsonb,

  -- The target the progress counter is measured against.
  target numeric(10, 2) not null,

  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- Evaluated in this zone for time-of-day rules.
  timezone text not null default 'UTC',

  visibility public.challenge_visibility not null default 'crew',

  badge_key text,
  badge_emoji text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint challenges_window_valid check (ends_at > starts_at),
  constraint challenges_max_length
    check (ends_at <= starts_at + interval '400 days'),
  constraint challenges_target_positive check (target > 0),
  constraint challenges_name_length check (char_length(trim(name)) between 2 and 100),
  constraint challenges_timezone_valid check (now() at time zone timezone is not null),

  -- A crew challenge belongs to a crew; a personal one to a member. Never both,
  -- never neither — otherwise scoring would not know whom to score.
  constraint challenges_scope_target check (
    (scope = 'crew' and crew_id is not null and owner_id is null)
    or (scope = 'personal' and owner_id is not null and crew_id is null)
  )
);

comment on table public.challenges is
  'A challenge instance. Crew challenges are admin-created; personal ones are self-created.';

create index challenges_crew_idx on public.challenges (crew_id) where crew_id is not null;
create index challenges_owner_idx on public.challenges (owner_id) where owner_id is not null;
create index challenges_window_idx on public.challenges (starts_at, ends_at);

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row
  execute function public.set_updated_at();

alter table public.challenges enable row level security;

create policy challenges_select_own_or_crew
  on public.challenges
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (crew_id is not null and public.caller_in_crew(crew_id))
  );

-- Personal challenges: self-created. Crew challenges: admins only, matching the
-- rule that admins set goals and create challenges.
create policy challenges_insert_personal
  on public.challenges
  for insert
  to authenticated
  with check (
    scope = 'personal'
    and owner_id = (select auth.uid())
    and created_by = (select auth.uid())
  );

create policy challenges_insert_crew_admin
  on public.challenges
  for insert
  to authenticated
  with check (
    scope = 'crew'
    and crew_id is not null
    and public.caller_is_crew_admin(crew_id)
    and created_by = (select auth.uid())
  );

create policy challenges_update_owner_or_admin
  on public.challenges
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (crew_id is not null and public.caller_is_crew_admin(crew_id))
  )
  with check (
    owner_id = (select auth.uid())
    or (crew_id is not null and public.caller_is_crew_admin(crew_id))
  );

create policy challenges_delete_owner_or_admin
  on public.challenges
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (crew_id is not null and public.caller_is_crew_admin(crew_id))
  );

-- ----------------------------------------------------------------------------
-- Participation
-- ----------------------------------------------------------------------------
create table public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  joined_at timestamptz not null default now(),

  -- Cached progress, refreshed by the scoring engine. The authoritative value is
  -- always recomputable from sessions; this exists so a feed or leaderboard does
  -- not have to rescore everyone on every read.
  progress numeric(10, 2) not null default 0,
  completed_at timestamptz,
  last_scored_at timestamptz,

  primary key (challenge_id, user_id)
);

comment on table public.challenge_participants is
  'Opt-in participation with cached progress. Progress is always recomputable from sessions.';

create index challenge_participants_user_idx on public.challenge_participants (user_id);

alter table public.challenge_participants enable row level security;

create policy challenge_participants_select_visible
  on public.challenge_participants
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.challenges c
      where c.id = challenge_id
        and c.crew_id is not null
        and public.caller_in_crew(c.crew_id)
    )
  );

-- Participation is always opt-in: a member enrols themselves. An admin cannot
-- conscript someone into a challenge.
create policy challenge_participants_insert_self
  on public.challenge_participants
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy challenge_participants_delete_self
  on public.challenge_participants
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Badges
-- ----------------------------------------------------------------------------
create table public.badges (
  key text primary key,
  name text not null,
  description text,
  emoji text,
  created_at timestamptz not null default now()
);

create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_key text not null references public.badges (key) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete set null,
  awarded_at timestamptz not null default now(),

  -- A badge may be earned repeatedly through different challenges, but only
  -- once per challenge.
  primary key (user_id, badge_key, challenge_id)
);

alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

create policy badges_select_all
  on public.badges for select to authenticated using (true);

-- Badges are visible to the owner and to crew mates, since recognition is the
-- point of earning one.
create policy user_badges_select_own_or_crew
  on public.user_badges
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.shares_crew_with_caller(user_id)
  );

-- No client write policy: badges are awarded by the scoring engine only.

-- ----------------------------------------------------------------------------
-- The scoring engine
-- ----------------------------------------------------------------------------
/**
 * Computes a member's progress on a challenge.
 *
 * One function interprets every rule type, so personal and crew challenges are
 * scored by identical logic. Returns a raw count/percentage which the caller
 * compares against `challenges.target`.
 *
 * Only sessions that are FINISHED and at least 20 minutes long qualify. For crew
 * challenges the crew's own `min_session_minutes` applies instead.
 */
create or replace function public.score_challenge_for_user(
  p_challenge_id uuid,
  p_user_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  v_min_seconds integer := 20 * 60;
  v_tz text;
  v_result numeric := 0;
  v_target_per_week integer;
  v_weeks integer;
  v_start_hour integer;
  v_end_hour integer;
  v_exercise uuid;
  v_baseline numeric;
  v_current numeric;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null then
    return 0;
  end if;

  v_tz := coalesce(c.timezone, 'UTC');

  -- Crew challenges use the crew's own validity threshold.
  if c.crew_id is not null then
    select (cr.min_session_minutes * 60) into v_min_seconds
    from public.crews cr where cr.id = c.crew_id;
    v_min_seconds := coalesce(v_min_seconds, 20 * 60);
  end if;

  if c.rule_type = 'session_count' then
    select count(*)
    into v_result
    from public.sessions s
    where s.user_id = p_user_id
      and s.ended_at is not null
      and s.duration_seconds >= v_min_seconds
      and s.started_at >= c.starts_at
      and s.started_at < c.ends_at;

  elsif c.rule_type = 'distinct_gyms' then
    select count(distinct s.gym_id)
    into v_result
    from public.sessions s
    where s.user_id = p_user_id
      and s.ended_at is not null
      and s.duration_seconds >= v_min_seconds
      and s.gym_id is not null
      and s.started_at >= c.starts_at
      and s.started_at < c.ends_at;

  elsif c.rule_type = 'time_of_day' then
    -- Hour range evaluated in the challenge's timezone, so an "Early Bird"
    -- session is judged by the member's local clock.
    v_start_hour := coalesce((c.rule ->> 'start_hour')::int, 0);
    v_end_hour := coalesce((c.rule ->> 'end_hour')::int, 24);

    select count(*)
    into v_result
    from public.sessions s
    where s.user_id = p_user_id
      and s.ended_at is not null
      and s.duration_seconds >= v_min_seconds
      and s.started_at >= c.starts_at
      and s.started_at < c.ends_at
      and extract(hour from (s.started_at at time zone v_tz)) >= v_start_hour
      and extract(hour from (s.started_at at time zone v_tz)) < v_end_hour;

  elsif c.rule_type = 'weekly_consistency' then
    -- Counts CONSECUTIVE qualifying weeks from the challenge start, so the
    -- member cannot satisfy "3 per week for 4 weeks" by cramming 12 sessions
    -- into a single week.
    v_target_per_week := coalesce((c.rule ->> 'sessions_per_week')::int, 3);
    v_weeks := coalesce((c.rule ->> 'weeks')::int, 4);

    select count(*)
    into v_result
    from (
      select
        public.week_start(s.started_at, v_tz) as wk,
        count(*) as n
      from public.sessions s
      where s.user_id = p_user_id
        and s.ended_at is not null
        and s.duration_seconds >= v_min_seconds
        and s.started_at >= c.starts_at
        and s.started_at < c.ends_at
      group by 1
      having count(*) >= v_target_per_week
    ) qualifying_weeks;

    v_result := least(v_result, v_weeks);

  elsif c.rule_type = 'crew_session_total' then
    -- Contribution of this member toward the crew total.
    select count(*)
    into v_result
    from public.sessions s
    where s.user_id = p_user_id
      and s.ended_at is not null
      and s.duration_seconds >= v_min_seconds
      and s.started_at >= c.starts_at
      and s.started_at < c.ends_at;

  elsif c.rule_type = 'exercise_1rm_gain' then
    v_exercise := nullif(c.rule ->> 'exercise_id', '')::uuid;
    if v_exercise is null then
      return 0;
    end if;

    -- Baseline is the best estimated 1RM BEFORE the challenge began, so
    -- pre-existing progress does not count toward it.
    select max(st.estimated_1rm_kg)
    into v_baseline
    from public.sets st
    join public.session_exercises se on se.id = st.session_exercise_id
    join public.sessions s on s.id = se.session_id
    where s.user_id = p_user_id
      and se.exercise_id = v_exercise
      and s.started_at < c.starts_at
      and not st.is_warmup;

    select max(st.estimated_1rm_kg)
    into v_current
    from public.sets st
    join public.session_exercises se on se.id = st.session_exercise_id
    join public.sessions s on s.id = se.session_id
    where s.user_id = p_user_id
      and se.exercise_id = v_exercise
      and s.started_at >= c.starts_at
      and s.started_at < c.ends_at
      and not st.is_warmup;

    if v_baseline is null or v_baseline <= 0 or v_current is null then
      return 0;
    end if;

    v_result := round(((v_current - v_baseline) / v_baseline) * 100, 2);
    v_result := greatest(v_result, 0);
  end if;

  return coalesce(v_result, 0);
end;
$$;

comment on function public.score_challenge_for_user(uuid, uuid) is
  'Interprets any challenge rule type for one member. Single source of scoring truth.';

/**
 * Rescores every participant of a challenge and awards badges on completion.
 *
 * For crew totals, completion is judged on the COMBINED progress of all
 * participants, matching "collectively complete 50 sessions".
 */
create or replace function public.rescore_challenge(p_challenge_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  r record;
  v_score numeric;
  v_updated integer := 0;
  v_combined numeric := 0;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null then
    return 0;
  end if;

  for r in
    select cp.user_id from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
  loop
    v_score := public.score_challenge_for_user(p_challenge_id, r.user_id);
    v_combined := v_combined + v_score;

    update public.challenge_participants cp
    set progress = v_score,
        last_scored_at = now(),
        completed_at = case
          -- Crew totals complete for everyone at once, handled below.
          when c.rule_type = 'crew_session_total' then cp.completed_at
          when v_score >= c.target and cp.completed_at is null then now()
          else cp.completed_at
        end
    where cp.challenge_id = p_challenge_id
      and cp.user_id = r.user_id;

    v_updated := v_updated + 1;
  end loop;

  -- Crew challenge: the group either hits the combined target or does not.
  if c.rule_type = 'crew_session_total' and v_combined >= c.target then
    update public.challenge_participants
    set completed_at = coalesce(completed_at, now())
    where challenge_id = p_challenge_id;
  end if;

  -- Award badges for newly completed participants.
  if c.badge_key is not null then
    insert into public.badges (key, name, emoji)
    values (c.badge_key, coalesce(c.name, c.badge_key), c.badge_emoji)
    on conflict (key) do nothing;

    insert into public.user_badges (user_id, badge_key, challenge_id)
    select cp.user_id, c.badge_key, c.id
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.completed_at is not null
    on conflict do nothing;
  end if;

  return v_updated;
end;
$$;

comment on function public.rescore_challenge(uuid) is
  'Rescores all participants and awards badges. Safe to run repeatedly.';

revoke all on function public.score_challenge_for_user(uuid, uuid) from public;
grant execute on function public.score_challenge_for_user(uuid, uuid) to authenticated, service_role;

revoke all on function public.rescore_challenge(uuid) from public;
grant execute on function public.rescore_challenge(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Weekly crew leaderboard
-- ----------------------------------------------------------------------------
/**
 * The crew's weekly leaderboard, resetting Monday 00:00 in the CREW's timezone.
 *
 * Ranked by sessions completed, then consistency streak, then challenge
 * contribution. Total weight lifted and session duration are deliberately
 * excluded as ranking metrics: they favour heavier lifters and members with more
 * free time, which would make the board discouraging rather than motivating.
 *
 * Members whose activity visibility is 'trained_only' still appear with their
 * session COUNT — that is the crew's shared goal — but no gym, duration, or lift
 * detail is exposed anywhere in this result.
 */
create or replace function public.crew_weekly_leaderboard(
  p_crew_id uuid,
  p_week_offset integer default 0
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  sessions_completed bigint,
  is_caller boolean,
  week_start timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with guard as (
    -- Non-members get nothing, regardless of how this is called.
    select public.caller_in_crew(p_crew_id) as allowed
  ),
  crew_tz as (
    select c.timezone, c.min_session_minutes
    from public.crews c
    where c.id = p_crew_id
  ),
  window_bounds as (
    select
      public.week_start(now(), ct.timezone)
        + make_interval(weeks => p_week_offset) as wk_start,
      public.week_start(now(), ct.timezone)
        + make_interval(weeks => p_week_offset + 1) as wk_end,
      ct.min_session_minutes
    from crew_tz ct
  )
  select
    cm.user_id,
    p.display_name,
    p.avatar_url,
    count(s.id)::bigint as sessions_completed,
    cm.user_id = (select auth.uid()) as is_caller,
    wb.wk_start
  from public.crew_members cm
  cross join window_bounds wb
  cross join guard g
  join public.profiles p on p.id = cm.user_id
  left join public.sessions s
    on s.user_id = cm.user_id
   and s.ended_at is not null
   and s.duration_seconds >= (wb.min_session_minutes * 60)
   and s.started_at >= wb.wk_start
   and s.started_at < wb.wk_end
  where cm.crew_id = p_crew_id
    and g.allowed
  group by cm.user_id, p.display_name, p.avatar_url, wb.wk_start
  order by sessions_completed desc, p.display_name asc;
$$;

comment on function public.crew_weekly_leaderboard(uuid, integer) is
  'Monday-anchored weekly leaderboard in the crew timezone. Ranks sessions, never weight or duration.';

/**
 * Crew progress toward its combined weekly session target.
 */
create or replace function public.crew_weekly_progress(p_crew_id uuid)
returns table (
  week_start timestamptz,
  sessions_completed bigint,
  weekly_target integer,
  percent_complete numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with crew_info as (
    select c.timezone, c.weekly_target_sessions, c.min_session_minutes
    from public.crews c
    where c.id = p_crew_id
      and public.caller_in_crew(p_crew_id)
  ),
  bounds as (
    select
      public.week_start(now(), ci.timezone) as wk_start,
      public.week_start(now(), ci.timezone) + interval '7 days' as wk_end,
      ci.weekly_target_sessions,
      ci.min_session_minutes
    from crew_info ci
  )
  select
    b.wk_start,
    count(s.id)::bigint,
    b.weekly_target_sessions,
    round(
      least(count(s.id)::numeric / greatest(b.weekly_target_sessions, 1) * 100, 100),
      1
    )
  from bounds b
  left join public.crew_members cm on cm.crew_id = p_crew_id
  left join public.sessions s
    on s.user_id = cm.user_id
   and s.ended_at is not null
   and s.duration_seconds >= (b.min_session_minutes * 60)
   and s.started_at >= b.wk_start
   and s.started_at < b.wk_end
  group by b.wk_start, b.weekly_target_sessions;
$$;

comment on function public.crew_weekly_progress(uuid) is
  'Crew progress toward its combined weekly session target, in the crew timezone.';

revoke all on function public.crew_weekly_leaderboard(uuid, integer) from public;
grant execute on function public.crew_weekly_leaderboard(uuid, integer) to authenticated, service_role;

revoke all on function public.crew_weekly_progress(uuid) from public;
grant execute on function public.crew_weekly_progress(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Starter challenge templates
-- ----------------------------------------------------------------------------
insert into public.challenge_templates
  (key, name, description, rule_type, default_rule, default_scope, default_duration_days, badge_key, badge_emoji)
values
  ('consistency_3x4',
   'Consistency Challenge',
   'Complete 3 sessions a week for 4 weeks.',
   'weekly_consistency',
   '{"sessions_per_week": 3, "weeks": 4, "target": 4}'::jsonb,
   'personal', 28, 'consistency', '📅'),

  ('exploration_3_gyms',
   'Exploration Challenge',
   'Train at 3 different gyms.',
   'distinct_gyms',
   '{"target": 3}'::jsonb,
   'personal', 30, 'explorer', '🗺️'),

  ('early_bird_5',
   'Early Bird',
   'Complete 5 sessions starting before 9 AM.',
   'time_of_day',
   '{"start_hour": 0, "end_hour": 9, "target": 5}'::jsonb,
   'personal', 30, 'early_bird', '🌅'),

  ('after_school_10',
   'After School',
   'Complete 10 sessions between 3 PM and 7 PM.',
   'time_of_day',
   '{"start_hour": 15, "end_hour": 19, "target": 10}'::jsonb,
   'personal', 30, 'after_school', '🎒'),

  ('crew_50_sessions',
   'Crew Challenge',
   'Collectively complete 50 sessions.',
   'crew_session_total',
   '{"target": 50}'::jsonb,
   'crew', 30, 'crew_50', '🤝'),

  ('strength_builder_5pct',
   'Strength Builder',
   'Improve an exercise''s estimated one-rep max by 5%.',
   'exercise_1rm_gain',
   '{"target": 5}'::jsonb,
   'personal', 56, 'strength_builder', '💪');

insert into public.badges (key, name, description, emoji) values
  ('consistency', 'Consistency', 'Trained regularly for four straight weeks.', '📅'),
  ('explorer', 'Explorer', 'Trained at three different gyms.', '🗺️'),
  ('early_bird', 'Early Bird', 'Five sessions before 9 AM.', '🌅'),
  ('after_school', 'After School', 'Ten afternoon sessions.', '🎒'),
  ('crew_50', 'Crew Effort', 'Helped the crew reach fifty sessions.', '🤝'),
  ('strength_builder', 'Strength Builder', 'Improved an estimated 1RM by 5%.', '💪')
on conflict (key) do nothing;
