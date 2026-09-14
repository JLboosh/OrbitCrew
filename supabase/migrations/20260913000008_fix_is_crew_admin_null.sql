-- ============================================================================
-- SECURITY FIX: is_crew_admin must never return NULL
-- ============================================================================
-- THE BUG
-- -------
-- `is_crew_admin` was defined as:
--
--     select public.crew_role_of(p_crew_id, p_user_id) in ('owner', 'admin');
--
-- For a NON-MEMBER, `crew_role_of` returns NULL, so the whole expression
-- evaluates to NULL rather than false — SQL three-valued logic, not a boolean.
--
-- The consequences differed by call site, which is what made this dangerous:
--
--   * In RLS policies (`using (public.is_crew_admin(id))`) PostgreSQL requires
--     a policy expression to be TRUE, and treats NULL as deny. Those were safe.
--
--   * In PL/pgSQL guards (`if not public.is_crew_admin(...) then raise ...`),
--     `not NULL` is NULL, and `IF NULL THEN` does NOT take the branch. The
--     guard was silently skipped.
--
-- Impact: a non-member could call `create_crew_invite` for a crew they did not
-- belong to, obtain a valid code, and redeem it to join a private crew —
-- defeating the invite-only guarantee entirely. Caught by
-- scripts/verify-social.mjs.
--
-- THE FIX
-- -------
-- Force a concrete boolean with `coalesce(..., false)`, so the function fails
-- closed for every caller regardless of calling context.
--
-- LESSON: a predicate used for authorisation must return a strict boolean.
-- Returning NULL means "unknown", and different call sites disagree about
-- whether unknown means allow or deny.
-- ============================================================================

create or replace function public.is_crew_admin(p_crew_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.crew_role_of(p_crew_id, p_user_id) in ('owner', 'admin'),
    false
  );
$$;

comment on function public.is_crew_admin(uuid, uuid) is
  'True only for owner/admin. Returns false (never NULL) for non-members so PL/pgSQL guards fail closed.';

-- Harden the invite RPC independently of the helper, so a future regression in
-- one place does not silently reopen the hole. Defence in depth: the membership
-- check is now explicit here too.
create or replace function public.create_crew_invite(
  p_crew_id uuid,
  p_expires_in_hours integer default 168,
  p_max_uses integer default null
)
returns public.crew_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_invite public.crew_invites;
  v_attempt int := 0;
  v_role public.crew_role;
begin
  if (select auth.uid()) is null then
    raise exception 'Must be signed in to create an invite'
      using errcode = '42501';
  end if;

  -- Read the role explicitly and test it with IS DISTINCT FROM, which is
  -- NULL-safe, rather than relying on a boolean helper.
  v_role := public.crew_role_of(p_crew_id, (select auth.uid()));

  if v_role is null then
    -- Same generic message as a permission failure: a non-member must not be
    -- able to distinguish "crew does not exist" from "you are not an admin".
    raise exception 'Only crew admins may create invites'
      using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'Only crew admins may create invites'
      using errcode = '42501';
  end if;

  if p_expires_in_hours < 1 or p_expires_in_hours > 8760 then
    raise exception 'Invite expiry must be between 1 hour and 1 year'
      using errcode = '22023';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := '';

    for _i in 1..8 loop
      v_code := v_code || substr(
        v_alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)),
        1
      );
    end loop;

    begin
      insert into public.crew_invites (crew_id, code, created_by, expires_at, max_uses)
      values (
        p_crew_id,
        v_code,
        (select auth.uid()),
        now() + make_interval(hours => p_expires_in_hours),
        p_max_uses
      )
      returning * into v_invite;

      return v_invite;
    exception
      when unique_violation then
        if v_attempt >= 5 then
          raise;
        end if;
    end;
  end loop;
end;
$$;

comment on function public.create_crew_invite(uuid, integer, integer) is
  'Admin-only. Creates a CSPRNG invite code with a mandatory expiry. Fails closed for non-members.';

revoke execute on function public.create_crew_invite(uuid, integer, integer) from anon;
