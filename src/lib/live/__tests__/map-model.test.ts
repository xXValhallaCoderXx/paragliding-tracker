import { buildLiveMapTrack, liveMapPosition, livePositionIsStale } from '../map-model';
import { LIVE_MAP_MAX_ROWS, LIVE_MAP_WINDOW_MS, type CapturedMapFix, type LiveMapData } from '../types';

const fix = (sequence: number, changes: Partial<CapturedMapFix> = {}): CapturedMapFix => ({
  sessionId: 'recording', sequence, sourceTimestamp: sequence * 1000, receiptTimestamp: sequence * 1000,
  latitude: 46, longitude: 8 + sequence / 1000, horizontalAccuracy: null, mocked: false, ...changes,
});
const data = (rows: CapturedMapFix[], position = rows.at(-1) ?? null): LiveMapData => ({
  sessionId: 'recording', observedAt: 0, rows, position, cursor: { sessionId: 'recording', sequence: rows.at(-1)?.sequence ?? 0 }, readError: null,
});

it('draws only committed positions without altitude, interpolation or ongoing-flight endpoints', () => {
  const rows = [fix(1), fix(2), fix(3)];
  const track = buildLiveMapTrack(data(rows), 3500)!;
  expect(track.segments).toEqual([rows.map((row) => [row.longitude, row.latitude])]);
  expect(track.first).toBeUndefined();
  expect(track.last).toBeUndefined();
  expect(liveMapPosition(data(rows), 3500)).toBe(rows[2]);
  expect(liveMapPosition(data(rows), 50_000)).toBe(rows[2]);
});

it('breaks on invalid, mocked, missing sequence and nonincreasing time without sorting away evidence', () => {
  const rows = [fix(1), fix(2), fix(3, { latitude: NaN }), fix(4), fix(5, { mocked: true }),
    fix(6), fix(8), fix(9, { sourceTimestamp: 7000 }), fix(10), fix(11)];
  const track = buildLiveMapTrack(data(rows), 11_000)!;
  expect(track.segments).toEqual([
    [[8.001, 46], [8.002, 46]],
    [[8.009, 46], [8.01, 46], [8.011, 46]],
  ]);
  expect(track.isolatedPoints).toEqual([[8.004, 46], [8.006, 46], [8.008, 46]]);
});

it('keeps exact 15-second runs and splits longer gaps and dateline crossings', () => {
  const rows = [fix(1, { sourceTimestamp: 0, longitude: 179.9 }),
    fix(2, { sourceTimestamp: 15_000, longitude: -179.9 }),
    fix(3, { sourceTimestamp: 30_001, longitude: -179.8 })];
  const track = buildLiveMapTrack(data(rows), 31_000)!;
  expect(track.segments).toHaveLength(2);
  expect(track.segments[0]!.at(-1)![0]).toBe(180);
  expect(track.segments[1]![0]![0]).toBe(-180);
  expect(track.isolatedPoints).toEqual([[-179.8, 46]]);
  expect(track.bounds.ne[0] - track.bounds.sw[0]).toBeLessThan(1);
});

it('caps the recent trail and retains a scalar last-known position after the trail ages away', () => {
  const rows = Array.from({ length: 1200 }, (_, index) => fix(index + 1, { sourceTimestamp: index, receiptTimestamp: index }));
  const track = buildLiveMapTrack(data(rows), 2000)!;
  expect(track.segments.flat()).toHaveLength(LIVE_MAP_MAX_ROWS);
  const aged = buildLiveMapTrack(data(rows), 2000 + LIVE_MAP_WINDOW_MS)!;
  expect(aged.segments).toEqual([]);
  expect(aged.isolatedPoints).toEqual([]);
  expect(liveMapPosition(data(rows), 2000 + LIVE_MAP_WINDOW_MS)).toBe(rows.at(-1));
});

it('rejects another session, future source timestamps and unusable scalar positions', () => {
  const invalid = [fix(1, { sessionId: 'old' }), fix(2, { longitude: Infinity }), fix(3, { sourceTimestamp: 10_000 })];
  expect(buildLiveMapTrack(data(invalid), 5000)).toBeNull();
  expect(liveMapPosition(data([], invalid[0]), 5000)).toBeNull();
  expect(buildLiveMapTrack(data([]), 5000)).toBeNull();
});

it('requires fresh source and receipt times plus healthy capture for a current marker', () => {
  const position = fix(1);
  expect(livePositionIsStale(position, 15_999, true)).toBe(false);
  expect(livePositionIsStale(position, 16_000, true)).toBe(true);
  expect(livePositionIsStale({ ...position, receiptTimestamp: 19_000 }, 20_000, true)).toBe(true);
  expect(livePositionIsStale({ ...position, sourceTimestamp: 19_000 }, 20_000, true)).toBe(true);
  expect(livePositionIsStale(position, 2000, false)).toBe(true);
  expect(livePositionIsStale(position, 0, true)).toBe(true);
});
