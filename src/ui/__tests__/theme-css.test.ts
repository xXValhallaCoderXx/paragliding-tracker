import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { paper } from '../theme';

/**
 * The paper palette is written twice: once as TypeScript in theme.ts (for the handful of runtime
 * reads that cannot be class names) and once as `@theme` variables in global.css (for every
 * utility). This suite is what stops the two drifting apart.
 */
const css = readFileSync(join(__dirname, '..', '..', 'global.css'), 'utf8');

/** theme.ts key -> CSS custom property suffix. */
function cssNameFor(key: string): string {
  // `paper.text` is deliberately `--color-body`: `text-text` would be an absurd utility name.
  if (key === 'text') return 'color-body';
  return `color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** `rgba(255,252,246,0.6)` and `rgba(255, 252, 246, 0.6)` are the same colour. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

it('keeps the CSS colour map consistent with the runtime palette', () => {
  const declared = Object.fromEntries([...css.matchAll(/^\s*--(color-[a-z0-9-]+):\s*([^;]+);/gm)]
    .map(([, name, value]) => [name, normalise(value)]));
  const expected = Object.fromEntries(Object.entries(paper).map(([key, value]) => [cssNameFor(key), normalise(value)]));
  expect(declared).toEqual(expected);
});
