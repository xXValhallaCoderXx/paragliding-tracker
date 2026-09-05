import { normalizeReplayPoints, telemetryAt, type ReplayFix } from '../model';

const bounds = { startedAt: 1000, endedAt: 100_000 };
const fix = (sourceTimestamp: number, overrides: Partial<ReplayFix> = {}): ReplayFix => ({
  sourceTimestamp, sequence: sourceTimestamp, latitude: 46, longitude: 8, mocked: false, gpsAltitude: 1000, speed: 10, ...overrides,
});
describe('replay fixes', () => {
  it('sorts source time and keeps the highest usable sequence for duplicate timestamps', () => {
    const result = normalizeReplayPoints([fix(3000), fix(1000, { sequence: 3, gpsAltitude: 1200 }), fix(1000, { sequence: 1 }), fix(1000, { sequence: 5, mocked: true })], bounds);
    expect(result.map((p) => p.timestamp)).toEqual([1000, 3000]);
    expect(result[0]!.altitude).toBe(1200);
  });
  it('retains sub-second timing without IGC second rounding', () => {
    expect(normalizeReplayPoints([fix(1100), fix(1250), fix(1350)], bounds).map((p) => p.timestamp)).toEqual([1100, 1250, 1350]);
  });
  it('includes boundary fixes and excludes pre-start cached and post-stop fixes', () => {
    expect(normalizeReplayPoints([fix(999), fix(1000), fix(100_000), fix(100_001)], bounds).map((p) => p.timestamp)).toEqual([1000, 100_000]);
  });
  it('filters invalid fixes while retaining usable points in replay', () => {
    expect(normalizeReplayPoints([fix(1000), fix(2000, { latitude: NaN }), fix(3000)], bounds)
      .map((point) => point.timestamp)).toEqual([1000, 3000]);
  });
  it('retains stationary coordinates, negative altitude and zero speed', () => {
    const points = normalizeReplayPoints([fix(1000, { gpsAltitude: -10, speed: 0 }), fix(2000, { gpsAltitude: -20, speed: 0 })], bounds);
    expect(points).toHaveLength(2);
    expect(telemetryAt(points, 1500)).toMatchObject({ altitude: -15, speed: 0 });
  });
  it.each([null, NaN, Infinity])('missing altitude %s never removes a coordinate', (gpsAltitude) => {
    const points = normalizeReplayPoints([fix(1000, { gpsAltitude })], bounds);
    expect(points).toHaveLength(1);
    expect(points[0]!.altitude).toBeNull();
  });
  it.each([null, -1, NaN, Infinity])('invalid speed %s stays unavailable', (speed) => {
    expect(normalizeReplayPoints([fix(1000, { speed })], bounds)[0]!.speed).toBeNull();
  });
});

describe('seeking and interpolation', () => {
  const points = normalizeReplayPoints([fix(2000), fix(17_000, { gpsAltitude: 1300, speed: 20 }), fix(40_000, { gpsAltitude: null, speed: null }), fix(41_000)], bounds);
  it('interpolates across exactly 15 seconds', () => {
    expect(telemetryAt(points, 9500)).toMatchObject({ left: 0, right: 1, fraction: 0.5, altitude: 1150, speed: 15 });
  });
  it('does not interpolate a longer gap', () => { expect(telemetryAt(points, 30_000)).toBeNull(); });
  it.each([1000, 100_000, NaN])('does not extrapolate at %s', (t) => { expect(telemetryAt(points, t)).toBeNull(); });
  it.each([2000, 17_000, 40_000, 41_000])('returns exact boundary telemetry at %s', (t) => {
    const index = points.findIndex((p) => p.timestamp === t);
    expect(telemetryAt(points, t)).toMatchObject({ left: index, right: index, fraction: 0 });
  });
  it('does not fill in a missing altitude or speed from its neighbour', () => {
    expect(telemetryAt(points, 40_500)).toMatchObject({ altitude: null, speed: null, fraction: 0.5 });
  });
  it('handles no fixes', () => { expect(telemetryAt([], 1000)).toBeNull(); });
});
