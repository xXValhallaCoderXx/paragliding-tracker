/** Real Auth/PostgREST/Storage/Edge acceptance. Default execution creates and
 * removes an isolated local stack; the exported verifier supports release smoke.
 * Only randomly created disposable accounts and their owner prefixes are touched.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(import.meta.dirname, '..');
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { fetch: (input, init = {}) => fetch(input, { ...init,
    signal: AbortSignal.any([init.signal, AbortSignal.timeout(30_000)].filter(Boolean)) }) } };
function ok(result, label) {
  assert.ok(!result.error, `${label} failed (code ${result.error?.code ?? result.error?.status ?? 'unknown'}).`);
  return result.data;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifySharedFlights(url, publicKey, adminKey) {
  const admin = createClient(url, adminKey, options);
  const anonymous = createClient(url, publicKey, options);
  const accounts = [];
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, label); console.log(`PASS ${++checks}: ${label}`); };
  const rpc = async (account, name, args = {}) => ok(await account.client.rpc(name, args), name);
  const deniedRpc = async (account, name, args = {}) => !!(await account.client.rpc(name, args)).error;
  const edge = async (account, body, functionName = 'shared-flight') => {
    const response = await fetch(new URL(`/functions/v1/${functionName}`, url), { method: 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${account?.token ?? publicKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data; try { data = JSON.parse(bytes.toString()); } catch { data = null; }
    return { status: response.status, bytes, data };
  };
  const edgeOk = (result, label) => {
    const code = typeof result.data?.error === 'string' && /^[a-z_]+$/.test(result.data.error) ? result.data.error : 'unavailable';
    assert.equal(result.status, 200, `${label} failed (${result.status}/${code}).`);
    return result;
  };
  const state = account => rpc(account, 'social_get_state');
  const prefs = account => rpc(account, 'social_get_sharing_preferences');
  const detail = (account, activityId) => rpc(account, 'social_get_activity', { p_activity_id: activityId });
  const publication = (account, flight) => rpc(account, 'social_get_my_publication', { p_flight_id: flight.id });
  const prepare = (account, flight, revision, mode = 'manual', generation = null, operationId = randomUUID()) =>
    rpc(account, 'social_prepare_share', { p_flight_id: flight.id, p_operation_id: operationId, p_mode: mode,
      p_consent_generation: generation, p_expected_revision: revision });
  const upload = (account, prepared, artifact) => edge(account, { action: 'upload', activityId: prepared.activityId, uploadToken: prepared.uploadToken, artifact });
  const read = (account, summary) => edge(account, { action: 'read', activityId: summary.activityId, generation: summary.artifact.generation });
  const cleanup = account => edge(account, { action: 'cleanup' });
  const hide = (account, flight) => rpc(account, 'social_hide_flight', { p_flight_id: flight.id });
  const auto = (account, enabled) => rpc(account, 'social_set_auto_share', { p_enabled: enabled });
  const relationship = async (account, other, action, id) => rpc(account, 'social_change_relationship', {
    p_other_user_id: other.id, p_action: action, ...(id ? { p_request_id: id } : {}) });
  const invite = async (account, other) => rpc(account, 'social_request_pilot', { p_user_id: other.id });
  const accept = async (account, other) => {
    const pending = (await state(account)).relationships.find(row => row.userId === other.id);
    await relationship(account, other, 'accept', pending.id); return pending.id;
  };
  const bytesInBucket = async (bucket, account) => ok(await admin.storage.from(bucket).list(account.id, { limit: 1000 }), 'Inspect disposable storage');
  const seed = async (account, patch = {}) => {
    const startedAt = Date.UTC(2026, 8, 21, 3);
    const flight = { id: randomUUID(), user_id: account.id, recording_session_id: randomUUID(), status: 'completed',
      started_at: startedAt, ended_at: startedAt + 60_000, timezone_offset_minutes: -480,
      client_created_at: startedAt, client_updated_at: startedAt, title: 'Disposable shared flight', site: 'Test launch',
      site_source: 'manual', notes: 'PRIVATE-DO-NOT-SHARE', metrics_algorithm_version: 3,
      duration_ms: 60_000, track_distance_metres: 1500, min_gps_altitude: 300, max_gps_altitude: 400,
      max_ground_speed: 15, fix_count: 3, quality: 'healthy', metrics_computed_at: startedAt + 61_000, ...patch };
    await rpc(account, 'write_private_flight', { p_flight: flight });
    return flight;
  };
  const artifactFor = (flight, noGps = false) => ({ schemaVersion: 1, provenance: 'recorded',
    bounds: { startedAt: flight.started_at, endedAt: flight.ended_at }, partial: flight.status === 'partial',
    points: noGps ? [] : [
      { timestamp: flight.started_at + 1, latitude: 1.31, longitude: 103.81, altitude: null, speed: 12.5 },
      { timestamp: flight.started_at + 1001, latitude: 1.32, longitude: 103.82, altitude: 400, speed: 13.5 },
      { timestamp: flight.ended_at, latitude: 1.33, longitude: 103.83, altitude: 300, speed: null },
    ] });
  try {
    for (const label of ['a', 'b', 'c']) {
      const email = `${label}-${randomUUID()}@shared-http.example.test`;
      const password = `Aa1!${randomUUID()}`;
      const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create disposable account');
      const account = { id: created.user.id, client: createClient(url, publicKey, options), token: null, deleted: false };
      accounts.push(account);
      const session = ok(await account.client.auth.signInWithPassword({ email, password }), 'Authenticate disposable account');
      account.token = session.session.access_token;
    }
    const [a, b, c] = accounts;
    check(new Set(accounts.map(account => account.id)).size === 3, 'three disposable Auth sessions are independent');
    check((await prefs(a)).enabled === false && (await prefs(a)).generation === null, 'automatic sharing defaults off');
    check(!!(await anonymous.rpc('social_list_feed')).error, 'anonymous feed reads are denied');
    for (const [index, account] of accounts.entries()) await rpc(account, 'social_save_profile', {
      p_display_name: `Fixture Pilot ${index + 1}`,
      p_username: `qa_s_${account.id.replaceAll('-', '').slice(0, 18)}`, p_discoverable: true,
    });
    const flight = await seed(a);
    check((await publication(a, flight)).state === 'private', 'older backed-up flight stays private without a manual request');
    const prepared = await prepare(a, flight, 0);
    const artifact = artifactFor(flight);
    check((await publication(a, flight)).state === 'pending' && await deniedRpc(a, 'social_get_activity', { p_activity_id: prepared.activityId }), 'prepared artifact is not visible before activation');
    const invalid = await upload(a, prepared, { ...artifact, notes: 'PRIVATE-LEAK-ATTEMPT' });
    check(invalid.status === 400 && invalid.data?.error === 'shared_artifact_invalid', 'Edge rejects private artifact fields before any upload');
    check((await bytesInBucket('shared-flight-replays', a)).length === 0, 'rejected artifact leaves Storage empty');
    const published = edgeOk(await upload(a, prepared, artifact), 'Recorded replay upload').data;
    check(published.state === 'shared', 'real Edge upload activates a publication');
    const summary = await detail(a, prepared.activityId);
    check(Object.keys(summary).sort().join(',') === ['activityId', 'author', 'publishedAt', 'title', 'site', 'siteSource', 'startedAt', 'endedAt',
      'timezoneOffsetMinutes', 'status', 'metrics', 'routePreview', 'provenance', 'replayAvailable', 'artifact', 'kudos'].sort().join(',') &&
      !JSON.stringify(summary).includes('PRIVATE-DO-NOT-SHARE'), 'detail is an exact safe projection without notes, IGC or recording identity');
    const ownerBytes = edgeOk(await read(a, summary), 'Owner artifact read');
    check(hash(ownerBytes.bytes) === summary.artifact.sha256 && ownerBytes.bytes.length === summary.artifact.byteCount &&
      ownerBytes.bytes.equals(Buffer.from(JSON.stringify(artifact))), 'read returns exact verified sanitized bytes');
    check(ownerBytes.data.points[0].speed === 12.5 && ownerBytes.data.points[0].altitude === null &&
      ownerBytes.data.points[0].timestamp === flight.started_at + 1, 'original replay retains measured speed, missing altitude and millisecond precision');
    check(summary.routePreview.length === 2, 'route preview leaves the real recording gap open');
    check((await read(null, summary)).status >= 400, 'anonymous artifact reads are denied');
    check((await read(c, summary)).status === 403 && await deniedRpc(c, 'social_get_activity', { p_activity_id: summary.activityId }), 'third account cannot read detail or artifact');
    await invite(a, b);
    check((await rpc(b, 'social_list_feed')).items.length === 0 && (await read(b, summary)).status === 403, 'pending friend cannot read posts or routes');
    const firstRelation = await accept(b, a);
    check((await rpc(b, 'social_list_feed')).items.some(item => item.activityId === summary.activityId), 'newly accepted friend sees previously shared history');
    check(hash(edgeOk(await read(b, summary), 'Friend artifact read').bytes) === summary.artifact.sha256, 'accepted friend reads the same sanitized replay');
    check(ok(await b.client.from('flights').select('id').eq('user_id', a.id), 'Private flight read').length === 0 &&
      ok(await b.client.from('profiles').select('id').eq('id', a.id), 'Private profile read').length === 0, 'friend access does not widen private backup or profile policies');
    const stored = await bytesInBucket('shared-flight-replays', a);
    check(!!(await b.client.storage.from('shared-flight-replays').download(`${a.id}/${stored[0].name}`)).error,
      'friend cannot bypass Edge authorization using a Storage object path');
    check(!!(await a.client.rpc('social_begin_upload', { p_owner: a.id, p_activity_id: prepared.activityId, p_upload_token: prepared.uploadToken })).error,
      'service activation bridge cannot be called by authenticated clients');
    await rpc(a, 'write_private_flight', { p_metadata_only: true, p_flight: { id: flight.id, title: 'Edited shared title',
      site: 'Edited launch', site_source: 'manual', notes: 'STILL-PRIVATE', client_updated_at: flight.client_updated_at + 1 } });
    const edited = await detail(b, summary.activityId);
    check(edited.title === 'Edited shared title' && edited.site === 'Edited launch' && edited.artifact.sha256 === summary.artifact.sha256 &&
      !JSON.stringify(edited).includes('STILL-PRIVATE'), 'metadata edits update only the approved shared projection and preserve replay');

    const enabled = await auto(a, true);
    const queuedFlight = await seed(a);
    const queued = await prepare(a, queuedFlight, 0, 'automatic', enabled.generation);
    await auto(a, false);
    const canceled = await upload(a, queued, artifactFor(queuedFlight));
    check(canceled.status === 409 && (await publication(a, queuedFlight)).state === 'private', 'disabling auto invalidates queued automatic publication');
    check((await publication(a, flight)).state === 'shared' && (await detail(b, summary.activityId)).artifact.sha256 === summary.artifact.sha256,
      'disabling automatic posting preserves existing shared history');
    const reenabled = await auto(a, true);
    check(reenabled.generation !== enabled.generation && await deniedRpc(a, 'social_prepare_share', {
      p_flight_id: queuedFlight.id, p_operation_id: randomUUID(), p_mode: 'automatic', p_consent_generation: enabled.generation,
      p_expected_revision: (await publication(a, queuedFlight)).revision }), 'old consent cannot be reused after disabling and re-enabling');
    const future = await seed(a);
    const futurePrepared = await prepare(a, future, 0, 'automatic', reenabled.generation);
    edgeOk(await upload(a, futurePrepared, artifactFor(future)), 'Automatic publication');
    check((await publication(a, future)).state === 'shared', 'current automatic consent publishes a newly queued flight');

    await hide(a, flight);
    check((await read(b, summary)).status === 403 && await deniedRpc(b, 'social_get_activity', { p_activity_id: summary.activityId }), 'hide immediately revokes detail and artifact reads');
    check((await upload(a, prepared, artifact)).status === 409, 'late upload retry cannot undo hide');
    check(await deniedRpc(a, 'social_prepare_share', { p_flight_id: flight.id, p_operation_id: randomUUID(), p_mode: 'manual',
      p_consent_generation: null, p_expected_revision: prepared.revision }), 'stale manual preparation cannot undo hide');
    edgeOk(await cleanup(a), 'Hidden artifact cleanup');
    check(!(await bytesInBucket('shared-flight-replays', a)).some(row => row.name === stored[0].name), 'hidden artifact is physically removed by durable cleanup');
    const reshared = await prepare(a, flight, (await publication(a, flight)).revision);
    edgeOk(await upload(a, reshared, artifact), 'Explicit re-share');
    const newSummary = await detail(b, reshared.activityId);
    check(newSummary.artifact.generation !== summary.artifact.generation && newSummary.publishedAt === summary.publishedAt,
      'explicit re-share creates a new artifact generation without duplicating publication history');
    check((await read(b, summary)).status === 403, 'old artifact generation remains inaccessible after re-share');

    const partial = await seed(a, { status: 'partial', quality: 'partial' });
    const partialPrepared = await prepare(a, partial, 0);
    edgeOk(await upload(a, partialPrepared, artifactFor(partial)), 'Partial publication');
    check((await detail(b, partialPrepared.activityId)).status === 'partial', 'saved partial flight remains explicitly partial');
    const restored = await seed(a);
    const restoredPrepared = await prepare(a, restored, 0);
    const restoredArtifact = { schemaVersion: 1, provenance: 'igc', partial: false,
      bounds: { startedAt: restored.started_at + 1000, endedAt: restored.ended_at },
      points: [
        { timestamp: restored.started_at + 1000, latitude: 1.31, longitude: 103.81, altitude: 400, speed: null },
        { timestamp: restored.ended_at, latitude: 1.33, longitude: 103.83, altitude: 300, speed: null },
      ] };
    edgeOk(await upload(a, restoredPrepared, restoredArtifact), 'Restored IGC publication');
    const restoredSummary = await detail(b, restoredPrepared.activityId);
    const restoredBytes = edgeOk(await read(b, restoredSummary), 'Restored IGC replay read');
    check(restoredSummary.provenance === 'igc' && restoredSummary.replayAvailable && restoredBytes.data.provenance === 'igc' &&
      restoredBytes.data.points.every(point => point.speed === null && point.timestamp % 1000 === 0),
      'manual restored replay retains IGC provenance, second precision and unavailable speed');
    check(restoredBytes.bytes.equals(Buffer.from(JSON.stringify(restoredArtifact))) && hash(restoredBytes.bytes) === restoredSummary.artifact.sha256,
      'restored IGC-derived replay round-trips exact sanitized bytes');
    const noGps = await seed(a, { fix_count: 0, quality: 'no_track', track_distance_metres: 0, min_gps_altitude: null, max_gps_altitude: null, max_ground_speed: null });
    const noGpsPrepared = await prepare(a, noGps, 0);
    edgeOk(await upload(a, noGpsPrepared, artifactFor(noGps, true)), 'No-GPS publication');
    const noGpsSummary = await detail(b, noGpsPrepared.activityId);
    check(!noGpsSummary.replayAvailable && noGpsSummary.routePreview.length === 0 && edgeOk(await read(b, noGpsSummary), 'No-GPS read').data.points.length === 0,
      'no-GPS summary remains available without fake route or replay');
    const page = await rpc(b, 'social_list_feed', { p_limit: 1 });
    const nextPage = await rpc(b, 'social_list_feed', { p_limit: 1, p_cursor_published_at: page.nextCursor.publishedAt, p_cursor_activity_id: page.nextCursor.activityId });
    check(page.items.length === 1 && nextPage.items.length === 1 && page.items[0].activityId !== nextPage.items[0].activityId, 'feed pagination crosses the cursor without duplicate rows');

    await relationship(a, b, 'remove', firstRelation);
    check((await rpc(b, 'social_list_feed')).items.length === 0 && (await read(b, newSummary)).status === 403, 'friend removal revokes feed and route reads');
    await invite(a, b); await accept(b, a);
    await relationship(b, a, 'block');
    check((await read(b, newSummary)).status === 403 && (await rpc(b, 'social_list_feed')).items.length === 0, 'reader-side block also revokes all shared access');
    await relationship(b, a, 'unblock'); await invite(a, b); await accept(b, a);
    await rpc(a, 'delete_private_flight', { p_flight_id: partial.id });
    check(await deniedRpc(b, 'social_get_activity', { p_activity_id: partialPrepared.activityId }), 'private flight deletion immediately removes its social publication');
    edgeOk(await cleanup(a), 'Deleted flight artifact cleanup');
    check(!(await bytesInBucket('shared-flight-replays', a)).some(row => row.name.startsWith(`${partialPrepared.activityId}-`)), 'private deletion artifact cleanup removes the actual object');

    const privatePath = `${a.id}/${flight.id}.igc`;
    ok(await a.client.storage.from('flight-igc').upload(privatePath, 'PRIVATE-PILOT-HEADER-FIXTURE', { contentType: 'application/vnd.fai.igc', upsert: false }), 'Private IGC fixture upload');
    check(!!(await b.client.storage.from('flight-igc').download(privatePath)).error, 'friend cannot download original private IGC');
    check((await bytesInBucket('flight-igc', a)).length === 1 && (await bytesInBucket('shared-flight-replays', a)).length > 0,
      'account deletion fixture contains both private and shared objects');
    edgeOk(await edge(a, {}, 'delete-account'), 'Account deletion'); a.deleted = true;
    check((await bytesInBucket('flight-igc', a)).length === 0 && (await bytesInBucket('shared-flight-replays', a)).length === 0,
      'account deletion physically drains both Storage buckets');
    check(!!(await admin.auth.admin.getUserById(a.id)).error && (await read(b, newSummary)).status === 403,
      'account deletion removes Auth identity and revokes social reads');
    edgeOk(await cleanup(b), 'Post-account cleanup receipts');
    return checks;
  } finally {
    let failures = 0;
    for (const account of accounts) {
      // Prefixes derive exclusively from users this invocation created. Drain
      // every page before Auth deletion; never enumerate or touch another owner.
      try {
        for (const bucket of ['flight-igc', 'shared-flight-replays']) {
          for (;;) {
            const rows = ok(await admin.storage.from(bucket).list(account.id, { limit: 100, offset: 0 }), 'Fixture cleanup list');
            if (!rows.length) break;
            assert.ok(rows.every(row => typeof row.name === 'string' && !row.name.includes('/')), 'Unexpected disposable object shape.');
            ok(await admin.storage.from(bucket).remove(rows.map(row => `${account.id}/${row.name}`)), 'Fixture cleanup remove');
          }
        }
        if (!account.deleted) ok(await admin.auth.admin.deleteUser(account.id), 'Fixture account cleanup');
      } catch { failures += 1; }
    }
    assert.equal(failures, 0, 'Disposable fixture cleanup failed; investigate before another run.');
    console.log('Disposable shared-flight accounts and stored objects cleaned up.');
  }
}

async function localRun() {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
  const project = `xc-shared-http-${randomUUID().slice(0, 8)}`;
  const workdir = await mkdtemp(join(tmpdir(), project));
  let stackAttempted = false, failure = null;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|SMTP_|PG|DATABASE_URL$)/.test(key)));
  const run = args => new Promise((resolveResult, reject) => {
    const child = spawn(join(root, 'node_modules/.bin/supabase'), [...args, '--workdir', workdir], { cwd: workdir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', value => { output += value; });
    child.stderr.resume(); // CLI diagnostics may contain credentials.
    const timeout = setTimeout(() => child.kill('SIGTERM'), 300_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error(`Supabase ${args[0]} could not start.`)); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolveResult(output);
      else reject(new Error(`Supabase ${args[0]} failed (${code}).`));
    });
  });
  try {
    await run(['init']);
    const servers = await Promise.all(Array.from({ length: 7 }, () => new Promise((resolveServer, reject) => {
      const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveServer(server));
    })));
    const [api, db, shadow, studio, mail, pooler, inspector] = servers.map(server => server.address().port);
    await Promise.all(servers.map(server => new Promise(resolveClose => server.close(resolveClose))));
    await writeFile(join(workdir, 'supabase/config.toml'), `project_id = "${project}"
[api]
port = ${api}
[db]
port = ${db}
shadow_port = ${shadow}
major_version = 17
[db.seed]
enabled = false
[db.pooler]
enabled = false
port = ${pooler}
[studio]
enabled = false
port = ${studio}
[local_smtp]
enabled = false
port = ${mail}
[auth.email.smtp]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = true
policy = "per_worker"
inspector_port = ${inspector}
[functions.shared-flight]
verify_jwt = true
[functions.delete-account]
verify_jwt = true
`);
    for (const directory of ['migrations', 'functions']) await cp(join(root, 'supabase', directory), join(workdir, 'supabase', directory), { recursive: true });
    console.log(`Starting isolated shared-flight HTTP stack: ${project}`);
    stackAttempted = true;
    await run(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor']);
    const status = JSON.parse(await run(['status', '--output', 'json']));
    const endpoint = new URL(status.API_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && Number(endpoint.port) === api, 'Refusing a non-isolated endpoint.');
    const checks = await verifySharedFlights(endpoint.href, status.ANON_KEY, status.SERVICE_ROLE_KEY);
    console.log(`Shared-flight HTTP acceptance: ${checks} checks passed.`);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (stackAttempted) {
        try { await run(['stop', '--no-backup']); }
        catch (error) { if (!failure) throw error; console.error('Isolated stack cleanup also failed; inspect the named test project.'); }
      }
    }
    finally { await rm(workdir, { recursive: true, force: true }); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await localRun().catch(error => { console.error(error.message); process.exitCode = 1; });
}
