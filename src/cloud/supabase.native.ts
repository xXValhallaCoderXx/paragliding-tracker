import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, cloudConfigured } from './config';
import { sessionStorage } from './session-storage';
import type { Database } from './database.types';
import { CloudError } from './types';

let client: SupabaseClient<Database> | null = null;

/**
 * The Supabase client, constructed on first use.
 *
 * Lazy rather than a module-level `export const supabase` on purpose: it keeps
 * `createClient` out of module evaluation, so `pnpm test`, `expo export` and a build
 * with no EXPO_PUBLIC_SUPABASE_* configured never construct a client or open a socket.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (!cloudConfigured) {
    throw new CloudError('not_configured', 'Cloud backup is not configured in this build.');
  }
  if (!client) {
    client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: sessionStorage,
        storageKey: 'xc-cloud-session',
        autoRefreshToken: true,
        persistSession: true,
        // No magic links and no OAuth, so there is never a session in a URL to detect.
        detectSessionInUrl: false,
      },
      // Realtime is never subscribed to; this only keeps an idle socket cheap.
      realtime: { params: { eventsPerSecond: 1 } },
      global: { headers: { 'x-client-info': 'flight-log-alpha' } },
    });
    installAutoRefreshBridge(client);
  }
  return client;
}

/**
 * Runs the token refresh timer only while the app is foregrounded.
 *
 * This matters more here than in a typical app: a flight is a multi-hour background
 * recording, and a periodic auth refresh would wake the radio in competition with the
 * GPS foreground service. Supabase refresh tokens rotate rather than expire on a wall
 * clock, so a token that goes stale in the background is simply refreshed on next use.
 *
 * Installed once at client construction, not from a React effect, so remounts cannot
 * stack listeners.
 */
function installAutoRefreshBridge(supabase: SupabaseClient<Database>): void {
  const apply = (state: AppStateStatus) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  };
  apply(AppState.currentState);
  AppState.addEventListener('change', apply);
}
