import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { paper } from '../theme';

/**
 * The paper palette is written twice: once as TypeScript in theme.ts (for the handful of runtime
 * reads that cannot be class names) and once as `@theme` variables in global.css (for every
 * utility). This suite is what stops the two drifting apart.
 */
const css = readFileSync(join(__dirname, '..', '..', 'global.css'), 'utf8');

function cssVariable(name: string): string | undefined {
  return css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))?.[1]?.trim();
}

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

describe('global.css mirrors the paper palette in theme.ts', () => {
  it.each(Object.entries(paper))('paper.%s is exposed as a CSS variable', (key, value) => {
    const name = cssNameFor(key);
    const declared = cssVariable(name);
    // Report the variable name on failure rather than a bare `undefined`.
    expect({ name, value: declared && normalise(declared) }).toEqual({
      name,
      value: normalise(value),
    });
  });

  it('declares no colour variable that theme.ts does not define', () => {
    const expected = new Set(Object.keys(paper).map(cssNameFor));
    const declared = [...css.matchAll(/^\s*(--color-[a-z0-9-]+):/gm)].map((m) => m[1].slice(2));
    expect(declared.filter((name) => !expected.has(name))).toEqual([]);
  });
});
