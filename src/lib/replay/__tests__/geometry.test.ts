import { buildReplayGeometry, CHART_VIEW, chartEnvelope, markerAt, ROUTE_VIEW } from '../geometry';
import { telemetryAt, type ReplayPoint } from '../model';

const point = (timestamp: number, longitude = 8, altitude: number | null = 1000): ReplayPoint => ({ timestamp, latitude: 46, longitude, altitude, speed: 10 });
const bounds = { startedAt: 0, endedAt: 100_000 };

it('fits stationary tracks at the centre with finite chart coordinates', () => {
  const points = [point(0), point(1000)];
  const geometry = buildReplayGeometry(points, bounds);
  expect(geometry.projected).toEqual([{ x: 180, y: 140 }, { x: 180, y: 140 }]);
  expect(geometry.chartY(1000)).toBe(70);
  expect(geometry.routePath + geometry.chartPath).not.toMatch(/NaN|Infinity/);
});
it('route, start/end and moving pilot share one fixed fit', () => {
  const points = [point(0, 8), point(10_000, 8.1)];
  const geometry = buildReplayGeometry(points, bounds);
  expect(markerAt(geometry.projected, telemetryAt(points, 0))).toEqual(geometry.projected[0]);
  expect(markerAt(geometry.projected, telemetryAt(points, 10_000))).toEqual(geometry.projected[1]);
  expect(markerAt(geometry.projected, telemetryAt(points, 5000))!.x).toBeCloseTo(180);
  expect(geometry.projected[0]!.x).toBeCloseTo(ROUTE_VIEW.padding);
});
it('does not wrap the marker through the middle of the earth at the dateline', () => {
  const points = [point(0, 179.99), point(10_000, -179.99)];
  const geometry = buildReplayGeometry(points, bounds);
  expect(markerAt(geometry.projected, telemetryAt(points, 5000))!.x).toBeCloseTo(180);
});
it('splits route and chart at gaps; marker disappears inside one', () => {
  const points = [point(0), point(1000, 8.01), point(30_000, 8.2), point(31_000, 8.21)];
  const geometry = buildReplayGeometry(points, bounds);
  expect(geometry.routePath.match(/M/g)).toHaveLength(2);
  expect(geometry.chartPath.match(/M/g)).toHaveLength(2);
  expect(markerAt(geometry.projected, telemetryAt(points, 20_000))).toBeNull();
});
it('missing altitude breaks only the chart and preserves isolated altitude samples', () => {
  const points = [point(0), point(1000, 8.01, null), point(2000, 8.02, 1100)];
  const geometry = buildReplayGeometry(points, bounds);
  expect(geometry.routePath.match(/M/g)).toHaveLength(1);
  expect(geometry.chartPath.match(/M/g)).toHaveLength(2);
  expect(geometry.chartPath.match(/L/g)).toHaveLength(2);
});
it('all missing altitudes produce an empty chart with a usable route', () => {
  const geometry = buildReplayGeometry([point(0, 8, null), point(1000, 8.1, null)], bounds);
  expect(geometry.chartPath).toBe('');
  expect(geometry.minAltitude).toBeNull();
  expect(geometry.routePath).toContain('L');
});
it('uses recording bounds, leaving real empty chart time before and after fixes', () => {
  const geometry = buildReplayGeometry([point(10_000), point(20_000)], bounds);
  expect(geometry.chartX(0)).toBe(CHART_VIEW.padding);
  expect(geometry.chartX(bounds.endedAt)).toBe(CHART_VIEW.width - CHART_VIEW.padding);
  expect(geometry.chartX(10_000)).toBeGreaterThan(CHART_VIEW.padding);
});
it('envelopes retain narrow altitude peaks and troughs in timestamp order', () => {
  const run = [{ x: 1.1, y: 10 }, { x: 1.2, y: 50 }, { x: 1.3, y: -100 }, { x: 1.4, y: 20 }, { x: 1.5, y: 25 }];
  expect(chartEnvelope(run)).toEqual([run[0], run[1], run[2], run[4]]);
});
it('fits a tall route without independent x/y stretching', () => {
  const points = [point(0), { ...point(10_000, 8.01), latitude: 46.1 }];
  const geometry = buildReplayGeometry(points, bounds);
  expect(geometry.projected[1]!.y).toBeCloseTo(ROUTE_VIEW.padding);
  expect(geometry.projected[0]!.y).toBeCloseTo(ROUTE_VIEW.height - ROUTE_VIEW.padding);
  expect(geometry.projected[1]!.x - geometry.projected[0]!.x).toBeLessThan(20);
});
