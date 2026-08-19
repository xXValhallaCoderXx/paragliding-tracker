// Installs a synchronous `globalThis.localStorage` backed by its own SQLite store.
// This is Expo's current recommendation for persisting a Supabase session, and it costs
// no new dependency: expo-sqlite is already here for the recorder. The import is a
// no-op on web (where a real localStorage exists), so the web bundle still builds.
//
// The store is a separate database from `xc-recorder.db`, so it cannot contend with the
// recorder's WAL or its write serializer — auth traffic can never stall a GPS write.
import 'expo-sqlite/localStorage/install';

/**
 * Session storage adapter for supabase-js.
 *
 * Passed explicitly to `createClient` rather than relying on auto-detection, so the
 * choice is visible and testable rather than dependent on which globals happen to exist.
 *
 * Trade-off worth knowing: this is app-private storage, not the Keychain/Keystore, so
 * the refresh token is not encrypted at rest. If that becomes a requirement, seal the
 * value with AES here and keep the key in expo-secure-store — a 32-byte key base64s to
 * 44 characters, far under the iOS ~2 KB limit that makes chunked adapters necessary.
 * This file is the only thing that would change.
 */
export const sessionStorage = {
  getItem: (key: string): string | null => globalThis.localStorage.getItem(key),
  setItem: (key: string, value: string): void => {
    globalThis.localStorage.setItem(key, value);
  },
  removeItem: (key: string): void => {
    globalThis.localStorage.removeItem(key);
  },
};
