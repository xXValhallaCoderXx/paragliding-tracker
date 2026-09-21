import { MAX_REPLAY_POINTS, routePreview, validateArtifact } from './validator.ts';
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected value'); }
function artifact() { return { schemaVersion: 1, provenance: 'recorded', bounds: { startedAt: 1000, endedAt: 2000 }, partial: false,
  points: [{ timestamp: 1000, latitude: 1, longitude: 2, altitude: null, speed: null },
    { timestamp: 2000, latitude: 1.1, longitude: 2.1, altitude: 300, speed: 12 }] }; }
function rejects(value: unknown) { let rejected = false; try { validateArtifact(value); } catch { rejected = true; } equal(rejected, true); }
Deno.test('preserves original nullable telemetry and exact timestamps', () => {
  const input = artifact(); input.points[0]!.timestamp = 1001;
  equal(validateArtifact(input), input);
});
Deno.test('accepts no-track and single-fix artifacts without inventing replay', () => {
  const input = artifact(); input.points = [];
  equal(validateArtifact(input).points, []);
  input.points = [artifact().points[0]!]; equal(validateArtifact(input).points.length, 1);
});
for (const [label, mutate] of Object.entries<(value: ReturnType<typeof artifact>) => void>({
  privateField: (v) => Object.assign(v, { notes: 'private' }),
  privatePoint: (v) => Object.assign(v.points[0]!, { deviceId: 'private' }),
  unordered: (v) => { v.points.reverse(); },
  duplicate: (v) => { v.points[1]!.timestamp = 1000; },
  latitude: (v) => { v.points[0]!.latitude = 91; },
  longitude: (v) => { v.points[0]!.longitude = -181; },
  outsideBounds: (v) => { v.points[1]!.timestamp = 2001; },
  nonfinite: (v) => { v.points[1]!.altitude = Infinity; },
  negativeSpeed: (v) => { v.points[1]!.speed = -1; },
  fakeIgcSpeed: (v) => { v.provenance = 'igc'; },
  fractionalBounds: (v) => { v.bounds.startedAt = 1000.1; },
  fractionalTimestamp: (v) => { v.points[0]!.timestamp = 1000.1; },
})) Deno.test(`rejects ${label}`, () => { const value = artifact(); mutate(value); rejects(value); });
Deno.test('IGC provenance requires unavailable speed and recorded precision', () => {
  const input = artifact(); input.provenance = 'igc'; input.points[1]!.speed = null;
  equal(validateArtifact(input).provenance, 'igc');
  input.points[0]!.timestamp = 1001; rejects(input);
});
Deno.test('limits sample count before consuming unbounded arrays', () => {
  const input = artifact(); input.points = Array(MAX_REPLAY_POINTS + 1).fill(input.points[0]); rejects(input);
});
Deno.test('checks artifact against the owned cloud flight bounds and partial status', () => {
  let failed = false;
  try { validateArtifact(artifact(), { startedAt: 1000, endedAt: 1500, partial: false }); } catch { failed = true; }
  equal(failed, true);
  failed = false;
  try { validateArtifact(artifact(), { startedAt: 1000, endedAt: 2000, partial: true }); } catch { failed = true; }
  equal(failed, true);
});
Deno.test('preview retains real 15-second gaps without joining discontinuous runs', () => {
  const point = artifact().points[0]!;
  const preview = routePreview([{ ...point, timestamp: 1000 }, { ...point, timestamp: 2000, latitude: 2 },
    { ...point, timestamp: 18000, latitude: 3 }, { ...point, timestamp: 19000, latitude: 4 }]);
  equal(preview, [[1, 2, 2, 2], [3, 2, 4, 2]]);
});
Deno.test('overview stays bounded even with thousands of disconnected fixes', () => {
  const point = artifact().points[0]!;
  const preview = routePreview(Array.from({ length: 10_000 }, (_, i) => ({ ...point, timestamp: i * 20_000 })));
  equal(preview.flat().length <= 1200, true);
  equal(preview.every((run) => run.length === 2), true);
});
