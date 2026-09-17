-- ----------------------------------------------------------------------------
-- Verified University of Waterloo campus fitness facilities
-- ----------------------------------------------------------------------------
-- WHY THIS IS A MIGRATION AND NOT AN IMPORT
-- -----------------------------------------
-- `npm run gyms:import -- waterloo` matches `leisure=fitness_centre`,
-- `amenity=gym`, and `leisure=sports_centre` carrying a fitness-related `sport`
-- tag. Both campus fitness centres sit inside buildings that OpenStreetMap tags
-- as `leisure=sports_centre` WITHOUT such a sport tag (the PAC way carries no
-- `sport` at all; Columbia Icefield carries `sport=multi`), so the importer
-- skips them and the campus reads as having no gyms at all.
--
-- These two are therefore entered as `source = 'verified'`, which the gym_source
-- enum defines as "manually confirmed". They are confirmed against two
-- independent sources:
--
--   * Existence and operation: University of Waterloo Athletics lists the
--     fitness centres in the Physical Activities Complex and the Columbia
--     Icefield as its recreation facilities
--     (https://athletics.uwaterloo.ca/facilities).
--   * Coordinates: the OpenStreetMap ways for the two buildings,
--     way/43250596 (ref=PAC, operator=University of Waterloo) and
--     way/43250639 (ref=CIF), reduced to their representative centre points.
--
-- The coordinate is the BUILDING centroid, which is what OSM's `out center`
-- yields for a way. That is the honest precision available: it locates the
-- facility to its building, not to a room inside it.
--
-- `osm_id` is populated so this stays keyed to the same OSM elements. If the
-- importer's query is ever widened to catch these, `upsert_osm_gym` updates
-- these rows in place instead of creating duplicates.
--
-- Idempotent: re-running refreshes name, location, and website without
-- duplicating. No opening hours are recorded, because campus facility hours
-- change by term and an out-of-date schedule is worse than none.

insert into public.gyms (osm_id, name, location, city, country_code, website, source)
values
  (
    'way/43250596',
    'PAC Fitness Centre',
    extensions.ST_SetSRID(
      extensions.ST_MakePoint(-80.5461585, 43.4723941),
      4326
    )::extensions.geography,
    'Waterloo',
    'CA',
    'https://athletics.uwaterloo.ca/facilities',
    'verified'
  ),
  (
    'way/43250639',
    'CIF Fitness Centre',
    extensions.ST_SetSRID(
      extensions.ST_MakePoint(-80.5484705, 43.4754189),
      4326
    )::extensions.geography,
    'Waterloo',
    'CA',
    'https://athletics.uwaterloo.ca/facilities',
    'verified'
  )
on conflict (osm_id) do update
  set name = excluded.name,
      location = excluded.location,
      city = coalesce(excluded.city, public.gyms.city),
      country_code = coalesce(excluded.country_code, public.gyms.country_code),
      website = coalesce(excluded.website, public.gyms.website),
      source = excluded.source,
      -- A previous report must not keep a confirmed facility hidden.
      hidden_at = null;
