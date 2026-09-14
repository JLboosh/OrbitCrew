-- ============================================================================
-- Gyms, PostGIS geospatial search, and structured ratings
-- ============================================================================
-- Gym records are sourced from OpenStreetMap and cached in OUR database rather
-- than queried live.
--
-- WHY CACHE INSTEAD OF PROXYING OVERPASS
-- --------------------------------------
-- The public Overpass API's usage policy allows roughly 10,000 requests and 1 GB
-- per DAY for an entire application, not per user. Querying it on every map pan
-- would exhaust that budget almost immediately and get the app blocked. Caching
-- into a GIST-indexed table also makes nearby search a few milliseconds instead
-- of seconds, and keeps the map working when Overpass is down.
-- ============================================================================

create extension if not exists postgis with schema extensions;

-- ----------------------------------------------------------------------------
-- Gyms
-- ----------------------------------------------------------------------------
create type public.gym_source as enum ('osm', 'user', 'verified');

comment on type public.gym_source is
  'osm: imported from OpenStreetMap. user: submitted in-app. verified: manually confirmed.';

create table public.gyms (
  id uuid primary key default gen_random_uuid(),

  -- OpenStreetMap element identity, e.g. 'node/123456' or 'way/98765'.
  -- Unique so re-running the importer updates rather than duplicates.
  osm_id text unique,

  name text not null,

  -- geography(Point,4326) rather than geometry: distance calculations are in
  -- metres on the WGS84 spheroid, so no projection maths is needed and results
  -- stay correct at any latitude.
  location extensions.geography (point, 4326) not null,

  address text,
  city text,
  country_code text,

  -- Opening hours in OSM syntax (e.g. 'Mo-Fr 06:00-22:00'). Kept as text
  -- because OSM's format is richer than any simple structure, and parsing is
  -- better done in the client where it can be shown as written.
  opening_hours text,
  phone text,
  website text,

  source public.gym_source not null default 'osm',

  -- Set when a member reports the gym as closed or bogus, hiding it from search
  -- without destroying the record or its rating history.
  hidden_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gyms_name_length check (char_length(trim(name)) between 1 and 200),
  constraint gyms_country_code_format
    check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

comment on table public.gyms is
  'Gym directory cached from OpenStreetMap. Queried via nearby_gyms(); never proxied live to Overpass.';
comment on column public.gyms.location is
  'WGS84 point. This is a PLACE location, never a user location.';

-- The index that makes proximity search viable. Without it, every nearby query
-- would scan the whole table.
create index gyms_location_idx on public.gyms using gist (location);

create trigger gyms_set_updated_at
  before update on public.gyms
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: gyms
-- ----------------------------------------------------------------------------
-- Gyms are public facilities, not private data. Every authenticated member may
-- read them. Writes are restricted to trusted server-side code (the importer),
-- so a client cannot vandalise the shared directory.
alter table public.gyms enable row level security;

create policy gyms_select_authenticated
  on public.gyms
  for select
  to authenticated
  using (hidden_at is null);

-- No client INSERT/UPDATE/DELETE policies. The OSM importer runs with the
-- service role, and user-submitted gyms will go through a moderated RPC.

-- ----------------------------------------------------------------------------
-- Nearby search
-- ----------------------------------------------------------------------------
/**
 * Gyms within `p_radius_metres` of a coordinate, nearest first.
 *
 * The caller's coordinate is used transiently for this query and never stored.
 * That is the core location-privacy property: the app asks "what is near this
 * point", and the answer is about PLACES, not people.
 */
create or replace function public.nearby_gyms(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_metres integer default 5000,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  latitude double precision,
  longitude double precision,
  address text,
  opening_hours text,
  distance_metres double precision
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
  )
  select
    g.id,
    g.name,
    extensions.ST_Y(g.location::extensions.geometry) as latitude,
    extensions.ST_X(g.location::extensions.geometry) as longitude,
    g.address,
    g.opening_hours,
    extensions.ST_Distance(g.location, o.point) as distance_metres
  from public.gyms g
  cross join origin o
  where g.hidden_at is null
    -- ST_DWithin is the indexable form; it uses the GIST index rather than
    -- computing a distance for every row.
    and extensions.ST_DWithin(g.location, o.point, greatest(p_radius_metres, 1))
  -- Ordering by the output alias rather than the `<->` KNN operator: operators
  -- cannot be schema-qualified, and `<->` is unreachable under the pinned empty
  -- search_path. ST_DWithin has already reduced the set via the GIST index, so
  -- sorting the remainder is cheap.
  order by distance_metres
  limit greatest(least(p_limit, 200), 1);
$$;

comment on function public.nearby_gyms(double precision, double precision, integer, integer) is
  'Gyms near a coordinate, nearest first. The coordinate is transient and never persisted.';

revoke execute on function public.nearby_gyms(double precision, double precision, integer, integer)
  from anon;

/**
 * Upserts a gym from OpenStreetMap. Idempotent on `osm_id`, so the importer can
 * be re-run safely.
 *
 * Restricted to the service role: this writes to the shared directory.
 */
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
begin
  insert into public.gyms (
    osm_id, name, location, address, city, country_code, opening_hours, phone, website, source
  )
  values (
    p_osm_id,
    trim(p_name),
    extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
    p_address, p_city, upper(nullif(trim(coalesce(p_country_code, '')), '')),
    p_opening_hours, p_phone, p_website,
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
  'Idempotent gym import keyed on osm_id. Service-role only.';

revoke execute on function public.upsert_osm_gym(
  text, text, double precision, double precision, text, text, text, text, text, text
) from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Structured ratings
-- ----------------------------------------------------------------------------
-- Separate axes rather than one blended star score, because "good gym" means
-- different things to different people: a member who trains at 6pm cares about
-- crowding, someone in a hot climate cares about air conditioning.
create table public.gym_ratings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  overall smallint not null,
  air_conditioning smallint,
  equipment_quality smallint,
  equipment_availability smallint,
  cleanliness smallint,
  -- Higher is better, i.e. 5 = pleasantly quiet. Stored consistently with the
  -- other axes so the UI never has to invert one scale.
  crowding smallint,
  value_for_money smallint,

  review_text text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gym_ratings_overall_range check (overall between 1 and 5),
  constraint gym_ratings_ac_range check (air_conditioning is null or air_conditioning between 1 and 5),
  constraint gym_ratings_quality_range
    check (equipment_quality is null or equipment_quality between 1 and 5),
  constraint gym_ratings_availability_range
    check (equipment_availability is null or equipment_availability between 1 and 5),
  constraint gym_ratings_cleanliness_range
    check (cleanliness is null or cleanliness between 1 and 5),
  constraint gym_ratings_crowding_range check (crowding is null or crowding between 1 and 5),
  constraint gym_ratings_value_range
    check (value_for_money is null or value_for_money between 1 and 5),
  constraint gym_ratings_review_length
    check (review_text is null or char_length(review_text) <= 1000)
);

comment on table public.gym_ratings is
  'Multi-axis gym ratings. One rating per member per gym per 30 days, enforced by trigger.';
comment on column public.gym_ratings.crowding is
  'Higher is better (5 = pleasantly quiet), consistent with the other axes.';

create index gym_ratings_gym_idx on public.gym_ratings (gym_id);
create index gym_ratings_user_idx on public.gym_ratings (user_id);

create trigger gym_ratings_set_updated_at
  before update on public.gym_ratings
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- One rating per gym per member per 30 days
-- ----------------------------------------------------------------------------
-- A plain UNIQUE constraint cannot express "per rolling 30 days", so this is a
-- trigger. Rate limiting keeps a single motivated member from flooding a gym's
-- score, while still allowing an honest re-review after a month.
create or replace function public.enforce_rating_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.gym_ratings r
    where r.gym_id = new.gym_id
      and r.user_id = new.user_id
      and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and r.created_at > now() - interval '30 days'
  ) then
    raise exception 'You can only rate a gym once every 30 days'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger gym_ratings_rate_limit
  before insert on public.gym_ratings
  for each row
  execute function public.enforce_rating_rate_limit();

