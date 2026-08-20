import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `index.js` registers the background location task *before* expo-router, and that
 * ordering is load-bearing: on Android the task callback runs in a headless JS context
 * on every GPS batch. Anything reachable from that entry point is evaluated there.
 *
 * supabase-js opens sockets and installs timers at construction. If it ever became
 * reachable from `location-task`, every GPS callback during a four-hour flight would pay
 * for it. These tests are the guard, because the failure would only ever show up as
 * battery drain and dropped fixes on a real device.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from\s+'([^']+)'|import\s*\(\s*'([^']+)'/g)].map(
    (match) => match[1] ?? match[2]!,
  );
}

/**
 * Imports that survive compilation.
 *
 * `import type` is erased by the TypeScript transform and creates no runtime edge, so it
 * cannot pull a module into a bundle or a headless callback. That distinction matters for
 * the leaf rules below, where the concern is specifically what gets *evaluated* — a shared
 * helper naming a recorder type is not the cycle that would drag supabase-js into a GPS
 * batch.
 */
function runtimeImportsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
    .replace(/\bimport\s+type\b[\s\S]*?from\s+'[^']+';/g, '')
    .replace(/\bexport\s+type\b[\s\S]*?from\s+'[^']+';/g, '');
  return [...source.matchAll(/from\s+'([^']+)'|import\s*\(\s*'([^']+)'/g)].map(
    (match) => match[1] ?? match[2]!,
  );
}

describe('cloud backup never reaches the capture path', () => {
  it('no recorder module imports the cloud layer or supabase', () => {
    for (const file of sourceFiles('src/recorder')) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier }).not.toMatchObject({ specifier: expect.stringContaining('@/cloud') });
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@supabase/'),
        });
      }
    }
  });

  it('the headless location task pulls in nothing beyond the database layer', () => {
    // Walked transitively: a direct-import check would miss a two-hop path.
    const resolved = new Set<string>();
    const queue = ['src/recorder/location-task.native.ts'];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (resolved.has(file)) continue;
      resolved.add(file);
      for (const specifier of importsOf(file)) {
        expect(specifier).not.toContain('@supabase/');
        expect(specifier).not.toContain('@/cloud');
        expect(specifier).not.toContain('@/sites');
        if (!specifier.startsWith('.')) continue;
        const base = join('src/recorder', specifier.replace(/^\.\//, ''));
        for (const candidate of [`${base}.ts`, `${base}.native.ts`, `${base}.tsx`]) {
          try {
            if (statSync(candidate).isFile()) {
              queue.push(candidate);
              break;
            }
          } catch {
            // Not this extension; try the next.
          }
        }
      }
    }
    expect(resolved.size).toBeGreaterThan(1);
  });

  it('the store never imports UI, so it cannot become a back door into the domain', () => {
    // Same rule as the cloud layer. Without it the store is the one place a screen could
    // reach the recorder through, and the layering that every other rule here protects
    // would quietly stop meaning anything.
    for (const file of sourceFiles('src/store')) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@/features'),
        });
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@/components'),
        });
        expect({ file, specifier }).not.toMatchObject({ specifier: expect.stringContaining('@/app') });
      }
    }
  });

  it('the store subscribes to nothing, so building it stays free', () => {
    // Asserted on imports, not on file text: this codebase writes comments *about*
    // subscribing (three of them), and a grep would fire on the prose.
    //
    // Each of the three services is dangerous to hold here for a different reason.
    // `recorderService.subscribe()` reference-counts a 1 Hz poll that only stops when the
    // last listener leaves. `cloudAuthService.subscribe()` reaches `getSupabase()`, which
    // constructs the client that supabase.native.ts keeps lazy on purpose so tests,
    // native exports and unconfigured builds never open a socket. `cloudSyncEngine`
    // fires two SQLite reads on every subscribe. All three belong in a component effect.
    for (const file of sourceFiles('src/store')) {
      for (const specifier of importsOf(file)) {
        for (const forbidden of [
          '@/recorder/recorder-service',
          '@/cloud/auth-service',
          '@/cloud/sync-engine',
          '@/cloud/supabase',
        ]) {
          expect({ file, specifier }).not.toMatchObject({
            specifier: expect.stringContaining(forbidden),
          });
        }
      }
    }
  });

  it('the site layer imports nothing from this app', () => {
    // It is a client for two public catalogues and the pure policy over their answers.
    // Keeping it self-contained is what lets it be unit-tested with no database, no
    // native module and no network — and stops it inheriting, say, the cloud layer's
    // 30-second retry backoff, which would be absurd on a typeahead.
    for (const file of sourceFiles('src/sites')) {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('.')) continue;
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@/'),
        });
      }
    }
  });

  it('the site layer never uses an abort primitive that does not exist on device', () => {
    // AbortSignal.timeout() is present in the Node environment jest runs in and absent
    // from the abort-controller polyfill React Native ships. It would pass every test
    // here and throw on a phone, so this is the only place that can catch it.
    //
    // Comments are stripped first: the code explains in prose why it avoids this, and a
    // guard that fires on its own justification is a guard nobody keeps.
    for (const file of sourceFiles('src/sites')) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect({ file, code }).not.toMatchObject({
        code: expect.stringContaining('AbortSignal.timeout'),
      });
    }
  });

  it('no recorder module imports the site layer', () => {
    // Naming a launch is never a capture concern, and the headless GPS task must not
    // grow an HTTP client.
    for (const file of sourceFiles('src/recorder')) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@/sites'),
        });
      }
    }
  });

  it('the lib layer is a leaf, so every other layer can safely reach into it', () => {
    // `src/lib/track` is imported by the recorder at finalize, by the logbook for card
    // thumbnails and by the flight screen for the hero. That only stays safe while it
    // imports nothing back — otherwise the shared helper becomes the cycle through which
    // the cloud layer, or supabase, reaches the capture path.
    //
    // The headless walk above would not catch it: that walk only follows relative
    // specifiers, so it checks `@/lib/track/simplify` as a string and never enters it.
    for (const file of sourceFiles('src/lib')) {
      for (const specifier of runtimeImportsOf(file)) {
        for (const forbidden of [
          '@/cloud',
          '@/sites',
          '@/features',
          '@/components',
          '@/app',
          '@/store',
          '@/recorder',
          '@/ui',
          '@supabase/',
        ]) {
          expect({ file, specifier }).not.toMatchObject({
            specifier: expect.stringContaining(forbidden),
          });
        }
      }
    }
  });

  it('the track layer is renderer-agnostic, so jest can test every decision it makes', () => {
    // Jest never collects `.tsx`, which is why every rule the plate applies lives in these
    // modules rather than in the component. That only holds while they stay importable in
    // plain node — one `react-native` import and the whole suite needs a mock.
    for (const file of sourceFiles('src/lib/track')) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier }).not.toMatchObject({ specifier: 'react-native' });
        expect({ file, specifier }).not.toMatchObject({ specifier: 'react-native-svg' });
        expect({ file, specifier }).not.toMatchObject({ specifier: 'react' });
      }
    }
  });

  it('the cloud layer never imports UI, so it stays testable and reusable', () => {
    for (const file of sourceFiles('src/cloud')) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@/features'),
        });
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringContaining('@/components'),
        });
        expect({ file, specifier }).not.toMatchObject({ specifier: expect.stringContaining('@/app') });
      }
    }
  });
});
