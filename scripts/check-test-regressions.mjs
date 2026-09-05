import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Intentional defects run only in a disposable copy. Never edit the working tree to test a test.
const root = resolve(import.meta.dirname, '..');
const copy = await mkdtemp(join(tmpdir(), 'xc-test-regressions-'));
let child;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; child?.kill(signal); });
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    child = spawn('pnpm', args, { cwd: copy, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => { child = null; resolve({ code, output }); });
  });
}
const cases = [
  ['exclusive transaction handle', 'src/recorder/database.native.ts',
    "await transaction.runAsync('DELETE FROM exports WHERE session_id = ?', row.recording_session_id);",
    "await database.runAsync('DELETE FROM exports WHERE session_id = ?', row.recording_session_id);",
    'src/recorder/__tests__/sqlite-repository.test.ts', 'rejects deleting open or processing'],
  ['callback deduplication', 'src/recorder/repository-core.ts', 'if (existingEvent) {', 'if (false && existingEvent) {', 'src/recorder/__tests__/sqlite-repository.test.ts', 'deduplicates callbacks'],
  ['recovery receipt deadline', 'src/recorder/repository-core.ts', 'candidate.receipt_timestamp <= attempt.deadline_at', 'candidate.receipt_timestamp <= attempt.deadline_at + 1', 'src/recorder/__tests__/sqlite-repository.test.ts', 'requires a fresh'],
  ['Stop bypasses recovery queue', 'src/recorder/recorder-service.native.ts',
    'canonicalStoppedAt = await requestSessionStop(sessionId, requestedAt);',
    'canonicalStoppedAt = await this.runLifecycleOperation(() => requestSessionStop(sessionId, requestedAt));',
    'src/recorder/__tests__/recorder-lifecycle.test.ts', 'starts persisting Stop immediately'],
  ['final proof race', 'src/recorder/recorder-service.native.ts', 'return this.getFinalRecoveryAttemptProof(current);', 'return null;', 'src/recorder/__tests__/recorder-lifecycle.test.ts', 'accepts a final queued proof'],
  ['profile registration', 'src/cloud/payloads.ts', 'registration_id: profile.registrationId,', '', 'src/cloud/__tests__/payloads.test.ts', 'maps all profile fields'],
  ['postcard cancellation release', 'src/features/postcard/export.ts', 'if (original) adapter.release(original);', '', 'src/features/postcard/__tests__/composer.test.ts', 'abandons preparation when closed'],
];
try {
  for (const name of ['src', 'tests', 'scripts', 'assets']) await cp(join(root, name), join(copy, name), { recursive: true });
  for (const name of ['package.json', 'tsconfig.json', 'jest.config.cjs', 'eslint.config.js', 'index.js']) await cp(join(root, name), join(copy, name));
  for (const name of ['migrations', 'tests']) await cp(join(root, 'supabase', name), join(copy, 'supabase', name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir');
  for (const [name, file, before, after, suite, scenario] of cases) {
    if (interrupted) throw new Error('Regression checks interrupted.');
    const path = join(copy, file);
    const original = await readFile(path, 'utf8');
    if (!original.includes(before)) throw new Error(`Mutation target missing: ${name}`);
    await writeFile(path, original.replace(before, after));
    const result = await run(['exec', 'jest', '--runInBand', suite, '--testNamePattern', scenario]);
    await writeFile(path, original);
    if (result.code === 0 || !result.output.includes('FAIL ') || !result.output.includes(scenario)) {
      throw new Error(`${name}: replacement test did not reject the defect as expected.\n${result.output}`);
    }
    console.log(`Rejected defect: ${name}`);
  }
  const engine = join(copy, 'src/cloud/sync-engine.native.ts');
  const engineSource = await readFile(engine, 'utf8');
  await writeFile(engine, engineSource.replace(".select('pilot_name, glider_type, glider_id, registration_id, client_updated_at')", ".select('pilot_name, glider_type, glider_id, registration_number, client_updated_at')"));
  const incompatibleQuery = await run(['run', 'test:types']);
  await writeFile(engine, engineSource);
  if (incompatibleQuery.code === 0 || !incompatibleQuery.output.includes('error TS')) throw new Error(`Incompatible query not caught:\n${incompatibleQuery.output}`);
  console.log('Rejected defect: query references a column absent from generated schema');
  const rls = join(copy, 'supabase/migrations/20260818120100_cloud_rls.sql');
  const original = await readFile(rls, 'utf8');
  await writeFile(rls, original.replace('alter table public.flights  enable row level security;', 'alter table public.flights disable row level security;'));
  const insecure = await run(['run', 'test:db']);
  await writeFile(rls, original);
  if (insecure.code === 0 || !insecure.output.includes('B flight survives unchanged')) throw new Error(`RLS mutation not caught:\n${insecure.output}`);
  console.log('Rejected defect: cross-owner flight mutations and lost data');
  const types = join(copy, 'src/cloud/database.types.ts');
  await writeFile(types, `${await readFile(types, 'utf8')}\n// stale generated output\n`);
  const drift = await run(['run', 'test:db']);
  if (drift.code === 0 || !drift.output.includes('types have drifted')) throw new Error(`Schema drift not caught:\n${drift.output}`);
  console.log('Rejected defect: generated schema type drift');
  const missingDocker = await run(['run', 'test:db'], { DOCKER_HOST: 'unix:///tmp/xc-nonexistent-docker.sock' });
  if (missingDocker.code === 0 || !missingDocker.output.includes('Docker is required')) throw new Error(`Missing Docker did not fail clearly:\n${missingDocker.output}`);
  console.log('Missing Docker fails clearly without skipping database checks.');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await rm(copy, { recursive: true, force: true });
}
