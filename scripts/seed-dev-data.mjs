/**
 * Seeds realistic development data.
 *
 * Creates members, a crew with a weekly goal, logged sessions with sets, gym
 * ratings, and a friendship — enough to make every screen show something real
 * instead of an empty state.
 *
 * Unlike the verification scripts, this does NOT clean up after itself: the data
 * is meant to persist so you can sign in and use it.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-dev-data.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-dev-data.mjs --reset
 *
 * `--reset` deletes previously seeded accounts first, so re-running does not
 * accumulate duplicates. It only ever touches accounts on the @gymcrew.dev
 * domain, never real users.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SEED_DOMAIN = 'gymcrew.dev';
const SEED_PASSWORD = 'DevPassword123!';

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* optional */
  }
  return out;
}

const fileEnv = loadEnv();
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    'Missing configuration. Need EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,\n' +
      'and SUPABASE_SERVICE_ROLE_KEY (used to create pre-confirmed accounts).',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MEMBERS = [
  { handle: 'alex', displayName: 'Alex Rivera', timezone: 'America/Toronto' },
  { handle: 'sam', displayName: 'Sam Chen', timezone: 'America/Toronto' },
  { handle: 'jordan', displayName: 'Jordan Blake', timezone: 'America/Toronto' },
  { handle: 'riley', displayName: 'Riley Okafor', timezone: 'America/Vancouver' },
];

const daysAgo = (d, hour = 18) => {
  const date = new Date(Date.now() - d * 86400_000);
  date.setHours(hour, 0, 0, 0);
  return date;
};

async function resetSeed() {
  console.log('Removing previously seeded accounts...');
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);

  let removed = 0;
  for (const user of data.users) {
    if (user.email?.endsWith(`@${SEED_DOMAIN}`)) {
      await admin.auth.admin.deleteUser(user.id);
      removed += 1;
    }
  }
  // Crews outlive their creator because created_by is ON DELETE SET NULL, and a
  // memberless crew is unreachable through RLS, so clear those too.
  await admin.from('crews').delete().is('created_by', null);
  console.log(`  removed ${removed} seeded accounts`);
}

