import { Platform } from 'react-native';

/**
 * The contract every RTK Query `queryFn` in this app follows.
 *
 * Deliberately free of imports beyond `Platform`, so jest can execute it without pulling
 * the store, react-redux or expo-sqlite into a unit test.
 */

/** Whether the local database exists on this platform. */
export const DATA_AVAILABLE = Platform.OS !== 'web';

/**
 * What a failed read puts in the cache.
 *
 * The repositories throw `Error` and `RecorderError`; an `Error` instance in Redux state
 * is exactly what `serializableStateInvariant` exists to catch, and it would not survive
 * a devtools round-trip either.
 */
export interface SerializedQueryError {
  message: string;
  /** Present when the thrown value carried one — `RecorderError` and `CloudError` do. */
  code?: string;
}

export function serializeQueryError(error: unknown): SerializedQueryError {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      message: error.message,
      ...(typeof code === 'string' ? { code } : {}),
    };
  }
  return { message: String(error) };
}

const UNAVAILABLE: { error: SerializedQueryError } = {
  error: { message: 'The local flight logbook is only available in the installed mobile app.' },
};

/**
 * The one place a repository rejection becomes cache state instead of a throw.
 *
 * This is not tidiness. RTK Query rethrows anything a `queryFn` throws, and its own error
 * message says why that matters: *"In the case of an unhandled error, no tags will be
 * provided or invalidated."* An entry that threw once never registers as providing its
 * tags, so every later `invalidateTags` silently misses it — a transient SQLite hiccup
 * would become permanent staleness. Returning `{ error }` keeps the entry in the tag
 * graph so the next invalidation still repairs it.
 *
 * The web short-circuit is the correctness guard; `skip` at the call sites is the
 * optimisation. Queries dispatch from an effect rather than during render, so static
 * rendering never reaches either, but a browser would.
 */
export async function repositoryQuery<T>(
  read: () => Promise<T>,
): Promise<{ data: T } | { error: SerializedQueryError }> {
  if (!DATA_AVAILABLE) return UNAVAILABLE;
  try {
    return { data: await read() };
  } catch (error) {
    return { error: serializeQueryError(error) };
  }
}
