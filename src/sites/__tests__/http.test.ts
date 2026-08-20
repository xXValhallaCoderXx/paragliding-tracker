import { buildUrl, classifySiteError, fetchJson, isSiteLookupError } from '../http';

/**
 * The transport is injected precisely so these never touch the network. The jest
 * environment is Node, where `fetch` is real — a test that forgot to stub it would make
 * live requests against a volunteer-run service on every CI run.
 */
function respondWith(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('buildUrl', () => {
  it('encodes every value', () => {
    expect(buildUrl('https://x.test/api', { q: 'Bukit Jugra', limit: 8 })).toBe(
      'https://x.test/api?q=Bukit%20Jugra&limit=8',
    );
  });

  it('encodes the characters that would otherwise inject a parameter', () => {
    // A place name containing an ampersand is not exotic, and unencoded it silently
    // becomes an extra query parameter.
    expect(buildUrl('https://x.test/api', { q: 'Sun & Moon' })).toContain('q=Sun%20%26%20Moon');
    expect(buildUrl('https://x.test/api', { q: 'Zürs' })).toContain('q=Z%C3%BCrs');
  });
});

describe('classifySiteError', () => {
  it('treats 429 as throttling, not as failure', () => {
    // Photon is fair-use. Reporting this as "no results" would be a lie and would invite
    // the caller to retry, which is the last thing a throttled service needs.
    expect(classifySiteError(null, 429)).toBe('throttled');
  });

  it('treats other bad statuses as the service being unavailable', () => {
    expect(classifySiteError(null, 503)).toBe('unavailable');
    expect(classifySiteError(null, 404)).toBe('unavailable');
  });

  it('recognises offline in both environments', () => {
    // React Native's whatwg-fetch and Node's undici word this differently, and only one
    // of them is the one tests run against.
    expect(classifySiteError(new TypeError('Network request failed'))).toBe('offline');
    expect(classifySiteError(new TypeError('fetch failed'))).toBe('offline');
    expect(classifySiteError(new TypeError('Failed to fetch'))).toBe('offline');
  });

  it('recognises an abort in both environments', () => {
    const rnAbort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const nodeAbort = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    expect(classifySiteError(rnAbort)).toBe('aborted');
    expect(classifySiteError(nodeAbort)).toBe('aborted');
  });

  it('falls back to unavailable rather than guessing', () => {
    expect(classifySiteError(new Error('something odd'))).toBe('unavailable');
    expect(classifySiteError('a string')).toBe('unavailable');
  });
});

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    await expect(
      fetchJson('https://x.test', { transport: respondWith({ features: [] }) }),
    ).resolves.toEqual({ features: [] });
  });

  it('treats a non-2xx as an error, which fetch does not', async () => {
    // The single most likely mistake in a codebase whose every other HTTP call goes
    // through supabase-js: fetch resolves for 429 and 503.
    await expect(
      fetchJson('https://x.test', { transport: respondWith({}, 429) }),
    ).rejects.toMatchObject({ kind: 'throttled' });
    await expect(
      fetchJson('https://x.test', { transport: respondWith({}, 503) }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('classifies a network failure as offline', async () => {
    await expect(
      fetchJson('https://x.test', {
        transport: async () => {
          throw new TypeError('Network request failed');
        },
      }),
    ).rejects.toMatchObject({ kind: 'offline' });
  });

  it('always rejects with a classified error, never a raw one', async () => {
    const rejection = await fetchJson('https://x.test', {
      transport: async () => {
        throw new Error('boom');
      },
    }).catch((error: unknown) => error);
    expect(isSiteLookupError(rejection)).toBe(true);
  });

  it('aborts when the caller aborts', async () => {
    // RTK Query hands every queryFn a signal and aborts it when the subscription drops,
    // so an abandoned search must stop rather than run to completion.
    const controller = new AbortController();
    const pending = fetchJson('https://x.test', {
      signal: controller.signal,
      transport: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
          );
        }),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('gives up on a request that never answers', async () => {
    const pending = fetchJson('https://x.test', {
      timeoutMs: 10,
      transport: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
          );
        }),
    });
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});
