-- ============================================================================
-- Extensions and shared helpers
-- ============================================================================
-- Foundation for every later migration. Intentionally contains no tables so it
-- can be applied and verified independently.
--
-- NOTE: PostGIS is deliberately NOT enabled here. It is only needed by the gym
-- location features and is enabled in the gyms migration, which keeps this
-- baseline applicable on a Postgres instance without PostGIS available.
-- ============================================================================

-- Supabase convention: install extensions into a dedicated `extensions` schema
-- rather than `public`, so application tables stay separate from extension
-- objects.
create schema if not exists extensions;

-- `citext` gives case-insensitive text. Used for usernames so that "JackyLiu"
-- and "jackyliu" cannot both be registered.
create extension if not exists citext with schema extensions;

-- `pgcrypto` provides `gen_random_bytes`, used to generate crew invite codes.
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Shared trigger function: maintain `updated_at`
-- ----------------------------------------------------------------------------
-- Set as a BEFORE UPDATE trigger on any table with an `updated_at` column.
-- Assigning the timestamp in the database rather than trusting the client means
-- a malicious or buggy client cannot backdate a row.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- `search_path` is pinned to defeat search-path hijacking, a real privilege
-- escalation risk for functions that may run as a privileged owner.
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: forces updated_at to the server clock.';

-- ----------------------------------------------------------------------------
-- Shared enum: weight units
-- ----------------------------------------------------------------------------
-- Members log in either pounds or kilograms. Values are stored in the unit the
-- user entered plus this unit tag, so no precision is lost to conversion. All
-- comparisons and aggregates normalise to kilograms at query time.
create type public.weight_unit as enum ('lb', 'kg');

comment on type public.weight_unit is
  'Unit a weight was recorded in. Stored alongside the value; never converted on write.';
