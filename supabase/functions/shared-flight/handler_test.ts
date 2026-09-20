import { cleanupArtifacts, createSharedFlightHandler, type SharedFlightAdmin } from './handler.ts';
import { digest, MAX_ARTIFACT_BYTES } from './validator.ts';
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
const OWNER = '61000000-0000-0000-0000-000000000001';
const ACTIVITY = '62000000-0000-0000-0000-000000000001';
const TOKEN = '63000000-0000-0000-0000-000000000001';
const GENERATION = '64000000-0000-0000-0000-000000000001';
const PATH = `${OWNER}/${ACTIVITY}-${GENERATION}.json`;
const artifact = () => ({ schemaVersion: 1, provenance: 'recorded', bounds: { startedAt: 1000, endedAt: 2000 }, partial: false,
  points: [{ timestamp: 1000, latitude: 1, longitude: 2, altitude: null, speed: null },
    { timestamp: 2000, latitude: 1.1, longitude: 2.1, altitude: 300, speed: 12 }] });
const publication = { flightId: GENERATION, activityId: ACTIVITY, revision: 1, state: 'shared' };
function fixture(options: { authFail?: boolean; beginError?: string; activateError?: string; lostUploadReply?: boolean;
  badStoredBytes?: boolean; denySecondRead?: boolean; alreadyPublished?: boolean; removeFail?: boolean } = {}) {
  const files = new Map<string, Blob>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const writes: string[] = [];
  let readChecks = 0;
  const admin: SharedFlightAdmin = {
    auth: { getUser: () => Promise.resolve({ data: { user: options.authFail ? null : { id: OWNER } }, error: null }) },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'social_begin_upload') return options.beginError ? { data: null, error: { message: options.beginError } } : {
        data: options.alreadyPublished ? { alreadyPublished: true, publication } : { alreadyPublished: false, objectPath: PATH, startedAt: 1000, endedAt: 2000, partial: false }, error: null };
      if (name === 'social_activate_upload') return options.activateError ? { data: null, error: { message: options.activateError } } : { data: publication, error: null };
      if (name === 'social_authorize_artifact') {
        readChecks += 1;
        if (options.denySecondRead && readChecks > 1) return { data: null, error: { code: '42501', message: 'private database detail' } };
        const bytes = new TextEncoder().encode(JSON.stringify(artifact()));
        return { data: { objectPath: PATH, byteCount: bytes.length, sha256: await digest(bytes) }, error: null };
      }
      if (name === 'social_list_artifact_cleanup') return { data: [], error: null };
      return { data: null, error: null };
    },
    storage: { from(bucket) {
      equal(bucket, 'shared-flight-replays');
      return {
        upload(path, bytes, opts) {
          equal(opts, { contentType: 'application/json', upsert: false });
          writes.push(path); files.set(path, new Blob([new Uint8Array(bytes)]));
          return Promise.resolve({ error: options.lostUploadReply ? { message: 'network lost' } : null });
        },
        download(path) { return Promise.resolve({ data: options.badStoredBytes ? new Blob(['invalid']) : files.get(path) ?? null, error: null }); },
        remove(paths) { if (!options.removeFail) for (const path of paths) files.delete(path); return Promise.resolve({ error: options.removeFail ? { message: 'storage error' } : null }); },
      };
    } },
  };
  const handler = createSharedFlightHandler({ env: (name) => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'secret' })[name], createAdmin: () => admin });
  const request = (value: unknown, headers: Record<string, string> = {}) => handler(new Request('https://example.invalid/shared-flight', {
    method: 'POST', headers: { Authorization: 'Bearer test-token', ...headers }, body: JSON.stringify(value),
  }));
  const upload = (value: unknown = artifact()) => request({ action: 'upload', activityId: ACTIVITY, uploadToken: TOKEN, artifact: value });
  const read = () => request({ action: 'read', activityId: ACTIVITY, generation: GENERATION });
  return { request, upload, read, files, calls, writes, admin, handler };
}
Deno.test('upload derives owner from verified auth and publishes only after immutable object upload', async () => {
  const state = fixture(); const result = await state.upload();
  equal(result.status, 200); equal(await result.json(), publication);
  equal(state.writes, [PATH]);
  equal(state.calls[0], { name: 'social_begin_upload', args: { p_owner: OWNER, p_activity_id: ACTIVITY, p_upload_token: TOKEN } });
  const activate = state.calls.find((call) => call.name === 'social_activate_upload')!;
  equal(activate.args.p_replay_available, true);
  equal(activate.args.p_route_preview, [[1, 2, 1.1, 2.1]]);
  equal(String(activate.args.p_sha256).length, 64);
});
Deno.test('authenticated owner cannot inject a different owner ID', async () => {
  const state = fixture(); const result = await state.request({ action: 'upload', ownerId: 'someone-else', activityId: ACTIVITY, uploadToken: TOKEN, artifact: artifact() });
  equal(result.status, 400); equal(state.calls, []); equal(state.writes, []);
});
Deno.test('private fields are rejected before reservations or storage writes', async () => {
  const state = fixture(); const result = await state.upload({ ...artifact(), notes: 'private' });
  equal(result.status, 400); equal(await result.json(), { error: 'shared_artifact_invalid' }); equal(state.calls, []);
});
Deno.test('actual request size is bounded independently of content-length', async () => {
  const state = fixture(); const result = await state.request({ padding: 'x'.repeat(MAX_ARTIFACT_BYTES + 1024) }, { 'Content-Length': '1' });
  equal(result.status, 400); equal(state.calls, []);
});
Deno.test('auth failure cannot reach database or storage', async () => {
  const state = fixture({ authFail: true }); equal((await state.upload()).status, 401); equal(state.calls, []);
});
for (const code of ['shared_consent_changed', 'shared_publication_changed', 'shared_account_deleting', 'shared_flight_not_ready']) {
  Deno.test(`${code} stays actionable and creates no object`, async () => {
    const state = fixture({ beginError: code }); const result = await state.upload();
    equal(result.status, 409); equal(await result.json(), { error: code }); equal(state.writes, []);
  });
}
Deno.test('hide during upload prevents activation and releases the lease for durable cleanup', async () => {
  const state = fixture({ activateError: 'shared_publication_changed' }); const result = await state.upload();
  equal(result.status, 409);
  equal(state.calls.some((call) => call.name === 'social_finish_failed_upload'), true);
  equal(state.calls.some((call) => call.name === 'social_list_artifact_cleanup'), true);
});
Deno.test('lost upload response reuses only identical immutable bytes', async () => {
  const state = fixture({ lostUploadReply: true }); equal((await state.upload()).status, 200);
  const bad = fixture({ lostUploadReply: true, badStoredBytes: true }); equal((await bad.upload()).status, 503);
  equal(bad.calls.some((call) => call.name === 'social_activate_upload'), false);
});
Deno.test('already-published retry returns receipt without a storage write', async () => {
  const state = fixture({ alreadyPublished: true }); equal((await state.upload()).status, 200); equal(state.writes, []);
});
Deno.test('no-track artifact is published with replay unavailable', async () => {
  const state = fixture(); equal((await state.upload({ ...artifact(), points: [] })).status, 200);
  equal(state.calls.find((call) => call.name === 'social_activate_upload')?.args.p_replay_available, false);
});
Deno.test('read verifies original bytes and authorizes again after download', async () => {
  const state = fixture(); const bytes = JSON.stringify(artifact()); state.files.set(PATH, new Blob([bytes]));
  const result = await state.read(); equal(result.status, 200); equal(await result.text(), bytes);
  equal(result.headers.get('Cache-Control'), 'no-store');
  equal(state.calls.filter((call) => call.name === 'social_authorize_artifact').length, 2);
});
Deno.test('block or hide during download prevents returning already-loaded bytes', async () => {
  const state = fixture({ denySecondRead: true }); state.files.set(PATH, new Blob([JSON.stringify(artifact())]));
  const result = await state.read(); equal(result.status, 403); equal(await result.json(), { error: 'shared_unavailable' });
});
Deno.test('corrupt artifact bytes are not returned', async () => {
  const state = fixture({ badStoredBytes: true }); equal((await state.read()).status, 400);
});
Deno.test('unexpected server diagnostics never enter response', async () => {
  const state = fixture({ beginError: 'SECRET DATABASE DETAIL' }); const result = await state.upload();
  equal(result.status, 503); equal(await result.json(), { error: 'shared_unavailable' });
});
Deno.test('cloud flight mismatch rejects validated-shaped artifact and releases lease', async () => {
  const state = fixture(); const changed = artifact(); changed.bounds.endedAt = 3000;
  equal((await state.upload(changed)).status, 400); equal(state.writes, []);
  equal(state.calls.some((call) => call.name === 'social_finish_failed_upload'), true);
});
Deno.test('cleanup removes only server-authorized owner-prefixed paths and acknowledges failures for retry', async () => {
  const state = fixture({ removeFail: true });
  state.files.set(PATH, new Blob(['retained until storage succeeds']));
  const acknowledgements: Record<string, unknown>[] = [];
  state.admin.rpc = (name, args) => {
    if (name === 'social_list_artifact_cleanup') return Promise.resolve({ data: [
      { ownerId: OWNER, objectPath: PATH },
      { ownerId: OWNER, objectPath: 'another-owner/private.json' },
      { ownerId: OWNER, objectPath: `${OWNER}/../private.json` },
    ], error: null });
    acknowledgements.push(args); return Promise.resolve({ data: null, error: null });
  };
  await cleanupArtifacts(state.admin);
  equal(acknowledgements, [{ p_object_path: PATH, p_removed: false }]);
  equal(state.files.has(PATH), true);
});
Deno.test('successful cleanup acknowledges exactly the removed object', async () => {
  const state = fixture(); state.files.set(PATH, new Blob(['old']));
  const acknowledgements: Record<string, unknown>[] = [];
  state.admin.rpc = (name, args) => {
    if (name === 'social_list_artifact_cleanup') return Promise.resolve({ data: [{ ownerId: OWNER, objectPath: PATH }], error: null });
    acknowledgements.push(args); return Promise.resolve({ data: null, error: null });
  };
  await cleanupArtifacts(state.admin);
  equal(acknowledgements, [{ p_object_path: PATH, p_removed: true }]); equal(state.files.has(PATH), false);
});
