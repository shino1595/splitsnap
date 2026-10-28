// The only file that loads supabase-js. It is imported with import() on first use, like the
// photo libraries, so a library that can't load in some runtime only disables sharing instead of
// crashing the app at start-up (docs/SYNC_DESIGN.md §1).
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSyncConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

let clientPromise: Promise<SupabaseClient> | null = null;

/** The shared client (anonymous session kept in AsyncStorage). Rejects if sharing isn't set up. */
export function loadSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!isSyncConfigured()) throw new Error('Shared groups are not set up in this version of the app.');
      // React Native's built-in URL lacks parts supabase-js uses (searchParams, hostname).
      if (Platform.OS !== 'web') await import('react-native-url-polyfill/auto');
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      });
      // Supabase's advice for React Native: refresh tokens only while the app is in the foreground.
      if (Platform.OS !== 'web') {
        AppState.addEventListener('change', (status) => {
          if (status === 'active') void client.auth.startAutoRefresh();
          else void client.auth.stopAutoRefresh();
        });
      }
      return client;
    })().catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** The signed-in user's id, signing in anonymously the first time. */
export async function ensureSignedIn(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;
  const result = await client.auth.signInAnonymously();
  if (result.error || !result.data.user) throw new Error(result.error ? result.error.message : 'Anonymous sign-in failed.');
  return result.data.user.id;
}
