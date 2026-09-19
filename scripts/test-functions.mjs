import { spawn } from 'node:child_process';

// Pin the runner without adding a native Deno dependency to the Expo app. pnpm caches
// this tool after its first download. Tests use only local files and no permissions.
const child = spawn('pnpm', [
  'dlx', 'deno@2.5.6', 'test', '--no-config', '--no-remote',
  'supabase/functions/delete-account/handler_test.ts', ...process.argv.slice(2),
], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = signal ? 130 : code ?? 1; });
