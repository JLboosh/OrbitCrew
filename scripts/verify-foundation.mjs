/**
 * Foundation verification against the REAL Supabase project.
 *
 * Proves the things that unit tests cannot:
 *   1. The signup trigger creates a profile and privacy_settings row.
 *   2. Privacy defaults are the most private values (the opt-in guarantee).
 *   3. Usernames are derived and de-duplicated rather than failing signup.
 *   4. RLS actually isolates users from each other.
 *   5. A user cannot escalate their own privacy row or edit someone else's.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-foundation.mjs
 *
 * The service_role key is used ONLY to create pre-confirmed test users and to
 * clean them up afterwards. Every assertion about visibility runs through a
 * normal authenticated session, so RLS is genuinely exercised.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) out[match[1]] = match[2];
    }
  } catch {
    // .env is optional when the values are already in the environment.
  }
  return out;
}

const fileEnv = loadEnvFile(new URL('../.env', import.meta.url).pathname);
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY (needed to create confirmed test users)');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const createdUserIds = [];

/** Creates a pre-confirmed user and returns an authenticated client for them. */
async function createUser({ email, password, metadata }) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata ?? {},
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  createdUserIds.push(data.user.id);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${email}) failed: ${signInError.message}`);

  return { id: data.user.id, client };
}

async function cleanup() {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
async function main() {
  const stamp = Date.now();
  const password = `Test-${stamp}-aB!`;

  console.log('\n1. Signup trigger provisions profile + privacy settings');
  const alex = await createUser({
    email: `alex.${stamp}@gymcrew.test`,
    password,
    metadata: { display_name: 'Alex Rivera', timezone: 'America/Toronto' },
  });

  const { data: alexProfile, error: alexProfileErr } = await alex.client
    .from('profiles')
    .select('*')
    .eq('id', alex.id)
    .single();

  check(
    'profile row created by trigger',
    !alexProfileErr && !!alexProfile,
    alexProfileErr?.message,
  );
  check(
    'username derived from email local part',
    alexProfile?.username?.startsWith('alex'),
    `got ${alexProfile?.username}`,
  );
  check(
    'display_name taken from signup metadata',
    alexProfile?.display_name === 'Alex Rivera',
    `got ${alexProfile?.display_name}`,
  );
  check(
    'valid timezone from metadata is honoured',
    alexProfile?.timezone === 'America/Toronto',
    `got ${alexProfile?.timezone}`,
  );
  check(
    'weight unit defaults to lb',
    alexProfile?.weight_unit === 'lb',
    `got ${alexProfile?.weight_unit}`,
  );

  console.log('\n2. Privacy defaults are the most private values (opt-in guarantee)');
  const { data: privacy, error: privacyErr } = await alex.client
    .from('privacy_settings')
    .select('*')
    .eq('user_id', alex.id)
    .single();

  check('privacy row created by trigger', !privacyErr && !!privacy, privacyErr?.message);
  check(
    'live presence defaults to nobody',
    privacy?.presence_visibility === 'nobody',
    `got ${privacy?.presence_visibility}`,
  );
  check(
    'activity detail defaults to trained_only',
    privacy?.default_activity_detail === 'trained_only',
    `got ${privacy?.default_activity_detail}`,
  );
  check(
    'progress sharing defaults to false',
    privacy?.share_progress_summary === false,
    `got ${privacy?.share_progress_summary}`,
  );
  check(
    'motivation spotlight defaults to false (never opt-out)',
    privacy?.allow_motivation_spotlight === false,
    `got ${privacy?.allow_motivation_spotlight}`,
  );
  check(
    'crowd stats contribution defaults to false',
    privacy?.contribute_to_crowd_stats === false,
    `got ${privacy?.contribute_to_crowd_stats}`,
  );

  console.log('\n3. Username collisions resolve instead of failing signup');
  const sam1 = await createUser({ email: `sam.${stamp}@gymcrew.test`, password });
  const sam2 = await createUser({ email: `sam.${stamp}@other.test`, password });

  const { data: p1 } = await sam1.client
    .from('profiles')
    .select('username')
    .eq('id', sam1.id)
    .single();
  const { data: p2 } = await sam2.client
    .from('profiles')
    .select('username')
    .eq('id', sam2.id)
    .single();

  check('both colliding signups succeeded', !!p1?.username && !!p2?.username);
  check(
    'usernames are distinct',
    p1?.username !== p2?.username,
    `got ${p1?.username} and ${p2?.username}`,
  );

  console.log('\n4. Invalid timezone falls back to UTC instead of aborting signup');
  const badTz = await createUser({
    email: `badtz.${stamp}@gymcrew.test`,
    password,
    metadata: { timezone: 'Mars/Olympus_Mons' },
  });
  const { data: badTzProfile } = await badTz.client
    .from('profiles')
    .select('timezone')
    .eq('id', badTz.id)
    .single();
  check(
    'bogus timezone replaced with UTC',
    badTzProfile?.timezone === 'UTC',
    `got ${badTzProfile?.timezone}`,
  );

  console.log('\n5. RLS isolates users from each other');
  const { data: otherProfile } = await alex.client
    .from('profiles')
    .select('id')
    .eq('id', sam1.id)
    .maybeSingle();
  check(
    "cannot read another member's profile",
    otherProfile === null,
    `got ${JSON.stringify(otherProfile)}`,
  );

  const { data: allProfiles } = await alex.client.from('profiles').select('id');
  check(
    'unfiltered profile list returns only self',
    allProfiles?.length === 1 && allProfiles[0].id === alex.id,
    `got ${allProfiles?.length} rows`,
  );

  const { data: otherPrivacy } = await alex.client
    .from('privacy_settings')
    .select('user_id')
    .eq('user_id', sam1.id)
    .maybeSingle();
  check("cannot read another member's privacy settings", otherPrivacy === null);

  const { error: crossUpdateErr, data: crossUpdated } = await alex.client
    .from('profiles')
    .update({ display_name: 'Hacked' })
    .eq('id', sam1.id)
    .select();
  check(
    "cannot modify another member's profile",
    !crossUpdated || crossUpdated.length === 0,
    crossUpdateErr?.message,
  );

  console.log('\n6. A user CAN manage their own data');
  const { error: selfUpdateErr } = await alex.client
    .from('profiles')
    .update({ display_name: 'Alex R.' })
    .eq('id', alex.id);
  check('can update own profile', !selfUpdateErr, selfUpdateErr?.message);

  const { error: selfPrivacyErr } = await alex.client
    .from('privacy_settings')
    .update({ presence_visibility: 'friends' })
    .eq('user_id', alex.id);
  check('can opt in to presence sharing', !selfPrivacyErr, selfPrivacyErr?.message);

  console.log('\n7. Clients cannot forge rows the trigger owns');
  const { error: insertProfileErr } = await alex.client
    .from('profiles')
    .insert({ id: crypto.randomUUID(), username: `ghost${stamp}`, display_name: 'Ghost' });
  check('direct profile insert is blocked', !!insertProfileErr, 'insert unexpectedly succeeded');

  const { data: deleted } = await alex.client
    .from('privacy_settings')
    .delete()
    .eq('user_id', alex.id)
    .select();
  check(
    'cannot delete own privacy row (would fail open)',
    !deleted || deleted.length === 0,
    'delete unexpectedly removed the row',
  );

  console.log('\n8. Database-side constraints hold');
  const { error: badUsernameErr } = await alex.client
    .from('profiles')
    .update({ username: 'no spaces!' })
    .eq('id', alex.id);
  check('invalid username format rejected', !!badUsernameErr, 'constraint did not fire');

  const { error: badTimezoneErr } = await alex.client
    .from('profiles')
    .update({ timezone: 'Nowhere/Fake' })
    .eq('id', alex.id);
  check('invalid timezone rejected', !!badTimezoneErr, 'constraint did not fire');

  const { error: updatedAtErr } = await alex.client
    .from('profiles')
    .update({ updated_at: '2000-01-01T00:00:00Z' })
    .eq('id', alex.id);
  const { data: afterBackdate } = await alex.client
    .from('profiles')
    .select('updated_at')
    .eq('id', alex.id)
    .single();
  check(
    'updated_at cannot be backdated by the client',
    !updatedAtErr && new Date(afterBackdate.updated_at).getFullYear() > 2020,
    `got ${afterBackdate?.updated_at}`,
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    console.log('='.repeat(60));
    process.exit(failures.length ? 1 : 0);
  })
  .catch(async (err) => {
    await cleanup();
    console.error('\nVerification aborted:', err.message);
    process.exit(1);
  });
