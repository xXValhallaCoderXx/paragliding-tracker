/** Private equipment acceptance. Direct execution uses a disposable local Supabase stack. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(import.meta.dirname, '..');
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { fetch: (input, init = {}) => fetch(input, {
    ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(20_000)].filter(Boolean)),
  }) } };
function ok(result, label) {
  assert.ok(!result.error, `${label} failed (${result.error?.code ?? result.error?.status ?? 'unknown'}).`);
  return result.data;
}

export async function verifyEquipment(url, publicKey, adminKey) {
  const admin = createClient(url, adminKey, options);
  const anonymous = createClient(url, publicKey, options);
  const accounts = [];
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, label); console.log(`PASS ${++checks}: ${label}`); };
  const read = async client => ok(await client.rpc('read_private_equipment'), 'Read equipment').entities;
  const write = async (client, kind, key, payload, revision, operationId = randomUUID()) =>
    ok(await client.rpc('write_private_equipment', {
      p_kind: kind, p_key: key, p_payload: payload, p_expected_revision: revision, p_operation_id: operationId,
    }), 'Write equipment');
  try {
    for (const label of ['owner', 'other']) {
      const email = `${label}-${randomUUID()}@equipment-qa.example.test`;
      const password = `Aa1!${randomUUID()}`;
      const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create disposable account');
      const client = createClient(url, publicKey, options);
      accounts.push({ id: created.user.id, client });
      ok(await client.auth.signInWithPassword({ email, password }), 'Sign in disposable account');
      if (label === 'owner') {
        accounts[0].second = createClient(url, publicKey, options);
        ok(await accounts[0].second.auth.signInWithPassword({ email, password }), 'Sign in second device');
      }
    }
    const [a, b] = accounts;
    check((await read(a.client)).length === 0, 'new private inventory is empty without a Friends profile');
    const id = randomUUID();
    const wing = { id, sport: 'paragliding', model: 'QA Wing', size: 'M', registrationId: 'QA-001', archived: false };
    const operation = randomUUID();
    const created = await write(a.client, 'aircraft', id, wing, 0, operation);
    check(created.status === 'applied' && created.entity.revision === 1, 'aircraft saves at its first server revision');
    check(JSON.stringify(await write(a.client, 'aircraft', id, wing, 0, operation)) === JSON.stringify(created),
      'lost-response retry returns the same operation receipt');
    check((await read(a.second))[0].payload.model === 'QA Wing', 'a second device restores aircraft details');
    const edited = { ...wing, model: 'QA Wing Edited' };
    await write(a.client, 'aircraft', id, edited, 1);
    const conflict = await write(a.second, 'aircraft', id, { ...wing, size: 'L' }, 1);
    check(conflict.status === 'conflict' && conflict.entity.revision === 2 && conflict.entity.payload.model === edited.model,
      'stale device edit returns the canonical conflict without overwriting it');
    const reapplied = await write(a.second, 'aircraft', id, { ...edited, size: 'L' }, 2);
    check(reapplied.status === 'applied' && reapplied.entity.revision === 3, 'reviewed changes can be explicitly reapplied');
    const secondId = randomUUID();
    await write(a.second, 'aircraft', secondId, { ...wing, id: secondId, sport: 'speedflying', model: 'QA Speedwing' }, 0);
    await write(a.client, 'sport', 'paragliding', { sport: 'paragliding', pilotIdentifier: 'QA PILOT 123' }, 0);
    await write(a.client, 'selection', 'current', { aircraftId: id }, 0);
    check((await read(a.second)).length === 4, 'independent aircraft, sport identifier and current selection restore together');
    const archived = await write(a.second, 'aircraft', id, { ...reapplied.entity.payload, archived: true }, 3);
    check(archived.related.some(row => row.kind === 'selection' && row.payload.aircraftId === null),
      'archiving the current aircraft clears selection in the same server mutation');
    const invalidSelection = await a.client.rpc('write_private_equipment', {
      p_kind: 'selection', p_key: 'current', p_payload: { aircraftId: id }, p_expected_revision: 2, p_operation_id: randomUUID(),
    });
    check(!!invalidSelection.error, 'an archived aircraft cannot become current');
    await write(a.client, 'aircraft', id, { ...archived.entity.payload, archived: false }, 4);
    check((await read(a.second)).find(row => row.kind === 'selection').payload.aircraftId === null,
      'restoring an aircraft leaves current selection unchanged');
    check((await read(b.client)).length === 0, 'another account sees its own empty inventory');
    check(ok(await b.client.from('private_equipment').select('*').eq('owner_id', a.id), 'Cross-account read').length === 0,
      'row security hides another owner’s aircraft and identifiers');
    check(!!(await anonymous.rpc('read_private_equipment')).error, 'anonymous inventory access is denied');
    check(!!(await a.client.from('private_equipment').update({ revision: 999 }).eq('owner_id', a.id)).error,
      'direct writes cannot bypass revision and archive rules');
    const began = Date.UTC(2026, 8, 27, 1);
    const snapshot = { version: 1, capturedAt: began, aircraftId: id, sport: 'paragliding', model: 'Captured QA Wing', size: 'M', registrationId: 'QA-001' };
    const flight = { id: randomUUID(), user_id: a.id, recording_session_id: randomUUID(), status: 'completed',
      started_at: began, ended_at: began + 60_000, client_created_at: began, client_updated_at: began,
      title: 'Synthetic equipment fixture', site: null, site_source: null, notes: null, equipment_snapshot: snapshot };
    ok(await a.client.rpc('write_private_flight', { p_flight: flight }), 'Flight snapshot write');
    const restored = ok(await a.second.from('flights').select('equipment_snapshot').eq('id', flight.id).single(), 'Restore snapshot');
    check(JSON.stringify(restored.equipment_snapshot) === JSON.stringify(snapshot) ||
      Object.keys(snapshot).every(key => restored.equipment_snapshot[key] === snapshot[key]), 'private flight restores captured equipment independently of the aircraft list');
    const { equipment_snapshot: _snapshot, ...legacy } = flight;
    const older = ok(await a.client.rpc('write_private_flight', { p_flight: { ...legacy, title: 'Old-client metadata', client_updated_at: began + 1 } }), 'Old-client write');
    check(older.equipment_snapshot.model === snapshot.model, 'older clients omitting equipment preserve the snapshot');
    check(!!(await a.client.rpc('write_private_flight', { p_flight: { ...flight, equipment_snapshot: { ...snapshot, model: 'Changed' } } })).error,
      'captured equipment cannot be rewritten by an ordinary flight update');
    const social = ok(await a.client.rpc('social_get_state'), 'Read Friends state');
    check(!social.profile, 'equipment work does not create a Friends profile');
    ok(await admin.rpc('social_begin_account_deletion', { p_owner: a.id }), 'Mark disposable account deleting');
    check(!!(await a.client.rpc('read_private_equipment')).error, 'account deletion fences equipment reads');
    check(!!(await a.client.rpc('write_private_equipment', {
      p_kind: 'sport', p_key: 'hang_gliding', p_payload: { sport: 'hang_gliding', pilotIdentifier: 'QA' },
      p_expected_revision: 0, p_operation_id: randomUUID(),
    })).error, 'account deletion fences new equipment writes');
    console.log(`Private equipment HTTP acceptance: ${checks} checks passed.`);
    return checks;
  } finally {
    let failures = 0;
    for (const account of accounts) {
      try { ok(await admin.auth.admin.deleteUser(account.id), 'Disposable account cleanup'); }
      catch { failures += 1; }
    }
    assert.equal(failures, 0, 'Disposable equipment account cleanup failed.');
    console.log('Disposable equipment accounts and database fixtures cleaned up.');
  }
}

async function localRun() {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24.');
  const project = `xc-equipment-http-${randomUUID().slice(0, 8)}`;
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
    console.log(`Starting isolated equipment HTTP stack: ${project}`);
    stackAttempted = true;
    await run(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor']);
    const status = JSON.parse(await run(['status', '--output', 'json']));
    const endpoint = new URL(status.API_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && Number(endpoint.port) === api, 'Refusing a non-isolated endpoint.');
    const checks = await verifyEquipment(endpoint.href, status.ANON_KEY, status.SERVICE_ROLE_KEY);
    console.log(`Equipment HTTP acceptance: ${checks} checks passed.`);
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