async function createMember(member) {
  const email = `${member.handle}@${SEED_DOMAIN}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: member.displayName,
      username: member.handle,
      timezone: member.timezone,
    },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (signInError) throw new Error(`signIn(${email}): ${signInError.message}`);

  console.log(`  ${member.displayName.padEnd(16)} ${email}`);
  return { ...member, id: data.user.id, email, client };
}

/** Logs a finished session with a few sets, progressing the weight over time. */
async function logSession(member, { gymId, exercises, startedAt, minutes }) {
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);

  const { data: session, error } = await member.client
    .from('sessions')
    .insert({
      user_id: member.id,
      gym_id: gymId ?? null,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`session: ${error.message}`);

  for (const [index, block] of exercises.entries()) {
    const { data: se, error: seErr } = await member.client
      .from('session_exercises')
      .insert({ session_id: session.id, exercise_id: block.exerciseId, order_index: index })
      .select()
      .single();
    if (seErr) throw new Error(`session_exercise: ${seErr.message}`);

    // Every row carries identical keys: PostgREST builds a bulk insert from the
    // UNION of keys and fills absent ones with NULL, not the column default.
    const { error: setsErr } = await member.client.from('sets').insert(
      block.sets.map((set, setIndex) => ({
        session_exercise_id: se.id,
        set_index: setIndex,
        weight: set.weight ?? null,
        weight_unit: 'lb',
        reps: set.reps ?? null,
        rpe: set.rpe ?? null,
        is_warmup: set.isWarmup ?? false,
        duration_seconds: null,
      })),
    );
    if (setsErr) throw new Error(`sets: ${setsErr.message}`);
  }

  return session;
}

async function main() {
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) await resetSeed();

  console.log('\nCreating members...');
  const members = [];
  for (const member of MEMBERS) {
    members.push(await createMember(member));
  }
  const [alex, sam, jordan, riley] = members;

  // ---------------------------------------------------------------------
  console.log('\nLooking up reference data...');
  const { data: gyms } = await alex.client.from('gyms').select('id,name').limit(4);
  if (!gyms?.length) {
    console.error(
      'No gyms found. Run `npm run gyms:import -- waterloo` first so sessions can reference a gym.',
    );
    process.exit(1);
  }
  const { data: exercises } = await alex.client
    .from('exercises')
    .select('id,name')
    .in('name', ['Barbell Bench Press', 'Back Squat', 'Deadlift', 'Pull-Up', 'Overhead Press']);

  const byName = Object.fromEntries((exercises ?? []).map((e) => [e.name, e.id]));
  console.log(`  ${gyms.length} gyms, ${exercises?.length ?? 0} exercises`);

  // ---------------------------------------------------------------------
  console.log('\nCreating crew...');
  const { data: crew, error: crewError } = await alex.client
    .rpc('create_crew', {
      p_name: 'Waterloo Gym Crew',
      p_timezone: 'America/Toronto',
      p_weekly_target_sessions: 12,
      p_min_session_minutes: 20,
      p_description: 'Training together through the term.',
    })
    .single();
  if (crewError) throw new Error(`create_crew: ${crewError.message}`);
  console.log(`  ${crew.name} (target ${crew.weekly_target_sessions} sessions/week)`);

  const { data: invite } = await alex.client
    .rpc('create_crew_invite', { p_crew_id: crew.id, p_expires_in_hours: 168 })
    .single();

  for (const member of [sam, jordan, riley]) {
    const { error } = await member.client.rpc('redeem_crew_invite', { p_code: invite.code });
    if (error) throw new Error(`redeem(${member.handle}): ${error.message}`);
  }
  console.log(`  invite code ${invite.code} — 3 members joined`);

  // Promote Sam so there is an admin who is not the owner to test against.
  await alex.client
    .from('crew_members')
    .update({ role: 'admin' })
    .eq('crew_id', crew.id)
    .eq('user_id', sam.id);

  // ---------------------------------------------------------------------
  console.log('\nLogging sessions...');
  // Bench progresses 135 -> 155 -> 175 so the improvement percentage is real.
  const benchProgression = [135, 145, 155, 165, 175];
  let sessionCount = 0;

  for (const [weekIndex, weight] of benchProgression.entries()) {
    const dayOffset = (benchProgression.length - weekIndex) * 5;
    await logSession(alex, {
      gymId: gyms[0].id,
      startedAt: daysAgo(dayOffset, 7),
      minutes: 52,
      exercises: [
        {
          exerciseId: byName['Barbell Bench Press'],
          sets: [
            { weight: 45, reps: 12, isWarmup: true },
            { weight, reps: 5, rpe: 7 },
            { weight, reps: 5, rpe: 8 },
            { weight, reps: 4, rpe: 9 },
          ],
        },
        {
          exerciseId: byName['Pull-Up'],
          sets: [{ reps: 8 }, { reps: 7 }, { reps: 6 }],
        },
      ],
    });
    sessionCount += 1;
  }

  for (const [index, squatWeight] of [185, 205, 225].entries()) {
    await logSession(sam, {
      gymId: gyms[index % gyms.length].id,
      startedAt: daysAgo(3 - index, 17),
      minutes: 45,
      exercises: [
        {
          exerciseId: byName['Back Squat'],
          sets: [
            { weight: 95, reps: 10, isWarmup: true },
            { weight: squatWeight, reps: 5 },
            { weight: squatWeight, reps: 5 },
          ],
        },
      ],
    });
    sessionCount += 1;
  }

  for (const dayOffset of [1, 4]) {
    await logSession(jordan, {
      gymId: gyms[1].id,
      startedAt: daysAgo(dayOffset, 20),
      minutes: 35,
      exercises: [
        {
          exerciseId: byName['Deadlift'],
          sets: [
            { weight: 135, reps: 8, isWarmup: true },
            { weight: 245, reps: 5 },
          ],
        },
      ],
    });
    sessionCount += 1;
  }

  // A deliberately short session: below the crew's 20-minute threshold, so it
  // must NOT count toward the weekly goal. Useful for eyeballing that rule.
  await logSession(riley, {
    gymId: gyms[2].id,
    startedAt: daysAgo(1, 12),
    minutes: 12,
    exercises: [{ exerciseId: byName['Overhead Press'], sets: [{ weight: 65, reps: 8 }] }],
  });
  console.log(`  ${sessionCount} qualifying sessions + 1 deliberately too-short session`);

  // ---------------------------------------------------------------------
  console.log('\nAdding a friendship and privacy opt-ins...');
  const [a, b] = alex.id < jordan.id ? [alex.id, jordan.id] : [jordan.id, alex.id];
  await alex.client
    .from('friendships')
    .insert({ user_a: a, user_b: b, requested_by: alex.id, status: 'pending' });
  await jordan.client
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('user_a', a)
    .eq('user_b', b);

  // Sam opts into crew presence and gym-level detail so the crew screens have
  // something to show. Everyone else keeps the private defaults on purpose.
  await sam.client
    .from('privacy_settings')
    .update({
      presence_visibility: 'all_crews',
      default_activity_detail: 'gym_name',
      share_progress_summary: true,
    })
    .eq('user_id', sam.id);

  await sam.client.rpc('check_in', { p_gym_id: gyms[0].id, p_duration_minutes: 90 });
  console.log('  Alex and Jordan are friends; Sam shares presence and is checked in');

  // ---------------------------------------------------------------------
  console.log('\nAdding gym ratings...');
  const ratings = [
    {
      member: alex,
      gym: gyms[0],
      overall: 4,
      ac: 2,
      quality: 5,
      avail: 3,
      clean: 4,
      space: 2,
      value: 5,
      text: 'Great racks. Gets very busy after 5pm and the AC struggles.',
    },
    {
      member: sam,
      gym: gyms[0],
      overall: 5,
      ac: 3,
      quality: 5,
      avail: 4,
      clean: 5,
      space: 3,
      value: 4,
      text: 'Best squat racks in the area.',
    },
    {
      member: jordan,
      gym: gyms[1],
      overall: 3,
      ac: 4,
      quality: 3,
      avail: 2,
      clean: 3,
      space: 2,
      value: 3,
      text: 'Fine for cardio, not many free weights.',
    },
  ];

  for (const r of ratings) {
    const { error } = await r.member.client.from('gym_ratings').insert({
      gym_id: r.gym.id,
      user_id: r.member.id,
      overall: r.overall,
      air_conditioning: r.ac,
      equipment_quality: r.quality,
      equipment_availability: r.avail,
      cleanliness: r.clean,
      crowding: r.space,
      value_for_money: r.value,
      review_text: r.text,
    });
    if (error) throw new Error(`rating: ${error.message}`);
  }
  console.log(
    `  ${ratings.length} ratings across ${new Set(ratings.map((r) => r.gym.id)).size} gyms`,
  );

  // ---------------------------------------------------------------------
  console.log('\nCreating a crew challenge...');
  const { data: challenge, error: challengeError } = await alex.client
    .from('challenges')
    .insert({
      template_key: 'crew_50_sessions',
      scope: 'crew',
      crew_id: crew.id,
      created_by: alex.id,
      name: 'Term Push',
      description: 'Collectively complete 50 sessions this month.',
      rule_type: 'crew_session_total',
      rule: {},
      target: 50,
      starts_at: daysAgo(14).toISOString(),
      ends_at: new Date(Date.now() + 16 * 86400_000).toISOString(),
      timezone: 'America/Toronto',
      badge_key: 'crew_50',
      badge_emoji: '🤝',
    })
    .select()
    .single();
  if (challengeError) throw new Error(`challenge: ${challengeError.message}`);

  for (const member of members) {
    await member.client
      .from('challenge_participants')
      .insert({ challenge_id: challenge.id, user_id: member.id });
  }
  await alex.client.rpc('rescore_challenge', { p_challenge_id: challenge.id });
  console.log(`  "${challenge.name}" with ${members.length} participants, scored`);

  // ---------------------------------------------------------------------
  const { data: progress } = await alex.client
    .rpc('crew_weekly_progress', { p_crew_id: crew.id })
    .maybeSingle();

  console.log(`\n${'='.repeat(62)}`);
  console.log('Seed complete. Sign in with any of these:\n');
  for (const member of MEMBERS) {
    console.log(`  ${member.handle.padEnd(8)} ${member.handle}@${SEED_DOMAIN}   ${SEED_PASSWORD}`);
  }
  console.log(`\n  Crew invite code: ${invite.code}`);
  if (progress) {
    console.log(
      `  Crew week: ${progress.sessions_completed}/${progress.weekly_target} sessions ` +
        `(${progress.percent_complete}%)`,
    );
  }
  console.log(
    '\n  Note: only Sam has opted into sharing. Everyone else keeps the\n' +
      '  private defaults, which is what you want when testing visibility.',
  );
  console.log('='.repeat(62));
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
