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

  it('no shared module imports a platform-split .native file directly', () => {
    // `database.native` and friends resolve per platform through Metro's platform
    // extensions. Importing one by its explicit `.native` name from a shared component
    // drags expo-sqlite's web worker into the web bundle and breaks
    // `expo export --platform web` — with a stack trace that points at expo-sqlite
    // rather than at the import that caused it. Hence this test.
    // Widened as new top-level directories appear, rather than copied per directory:
    // one rule means one place to add the next one.
    const shared = [
      ...sourceFiles('src/features'),
      ...sourceFiles('src/app'),
      ...sourceFiles('src/store'),
      ...sourceFiles('src/lib'),
      ...sourceFiles('src/components'),
    ];
    for (const file of shared) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier }).not.toMatchObject({
          specifier: expect.stringMatching(/\.native$/),
        });
      }
    }
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
    // `expo export` and unconfigured builds never open a socket. `cloudSyncEngine`
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
