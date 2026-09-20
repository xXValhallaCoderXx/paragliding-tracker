/** Disposable Auth/PostgREST/Edge verification for the additive kudos contract. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

export async function verifyKudos(url, publicKey, adminKey) {
  const admin = createClient(url, adminKey, options);
  const anonymous = createClient(url, publicKey, options);
  const accounts = [];
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, label); console.log(`PASS ${++checks}: ${label}`); };
  const rpc = async (account, name, args = {}) => ok(await account.client.rpc(name, args), name);
  const denied = async (account, name, args = {}) => !!(await account.client.rpc(name, args)).error;
  const edge = async (account, body, name = 'shared-flight') => {
    const response = await fetch(new URL(`/functions/v1/${name}`, url), { method: 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    assert.equal(response.status, 200, `${name} returned HTTP ${response.status}.`);
    return response.json();
  };
  const state = account => rpc(account, 'social_get_state');
  const change = (account, other, action, id) => rpc(account, 'social_change_relationship', {
    p_other_user_id: other.id, p_action: action, ...(id ? { p_request_id: id } : {}) });
  const befriend = async (account, other) => {
    await rpc(account, 'social_request_friend', { p_code: (await state(other)).inviteCode });
    const pending = (await state(other)).relationships.find(row => row.userId === account.id);
    await change(other, account, 'accept', pending.id); return pending.id;
  };
  const set = (account, activityId, given) => rpc(account, 'social_set_kudos', { p_activity_id: activityId, p_given: given });
  const list = (account, activityId, cursor = null, limit = 25) => rpc(account, 'social_list_kudos', {
    p_activity_id: activityId, p_limit: limit, ...(cursor ? { p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id } : {}) });
  const detail = (account, activityId) => rpc(account, 'social_get_activity', { p_activity_id: activityId });
  try {
    for (const label of ['author', 'first', 'second']) {
      const email = `${label}-${randomUUID()}@kudos-http.example.test`;
      const password = `Aa1!${randomUUID()}`;
      const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create disposable account');
      const account = { id: created.user.id, client: createClient(url, publicKey, options), token: null, deleted: false };
      accounts.push(account);
      const signedIn = ok(await account.client.auth.signInWithPassword({ email, password }), 'Authenticate disposable account');
      account.token = signedIn.session.access_token;
      await rpc(account, 'social_save_profile', { p_display_name: label === 'author' ? 'Fixture Author' : 'Same Pilot' });
    }
    const [a, b, c] = accounts;
    check(new Set(accounts.map(account => account.id)).size === 3, 'three independent disposable accounts authenticate');
    const now = Date.UTC(2026, 8, 21, 3);
    const flight = { id: randomUUID(), user_id: a.id, recording_session_id: randomUUID(), status: 'completed',
      started_at: now, ended_at: now + 60_000, timezone_offset_minutes: -480, client_created_at: now, client_updated_at: now,
      title: 'Disposable kudos flight', site: null, site_source: null, notes: 'PRIVATE-NOT-IN-KUDOS', metrics_algorithm_version: 3,
      duration_ms: 60_000, track_distance_metres: 0, min_gps_altitude: null, max_gps_altitude: null,
      max_ground_speed: null, fix_count: 0, quality: 'no_track', metrics_computed_at: now + 61_000 };
    await rpc(a, 'write_private_flight', { p_flight: flight });
    const artifact = { schemaVersion: 1, provenance: 'recorded', bounds: { startedAt: now, endedAt: now + 60_000 }, partial: false, points: [] };
    const publish = async revision => {
      const prepared = await rpc(a, 'social_prepare_share', { p_flight_id: flight.id, p_operation_id: randomUUID(), p_mode: 'manual',
        p_consent_generation: null, p_expected_revision: revision });
      await edge(a, { action: 'upload', activityId: prepared.activityId, uploadToken: prepared.uploadToken, artifact });
      return prepared.activityId;
    };
    const activityId = await publish(0);
    const empty = (await detail(a, activityId)).kudos;
    check(empty.count === 0 && empty.givenByMe === false, 'existing detail includes an explicit zero kudos state');
    check(!!(await anonymous.rpc('social_list_kudos', { p_activity_id: activityId })).error &&
      !!(await anonymous.rpc('social_set_kudos', { p_activity_id: activityId, p_given: true })).error, 'anonymous names and mutations are denied');
    check(await denied(a, 'social_set_kudos', { p_activity_id: activityId, p_given: true }), 'author cannot give self-kudos');
    check(await denied(c, 'social_list_kudos', { p_activity_id: activityId }) &&
      await denied(c, 'social_set_kudos', { p_activity_id: activityId, p_given: true }), 'unrelated account cannot list or react');
    await rpc(a, 'social_request_friend', { p_code: (await state(b)).inviteCode });
    check(await denied(b, 'social_list_kudos', { p_activity_id: activityId }) &&
      await denied(b, 'social_set_kudos', { p_activity_id: activityId, p_given: true }), 'pending friendship cannot list or react');
    let ab = (await state(b)).relationships.find(row => row.userId === a.id).id;
    await change(b, a, 'accept', ab);
    const gave = await set(b, activityId, true);
    check(gave.activityId === activityId && gave.count === 1 && gave.givenByMe, 'accepted friend gives one canonical kudos');
    const originalReaction = (await list(b, activityId)).items[0].id;
    const duplicate = await Promise.all([set(b, activityId, true), set(b, activityId, true)]);
    check(duplicate.every(value => value.count === 1 && value.givenByMe) && (await list(b, activityId)).items[0].id === originalReaction,
      'concurrent desired-state retries retain one reaction and its identity');
    check((await rpc(b, 'social_list_feed')).items.find(item => item.activityId === activityId).kudos.givenByMe,
      'existing feed projects viewer-specific kudos without a new endpoint');
    await befriend(a, c);
    const names = await list(c, activityId);
    check(names.count === 1 && names.items[0].displayName === 'Same Pilot' && !names.givenByMe,
      'authorized viewer sees a reactor name without being that reactor’s friend');
    check(await denied(c, 'social_get_friend_profile', { p_user_id: b.id }), 'kudos name visibility grants no profile lookup access');
    check(names.items.every(item => Object.keys(item).sort().join(',') === 'displayName,id') &&
      !accounts.some(account => names.items.some(item => item.id === account.id)), 'supporter rows expose only random reaction IDs and chosen names');
    await set(c, activityId, true);
    const duplicates = await list(a, activityId);
    check(duplicates.count === 2 && duplicates.items.length === 2 && duplicates.items.every(item => item.displayName === 'Same Pilot') &&
      duplicates.items[0].id !== duplicates.items[1].id, 'duplicate display names remain distinct supporters');
    const firstPage = await list(a, activityId, null, 1);
    check(firstPage.count === 2 && firstPage.items.length === 1 && !!firstPage.nextCursor, 'first names page reports full count and bounded cursor');
    await rpc(b, 'social_save_profile', { p_display_name: 'Renamed Pilot' });
    const secondPage = await list(a, activityId, firstPage.nextCursor, 1);
    check(secondPage.items.length === 1 && secondPage.items[0].id !== firstPage.items[0].id && secondPage.items[0].displayName === 'Renamed Pilot',
      'renaming a supporter does not change page ordering or duplicate entries');
    await set(c, activityId, false);
    check((await list(a, activityId, firstPage.nextCursor, 1)).items.length === 1, 'next page survives deletion of its cursor reaction');
    check((await set(c, activityId, false)).count === 1, 'repeated undo is idempotent');
    await set(c, activityId, true);
    await befriend(b, c);
    await change(b, c, 'block');
    const blockedB = await list(b, activityId), blockedC = await list(c, activityId);
    check(blockedB.count === 1 && blockedB.items.length === 1 && blockedB.givenByMe &&
      blockedC.count === 1 && blockedC.items.length === 1 && blockedC.givenByMe, 'either-direction viewer/reactor blocks filter both count and names');
    check((await detail(b, activityId)).kudos.count === 1 && (await detail(c, activityId)).kudos.count === 1 &&
      (await detail(a, activityId)).kudos.count === 2, 'card/detail counts are viewer-specific and agree with the names list');
    await change(b, c, 'unblock');
    check((await list(b, activityId)).count === 2 && await denied(b, 'social_get_friend_profile', { p_user_id: c.id }),
      'unblocking reveals eligible names without restoring friendship or profile access');
    const retainedIds = (await list(a, activityId)).items.map(item => item.id).sort();
    await rpc(a, 'social_hide_flight', { p_flight_id: flight.id });
    check(await denied(b, 'social_list_kudos', { p_activity_id: activityId }) &&
      await denied(b, 'social_set_kudos', { p_activity_id: activityId, p_given: false }), 'Hide denies names and reaction mutations');
    const hidden = await rpc(a, 'social_get_my_publication', { p_flight_id: flight.id });
    check(await publish(hidden.revision) === activityId && JSON.stringify((await list(a, activityId)).items.map(item => item.id).sort()) === JSON.stringify(retainedIds),
      'explicit re-share retains the original reaction identities and count');
    await rpc(a, 'write_private_flight', { p_metadata_only: true, p_flight: { id: flight.id, title: 'Edited fixture title', site: null,
      site_source: null, notes: 'PRIVATE-EDIT', client_updated_at: flight.client_updated_at + 1 } });
    check((await detail(b, activityId)).title === 'Edited fixture title' && (await detail(b, activityId)).kudos.count === 2,
      'private metadata updates preserve reactions and the approved shared summary');
    check(ok(await b.client.from('flights').select('id').eq('user_id', a.id), 'Private flight denial').length === 0 &&
      ok(await c.client.from('profiles').select('id').eq('id', b.id), 'Private profile denial').length === 0,
      'kudos leave private flight and profile access unchanged');
    await change(b, a, 'remove', ab);
    check((await list(a, activityId)).count === 1 && await denied(b, 'social_list_kudos', { p_activity_id: activityId }),
      'reactor removing the author deletes their contribution and revokes names access');
    await befriend(a, b); await set(b, activityId, true);
    await change(b, a, 'block');
    check((await list(a, activityId)).count === 1 && await denied(b, 'social_set_kudos', { p_activity_id: activityId, p_given: true }),
      'reactor blocking the author deletes their contribution and denies stale writes');
    await change(b, a, 'unblock'); ab = await befriend(a, b); await set(b, activityId, true);
    await change(a, b, 'remove', ab);
    check((await list(a, activityId)).count === 1 && await denied(b, 'social_set_kudos', { p_activity_id: activityId, p_given: true }),
      'friend removal deletes the pair’s reactions and denies stale writes');
    await befriend(a, b);
    check((await list(a, activityId)).count === 1, 're-accepting friendship does not resurrect old kudos');
    await set(b, activityId, true);
    await change(a, b, 'block');
    check((await list(a, activityId)).count === 1 && await denied(b, 'social_list_kudos', { p_activity_id: activityId }),
      'author blocking a reactor deletes their contribution and revokes names access');
    await change(a, b, 'unblock'); await befriend(a, b); await set(b, activityId, true);
    await edge(b, {}, 'delete-account'); b.deleted = true;
    check((await list(a, activityId)).count === 1 && (await list(a, activityId)).items.length === 1,
      'reactor account deletion cascades their reaction and name');
    await rpc(a, 'delete_private_flight', { p_flight_id: flight.id });
    check(await denied(c, 'social_list_kudos', { p_activity_id: activityId }) &&
      await denied(c, 'social_set_kudos', { p_activity_id: activityId, p_given: true }), 'private flight deletion removes reactions and prevents resurrection');
    await edge(a, { action: 'cleanup' });
    return checks;
  } finally {
    let failures = 0;
    for (const account of accounts) {
      try {
        for (const bucket of ['flight-igc', 'shared-flight-replays']) {
          for (;;) {
            const rows = ok(await admin.storage.from(bucket).list(account.id, { limit: 100, offset: 0 }), 'Fixture cleanup list');
            if (!rows.length) break;
            assert.ok(rows.every(row => typeof row.name === 'string' && !row.name.includes('/')), 'Unexpected fixture object shape.');
            ok(await admin.storage.from(bucket).remove(rows.map(row => `${account.id}/${row.name}`)), 'Fixture cleanup remove');
          }
        }
        if (!account.deleted) ok(await admin.auth.admin.deleteUser(account.id), 'Fixture account cleanup');
      } catch { failures += 1; }
    }
    assert.equal(failures, 0, 'Disposable fixture cleanup failed; investigate before another run.');
    console.log('Disposable kudos accounts and objects cleaned up.');
  }
}

async function localRun() {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
  const project = `xc-kudos-http-${randomUUID().slice(0, 8)}`;
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
    console.log(`Starting isolated kudos HTTP stack: ${project}`);
    stackAttempted = true;
    await run(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor']);
    const status = JSON.parse(await run(['status', '--output', 'json']));
    const endpoint = new URL(status.API_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && Number(endpoint.port) === api, 'Refusing a non-isolated endpoint.');
    const checks = await verifyKudos(endpoint.href, status.ANON_KEY, status.SERVICE_ROLE_KEY);
    console.log(`Kudos HTTP acceptance: ${checks} checks passed.`);
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
