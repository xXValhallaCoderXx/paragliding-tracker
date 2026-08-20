import type { SiteErrorKind, SiteLookupError } from './types';

/**
 * The one HTTP helper this app has.
 *
 * Everything else talks to Supabase through supabase-js, which returns `{ data, error }`
 * and never throws for a bad status. `fetch` does neither, so two things that are easy to
 * forget are handled here once: a non-2xx response is not an error to `fetch`, and a
 * timeout has to be built rather than passed.
 */

/**
 * Injectable so tests never touch the network.
 *
 * The jest environment is Node, where `fetch` is real — a test that forgot to stub it
 * would quietly make live requests against a volunteer-run service.
 */
export type Transport = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  transport?: Transport;
}

/** Long enough for a slow mobile connection, short enough not to feel broken. */
const DEFAULT_TIMEOUT_MS = 6_000;

export function siteError(kind: SiteErrorKind, message: string): SiteLookupError {
  return { kind, message };
}

/**
 * Maps a failure to something the UI can reason about.
 *
 * The message shapes differ between the device and the test environment — React Native's
 * `whatwg-fetch` says "Network request failed" and aborts with "Aborted", while Node's
 * undici says "fetch failed" and "This operation was aborted". Both are matched, because
 * a classifier that only recognises the one you can test is a classifier that fails in
 * exactly the place it matters.
 */
export function classifySiteError(error: unknown, status?: number): SiteErrorKind {
  if (status === 429) return 'throttled';
  if (status !== undefined && status >= 400) return 'unavailable';

  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return 'aborted';

  const message = error instanceof Error ? error.message : String(error);
  if (/network request failed|fetch failed|failed to fetch/i.test(message)) return 'offline';
  if (/abort/i.test(message)) return 'aborted';
  return 'unavailable';
}

/**
 * Fetches JSON, or throws a `SiteLookupError`.
 *
 * Uses `AbortController` plus a timer rather than `AbortSignal.timeout()`. That helper
 * exists in Node — so it would pass every test here — and does **not** exist in the
 * `abort-controller` polyfill React Native ships, so it would throw on a phone. A
 * structural test guards against it being reintroduced, because no runtime test can.
 */
export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const transport = options.transport ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // A caller-supplied signal (RTK Query hands one to every queryFn) has to cancel this
  // request too, so an abandoned search stops rather than running to completion.
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller);

  try {
    const response = await transport(url, { signal: controller.signal });
    if (!response.ok) {
      // `fetch` resolves for 4xx and 5xx. Forgetting this turns "slow down" into
      // "no results found", which is the wrong thing to tell a pilot and the wrong
      // thing to do to a fair-use service.
      throw siteError(
        classifySiteError(null, response.status),
        `Site lookup failed with status ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (isSiteLookupError(error)) throw error;
    throw siteError(classifySiteError(error), messageOf(error));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function isSiteLookupError(value: unknown): value is SiteLookupError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as SiteLookupError).kind === 'string'
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds a query string with every value encoded.
 *
 * A place name with an ampersand in it would otherwise become parameter injection, and a
 * diacritic would become a malformed request — both silent, both only visible as "no
 * results" for the handful of sites whose names contain them.
 */
export function buildUrl(base: string, params: Record<string, string | number>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${base}?${query}`;
}
