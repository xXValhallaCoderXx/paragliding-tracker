/**
 * Real Auth -> PostgREST -> Storage acceptance against an isolated local stack.
 * Run with Node 24 and Docker: node scripts/test-private-archive-http.mjs
 * Does not read the app's environment files or contact its hosted project.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'node_modules/.bin/supabase');
const project = `xc-archive-http-${randomUUID().slice(0, 8)}`;
const started = performance.now();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|SMTP_|PG|DATABASE_URL$)/.test(key)));
let workdir, child, interrupted = false, cleaning = false, checks = 0;

function safeDiagnostic(value) {
  return value.split('\n').filter((line) => !/key|token|password|secret|jwt|postgres(?:ql)?:\/\//i.test(line))
    .slice(-8).join('\n').replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]');
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd: workdir ?? root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const running = child;
    let output = '', errors = '';
    running.stdout.on('data', (chunk) => { output += chunk; });
    running.stderr.on('data', (chunk) => { errors += chunk; });
    const timer = setTimeout(() => running.kill('SIGTERM'), 300_000);
    running.once('error', (error) => { clearTimeout(timer); child = null; reject(error); });
    running.once('close', (code, signal) => {
      clearTimeout(timer); child = null;
      if (code !== 0) reject(new Error(`${basename(command)} ${args[0]} failed (${signal ?? code}). ${safeDiagnostic(errors)}`));
      else resolve(output);
    });
  });
}
const supabase = (args) => run(cli, [...args, '--workdir', workdir]);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  if (!cleaning) child?.kill(signal);
});
async function availablePorts(count) {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}
function checked(condition, message) {
  if (interrupted) throw new Error('HTTP acceptance interrupted.');
  assert.ok(condition, message);
  checks += 1;
  console.log(`PASS ${message}`);
}
function successful(result, message) {
  const diagnostic = safeDiagnostic(String(result.error?.message ?? '')).slice(0, 500);
  assert.ok(!result.error, `${message} failed (status ${result.error?.status ?? result.error?.statusCode ?? 'n/a'}, code ${result.error?.code ?? 'n/a'}). ${diagnostic}`);
  return result.data;
}
function denied(result, message) {
  const status = Number(result.error?.status ?? result.error?.statusCode);
  checked(!!result.error && status >= 400 && status < 500, message);
}
const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: {
    fetch: (input, init = {}) => fetch(input, {
      ...init,
      signal: AbortSignal.any([init.signal, AbortSignal.timeout(15_000)].filter(Boolean)),
    }),
  },
};

try {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'HTTP acceptance requires Node 24.');
  assert.equal(spawnSync('docker', ['info'], { stdio: 'ignore' }).status, 0, 'Docker is required for HTTP acceptance.');
  workdir = await mkdtemp(join(tmpdir(), `${project}-`));
  await supabase(['init']);
  const [api, db, shadow, studio, mail, pooler] = await availablePorts(6);
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
  console.log(`Starting isolated Auth/PostgREST/Storage stack: ${project}`);
  await supabase(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  const status = JSON.parse(await supabase(['status', '--output', 'json']));
  const localUrl = new URL(status.API_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(localUrl.hostname) && Number(localUrl.port) === api,
    'Refusing a non-isolated HTTP endpoint.');
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Local API credentials were not returned.');
  const admin = createClient(localUrl.href, status.SERVICE_ROLE_KEY, clientOptions);
  const anonymous = createClient(localUrl.href, status.ANON_KEY, clientOptions);
  const accounts = [];
  for (const label of ['a', 'b']) {
    const email = `${label}-${randomUUID()}@archive-http.example.test`;
    const password = `Aa1!${randomUUID()}-${randomUUID().slice(0, 12)}`;
    const created = successful(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Disposable account creation');
    const client = createClient(localUrl.href, status.ANON_KEY, clientOptions);
    const signedIn = successful(await client.auth.signInWithPassword({ email, password }), 'Disposable account sign-in');
    assert.equal(signedIn.user.id, created.user.id);
    let restoredClient;
    if (label === 'a') {
      restoredClient = createClient(localUrl.href, status.ANON_KEY, clientOptions);
      const restoredSession = successful(await restoredClient.auth.signInWithPassword({ email, password }), 'Second owner session sign-in');
      checked(restoredSession.user.id === created.user.id && restoredSession.session.access_token !== signedIn.session.access_token,
        'owner A has two independently authenticated client sessions');
    }
    accounts.push({ id: created.user.id, client, restoredClient });
  }
  checked(accounts[0].id !== accounts[1].id, 'two disposable owners authenticate through the local Auth API');
  const [a, b] = accounts;
  const flightId = randomUUID();
  const path = `${a.id}/${flightId}.igc`;
  const content = 'AXCLHTTP\r\nHFDTE200926\r\nHFPRSPRESSALTSENSOR:NIL\r\nB0100000118000N10350000EA0000000100\r\nB0101000118001N10350001EA0000000101\r\n';
  const digest = createHash('sha256').update(content).digest('hex');
  const flight = {
    id: flightId, user_id: a.id, recording_session_id: randomUUID(), status: 'completed',
    started_at: Date.UTC(2026, 8, 20, 1), ended_at: Date.UTC(2026, 8, 20, 1, 1),
    client_created_at: 1000, client_updated_at: 1000, title: 'HTTP archive', site: 'Test launch',
    site_source: 'manual', notes: null, duration_ms: 60_000, fix_count: 2, quality: 'healthy',
  };
  const captured = successful(await a.client.rpc('write_private_flight', { p_flight: flight }), 'Captured write RPC');
  checked(captured.id === flightId && captured.user_id === a.id, 'captured manifest RPC returns one canonical owner-scoped row');
  successful(await a.client.storage.from('flight-igc').upload(path, content, { contentType: 'application/vnd.fai.igc', upsert: true }), 'IGC upload');
  const withIgc = successful(await a.client.rpc('write_private_flight', { p_flight: {
    ...flight, igc_object_path: path, igc_sha256: digest, igc_byte_count: Buffer.byteLength(content), igc_artifact_version: 1,
  } }), 'IGC manifest write');
  checked(withIgc.igc_sha256 === digest, 'IGC upload and archive reference complete through real HTTP APIs');
  const restoredManifest = successful(await a.restoredClient.from('flights').select('*').eq('id', flightId).single(), 'Second-session manifest read');
  checked(restoredManifest.user_id === a.id && restoredManifest.igc_sha256 === digest,
    'second owner session reads the complete backed-up manifest');
  const ownedFile = successful(await a.restoredClient.storage.from('flight-igc').download(path), 'Second-session IGC download');
  checked(await ownedFile.text() === content, 'second owner session downloads the exact original IGC bytes');
  const otherRows = successful(await b.client.from('flights').select('id').eq('id', flightId), 'Cross-account flight read');
  checked(otherRows.length === 0, 'another account cannot read the private manifest');
  denied(await b.client.storage.from('flight-igc').download(path), 'another account cannot download the private IGC');
  denied(await anonymous.storage.from('flight-igc').download(path), 'anonymous requests cannot download the private IGC');
  const foreignRemoval = await b.client.storage.from('flight-igc').remove([path]);
  const foreignRemovalStatus = Number(foreignRemoval.error?.status ?? foreignRemoval.error?.statusCode);
  checked((!!foreignRemoval.error && foreignRemovalStatus >= 400 && foreignRemovalStatus < 500)
    || (!foreignRemoval.error && foreignRemoval.data.length === 0), 'another account cannot remove the private IGC');
  const retained = successful(await a.client.storage.from('flight-igc').download(path), 'Owner download after unauthorized removal');
  checked(await retained.text() === content, 'unauthorized removal leaves the owner artifact intact');

  const edited = successful(await a.restoredClient.rpc('write_private_flight', { p_metadata_only: true, p_flight: {
    id: flightId, title: 'Edited on restored phone', site: 'Updated launch', site_source: 'manual',
    notes: 'Offline edit synchronized', client_updated_at: 5000,
  } }), 'Archive metadata write');
  checked(edited.title === 'Edited on restored phone' && edited.duration_ms === 60_000 && edited.igc_sha256 === digest,
    'archive metadata edit preserves captured facts and original artifact');
  const canonical = successful(await a.client.rpc('write_private_flight', { p_flight: flight }), 'Stale captured write');
  checked(canonical.title === edited.title && canonical.igc_sha256 === digest, 'stale captured upload cannot clobber restored edits or archive references');

  const deletion = successful(await a.restoredClient.rpc('delete_private_flight', { p_flight_id: flightId }), 'Second-session individual deletion');
  checked(deletion.flight_id === flightId && deletion.storage_cleanup_pending, 'individual deletion returns a durable pending cleanup receipt');
  const deletedRows = successful(await a.client.from('flights').select('id').eq('id', flightId), 'Deleted manifest read');
  checked(deletedRows.length === 0, 'deleted manifest disappears before file cleanup');
  denied(await a.client.storage.from('flight-igc').download(path), 'normal owner download is denied after deletion');
  denied(await a.client.storage.from('flight-igc').upload(path, content, { contentType: 'application/vnd.fai.igc', upsert: true }),
    'late IGC upload is denied after deletion');
  const resurrection = await a.client.rpc('write_private_flight', { p_flight: flight });
  checked(resurrection.error?.code === 'PFL01', 'captured RPC cannot resurrect the deleted identity');
  const beforeCleanup = successful(await a.restoredClient.rpc('acknowledge_private_flight_cleanup', { p_flight_id: flightId }), 'Premature cleanup acknowledgement');
  checked(beforeCleanup.storage_cleanup_pending, 'cleanup acknowledgement cannot hide a file still present in Storage');
  const removed = successful(await a.restoredClient.storage.from('flight-igc').remove([path]), 'Operation-aware Storage removal');
  checked(removed.some((object) => object.name === path), 'Storage remove can read and delete its tombstoned cleanup target');
  const cleaned = successful(await a.restoredClient.rpc('acknowledge_private_flight_cleanup', { p_flight_id: flightId }), 'Cleanup acknowledgement');
  checked(!cleaned.storage_cleanup_pending && !!cleaned.storage_cleaned_at, 'verified Storage cleanup is acknowledged');
  denied(await admin.storage.from('flight-igc').download(path), 'privileged download confirms the object is removed rather than merely hidden');
  const ownMarkers = successful(await a.client.from('private_flight_deletions').select('flight_id').eq('flight_id', flightId), 'Owner deletion receipt read');
  checked(ownMarkers.length === 1, 'anti-resurrection receipt remains after physical object removal');
  const foreignMarkers = successful(await b.client.from('private_flight_deletions').select('flight_id').eq('flight_id', flightId), 'Cross-account receipt read');
  checked(foreignMarkers.length === 0, 'another account cannot read deletion receipts');
  console.log(`Private archive HTTP acceptance: ${checks} checks passed.`);
} catch (error) {
  console.error(safeDiagnostic(error.message));
  process.exitCode = interrupted ? 130 : 1;
} finally {
  cleaning = true;
  if (workdir) {
    try { await supabase(['stop', '--no-backup']); console.log('Isolated HTTP stack removed.'); }
    catch (error) { console.error(`Cleanup failed for ${project}: ${safeDiagnostic(error.message)}`); process.exitCode = 1; }
    await rm(workdir, { recursive: true, force: true });
  }
  if (interrupted) process.exitCode = 130;
  console.log(`HTTP verification including cleanup: ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
