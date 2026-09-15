/**
 * Verifies training, presence, progress, and the challenge engine against the
 * REAL Supabase project.
 *
 * The important claims under test:
 *   * presence never outlives 3 hours and is invisible unless opted in
 *   * estimated 1RM and improvement percentages are computed correctly
 *   * leaderboards rank sessions, and non-members see nothing
 *   * challenge scoring cannot be gamed by cramming
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-training.mjs
 */

import { createHarness, loadConfig } from './lib/harness.mjs';

const harness = createHarness(loadConfig(import.meta.url));

/** Logs a complete finished session and returns its id. */
async function logSession(client, userId, { gymId, exerciseId, sets, startedAt, endedAt }) {
  const { data: session, error: sErr } = await client
    .from('sessions')
    .insert({ user_id: userId, gym_id: gymId ?? null, started_at: startedAt, ended_at: endedAt })
    .select()
    .single();
  if (sErr) throw new Error(`session insert: ${sErr.message}`);

  if (exerciseId && sets?.length) {
    const { data: se, error: seErr } = await client
      .from('session_exercises')
      .insert({ session_id: session.id, exercise_id: exerciseId, order_index: 0 })
      .select()
      .single();
    if (seErr) throw new Error(`session_exercise insert: ${seErr.message}`);

    // PostgREST bulk inserts use the UNION of keys across all rows and fill
    // absent ones with NULL rather than the column default. So every row must
    // specify the same keys explicitly, or `is_warmup` arrives as null and
    // violates its NOT NULL constraint.
    const { error: setsErr } = await client.from('sets').insert(
      sets.map((s, i) => ({
        session_exercise_id: se.id,
        set_index: i,
        weight: s.weight ?? null,
        weight_unit: s.weight_unit ?? 'lb',
        reps: s.reps ?? null,
        rpe: s.rpe ?? null,
        is_warmup: s.is_warmup ?? false,
        duration_seconds: s.duration_seconds ?? null,
      })),
    );
    if (setsErr) throw new Error(`sets insert: ${setsErr.message}`);
  }

  return session;
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400_000).toISOString();

/**
 * Monday 00:00 local time for the current week.
 *
 * Assumes the machine timezone matches the crew timezone used in these tests
 * (America/Toronto), which is true for local development.
 */
