/** Three real Auth sessions exercise Friends through PostgREST, with disposable accounts only.
 * Default: isolated local stack. Exported verifier can also be used by a controlled release runner.
 */
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
    signal: AbortSignal.any([init.signal, AbortSignal.timeout(15_000)].filter(Boolean)) }) } };
function ok(result, label) {
  // Never print RPC payloads, email addresses, tokens or raw service errors.
  assert.ok(!result.error, `${label} failed (${result.error?.code ?? result.error?.status ?? 'unknown'}).`);
  return result.data;
}

export async function verifyFriends(url, publicKey, adminKey) {
  const admin = createClient(url, adminKey, options);
  const anonymous = createClient(url, publicKey, options);
  const accounts = [];
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, label); console.log(`PASS ${++checks}: ${label}`); };
  const state = async account => ok(await account.client.rpc('social_get_state'), 'Read social state');
  const change = async (account, other, action, requestId) => ok(await account.client.rpc('social_change_relationship', {
    p_other_user_id: other.id, p_action: action, ...(requestId ? { p_request_id: requestId } : {}),
  }), `Relationship ${action}`);
  const request = async (account, other) => ok(await account.client.rpc('social_request_pilot', { p_user_id: other.id }), 'Send request');
  const search = async (account, query) => ok(await account.client.rpc('social_search_pilots', { p_query: query }), 'Find pilots');
  const save = async (account, displayName, discoverable = true) => ok(await account.client.rpc('social_save_profile', {
    p_display_name: displayName, p_username: account.username, p_discoverable: discoverable,
  }), 'Save social profile');
  const profile = async (account, other) => ok(await account.client.rpc('social_get_friend_profile', { p_user_id: other.id }), 'Read friend profile');
  try {
    for (const label of ['a', 'b', 'c']) {
      const email = `${label}-${randomUUID()}@friends-http.example.test`;
      const password = `Aa1!${randomUUID()}`;
      const { user } = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create disposable account');
      const account = { id: user.id, username: `qa_f_${user.id.replaceAll('-', '').slice(0, 18)}`,
        client: createClient(url, publicKey, options), deleted: false };
      accounts.push(account);
      const signedIn = ok(await account.client.auth.signInWithPassword({ email, password }), 'Sign in disposable account');
      assert.equal(signedIn.user.id, user.id);
    }
    const [a, b, c] = accounts;
    check(new Set(accounts.map(account => account.id)).size === 3, 'three independent accounts authenticate');
    check((await state(a)).profile === null, 'sign-in does not automatically publish a social profile');
    check(!!(await anonymous.rpc('social_get_state')).error, 'anonymous social reads are denied');
    check(!!(await anonymous.rpc('social_search_pilots', { p_query: 'Pilot' })).error, 'anonymous discovery is denied');
    check(!!(await anonymous.rpc('social_request_pilot', { p_user_id: b.id })).error, 'anonymous requests are denied');
    for (const [index, account] of [a, b].entries()) await save(account, `  Test   Pilot ${index + 1}  `);
    ok(await admin.from('social_profiles').insert({ user_id: c.id, display_name: 'Legacy Pilot' }), 'Create legacy fixture profile');
    check((await state(c)).profile.username === null && !(await state(c)).profile.discoverable,
      'legacy profiles remain readable and hidden before claiming a username');
    check(!!(await c.client.rpc('social_search_pilots', { p_query: 'Pilot' })).error &&
      !!(await c.client.rpc('social_request_pilot', { p_user_id: a.id })).error,
      'legacy pilots must choose a username before discovery or new requests');
    await save(c, 'Test Pilot 3');
    const initialA = await state(a), initialB = await state(b);
    check(initialA.profile.displayName === 'Test Pilot 1' && initialA.profile.username === a.username &&
      initialA.profile.discoverable && !('inviteCode' in initialA), 'profile setup normalizes the name and publishes the chosen username without invite codes');
    check(!!(await c.client.rpc('social_save_profile', { p_display_name: 'Conflict', p_username: a.username.toUpperCase(), p_discoverable: true })).error,
      'case-insensitive username uniqueness is enforced');
    const foundB = (await search(a, `@${b.username.toUpperCase()}`)).items;
    check(foundB.length === 1 && foundB[0].userId === b.id && foundB[0].relationshipState === 'none' &&
      Object.keys(foundB[0]).sort().join(',') === 'displayName,relationshipId,relationshipState,userId,username',
      'username search exposes only discovery identity and relationship state');
    check(!(await search(a, `@${a.username}`)).items.some(item => item.userId === a.id), 'search excludes the caller');
    check(!!(await a.client.rpc('social_search_pilots', { p_query: ' ' })).error, 'empty search never browses the directory');
    await save(c, `Literal %_ ${c.username}`);
    check((await search(a, '%_')).items.some(item => item.userId === c.id) &&
      !(await search(a, '%_')).items.some(item => item.userId === b.id), 'SQL wildcard characters are literal name text');
    check(!(await search(a, '@literal')).items.some(item => item.userId === c.id), 'leading @ restricts matching to usernames');
    await save(c, 'Test Pilot 3');
    check(!!(await c.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'unrelated account cannot read a profile or count');
    const metadata = { status: 'completed', started_at: 1000, ended_at: 61000, client_created_at: 1000,
      client_updated_at: 1000, title: 'Private HTTP fixture', site: null, site_source: null,
      notes: 'PRIVATE-FRIENDS-TEST-NOTE',
      metrics_algorithm_version: 1, duration_ms: 60000, track_distance_metres: 0,
      fix_count: 0, quality: 'no_track', metrics_computed_at: 62000 };
    const flightIds = [];
    for (const patch of [{}, { status: 'partial' }, { metrics_computed_at: null }]) {
      const id = randomUUID(); flightIds.push(id);
      ok(await a.client.rpc('write_private_flight', { p_flight: {
        ...metadata, ...patch, id, user_id: a.id, recording_session_id: randomUUID(),
      } }), 'Back up private fixture');
    }
    check((await state(a)).profile.backedUpFlightCount === 2, 'count includes completed/partial no-track summaries and excludes incomplete metrics');
    await save(b, 'Test Pilot 2', false);
    check(!(await search(a, `@${b.username}`)).items.some(item => item.userId === b.id) &&
      (await request(a, b)).status === 'unavailable', 'hiding removes search visibility and rejects a stale result request');
    check((await search(b, `@${a.username}`)).items.some(item => item.userId === a.id), 'hidden pilots can still search');
    await save(b, 'Test Pilot 2');
    check((await request(a, b)).status === 'sent', 'search result identity creates an explicit request');
    const pendingB = (await state(b)).relationships[0];
    check(pendingB.state === 'incoming' && Object.keys(pendingB).sort().join(',') === 'displayName,id,state,userId,username', 'pending requests expose only display identity and relationship state');
    check(!!(await b.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'pending request cannot read flight count');
    check((await request(a, b)).status === 'outgoing', 'duplicate request is retry-safe');
    check((await request(b, a)).status === 'incoming', 'crossed request does not silently accept');
    check(!!(await a.client.rpc('social_change_relationship', { p_other_user_id: b.id, p_action: 'accept', p_request_id: pendingB.id })).error, 'sender cannot accept their own request');
    await save(b, 'Test Pilot 2', false);
    check((await state(b)).relationships[0].id === pendingB.id, 'hiding preserves pending requests');
    await change(b, a, 'accept', pendingB.id);
    const sharedA = await profile(b, a);
    check(sharedA.backedUpFlightCount === 2 && Object.keys(sharedA).sort().join(',') === 'backedUpFlightCount,displayName,userId,username', 'accepted friend receives only identity and aggregate count');
    check((await profile(a, b)).backedUpFlightCount === 0, 'accepted access is mutual and true zero is preserved');
    check(ok(await b.client.from('flights').select('id,notes').eq('user_id', a.id), 'Private flight denial').length === 0, 'friendship does not widen private flight access');
    check(ok(await b.client.from('profiles').select('*').eq('id', a.id), 'Private profile denial').length === 0, 'friendship does not widen private pilot/export profile access');
    check(ok(await b.client.from('social_profiles').select('*').eq('user_id', a.id), 'Social table denial').length === 0, 'friend profile access is constrained to the narrow RPC');
    check(!!(await c.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'third account remains excluded after friendship acceptance');
    ok(await a.client.rpc('delete_private_flight', { p_flight_id: flightIds[0] }), 'Delete backed-up fixture');
    check((await profile(b, a)).backedUpFlightCount === 1, 'server count follows private flight deletion');
    b.username = `new_${b.id.replaceAll('-', '').slice(0, 18)}`;
    await save(b, 'Renamed Pilot');
    check(!(await search(c, `@${initialB.profile.username}`)).items.some(item => item.userId === b.id) &&
      (await search(c, `@${b.username}`)).items.some(item => item.userId === b.id), 'renamed usernames update discovery');
    check((await profile(a, b)).username === b.username && (await state(a)).relationships[0].id === pendingB.id,
      'renaming and hiding preserve the exact friendship identity');
    await change(a, b, 'remove', pendingB.id);
    check(!!(await b.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'removal revokes future profile reads');
    await request(a, b);
    const second = (await state(b)).relationships[0];
    await change(b, a, 'accept', second.id);
    await change(a, b, 'remove', pendingB.id);
    check((await profile(b, a)).userId === a.id, 'stale removal cannot delete a newer friendship');
    await change(a, b, 'block');
    check((await request(b, a)).status === 'unavailable' && !!(await b.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'blocking revokes reads and new requests');
    check(!(await search(a, `@${b.username}`)).items.some(item => item.userId === b.id) &&
      !(await search(b, `@${a.username}`)).items.some(item => item.userId === a.id), 'blocking removes both directions from discovery');
    check((await state(a)).relationships[0].state === 'blocked' && (await state(b)).relationships.length === 0, 'only blocker sees their blocked list');
    await change(a, b, 'unblock');
    check((await state(a)).relationships.length === 0 && !!(await b.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'unblocking does not restore friendship');
    await request(a, b);
    const third = (await state(b)).relationships[0];
    await change(b, a, 'decline', third.id);
    check((await state(a)).relationships.length === 0, 'recipient can decline request');
    await request(a, b);
    const fourth = (await state(a)).relationships[0];
    await change(a, b, 'cancel', fourth.id);
    check((await state(b)).relationships.length === 0, 'sender can cancel request');
    ok(await c.client.rpc('social_block_pilot', { p_user_id: a.id }), 'Block discovery stranger');
    check(!(await search(c, `@${a.username}`)).items.some(item => item.userId === a.id) &&
      (await request(a, c)).status === 'unavailable', 'a discoverable stranger can be blocked before any friendship');
    await change(c, a, 'unblock');
    await request(a, b);
    await change(b, a, 'accept', (await state(b)).relationships[0].id);
    let limited = false;
    for (let attempt = 0; attempt < 22; attempt++) {
      if ((await request(c, { id: randomUUID() })).status === 'rate_limited') { limited = true; break; }
    }
    check(limited, 'failed request attempts consume a committed rate limit');
    let searchLimited = false;
    for (let attempt = 0; attempt < 62; attempt++) {
      if ((await search(c, '@no_such_fixture')).status === 'rate_limited') { searchLimited = true; break; }
    }
    check(searchLimited, 'empty discovery attempts consume the separate search rate limit');
    ok(await admin.auth.admin.deleteUser(a.id), 'Delete disposable account'); a.deleted = true;
    check((await state(b)).relationships.length === 0 && !!(await b.client.rpc('social_get_friend_profile', { p_user_id: a.id })).error, 'account deletion cascades relationships and revokes profile reads');
    return checks;
  } finally {
    const failures = [];
    for (const account of accounts) {
      if (account.deleted) continue;
      const result = await admin.auth.admin.deleteUser(account.id);
      if (result.error) failures.push(account.id);
    }
    assert.equal(failures.length, 0, 'Disposable account cleanup failed. Inspect the test runner before another run.');
    console.log('Disposable Friends accounts and rows cleaned up.');
  }
}

async function localRun() {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
  const project = `xc-friends-http-${randomUUID().slice(0, 8)}`;
  const workdir = await mkdtemp(join(tmpdir(), project));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|SMTP_|PG|DATABASE_URL$)/.test(key)));
  const run = (args) => new Promise((resolveResult, reject) => {
    const child = spawn(join(root, 'node_modules/.bin/supabase'), [...args, '--workdir', workdir], { cwd: workdir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', value => { output += value; });
    // CLI diagnostics can contain local credentials; do not forward them.
    child.stderr.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 300_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolveResult(output);
      else reject(new Error(`Supabase ${args[0]} failed (${code}).`));
    });
  });
  try {
    await run(['init']);
    const servers = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolveServer, reject) => {
      const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveServer(server));
    })));
    const [api, db, shadow, studio, mail, pooler] = servers.map(server => server.address().port);
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
enabled = false
`);
    await cp(join(root, 'supabase/migrations'), join(workdir, 'supabase/migrations'), { recursive: true });
    console.log(`Starting isolated Friends HTTP stack: ${project}`);
    await run(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
    const status = JSON.parse(await run(['status', '--output', 'json']));
    const endpoint = new URL(status.API_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && Number(endpoint.port) === api, 'Refusing a non-isolated endpoint.');
    const checks = await verifyFriends(endpoint.href, status.ANON_KEY, status.SERVICE_ROLE_KEY);
    console.log(`Friends HTTP acceptance: ${checks} checks passed.`);
  } finally {
    try { await run(['stop', '--no-backup']); }
    finally { await rm(workdir, { recursive: true, force: true }); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await localRun().catch(error => { console.error(error.message); process.exitCode = 1; });
}
