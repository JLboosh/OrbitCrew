/**
 * Shared harness for verification scripts that run against a real Supabase
 * project.
 *
 * Test users are created with the service-role key (so they are pre-confirmed
 * and no email round-trip is needed), but every assertion afterwards runs
 * through a NORMAL authenticated session. That distinction matters: it means the
 * checks exercise row-level security exactly as the app does, rather than
 * bypassing it.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnvFile(url) {
  const out = {};
  try {
    for (const line of readFileSync(url, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) out[match[1]] = match[2];
    }
  } catch {
    // Optional: values may already be present in the environment.
  }
  return out;
}

export function loadConfig(importMetaUrl) {
  const fileEnv = loadEnvFile(new URL('../.env', importMetaUrl));

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fileEnv.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error(
      'Missing SUPABASE_SERVICE_ROLE_KEY.\n' +
        'It is required to create pre-confirmed test users, and is deliberately\n' +
        'not stored in .env because it bypasses row-level security.',
    );
    process.exit(1);
  }

  return { supabaseUrl, anonKey, serviceKey };
}

export function createHarness(config) {
  const admin = createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const createdUserIds = [];
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

  function section(title) {
    console.log(`\n${title}`);
  }

  /** Creates a confirmed user and returns an authenticated client for them. */
  async function createUser(label, metadata = {}) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `${label}.${stamp}@gymcrew.test`;
    const password = `Test-${stamp}-aB!`;

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
    createdUserIds.push(data.user.id);

    const client = createClient(config.supabaseUrl, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn(${email}) failed: ${signInError.message}`);

    return { id: data.user.id, email, client, label };
  }

  async function cleanup() {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  function report() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    console.log('='.repeat(60));
    return failures.length === 0;
  }

  /** Wraps a suite with cleanup and a correct process exit code. */
  async function run(suite) {
    try {
      await suite({ admin, createUser, check, section });
      await cleanup();
      process.exit(report() ? 0 : 1);
    } catch (err) {
      await cleanup();
      console.error('\nVerification aborted:', err.message);
      process.exit(1);
    }
  }

  return { admin, createUser, check, section, cleanup, report, run };
}
