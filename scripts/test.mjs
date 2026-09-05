import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bin = (name) => join(root, 'node_modules/.bin', name);
const commands = {
  types: [[bin('tsc'), '--noEmit']],
  lint: [[bin('eslint'), '.'], [process.execPath, '--test', 'scripts/eslint/architecture.test.cjs']],
  unit: [[bin('jest'), '--runInBand']],
  db: [[process.execPath, 'scripts/test-db.mjs']],
};
const [component, ...extra] = process.argv.slice(2);
const selected = component ? [component] : Object.keys(commands);
const started = performance.now();
let child;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  // The database child runs directly; pnpm executable shims exec Node and preserve NODE_PATH.
  child?.kill(signal);
});
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Tests require Node 24 (see .node-version).');
  for (const name of selected) {
    if (!commands[name]) throw new Error(`Unknown test component: ${name}`);
    const stepStarted = performance.now();
    for (const [command, ...args] of commands[name]) {
      if (interrupted) throw new Error('Verification interrupted.');
      const code = await new Promise((resolve, reject) => {
        child = spawn(command, [...args, ...extra], { stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code) => { child = null; resolve(code); });
      });
      if (code !== 0) throw new Error(`test:${name} failed.`);
    }
    console.log(`test:${name}: ${((performance.now() - stepStarted) / 1000).toFixed(1)}s`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  if (interrupted) process.exitCode = 130;
  console.log(`Total verification: ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
