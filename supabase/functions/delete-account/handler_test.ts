import { createDeleteAccountHandler, type DeletionAdmin } from './handler.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function fixture(count: number, options: {
  invalidToken?: boolean;
  missingUser?: boolean;
  listFailure?: number;
  removeFailure?: number;
  deleteFailure?: boolean;
  env?: Record<string, string | undefined>;
} = {}) {
  const files = new Set(Array.from({ length: count }, (_, index) => `owner/${index}.igc`));
  files.add('someone-else/private.igc');
  const calls: string[] = [];
  const deletedUsers: string[] = [];
  const tokens: string[] = [];
  const clients: [string, string][] = [];
  let lists = 0;
  let removals = 0;
  const admin: DeletionAdmin = {
    auth: {
      getUser(token) {
        tokens.push(token);
        return Promise.resolve({
          data: { user: options.missingUser ? null : { id: 'owner' } },
          error: options.invalidToken ? { message: 'Invalid token' } : null,
        });
      },
      admin: {
        deleteUser(id) {
          calls.push('delete-user');
          // Storage must be empty at the moment the auth deletion is attempted.
          equal([...files].filter((path) => path.startsWith(`${id}/`)), []);
          if (options.deleteFailure) return Promise.resolve({ error: { message: 'Auth unavailable' } });
          deletedUsers.push(id);
          return Promise.resolve({ error: null });
        },
      },
    },
    storage: {
      from(bucket) {
        equal(bucket, 'flight-igc');
        return {
          list(prefix, { limit, offset }) {
            calls.push('list');
            lists += 1;
            if (lists === options.listFailure) return Promise.resolve({ data: null, error: { message: 'List unavailable' } });
            return Promise.resolve({
              data: [...files].filter((path) => path.startsWith(`${prefix}/`)).sort()
                .slice(offset, offset + limit).map((path) => ({ name: path.slice(prefix.length + 1) })),
              error: null,
            });
          },
          remove(paths) {
            calls.push('remove');
            removals += 1;
            if (removals === options.removeFailure) return Promise.resolve({ error: { message: 'Remove unavailable' } });
            for (const path of paths) files.delete(path);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
  const env = options.env ?? { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-secret' };
  const handler = createDeleteAccountHandler({
    env: (name) => env[name],
    createAdmin: (url, key) => { clients.push([url, key]); return admin; },
  });
  return { handler, files, calls, deletedUsers, tokens, clients };
}

function request(authorization: string | null = 'Bearer owner-token', body?: unknown) {
  return new Request('https://example.invalid/delete-account', {
    method: 'POST', headers: authorization === null ? {} : { Authorization: authorization },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

for (const count of [0, 1, 99, 100, 101, 199, 200, 201, 250, 350]) {
  Deno.test(`drains ${count} archives before deleting only the verified owner`, async () => {
    const state = fixture(count);
    const response = await state.handler(request());
    equal(response.status, 200);
    equal(await response.json(), { deleted: true });
    equal([...state.files], ['someone-else/private.igc']);
    equal(state.deletedUsers, ['owner']);
    equal(state.calls.at(-1), 'delete-user');
  });
}

Deno.test('only the verified token chooses the account, ignoring a body user ID', async () => {
  const state = fixture(101);
  const response = await state.handler(request('bEaReR owner-token', { userId: 'someone-else' }));
  equal(response.status, 200);
  equal(state.tokens, ['owner-token']);
  equal(state.deletedUsers, ['owner']);
  equal([...state.files], ['someone-else/private.igc']);
});

for (const authorization of [null, '', 'Bearer', 'Basic owner-token', 'owner-token']) {
  Deno.test(`rejects malformed authorization ${JSON.stringify(authorization)} without a client`, async () => {
    const state = fixture(1);
    equal((await state.handler(request(authorization))).status, 401);
    equal(state.clients, []);
    equal(state.calls, []);
  });
}

for (const options of [{ invalidToken: true }, { missingUser: true }]) {
  Deno.test(`rejects unverified callers ${JSON.stringify(options)} without mutations`, async () => {
    const state = fixture(1, options);
    equal((await state.handler(request())).status, 401);
    equal(state.calls, []);
    equal(state.deletedUsers, []);
  });
}

Deno.test('rejects other methods before authentication', async () => {
  const state = fixture(1);
  equal((await state.handler(new Request('https://example.invalid/delete-account'))).status, 405);
  equal(state.clients, []);
});

for (const env of [{}, { SUPABASE_URL: 'https://example.invalid' }, { SUPABASE_SERVICE_ROLE_KEY: 'test-secret' }]) {
  Deno.test(`rejects missing server configuration ${Object.keys(env).join(',')}`, async () => {
    const state = fixture(1, { env });
    equal((await state.handler(request())).status, 500);
    equal(state.clients, []);
  });
}

Deno.test('prefers the explicit secret override', async () => {
  const state = fixture(0, { env: {
    SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'legacy', ACCOUNT_DELETION_SECRET_KEY: 'override',
  } });
  equal((await state.handler(request())).status, 200);
  equal(state.clients, [['https://example.invalid', 'override']]);
});

for (const [kind, failure] of [['list', 'listFailure'], ['remove', 'removeFailure']] as const) {
  for (const attempt of [1, 2]) {
    Deno.test(`${kind} failure on page ${attempt} preserves the account and remaining archives`, async () => {
      const state = fixture(201, { [failure]: attempt });
      const response = await state.handler(request());
      equal(response.status, 500);
      equal(state.deletedUsers, []);
      equal(state.calls.at(-1), kind);
      equal([...state.files].filter((path) => path.startsWith('owner/')).length, attempt === 1 ? 201 : 101);
      equal(state.files.has('someone-else/private.igc'), true);
    });
  }
}

Deno.test('reports auth deletion failure after archive cleanup', async () => {
  const state = fixture(101, { deleteFailure: true });
  const response = await state.handler(request());
  equal(response.status, 500);
  equal(await response.text(), 'Auth unavailable');
  equal(state.deletedUsers, []);
  equal([...state.files], ['someone-else/private.igc']);
});
