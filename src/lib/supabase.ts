import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
// Supabase's realtime and fetch paths rely on a WHATWG-compliant URL
// implementation, which React Native's Hermes runtime does not fully provide.
// This polyfill must be imported before the client is created.
import 'react-native-url-polyfill/auto';

import { env } from '@/config/env';
import type { Database } from '@/types/database.types';

/**
 * The single Supabase client for the app.
 *
 * Typed with the generated `Database` type, so every query, insert, and enum
 * value is checked at compile time. Regenerate after any migration:
 *
 *   npm run db:types
 *
 * SECURITY: this uses the anon key, which ships inside the app bundle and is
 * therefore public. It confers no authority by itself — row-level security
 * decides what each authenticated user can read and write. Never use the
 * service_role key here; it bypasses RLS and belongs only in Edge Functions.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    // Sessions persist across app restarts so members are not forced to
    // re-authenticate before every workout.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,

    // Only relevant on web, where a session can arrive in the URL fragment.
    // Enabling it in React Native causes spurious parsing of deep links.
    detectSessionInUrl: false,
  },
});

export type SupabaseClientType = typeof supabase;
