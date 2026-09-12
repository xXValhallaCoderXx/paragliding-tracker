import { METRES_PER_DEGREE } from '../geometry';
import { mapBounds, splitAntimeridian, type MapCoordinate } from '../map-geometry';

it('fits a stationary track to a finite neighbourhood at ordinary and polar latitudes', () => {
  for (const latitude of [0, 60, 90, -90]) {
    const bounds = mapBounds([[8, latitude], [8, latitude]])!;
    expect(bounds.ne.every(Number.isFinite) && bounds.sw.every(Number.isFinite)).toBe(true);
    expect(bounds.ne[0]).toBeGreaterThan(bounds.sw[0]);
    expect(bounds.ne[1]).toBeGreaterThan(bounds.sw[1]);
    expect(bounds.ne[1]).toBeLessThanOrEqual(90);
    expect(bounds.sw[1]).toBeGreaterThanOrEqual(-90);
  }
  const equator = mapBounds([[8, 0]])!;
  expect((equator.ne[0] - equator.sw[0]) * METRES_PER_DEGREE).toBeCloseTo(200);
  expect((equator.ne[1] - equator.sw[1]) * METRES_PER_DEGREE).toBeCloseTo(200);
  expect(mapBounds([])).toBeNull();
});

it.each([1, -1])('keeps dateline bounds narrow and splits a crossing in direction %s', (direction) => {
  const run: MapCoordinate[] = [[direction * 179.9, 10], [-direction * 179.9, 12]];
  const bounds = mapBounds(run)!;
  expect(bounds.ne[0] - bounds.sw[0]).toBeCloseTo(0.2);
  expect(Math.abs((bounds.ne[0] + bounds.sw[0]) / 2)).toBeCloseTo(180);
  expect(bounds.ne[1]).toBe(12);
  expect(bounds.sw[1]).toBe(10);
  const segments = splitAntimeridian(run);
  expect(segments).toEqual([
    [run[0], [direction * 180, 11]],
    [[-direction * 180, 11], run[1]],
  ]);
});

it('handles a fix exactly on the dateline without a world-spanning line or a seam-only segment', () => {
  const runs: MapCoordinate[][] = [
    [[179, 10], [-180, 11], [-179, 12]],
    [[180, 10], [-179, 11]],
    [[-180, 10], [180, 11], [179, 12]],
  ];
  for (const run of runs) {
    const segments = splitAntimeridian(run);
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < segment.length; index += 1) {
        expect(Math.abs(segment[index]![0] - segment[index - 1]![0])).toBeLessThanOrEqual(180);
      }
    }
    expect(segments[0]![0]![1]).toBe(run[0]![1]);
    expect(segments.at(-1)!.at(-1)![1]).toBe(run.at(-1)![1]);
  }
});
