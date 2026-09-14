-- ============================================================================
-- Friendships and blocking
-- ============================================================================
-- Two separate concepts, deliberately not merged into one table:
--
--   * A FRIENDSHIP is symmetric. Alex and Sam are either friends or not.
--     Stored as ONE row with a canonical ordering, so the pair cannot be
--     duplicated or disagree with itself.
--
--   * A BLOCK is asymmetric. Alex blocking Sam says nothing about Sam blocking
--     Alex. Modelling this as a friendship status would lose that asymmetry and
--     make "who blocked whom" unrecoverable.
-- ============================================================================

create type public.friendship_status as enum ('pending', 'accepted');

comment on type public.friendship_status is
  'Friend request lifecycle. Declining deletes the row; blocking uses user_blocks.';

-- ----------------------------------------------------------------------------
-- Friendships
-- ----------------------------------------------------------------------------
create table public.friendships (
  -- Canonical ordering (user_a < user_b) enforced below. This makes the pair the
  -- primary key, so a duplicate or contradictory reciprocal row is impossible
  -- rather than merely discouraged by application code.
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,

  -- Direction is still needed for the UI: only the recipient may accept.
  requested_by uuid not null references public.profiles (id) on delete cascade,

  status public.friendship_status not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_a, user_b),

  constraint friendships_canonical_order check (user_a < user_b),
  constraint friendships_no_self check (user_a <> user_b),
  constraint friendships_requester_participates check (requested_by in (user_a, user_b))
);

comment on table public.friendships is
  'Symmetric friendships, one row per pair with user_a < user_b enforced.';

create trigger friendships_set_updated_at
  before update on public.friendships
  for each row
  execute function public.set_updated_at();

-- Finding "my friends" must be fast from either side of the pair.
create index friendships_user_b_idx on public.friendships (user_b);
create index friendships_status_idx on public.friendships (status);

-- ----------------------------------------------------------------------------
-- Blocks
-- ----------------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

comment on table public.user_blocks is
  'Asymmetric blocks. A block hides both members from each other and prevents friend requests.';

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- ----------------------------------------------------------------------------
-- Helper functions used by RLS policies
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so these can read the tables while being called from within a
-- policy. Without it, a policy on `profiles` that consults `friendships` would
-- be evaluated under the caller's own restricted permissions and could recurse.

/** Canonical pair ordering, so callers never have to remember the convention. */
create or replace function public.friendship_pair(p_one uuid, p_two uuid)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case when p_one < p_two then array[p_one, p_two] else array[p_two, p_one] end;
$$;

create or replace function public.are_friends(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and f.user_a = least(p_one, p_two)
      and f.user_b = greatest(p_one, p_two)
  );
$$;

comment on function public.are_friends(uuid, uuid) is
  'True when an accepted friendship exists between the two users, in either direction.';

/**
 * True when either user has blocked the other. Used to suppress visibility in
 * both directions: a block should feel mutual to the blocked party even though
 * the record is one-way.
 */
create or replace function public.is_blocked_either_way(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_one and b.blocked_id = p_two)
       or (b.blocker_id = p_two and b.blocked_id = p_one)
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS: friendships
-- ----------------------------------------------------------------------------
alter table public.friendships enable row level security;

-- A user sees only the friendships they participate in. Nobody can enumerate
-- the social graph.
create policy friendships_select_participant
  on public.friendships
  for select
  to authenticated
  using (
    (select auth.uid()) in (user_a, user_b)
  );

-- Sending a request: the sender must be a participant, must be the requester,
-- the row must start as 'pending', and neither party may have blocked the other.
create policy friendships_insert_request
  on public.friendships
  for insert
  to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select auth.uid()) in (user_a, user_b)
    and status = 'pending'
    and not public.is_blocked_either_way(user_a, user_b)
  );

-- Accepting: only the RECIPIENT may move a request to accepted. Without this
-- the sender could accept their own request.
create policy friendships_update_recipient_accepts
  on public.friendships
  for update
  to authenticated
  using (
    (select auth.uid()) in (user_a, user_b)
    and requested_by <> (select auth.uid())
  )
  with check (
    (select auth.uid()) in (user_a, user_b)
    and requested_by <> (select auth.uid())
  );

-- Either party may delete: declining a request, or unfriending later.
create policy friendships_delete_participant
  on public.friendships
  for delete
  to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- ----------------------------------------------------------------------------
-- RLS: blocks
-- ----------------------------------------------------------------------------
alter table public.user_blocks enable row level security;

-- Deliberately only the blocker can read their own blocks. The blocked user must
-- NOT be able to discover that they were blocked.
create policy user_blocks_select_own
  on public.user_blocks
  for select
  to authenticated
  using (blocker_id = (select auth.uid()));

create policy user_blocks_insert_own
  on public.user_blocks
  for insert
  to authenticated
  with check (blocker_id = (select auth.uid()));

create policy user_blocks_delete_own
  on public.user_blocks
  for delete
  to authenticated
  using (blocker_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Extend profile visibility to friends
-- ----------------------------------------------------------------------------
-- The identity migration deliberately left profiles self-only until a
-- relationship existed to gate wider access. Friends may now see each other,
-- unless a block intervenes.
create policy profiles_select_friends
  on public.profiles
  for select
  to authenticated
  using (
    public.are_friends(id, (select auth.uid()))
    and not public.is_blocked_either_way(id, (select auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- Username lookup for the add-friend flow
-- ----------------------------------------------------------------------------
-- Exact-match only, and it honours `discoverable_by_username`. A SECURITY
-- DEFINER function is used so that finding someone by their exact handle does
-- NOT require a broad SELECT policy on profiles, which would let a client
-- enumerate the entire user base.
create or replace function public.find_profile_by_username(p_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username::text, p.display_name, p.avatar_url
  from public.profiles p
  join public.privacy_settings ps on ps.user_id = p.id
  where lower(p.username::text) = lower(trim(p_username))
    and ps.discoverable_by_username
    and p.id <> (select auth.uid())
    and not public.is_blocked_either_way(p.id, (select auth.uid()))
  limit 1;
$$;

comment on function public.find_profile_by_username(text) is
  'Exact-match username lookup honouring discoverable_by_username. Never allows enumeration.';

-- Only authenticated users may look anyone up.
revoke execute on function public.find_profile_by_username(text) from anon;
