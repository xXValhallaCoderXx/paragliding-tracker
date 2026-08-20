/**
 * Whatever was thrown, as something a pilot can read.
 *
 * This exists because of a real failure that took a day to find. RTK Query's `.unwrap()`
 * rethrows the *serialized* error, and `repositoryQuery` flattens `Error` to a plain
 * `{ message }` on purpose — an `Error` instance in Redux state is what
 * `serializableStateInvariant` exists to catch. Five separate copies of
 * `error instanceof Error ? error.message : String(error)` had grown around the app, and
 * every one of them fails that check and falls through to `String({ message })`, which is
 * `"[object Object]"`. A SQLite `CHECK constraint failed: flights` was sitting in that
 * object the whole time and never reached the screen.
 *
 * Deliberately duck-typed rather than importing `SerializedQueryError`: `src/lib` is a leaf
 * and a boundary test keeps it one.
 */

/** What to say when the thrown value carries no words of its own. */
const FALLBACK = 'Something went wrong.';

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function errorMessage(error: unknown, fallback: string = FALLBACK): string {
  if (error instanceof Error && usable(error.message)) return error.message;

  // The shape `repositoryQuery` puts in the cache, and the shape `.unwrap()` rethrows.
  if (error !== null && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message: unknown };
    if (usable(message)) return message;
  }

  if (usable(error)) return error;

  // Never `String(error)`. That is what produced "[object Object]", and an empty Error or a
  // stray null deserves a sentence rather than the word "null".
  return fallback;
}
