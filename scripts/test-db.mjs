import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'node_modules/.bin/supabase');
const generate = process.argv.includes('--update-types');
const project = `xc-test-${randomUUID().slice(0, 12)}`;
const started = performance.now();
let workdir, child, interrupted = false, cleaning = false;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(SUPABASE_|SMTP_|PG|DATABASE_URL$)/.test(key)));
function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd: workdir ?? root, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let output = '';
    if (capture) child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      child = null;
      if (code !== 0) reject(new Error(`${command.split('/').at(-1)} ${args[0]} failed (${signal ?? code})`));
      else resolve(output);
    });
  });
}
const supabase = (args, capture = false) => run(cli, [...args, '--workdir', workdir], capture);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  if (!cleaning) child?.kill(signal);
});
async function ports(count) {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server));
  })));
  const numbers = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return numbers;
}
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Database verification requires Node 24.');
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('Docker is required for database verification. Start Docker and rerun pnpm test. Database checks were not skipped.');
  }
  workdir = await mkdtemp(join(tmpdir(), `${project}-`));
  await supabase(['init']);
  const [api, db, shadow, studio, mail, pooler] = await ports(6);
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
  for (const name of ['migrations', 'tests']) {
    await cp(join(root, 'supabase', name), join(workdir, 'supabase', name), { recursive: true });
  }
  if (interrupted) throw new Error('Database verification interrupted.');
  console.log(`Isolated database: ${project} (port ${db})`);
  await supabase(['start', '--exclude', 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  if (interrupted) throw new Error('Database verification interrupted.');
  await supabase(['test', 'db']);
  const types = (await supabase(['gen', 'types', 'typescript', '--local', '--schema', 'public'], true)).trimEnd() + '\n';
  if (interrupted) throw new Error('Database verification interrupted.');
  const temporaryTypes = join(workdir, 'database.types.ts');
  await writeFile(temporaryTypes, types);
  const checkedIn = join(root, 'src/cloud/database.types.ts');
  if (generate) {
    await cp(temporaryTypes, checkedIn);
    console.log('Updated src/cloud/database.types.ts from applied migrations.');
  } else {
    const expected = await readFile(checkedIn, 'utf8').catch(() => '');
    if (expected !== types) throw new Error('Generated database types have drifted. Run pnpm db:types and review the diff.');
    console.log('Generated database types match.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  cleaning = true;
  if (workdir) {
    // The unique project ID scopes stop to this run; never stop another local stack.
    try { await supabase(['stop', '--no-backup']); }
    catch (error) { console.error(`Cleanup failed for ${project}: ${error.message}`); process.exitCode = 1; }
    await rm(workdir, { recursive: true, force: true });
  }
  if (interrupted) process.exitCode = 130;
  console.log(`Database verification including cleanup: ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
