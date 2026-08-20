/**
 * The contract every RTK Query `queryFn` in this app follows.
 *
 * Deliberately free of runtime imports, so jest can execute it without pulling the store,
 * react-redux or expo-sqlite into a unit test.
 */

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

/**
 * The one place a repository rejection becomes cache state instead of a throw.
 *
 * This is not tidiness. RTK Query rethrows anything a `queryFn` throws, and its own error
 * message says why that matters: *"In the case of an unhandled error, no tags will be
 * provided or invalidated."* An entry that threw once never registers as providing its
 * tags, so every later `invalidateTags` silently misses it — a transient SQLite hiccup
 * would become permanent staleness. Returning `{ error }` keeps the entry in the tag
 * graph so the next invalidation still repairs it.
 */
export async function repositoryQuery<T>(
  read: () => Promise<T>,
): Promise<{ data: T } | { error: SerializedQueryError }> {
  try {
    return { data: await read() };
  } catch (error) {
    return { error: serializeQueryError(error) };
  }
}