-- ----------------------------------------------------------------------------
-- RLS: gym_ratings
-- ----------------------------------------------------------------------------
alter table public.gym_ratings enable row level security;

-- Ratings are the shared, public-facing value of the directory, so any
-- authenticated member may read them.
create policy gym_ratings_select_authenticated
  on public.gym_ratings
  for select
  to authenticated
  using (true);

create policy gym_ratings_insert_own
  on public.gym_ratings
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy gym_ratings_update_own
  on public.gym_ratings
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy gym_ratings_delete_own
  on public.gym_ratings
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Aggregated rating summary
-- ----------------------------------------------------------------------------
-- A view keeps the averaging logic in one place. Exposed with
-- security_invoker so the caller's RLS still applies.
create view public.gym_rating_summaries
with (security_invoker = true)
as
select
  g.id as gym_id,
  count(r.id) as rating_count,
  round(avg(r.overall)::numeric, 2) as avg_overall,
  round(avg(r.air_conditioning)::numeric, 2) as avg_air_conditioning,
  round(avg(r.equipment_quality)::numeric, 2) as avg_equipment_quality,
  round(avg(r.equipment_availability)::numeric, 2) as avg_equipment_availability,
  round(avg(r.cleanliness)::numeric, 2) as avg_cleanliness,
  round(avg(r.crowding)::numeric, 2) as avg_crowding,
  round(avg(r.value_for_money)::numeric, 2) as avg_value_for_money
from public.gyms g
left join public.gym_ratings r on r.gym_id = g.id
group by g.id;

comment on view public.gym_rating_summaries is
  'Per-gym rating averages across all axes.';

-- ----------------------------------------------------------------------------
-- Moderation reports
-- ----------------------------------------------------------------------------
create type public.report_reason as enum (
  'permanently_closed',
  'wrong_location',
  'duplicate',
  'inappropriate_content',
  'spam',
  'other'
);

create table public.gym_reports (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid references public.gyms (id) on delete cascade,
  rating_id uuid references public.gym_ratings (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason public.report_reason not null,
  detail text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  -- A report must point at something.
  constraint gym_reports_has_target check (gym_id is not null or rating_id is not null),
  constraint gym_reports_detail_length check (detail is null or char_length(detail) <= 500)
);

comment on table public.gym_reports is
  'Member reports about a gym record or a review, for moderation.';

alter table public.gym_reports enable row level security;

-- A reporter sees only their own reports. Moderation happens server-side, so
-- reports are deliberately not readable by other members.
create policy gym_reports_select_own
  on public.gym_reports
  for select
  to authenticated
  using (reporter_id = (select auth.uid()));

create policy gym_reports_insert_own
  on public.gym_reports
  for insert
  to authenticated
  with check (reporter_id = (select auth.uid()));
