const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });
const messages = async (file, code) => (await eslint.lintText(code, { filePath: path.join(root, file) }))[0].messages.filter((m) => m.ruleId === 'architecture/boundaries');

test('boundary checks resolve aliases, relative paths, dynamic imports and require', async () => {
  for (const code of [
    "import { x } from '@/cloud/supabase';", "import { x } from '../cloud/supabase.native';",
    "import('../cloud/supabase.native');", "import(`../cloud/supabase.native`);",
    "import(modulePath);",
    "const x = require('../cloud/supabase.native');", "export { x } from '../cloud/supabase.native';",
  ]) assert.equal((await messages('src/recorder/probe.ts', code)).length, 1, code);
  for (const [file, code] of [
    ['src/lib/track/probe.ts', "import React from 'react';"],
    ['src/lib/probe.ts', "import { x } from '../recorder/database.native';"],
    ['src/store/probe.ts', "import('../cloud/sync-engine.native');"],
    ['src/sites/probe.ts', "import { x } from '../store/api';"],
    ['src/features/probe.ts', "import { x } from '../recorder/database.native';"],
    ['src/cloud/probe.ts', "import { x } from '../features/foo';"],
  ]) assert.equal((await messages(file, code)).length, 1, file);
});
test('type-only edges and local helpers are allowed', async () => {
  for (const code of [
    "import type { X } from '../cloud/types';", "import { type X } from '../cloud/types';",
    "export type { X } from '../cloud/types';", "export { type X } from '../cloud/types';",
    "import { x } from './repository-core';", "import { x } from '@/lib/track/fixes';",
  ]) assert.deepEqual(await messages('src/recorder/probe.ts', code), [], code);
});
test('unsupported native abort APIs and recorder SQL writes fail lint', async () => {
  assert.equal((await messages('src/sites/probe.ts', "AbortSignal.timeout(100); AbortSignal['any']([]);")).length, 2);
  assert.equal((await messages('src/recorder/sync-repository-core.ts', 'const sql = `UPDATE sessions SET status = ?`;')).length, 1);
});
