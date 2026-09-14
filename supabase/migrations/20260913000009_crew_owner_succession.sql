-- ============================================================================
-- Crew owner succession
-- ============================================================================
-- GAP THIS CLOSES
-- ---------------
-- `crew_members.user_id` cascades on account deletion, so deleting the owner's
-- account removed their membership and left the crew with NO owner. The
-- consequences:
--
--   * `crews_delete_owner` could never be satisfied, so the crew was permanently
--     undeletable.
--   * If the departing owner was the only admin, nobody could set goals, create
--     challenges, or invite members again. The crew was frozen.
--   * With every member gone the crew row lingered invisibly, since
--     `crews_select_member` requires membership.
--
-- POLICY
-- ------
-- When an owner's membership disappears, promote the most senior remaining
-- member — preferring an existing admin, then the earliest joiner. If nobody is
-- left, delete the crew, because an empty private crew has no meaning and
-- nothing can ever reach it again.
-- ============================================================================

create or replace function public.handle_owner_departure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_successor uuid;
begin
  -- Only react to the owner leaving.
  if old.role <> 'owner' then
    return old;
  end if;

  -- If the crew itself is being deleted, the cascade will remove the remaining
  -- rows; there is nothing to promote.
  if not exists (select 1 from public.crews c where c.id = old.crew_id) then
    return old;
  end if;

  select cm.user_id
  into v_successor
  from public.crew_members cm
  where cm.crew_id = old.crew_id
    and cm.user_id <> old.user_id
  -- Prefer an existing admin, then the longest-standing member.
  order by (cm.role = 'admin') desc, cm.joined_at asc
  limit 1;

  if v_successor is null then
    -- Nobody left. The crew is unreachable by construction, so remove it rather
    -- than leaking an orphaned row.
    delete from public.crews where id = old.crew_id;
    return old;
  end if;

  update public.crew_members
  set role = 'owner'
  where crew_id = old.crew_id
    and user_id = v_successor;

  return old;
end;
$$;

comment on function public.handle_owner_departure() is
  'Promotes a successor when a crew owner leaves, or deletes the crew if no members remain.';

-- AFTER DELETE: the owner row must already be gone, otherwise the
-- single-owner unique index would reject the promotion.
create trigger crew_members_owner_succession
  after delete on public.crew_members
  for each row
  execute function public.handle_owner_departure();
