import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `className` only works on components react-native-css actually wraps. Anything else — most
 * notably `SafeAreaView`, which is re-exported verbatim from react-native-safe-area-context —
 * silently ignores the prop: no error, no warning, no style.
 *
 * That is how `Screen` once shipped without its `flex: 1` and collapsed every route to zero
 * height on device. It could not be caught by the screenshot harness, because react-native-web
 * renders SafeAreaView as a plain element that *does* accept className, so the web build looked
 * correct while the Android build was blank.
 *
 * Anything outside the wrapped set must be registered with `styled()` first (see
 * src/components/ui/screen.tsx).
 */

const WRAPPED = new Set(
  // Parsed from the installed package so this cannot drift from reality.
  readFileSync(
    'node_modules/react-native-css/dist/commonjs/components/index.js',
    'utf8',
  )
    .match(/var _exportNames = \{([^}]*)\}/)?.[1]
    .match(/(\w+):/g)
    ?.map((s) => s.slice(0, -1)) ?? [],
);

/** Kit components that declare their own `className` passthrough prop. */
const OWN = new Set([
  'BusyRow',
  'Button',
  'Card',
  'Chip',
  'Disclaimer',
  'Hairline',
  'Input',
  'LinkButton',
  'ListRow',
  'LoadingScreen',
  'Notice',
  'SafeArea',
  'Screen',
  'SectionLabel',
  'StateLabel',
  'StatusPill',
  'TopBar',
]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('className only lands on components that understand it', () => {
  it('parsed the wrapped set from react-native-css', () => {
    expect(WRAPPED.has('View')).toBe(true);
    expect(WRAPPED.has('Text')).toBe(true);
    // The whole point: this one is NOT wrapped.
    expect(WRAPPED.has('SafeAreaView')).toBe(false);
  });

  it('has no className on an unregistered component', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles('src')) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<([A-Z][A-Za-z.]*)((?:[^<>]|\n)*?)\/?>/g)) {
        const [, tag, body] = match;
        if (!body.includes('className')) continue;
        if (WRAPPED.has(tag) || OWN.has(tag)) continue;
        offenders.push(`${file} <${tag}>`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
