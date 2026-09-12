import { buildReplayMapTrack, replayMapPosition } from '../map-model';
import { telemetryAt, type ReplayPoint } from '../model';

const point = (timestamp: number, longitude = 8, latitude = 46): ReplayPoint => ({ timestamp, longitude, latitude, altitude: null, speed: null });

it('keeps a fifteen-second run, longer gaps and isolated fixes distinct without needing altitude', () => {
  const points = [point(0), point(15_000, 8.01), point(31_000, 8.02), point(60_000, 8.03), point(61_000, 8.04)];
  const track = buildReplayMapTrack(points, 'saved-flight')!;
  expect(track).toMatchObject({
    id: 'saved-flight', first: [8, 46], last: [8.04, 46],
    segments: [[[8, 46], [8.01, 46]], [[8.03, 46], [8.04, 46]]],
    isolatedPoints: [[8.02, 46]],
  });
  const interpolated = replayMapPosition(points, telemetryAt(points, 7500))!;
  expect(interpolated[0]).toBeCloseTo(8.005);
  expect(interpolated[1]).toBe(46);
  expect(replayMapPosition(points, telemetryAt(points, 20_000))).toBeNull();
  expect(replayMapPosition(points, telemetryAt(points, 31_000))).toEqual([8.02, 46]);
  expect(replayMapPosition(points, telemetryAt(points, -1))).toBeNull();
  expect(replayMapPosition(points, telemetryAt(points, 62_000))).toBeNull();
});

it.each([1, -1])('uses the shortest marker path across the dateline in direction %s', (direction) => {
  const points = [point(0, direction * 179.9, 10), point(10_000, -direction * 179.9, 12)];
  const track = buildReplayMapTrack(points, 'crossing')!;
  expect(track.segments).toHaveLength(2);
  expect(track.isolatedPoints).toEqual([]);
  expect(replayMapPosition(points, telemetryAt(points, 0))).toEqual(track.first);
  expect(replayMapPosition(points, telemetryAt(points, 10_000))).toEqual(track.last);
  const middle = replayMapPosition(points, telemetryAt(points, 5000))!;
  expect(Math.abs(middle[0])).toBe(180);
  expect(middle[1]).toBe(11);
  expect(replayMapPosition(points, telemetryAt(points, 2500))![0]).toBeCloseTo(direction * 179.95);
});

it('does not bridge invalid positions, and has no track or marker when coordinates are unavailable', () => {
  const points = [point(0), point(1000, NaN), point(2000, 8.02)];
  const track = buildReplayMapTrack(points, 'invalid-middle')!;
  expect(track.segments).toEqual([]);
  expect(track.isolatedPoints).toEqual([[8, 46], [8.02, 46]]);
  expect(replayMapPosition(points, telemetryAt(points, 1000))).toBeNull();
  expect(replayMapPosition(points, telemetryAt(points, 500))).toBeNull();
  expect(buildReplayMapTrack([], 'empty')).toBeNull();
  expect(buildReplayMapTrack([point(0, 181), point(1000, 8, 91)], 'unusable')).toBeNull();
  expect(replayMapPosition([], null)).toBeNull();
});