function weekStartMs() {
  const d = new Date();
  const dayFromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayFromMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A session window guaranteed to fall inside the CURRENT week and entirely in
 * the past.
 *
 * Relative offsets like "30 hours ago" are not safe here: run on a Monday they
 * land in the previous week, so a leaderboard assertion fails even though the
 * Monday-anchored reset is behaving correctly. `fraction` positions the session
 * through the elapsed part of this week.
 */
function sessionThisWeek(fraction, minutes) {
  const start = weekStartMs();
  const now = Date.now();
  const durationMs = minutes * 60_000;

  // Latest start that still finishes by now.
  const latestStart = now - durationMs;
  const desired = start + (now - start) * fraction;
  const chosen = Math.min(Math.max(desired, start + 60_000), latestStart);

  return {
    startedAt: new Date(chosen),
    endedAt: new Date(chosen + durationMs),
    minutes,
  };
}

await harness.run(async ({ admin, createUser, check, section }) => {
  const alex = await createUser('tralex', { timezone: 'America/Toronto' });
  const sam = await createUser('trsam', { timezone: 'America/Toronto' });
  const outsider = await createUser('trout');

  const { data: gyms } = await alex.client.from('gyms').select('id,name').limit(3);
  const { data: bench } = await alex.client
    .from('exercises')
    .select('id,name')
    .eq('name', 'Barbell Bench Press')
    .single();

  // -------------------------------------------------------------------------
  section('1. Exercise library');

  const { data: canonical } = await alex.client
    .from('exercises')
    .select('id')
    .is('created_by', null);
  check('canonical library is seeded', (canonical?.length ?? 0) >= 40, `got ${canonical?.length}`);
  check('bench press exists in the library', !!bench?.id);

  const { data: custom, error: customErr } = await alex.client
    .from('exercises')
    .insert({
      name: 'Zercher Squat',
      primary_muscle: 'quads',
      equipment: 'barbell',
      created_by: alex.id,
    })
    .select()
    .single();
  check('member can add a custom exercise', !customErr, customErr?.message);

  const { data: samSeesCustom } = await sam.client
    .from('exercises')
    .select('id')
    .eq('id', custom.id);
  check('custom exercises are private to their author', samSeesCustom?.length === 0);

  const { error: libraryInjectErr, data: libraryInjected } = await alex.client
    .from('exercises')
    .insert({ name: 'Fake Global Lift', primary_muscle: 'chest', created_by: null })
    .select();
  check(
    'cannot inject into the shared canonical library',
    !!libraryInjectErr || !libraryInjected?.length,
  );

  // -------------------------------------------------------------------------
  section('2. Sessions, generated duration, and unit normalisation');

  const alexFirst = sessionThisWeek(0.2, 60);
  const session = await logSession(alex.client, alex.id, {
    gymId: gyms[0].id,
    exerciseId: bench.id,
    startedAt: alexFirst.startedAt.toISOString(),
    endedAt: alexFirst.endedAt.toISOString(),
    // 135 lb x 5 -> Epley 1RM = 61.235 x (1 + 5/30) = 71.44 kg
    sets: [
      { weight: 45, weight_unit: 'lb', reps: 10, is_warmup: true },
      { weight: 135, weight_unit: 'lb', reps: 5 },
    ],
  });

  check(
    'duration is generated from timestamps',
    session.duration_seconds === 3600,
    `got ${session.duration_seconds}`,
  );

  const { data: loggedSets } = await alex.client
    .from('sets')
    .select('weight,weight_unit,weight_kg,estimated_1rm_kg,is_warmup,reps')
    .order('set_index');

  const working = loggedSets.find((s) => !s.is_warmup);
  check(
    'pounds are converted to kilograms exactly (135 lb = 61.235 kg)',
    Math.abs(Number(working.weight_kg) - 61.235) < 0.01,
    `got ${working.weight_kg}`,
  );
  check(
    'the entered value is preserved as typed',
    Number(working.weight) === 135 && working.weight_unit === 'lb',
  );
  check(
    'Epley 1RM is computed in the database (135 lb x 5 -> 71.44 kg)',
    Math.abs(Number(working.estimated_1rm_kg) - 71.441) < 0.05,
    `got ${working.estimated_1rm_kg}`,
  );
  const warmup = loggedSets.find((s) => s.is_warmup);
  check('warm-up sets get no 1RM estimate', warmup.estimated_1rm_kg === null);

  const { error: secondActiveErr } = await alex.client
    .from('sessions')
    .insert({ user_id: alex.id, started_at: new Date().toISOString() });
  const { error: thirdActiveErr } = await alex.client
    .from('sessions')
    .insert({ user_id: alex.id, started_at: new Date().toISOString() });
  check(
    'only one session may be in progress at a time',
    !secondActiveErr && !!thirdActiveErr,
    `second: ${secondActiveErr?.message}, third: ${thirdActiveErr?.message}`,
  );

  // Clean up the open session via the RPC, which also proves server-clock ending.
  const { data: ended, error: endErr } = await alex.client.rpc('end_session').single();
  check('end_session closes the active session', !endErr && !!ended?.ended_at, endErr?.message);

  const { error: negativeErr } = await alex.client.from('sessions').insert({
    user_id: alex.id,
    started_at: hoursAgo(1),
    ended_at: hoursAgo(3),
  });
  check('a session cannot end before it starts', !!negativeErr);

  const { data: samSeesSession } = await sam.client
    .from('sessions')
    .select('id')
    .eq('id', session.id);
  check('sessions are private to their owner', samSeesSession?.length === 0);

  // -------------------------------------------------------------------------
  section('3. Personal records are derived, not asserted');

  const { data: prs } = await alex.client
    .from('personal_records')
    .select('record_type,value')
    .eq('exercise_id', bench.id);

  const byType = Object.fromEntries((prs ?? []).map((p) => [p.record_type, Number(p.value)]));
  check(
    'a max-weight record was created by trigger',
    Math.abs(byType.max_weight - 61.235) < 0.01,
    `got ${byType.max_weight}`,
  );
  check(
    'an estimated-1RM record was created',
    Math.abs(byType.estimated_1rm - 71.441) < 0.05,
    `got ${byType.estimated_1rm}`,
  );
  check('warm-ups did not set the rep record', byType.max_reps === 5, `got ${byType.max_reps}`);

  const { error: forgePrErr, data: forgedPr } = await alex.client
    .from('personal_records')
    .insert({ user_id: alex.id, exercise_id: bench.id, record_type: 'max_weight', value: 500 })
    .select();
  check(
    'members cannot fabricate a personal record',
    !!forgePrErr || !forgedPr?.length,
    'forged PR accepted',
  );

  // Beat the record: 185 lb x 5 -> 83.9 kg estimated 1RM.
  const alexSecond = sessionThisWeek(0.45, 60);
  await logSession(alex.client, alex.id, {
    gymId: gyms[0].id,
    exerciseId: bench.id,
    startedAt: alexSecond.startedAt.toISOString(),
    endedAt: alexSecond.endedAt.toISOString(),
    sets: [{ weight: 185, weight_unit: 'lb', reps: 5 }],
  });

  const { data: progress } = await alex.client.rpc('exercise_progress');
  const benchProgress = (progress ?? []).find((p) => p.exercise_id === bench.id);
  check('improvement is reported with both endpoints', !!benchProgress?.baseline_1rm_kg);
  check(
    'improvement percentage matches the spec example (135 -> 185 lb = +37%)',
    Math.abs(Number(benchProgress.improvement_percent) - 37) < 0.5,
    `got ${benchProgress?.improvement_percent}%`,
  );

  // -------------------------------------------------------------------------
  section('4. Weekly summary and streaks use the local timezone');

  const { data: weekly } = await alex.client.rpc('weekly_training_summary', { p_weeks: 4 });
  check('weekly summary returns rows', (weekly?.length ?? 0) > 0);
  const thisWeek = weekly[0];
  check(
    'sessions are counted',
    Number(thisWeek.session_count) >= 2,
    `got ${thisWeek.session_count}`,
  );
  check(
    // 135 lb x 5 = 675 lb, 185 lb x 5 = 925 lb, total 1600 lb = 725.75 kg.
    // The 45 lb x 10 warm-up (450 lb) is correctly excluded.
    'volume excludes warm-ups (1600 lb of working sets = 725.75 kg)',
    Math.abs(Number(thisWeek.total_volume_kg) - 725.75) < 1,
    `got ${thisWeek.total_volume_kg}`,
  );

  const { data: streak } = await alex.client.rpc('training_streak').single();
  check(
    'streak is at least one week',
    Number(streak.current_streak_weeks) >= 1,
    `got ${streak.current_streak_weeks}`,
  );

  // -------------------------------------------------------------------------
  section('5. Presence: off by default, capped at 3 hours, no coordinates');

  const { data: presence, error: presenceErr } = await alex.client
    .rpc('check_in', { p_gym_id: gyms[0].id })
    .single();
  check('member can check in', !presenceErr && !!presence, presenceErr?.message);

  const span = (new Date(presence.expires_at) - new Date(presence.started_at)) / 3600_000;
  check('expiry is set and within 3 hours', span > 0 && span <= 3, `got ${span.toFixed(2)}h`);

  const { data: overLong } = await alex.client
    .rpc('check_in', { p_gym_id: gyms[0].id, p_duration_minutes: 100000 })
    .single();
  const clampedSpan = (new Date(overLong.expires_at) - new Date(overLong.started_at)) / 3600_000;
  check(
    'an absurd requested duration is clamped to the 3-hour maximum',
    clampedSpan <= 3.001,
    `got ${clampedSpan.toFixed(2)}h`,
  );

  const { error: directPresenceErr } = await alex.client.from('presence').insert({
    user_id: alex.id,
    gym_id: gyms[0].id,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
  });
  check('the 3-hour cap cannot be bypassed by a direct insert', !!directPresenceErr);

  const presenceColumns = Object.keys(presence);
  check(
    'presence stores no user coordinates',
    !presenceColumns.some((c) => /lat|lon|coord|geo/i.test(c)),
    `columns: ${presenceColumns.join(', ')}`,
  );

  // Default visibility is 'nobody'.
  const { data: samSeesPresence } = await sam.client.rpc('gym_presence', { p_gym_id: gyms[0].id });
  check(
    'presence is invisible by default, even to crew mates',
    (samSeesPresence?.length ?? 0) === 0,
    `got ${samSeesPresence?.length}`,
  );

  // -------------------------------------------------------------------------
  section('6. Presence becomes visible only after opting in');

  const { data: crew } = await alex.client
    .rpc('create_crew', {
      p_name: 'Presence Test Crew',
      p_timezone: 'America/Toronto',
      p_weekly_target_sessions: 10,
    })
    .single();
  const { data: invite } = await alex.client
    .rpc('create_crew_invite', { p_crew_id: crew.id })
    .single();
  await sam.client.rpc('redeem_crew_invite', { p_code: invite.code });

  const { data: stillHidden } = await sam.client.rpc('gym_presence', { p_gym_id: gyms[0].id });
  check('joining a crew alone does not reveal presence', (stillHidden?.length ?? 0) === 0);

  await alex.client
    .from('privacy_settings')
    .update({ presence_visibility: 'all_crews' })
    .eq('user_id', alex.id);

  const { data: nowVisible } = await sam.client.rpc('gym_presence', { p_gym_id: gyms[0].id });
  check(
    'presence appears to crew mates after opting in',
    nowVisible?.length === 1 && nowVisible[0].user_id === alex.id,
    `got ${nowVisible?.length}`,
  );

  const { data: outsiderView } = await outsider.client.rpc('gym_presence', {
    p_gym_id: gyms[0].id,
  });
  check('a non-crew, non-friend still sees nothing', (outsiderView?.length ?? 0) === 0);

  // 'selected_crews' requires the member to opt in per crew.
  await alex.client
    .from('privacy_settings')
    .update({ presence_visibility: 'selected_crews' })
    .eq('user_id', alex.id);
  const { data: notSelected } = await sam.client.rpc('gym_presence', { p_gym_id: gyms[0].id });
  check(
    'selected_crews hides presence until that crew is chosen',
    (notSelected?.length ?? 0) === 0,
  );

  await alex.client
    .from('crew_members')
    .update({ share_presence: true })
    .eq('crew_id', crew.id)
    .eq('user_id', alex.id);
  const { data: nowSelected } = await sam.client.rpc('gym_presence', { p_gym_id: gyms[0].id });
  check('choosing the crew reveals presence to it', nowSelected?.length === 1);

  // -------------------------------------------------------------------------
  section('7. Expired presence disappears and leaves no history');

  await admin
    .from('presence')
    .update({
      started_at: hoursAgo(4),
      expires_at: hoursAgo(1),
    })
    .eq('user_id', alex.id);

  const { data: expiredView } = await sam.client.rpc('gym_presence', { p_gym_id: gyms[0].id });
  check('expired presence is invisible even before cleanup runs', (expiredView?.length ?? 0) === 0);

  const { data: purged, error: purgeErr } = await admin.rpc('purge_expired_presence');
  check(
    'cleanup removes expired rows',
    !purgeErr && Number(purged) >= 1,
    purgeErr?.message ?? `purged ${purged}`,
  );

  const { error: purgeAsMemberErr } = await alex.client.rpc('purge_expired_presence');
  check('cleanup is not callable by members', !!purgeAsMemberErr);

  // -------------------------------------------------------------------------
  section('8. Weekly leaderboard');

  // Sam logs two qualifying sessions; Alex already has two.
  const samFirst = sessionThisWeek(0.6, 40);
  const samSecond = sessionThisWeek(0.8, 40);
  await logSession(sam.client, sam.id, {
    startedAt: samFirst.startedAt.toISOString(),
    endedAt: samFirst.endedAt.toISOString(),
  });
  await logSession(sam.client, sam.id, {
    startedAt: samSecond.startedAt.toISOString(),
    endedAt: samSecond.endedAt.toISOString(),
  });

  const { data: board, error: boardErr } = await alex.client.rpc('crew_weekly_leaderboard', {
    p_crew_id: crew.id,
  });
  check('leaderboard is queryable by a member', !boardErr, boardErr?.message);
  check('every crew member appears', board?.length === 2, `got ${board?.length}`);

  const counts = (board ?? []).map((r) => Number(r.sessions_completed));
  check(
    'ranked by sessions descending',
    counts.every((c, i) => i === 0 || c <= counts[i - 1]),
  );
  check(
    'the caller is flagged for highlighting',
    (board ?? []).some((r) => r.is_caller),
  );

  const boardColumns = Object.keys(board?.[0] ?? {});
  check(
    'leaderboard exposes no weight or duration ranking fields',
    !boardColumns.some((c) => /weight|volume|duration/i.test(c)),
    `columns: ${boardColumns.join(', ')}`,
  );

  const { data: outsiderBoard } = await outsider.client.rpc('crew_weekly_leaderboard', {
    p_crew_id: crew.id,
  });
  check('a non-member gets an empty leaderboard', (outsiderBoard?.length ?? 0) === 0);

  const { data: crewProgress } = await alex.client
    .rpc('crew_weekly_progress', { p_crew_id: crew.id })
    .single();
  check('crew progress reports the target', Number(crewProgress?.weekly_target) === 10);
  check(
    'crew progress counts sessions',
    Number(crewProgress?.sessions_completed) >= 4,
    `got ${crewProgress?.sessions_completed}`,
  );
  check('percentage is capped at 100', Number(crewProgress?.percent_complete) <= 100);

  // -------------------------------------------------------------------------
  section('9. Short sessions do not count');

  // 10 minutes, below the crew's 20-minute default.
  const samShort = sessionThisWeek(0.5, 10);
  await logSession(sam.client, sam.id, {
    startedAt: samShort.startedAt.toISOString(),
    endedAt: samShort.endedAt.toISOString(),
  });

  const { data: boardAfterShort } = await alex.client.rpc('crew_weekly_leaderboard', {
    p_crew_id: crew.id,
  });
  const samRow = (boardAfterShort ?? []).find((r) => r.user_id === sam.id);
  check(
    'a 10-minute session is excluded by the 20-minute rule',
    Number(samRow.sessions_completed) === 2,
    `got ${samRow?.sessions_completed}`,
  );

  // -------------------------------------------------------------------------
  section('10. Challenge engine');

  const { data: templates } = await alex.client.from('challenge_templates').select('key');
  check('starter templates are seeded', (templates?.length ?? 0) >= 6, `got ${templates?.length}`);

  const { data: consistency, error: chErr } = await alex.client
    .from('challenges')
    .insert({
      template_key: 'consistency_3x4',
      scope: 'personal',
      owner_id: alex.id,
      created_by: alex.id,
      name: 'Consistency Challenge',
      rule_type: 'weekly_consistency',
      rule: { sessions_per_week: 2, weeks: 4 },
      target: 4,
      starts_at: daysAgo(7),
      ends_at: new Date(Date.now() + 21 * 86400_000).toISOString(),
      timezone: 'America/Toronto',
    })
    .select()
    .single();
  check('member can create a personal challenge', !chErr, chErr?.message);

  await alex.client
    .from('challenge_participants')
    .insert({ challenge_id: consistency.id, user_id: alex.id });

  const { data: scored, error: scoreErr } = await alex.client.rpc('rescore_challenge', {
    p_challenge_id: consistency.id,
  });
  check('rescoring runs', !scoreErr && Number(scored) === 1, scoreErr?.message);

  const { data: participant } = await alex.client
    .from('challenge_participants')
    .select('progress,completed_at')
    .eq('challenge_id', consistency.id)
    .eq('user_id', alex.id)
    .single();
  check(
    'consistency counts qualifying WEEKS, not raw sessions',
    Number(participant.progress) === 1,
    `got ${participant.progress} (2 sessions this week = 1 qualifying week)`,
  );
  check('not marked complete before the target is met', participant.completed_at === null);

  // Cramming must not satisfy a multi-week challenge.
  const { data: crammed } = await alex.client
    .from('challenges')
    .insert({
      scope: 'personal',
      owner_id: alex.id,
      created_by: alex.id,
      name: 'Cram Test',
      rule_type: 'weekly_consistency',
      rule: { sessions_per_week: 2, weeks: 4 },
      target: 4,
      starts_at: daysAgo(3),
      ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      timezone: 'America/Toronto',
    })
    .select()
    .single();
  await alex.client
    .from('challenge_participants')
    .insert({ challenge_id: crammed.id, user_id: alex.id });
  await alex.client.rpc('rescore_challenge', { p_challenge_id: crammed.id });

  const { data: crammedProgress } = await alex.client
    .from('challenge_participants')
    .select('progress')
    .eq('challenge_id', crammed.id)
    .eq('user_id', alex.id)
    .single();
  check(
    'many sessions in one week still count as one week',
    Number(crammedProgress.progress) <= 1,
    `got ${crammedProgress.progress}`,
  );

  // Time-of-day scoring in the member's own timezone.
  const { data: earlyBird } = await alex.client
    .from('challenges')
    .insert({
      template_key: 'early_bird_5',
      scope: 'personal',
      owner_id: alex.id,
      created_by: alex.id,
      name: 'Early Bird',
      rule_type: 'time_of_day',
      rule: { start_hour: 0, end_hour: 9 },
      target: 5,
      starts_at: daysAgo(30),
      ends_at: new Date(Date.now() + 86400_000).toISOString(),
      timezone: 'America/Toronto',
    })
    .select()
    .single();
  await alex.client
    .from('challenge_participants')
    .insert({ challenge_id: earlyBird.id, user_id: alex.id });
  const { error: ebErr } = await alex.client.rpc('rescore_challenge', {
    p_challenge_id: earlyBird.id,
  });
  check('time-of-day challenges score without error', !ebErr, ebErr?.message);

  // Crew challenge: admin-only creation, combined completion.
  const { error: samCrewChallengeErr, data: samCrewChallenge } = await sam.client
    .from('challenges')
    .insert({
      scope: 'crew',
      crew_id: crew.id,
      created_by: sam.id,
      name: 'Unauthorised Crew Challenge',
      rule_type: 'crew_session_total',
      target: 10,
      starts_at: daysAgo(1),
      ends_at: new Date(Date.now() + 86400_000).toISOString(),
    })
    .select();
  check(
    'a plain member cannot create a crew challenge',
    !!samCrewChallengeErr || !samCrewChallenge?.length,
  );

  const { data: crewChallenge, error: ccErr } = await alex.client
    .from('challenges')
    .insert({
      template_key: 'crew_50_sessions',
      scope: 'crew',
      crew_id: crew.id,
      created_by: alex.id,
      name: 'Crew Push',
      rule_type: 'crew_session_total',
      rule: {},
      target: 4,
      starts_at: daysAgo(7),
      ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      timezone: 'America/Toronto',
      badge_key: 'crew_50',
      badge_emoji: '🤝',
    })
    .select()
    .single();
  check('an admin can create a crew challenge', !ccErr, ccErr?.message);

  await alex.client
    .from('challenge_participants')
    .insert({ challenge_id: crewChallenge.id, user_id: alex.id });
  await sam.client
    .from('challenge_participants')
    .insert({ challenge_id: crewChallenge.id, user_id: sam.id });

  await alex.client.rpc('rescore_challenge', { p_challenge_id: crewChallenge.id });

  const { data: crewParticipants } = await alex.client
    .from('challenge_participants')
    .select('user_id,progress,completed_at')
    .eq('challenge_id', crewChallenge.id);

  const combined = crewParticipants.reduce((sum, p) => sum + Number(p.progress), 0);
  check('crew progress is the sum of contributions', combined >= 4, `combined ${combined}`);
  check(
    'reaching the combined target completes it for everyone',
    crewParticipants.every((p) => p.completed_at !== null),
    JSON.stringify(crewParticipants.map((p) => p.completed_at)),
  );

  const { data: awarded } = await alex.client
    .from('user_badges')
    .select('badge_key')
    .eq('challenge_id', crewChallenge.id);
  check('a badge is awarded on completion', (awarded?.length ?? 0) >= 1, `got ${awarded?.length}`);

  const { data: outsiderChallenges } = await outsider.client
    .from('challenges')
    .select('id')
    .eq('id', crewChallenge.id);
  check('non-members cannot see crew challenges', (outsiderChallenges?.length ?? 0) === 0);

  // -------------------------------------------------------------------------
  section('11. Gym visit history respects visibility levels');

  const { data: visits, error: visitsErr } = await sam.client
    .rpc('gym_friend_visits', { p_gym_id: gyms[0].id })
    .single();
  check('visit history is queryable', !visitsErr, visitsErr?.message);
  check(
    'crew mate visits are counted',
    Number(visits?.visitor_count) >= 1,
    `got ${visits?.visitor_count}`,
  );
  check(
    'members at trained_only are counted but never named',
    Array.isArray(visits?.named_visitors) && visits.named_visitors.length === 0,
    `named: ${JSON.stringify(visits?.named_visitors)}`,
  );

  await alex.client
    .from('privacy_settings')
    .update({ default_activity_detail: 'gym_name' })
    .eq('user_id', alex.id);

  const { data: visitsNamed } = await sam.client
    .rpc('gym_friend_visits', { p_gym_id: gyms[0].id })
    .single();
  check(
    'members who share gym-level detail are named',
    visitsNamed?.named_visitors?.length === 1,
    `named: ${JSON.stringify(visitsNamed?.named_visitors)}`,
  );
});
