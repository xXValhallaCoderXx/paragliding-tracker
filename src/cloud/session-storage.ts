import * as SecureStore from 'expo-secure-store';

// Only still here to migrate sessions written by the previous release, which kept them
// in app-private SQLite. Drop this import — and `readLegacySession` with it — one release
// after everyone has launched the build below at least once.
import 'expo-sqlite/localStorage/install';

/**
 * Session storage adapter for supabase-js, backed by the iOS Keychain and the Android
 * Keystore.
 *
 * Passed explicitly to `createClient` rather than relying on auto-detection, so the
 * choice is visible and testable rather than dependent on which globals happen to exist.
 *
 * Two platform facts shape everything here:
 *
 *  - SecureStore has no synchronous delete, so the adapter is async. That is fine —
 *    supabase-js types `SupportedStorage` as `PromisifyMethods<...>`, so promise-returning
 *    methods are a first-class option rather than a workaround.
 *  - iOS rejects large keychain values (historically anything past ~2 KB) and a Supabase
 *    session comfortably exceeds that once it holds two JWTs and a user object. So the
 *    value is split across numbered items with the chunk count stored under the plain key.
 *
 * Worst case on a torn write is a corrupt read, which surfaces as "no session" and costs
 * the pilot one sign-in. `cloudAuthService.restore()` already treats an unreadable session
 * as signed-out, and nothing about the local logbook depends on it.
 */

const OPTIONS: SecureStore.SecureStoreOptions = {
  // The recorder runs for hours with the screen locked. `WHEN_UNLOCKED` would make the
  // refresh token unreadable mid-flight; `AFTER_FIRST_UNLOCK` is readable from the first
  // unlock after boot onwards. `THIS_DEVICE_ONLY` also keeps it out of iCloud backups.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  // Never prompt for biometrics. A token refresh can happen while the app is being
  // brought to the foreground; a Face ID sheet there would be unexplainable.
  requireAuthentication: false,
};

/**
 * Conservative: comfortably under the ~2 KB ceiling even after UTF-8 expansion, and small
 * enough that raising it later is a one-line change rather than a migration.
 */
const MAX_CHUNK_BYTES = 1024;

/** UTF-8 length of a single code point, without allocating a TextEncoder. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Splits on code point boundaries, never mid-surrogate-pair: the platforms store UTF-8,
 * and a lone surrogate is not valid UTF-8, so a naive `slice` could corrupt a value on
 * the way back out.
 */
function chunk(value: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of value) {
    const size = utf8Length(character.codePointAt(0) ?? 0);
    if (bytes + size > MAX_CHUNK_BYTES && current.length > 0) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const chunkKey = (key: string, index: number): string => `${key}.${index}`;

/** Removes chunks from `from` upward until one is already absent. */
async function removeChunksFrom(key: string, from: number): Promise<void> {
  for (let index = from; ; index += 1) {
    const existing = await SecureStore.getItemAsync(chunkKey(key, index), OPTIONS);
    if (existing === null) return;
    await SecureStore.deleteItemAsync(chunkKey(key, index), OPTIONS);
  }
}

/** The session written by the previous release, or null. Safe to call on every miss. */
function readLegacySession(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  const chunks = chunk(value);
  for (const [index, part] of chunks.entries()) {
    await SecureStore.setItemAsync(chunkKey(key, index), part, OPTIONS);
  }
  // The count goes in last, so a crash part-way through leaves the previous count
  // pointing at chunks that no longer agree — which reads as corrupt, not as a
  // half-valid session.
  await SecureStore.setItemAsync(key, String(chunks.length), OPTIONS);
  await removeChunksFrom(key, chunks.length);
}

async function removeItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS);
  await removeChunksFrom(key, 0);
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // The legacy store may not exist. Signing out must never fail on it.
  }
}

async function getItem(key: string): Promise<string | null> {
  const header = await SecureStore.getItemAsync(key, OPTIONS);

  if (header === null) {
    // One-time migration. Without it, upgrading the app would silently sign out every
    // pilot who already had an account.
    const legacy = readLegacySession(key);
    if (legacy === null) return null;
    await setItem(key, legacy);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Leaving the old copy behind is untidy, not harmful. Never fail a restore on it.
    }
    return legacy;
  }

  const count = Number.parseInt(header, 10);
  if (!Number.isInteger(count) || count < 1) {
    await removeItem(key);
    return null;
  }

  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const part = await SecureStore.getItemAsync(chunkKey(key, index), OPTIONS);
    if (part === null) {
      // A torn write. Clear it rather than handing supabase-js half a session.
      await removeItem(key);
      return null;
    }
    parts.push(part);
  }
  return parts.join('');
}

export const sessionStorage = { getItem, setItem, removeItem };
