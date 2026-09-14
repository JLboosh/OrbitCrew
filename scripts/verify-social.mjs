/**
 * Verifies the social graph against the REAL Supabase project.
 *
 * The central claim under test is that crews are genuinely invite-only: a
 * non-member must not be able to learn that a crew exists, who is in it, what
 * its goals are, or what its invite codes are.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-social.mjs
 */

import { createHarness, loadConfig } from './lib/harness.mjs';

const harness = createHarness(loadConfig(import.meta.url));

await harness.run(async ({ createUser, check, section }) => {
  const alex = await createUser('alex', { display_name: 'Alex Rivera' });
  const sam = await createUser('sam', { display_name: 'Sam Chen' });
  const jordan = await createUser('jordan', { display_name: 'Jordan Blake' });

  // -------------------------------------------------------------------------
  section('1. Crew creation makes the creator its owner');

  const { data: crew, error: crewErr } = await alex.client
    .rpc('create_crew', {
      p_name: 'Waterloo Gym Crew',
      p_timezone: 'America/Toronto',
      p_weekly_target_sessions: 36,
    })
    .single();

  check('crew created', !crewErr && !!crew, crewErr?.message);
  check('weekly target stored', crew?.weekly_target_sessions === 36);
  check('min session duration defaults to 20 minutes', crew?.min_session_minutes === 20);
  check('spotlight disabled by default', crew?.spotlight_enabled === false);
  check(
    'leaderboard metric defaults to sessions, not weight or duration',
    crew?.leaderboard_metric === 'sessions',
  );

  const { error: badTzErr } = await alex.client
    .rpc('create_crew', { p_name: 'Bad TZ Crew', p_timezone: 'Mars/Olympus_Mons' })
    .single();
  check('an unknown crew timezone is rejected', !!badTzErr, 'bogus timezone accepted');

  const { error: directInsertErr, data: directInsert } = await alex.client
    .from('crews')
    .insert({ name: 'Bypass Crew', created_by: alex.id })
    .select();
  check(
    'direct crew insert is blocked, leaving one sanctioned path',
    !!directInsertErr || !directInsert?.length,
    'direct insert unexpectedly succeeded',
  );

  const { data: ownerRow } = await alex.client
    .from('crew_members')
    .select('role')
    .eq('crew_id', crew.id)
    .eq('user_id', alex.id)
    .maybeSingle();
  check('creator was auto-enrolled as owner', ownerRow?.role === 'owner', `got ${ownerRow?.role}`);

  // -------------------------------------------------------------------------
  section('2. Non-members are fully blind to the crew');

  const { data: samCrewView } = await sam.client.from('crews').select('id').eq('id', crew.id);
  check(
    'non-member cannot see the crew',
    samCrewView?.length === 0,
    `got ${samCrewView?.length} rows`,
  );

  const { data: samMemberView } = await sam.client
    .from('crew_members')
    .select('user_id')
    .eq('crew_id', crew.id);
  check('non-member cannot see the member list', samMemberView?.length === 0);

  const { data: samAllCrews } = await sam.client.from('crews').select('id');
  check('unfiltered crew list is empty for a non-member', samAllCrews?.length === 0);

  const { error: samUpdateErr, data: samUpdated } = await sam.client
    .from('crews')
    .update({ weekly_target_sessions: 1 })
    .eq('id', crew.id)
    .select();
  check(
    "non-member cannot change the crew's goal",
    !samUpdated || samUpdated.length === 0,
    samUpdateErr?.message,
  );

  // -------------------------------------------------------------------------
  section('3. Invites are admin-only and hidden from members');

  const { data: invite, error: inviteErr } = await alex.client
    .rpc('create_crew_invite', { p_crew_id: crew.id, p_expires_in_hours: 24 })
    .single();
  check('admin can create an invite', !inviteErr && !!invite?.code, inviteErr?.message);
  check(
    'invite code uses unambiguous uppercase alphabet',
    /^[A-HJ-NP-Z2-9]{8}$/.test(invite?.code ?? ''),
    `got ${invite?.code}`,
  );
  check('invite has an expiry', !!invite?.expires_at);

  const { error: samInviteErr } = await sam.client
    .rpc('create_crew_invite', { p_crew_id: crew.id })
    .single();
  check('non-member cannot create an invite', !!samInviteErr, 'RPC unexpectedly succeeded');

  const { data: samInviteRead } = await sam.client
    .from('crew_invites')
    .select('code')
    .eq('crew_id', crew.id);
  check('non-member cannot read invite codes', samInviteRead?.length === 0);

  // -------------------------------------------------------------------------
  section('4. Redemption is the only way in');

  const { data: joinedCrewId, error: redeemErr } = await sam.client.rpc('redeem_crew_invite', {
    p_code: invite.code,
  });
  check('invite redemption succeeds', !redeemErr && joinedCrewId === crew.id, redeemErr?.message);

  const { data: samNowSees } = await sam.client.from('crews').select('name').eq('id', crew.id);
  check('new member can now see the crew', samNowSees?.length === 1);

  const { data: samRole } = await sam.client
    .from('crew_members')
    .select('role')
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id)
    .maybeSingle();
  check(
    'joined with the member role, not admin',
    samRole?.role === 'member',
    `got ${samRole?.role}`,
  );

  const { data: secondRedeem, error: secondRedeemErr } = await sam.client.rpc(
    'redeem_crew_invite',
    { p_code: invite.code },
  );
  check(
    'redeeming twice is idempotent rather than an error',
    !secondRedeemErr && secondRedeem === crew.id,
    secondRedeemErr?.message,
  );

  const { error: badCodeErr } = await jordan.client.rpc('redeem_crew_invite', {
    p_code: 'ZZZZZZZZ',
  });
  check('an unknown code is rejected', !!badCodeErr);
  check(
    'failure message does not reveal whether the code exists',
    badCodeErr?.message?.includes('not valid'),
    `got "${badCodeErr?.message}"`,
  );

  // -------------------------------------------------------------------------
  section('5. Direct membership insertion is impossible');

  const { error: forcedJoinErr, data: forcedJoin } = await jordan.client
    .from('crew_members')
    .insert({ crew_id: crew.id, user_id: jordan.id, role: 'member' })
    .select();
  check(
    'cannot self-insert into a crew, bypassing the invite',
    !!forcedJoinErr || !forcedJoin?.length,
    'insert unexpectedly succeeded',
  );

  // -------------------------------------------------------------------------
  section('6. Members cannot escalate their own privileges');

  const { data: promoted } = await sam.client
    .from('crew_members')
    .update({ role: 'admin' })
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id)
    .select();
  check('member cannot promote themselves to admin', !promoted || promoted.length === 0);

  const { data: ownerRemoved } = await sam.client
    .from('crew_members')
    .delete()
    .eq('crew_id', crew.id)
    .eq('user_id', alex.id)
    .select();
  check('member cannot remove the owner', !ownerRemoved || ownerRemoved.length === 0);

  const { data: goalChanged } = await sam.client
    .from('crews')
    .update({ weekly_target_sessions: 1 })
    .eq('id', crew.id)
    .select();
  check('plain member cannot change crew goals', !goalChanged || goalChanged.length === 0);

  // -------------------------------------------------------------------------
  section('7. Members can manage their own preferences and leave');

  const { error: prefErr } = await sam.client
    .from('crew_members')
    .update({ share_presence: true })
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id);
  check('member can opt in to presence for this crew', !prefErr, prefErr?.message);

  // -------------------------------------------------------------------------
  section('8. Per-crew overrides can only tighten privacy, never loosen it');

  // Global default is the most private value, so a more revealing per-crew
  // override must be clamped back down.
  await sam.client
    .from('crew_members')
    .update({ activity_detail_override: 'full_detail' })
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id);

  const { data: clamped } = await sam.client
    .from('crew_members')
    .select('activity_detail_override')
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id)
    .maybeSingle();
  check(
    'override more revealing than the global default is clamped',
    clamped?.activity_detail_override === 'trained_only',
    `got ${clamped?.activity_detail_override}`,
  );

  // After widening the global default, the same override becomes legitimate.
  await sam.client
    .from('privacy_settings')
    .update({ default_activity_detail: 'full_detail' })
    .eq('user_id', sam.id);
  await sam.client
    .from('crew_members')
    .update({ activity_detail_override: 'gym_name' })
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id);

  const { data: tightened } = await sam.client
    .from('crew_members')
    .select('activity_detail_override')
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id)
    .maybeSingle();
  check(
    'a more private override is accepted unchanged',
    tightened?.activity_detail_override === 'gym_name',
    `got ${tightened?.activity_detail_override}`,
  );

  // -------------------------------------------------------------------------
  section('9. Crew mates can see each other; strangers cannot');

  const { data: samSeesAlex } = await sam.client
    .from('profiles')
    .select('display_name')
    .eq('id', alex.id)
    .maybeSingle();
  check('crew mate profile is visible', samSeesAlex?.display_name === 'Alex Rivera');

  const { data: jordanSeesAlex } = await jordan.client
    .from('profiles')
    .select('display_name')
    .eq('id', alex.id)
    .maybeSingle();
  check('a stranger cannot see the profile', jordanSeesAlex === null);

  // -------------------------------------------------------------------------
  section('10. Friendships are symmetric and only the recipient may accept');

  const [a, b] = alex.id < jordan.id ? [alex.id, jordan.id] : [jordan.id, alex.id];

  const { error: requestErr } = await alex.client
    .from('friendships')
    .insert({ user_a: a, user_b: b, requested_by: alex.id, status: 'pending' });
  check('friend request created', !requestErr, requestErr?.message);

  const { data: selfAccepted } = await alex.client
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('user_a', a)
    .eq('user_b', b)
    .select();
  check(
    'requester cannot accept their own request',
    !selfAccepted || selfAccepted.length === 0,
    'self-accept unexpectedly succeeded',
  );

  const { error: acceptErr } = await jordan.client
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('user_a', a)
    .eq('user_b', b);
  check('recipient can accept', !acceptErr, acceptErr?.message);

  const { data: jordanSeesAlexNow } = await jordan.client
    .from('profiles')
    .select('display_name')
    .eq('id', alex.id)
    .maybeSingle();
  check(
    "friend's profile becomes visible after accepting",
    jordanSeesAlexNow?.display_name === 'Alex Rivera',
  );

  const { error: reversedErr } = await alex.client
    .from('friendships')
    .insert({ user_a: b, user_b: a, requested_by: alex.id, status: 'pending' });
  check(
    'reversed duplicate pair is rejected by the canonical-order constraint',
    !!reversedErr,
    'duplicate unexpectedly accepted',
  );

  // -------------------------------------------------------------------------
  section('11. Username lookup honours discoverability and blocks');

  const { data: foundSam } = await alex.client.rpc('find_profile_by_username', {
    p_username: (await sam.client.from('profiles').select('username').eq('id', sam.id).single())
      .data.username,
  });
  check('discoverable member can be found by exact username', foundSam?.length === 1);

  await sam.client
    .from('privacy_settings')
    .update({ discoverable_by_username: false })
    .eq('user_id', sam.id);

  const samUsername = (
    await sam.client.from('profiles').select('username').eq('id', sam.id).single()
  ).data.username;

  const { data: hiddenSam } = await alex.client.rpc('find_profile_by_username', {
    p_username: samUsername,
  });
  check('opting out of discoverability hides the member', hiddenSam?.length === 0);

  await sam.client
    .from('privacy_settings')
    .update({ discoverable_by_username: true })
    .eq('user_id', sam.id);

  const { error: blockErr } = await sam.client
    .from('user_blocks')
    .insert({ blocker_id: sam.id, blocked_id: alex.id });
  check('member can block someone', !blockErr, blockErr?.message);

  const { data: blockedLookup } = await alex.client.rpc('find_profile_by_username', {
    p_username: samUsername,
  });
  check('a block hides the blocker from the blocked user', blockedLookup?.length === 0);

  const { data: alexSeesBlock } = await alex.client.from('user_blocks').select('blocker_id');
  check('the blocked user cannot discover that they were blocked', alexSeesBlock?.length === 0);
});
