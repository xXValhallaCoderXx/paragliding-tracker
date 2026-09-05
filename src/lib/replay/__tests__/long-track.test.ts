import { performance } from 'node:perf_hooks';
import { buildReplayGeometry, markerAt } from '../geometry';
import { normalizeReplayPoints, telemetryAt, type ReplayFix } from '../model';

it('loads, simplifies and repeatedly scrubs a synthetic twelve-hour track without re-deriving paths', () => {
  const duration = 12 * 60 * 60 * 1000;
  const fixes: ReplayFix[] = Array.from({ length: 43_201 }, (_, index) => ({
    sequence: index, sourceTimestamp: index * 1000,
    latitude: 46 + index / 800_000 + Math.sin(index / 15) / 1000,
    longitude: 8 + index / 600_000 + Math.cos(index / 15) / 1000,
    mocked: false, gpsAltitude: index === 12345 ? 9876 : index === 23456 ? -99 : 1000 + Math.sin(index / 400) * 300,
    speed: 10,
  })).filter((fix) => fix.sourceTimestamp < 10_000_000 || fix.sourceTimestamp > 10_300_000);
  const began = performance.now();
  const bounds = { startedAt: 0, endedAt: duration };
  const points = normalizeReplayPoints(fixes, bounds);
  const geometry = buildReplayGeometry(points, bounds);
  const loaded = performance.now();
  const path = geometry.routePath;
  let hits = 0;
  for (let index = 0; index < 10_000; index++) {
    const telemetry = telemetryAt(points, (index * 7919) % duration);
    if (markerAt(geometry.projected, telemetry)) hits += 1;
  }
  const ended = performance.now();
  expect(hits).toBeGreaterThan(9000);
  expect(geometry.routePath).toBe(path);
  expect(geometry.gapCount).toBe(1);
  expect(geometry.minAltitude).toBe(-99);
  expect(geometry.maxAltitude).toBe(9876);
  expect(geometry.chartPath).toContain(` ${geometry.chartY(9876)}`);
  expect(geometry.routeVertexCount).toBeLessThan(points.length / 2);
  expect(geometry.chartVertexCount).toBeLessThan(1500);
  // Generous regression guard, not a device latency claim or a microbenchmark assertion.
  expect(ended - began).toBeLessThan(10_000);
  console.info(JSON.stringify({ fixture: '12h', usableFixes: points.length, routeVertices: geometry.routeVertexCount, chartVertices: geometry.chartVertexCount, loadAndGeometryMs: Math.round(loaded - began), seek10000Ms: Math.round(ended - loaded) }));
});
