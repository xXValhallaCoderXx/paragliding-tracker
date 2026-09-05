import { boundsOf, planeFrame, toPlanePoint } from '../track/geometry';
import { graticulePath, toPathData, type Viewport } from '../track/projection';
import { douglasPeuckerIndices } from '../track/simplify';
import type { PlanePoint } from '../track/types';
import { REPLAY_GAP_MS, type ReplayBounds, type ReplayPoint, type ReplayTelemetry } from './model';

export const ROUTE_VIEW: Viewport = { width: 360, height: 280, padding: 26 };
export const CHART_VIEW: Viewport = { width: 360, height: 140, padding: 14 };

/** Bound the worst case of Douglas-Peucker while keeping error below one display unit. */
function simplifyRoute(run: PlanePoint[]): PlanePoint[] {
  const result: PlanePoint[] = [];
  for (let start = 0; start < run.length; start += 255) {
    const chunk = run.slice(start, start + 256);
    const kept = douglasPeuckerIndices(chunk, 0.65).map((index) => chunk[index]!);
    if (start > 0) kept.shift();
    result.push(...kept);
  }
  return result;
}

/** Each horizontal pixel retains first/last and min/max altitude, in time order. */
export function chartEnvelope(run: readonly PlanePoint[]): PlanePoint[] {
  const kept: PlanePoint[] = [];
  let start = 0;
  while (start < run.length) {
    const column = Math.floor(run[start]!.x);
    let end = start + 1;
    let min = start;
    let max = start;
    while (end < run.length && Math.floor(run[end]!.x) === column) {
      if (run[end]!.y < run[min]!.y) min = end;
      if (run[end]!.y > run[max]!.y) max = end;
      end += 1;
    }
    for (const index of [...new Set([start, min, max, end - 1])].sort((a, b) => a - b)) kept.push(run[index]!);
    start = end;
  }
  return kept;
}

/** An isolated fix is a dot, never an invisible move or a line over missing data. */
function drawablePath(runs: readonly (readonly PlanePoint[])[]): string {
  return toPathData(runs.map((run) => run.length === 1 ? [run[0]!, { x: run[0]!.x + 0.01, y: run[0]!.y }] : run));
}

export function buildReplayGeometry(points: readonly ReplayPoint[], bounds: ReplayBounds,
  routeView: Viewport = ROUTE_VIEW, chartView: Viewport = CHART_VIEW) {
  const frame = planeFrame(points[0]!);
  const metres = points.map((point) => toPlanePoint(point, frame));
  const extent = boundsOf([metres])!;
  const spanX = extent.maxX - extent.minX;
  const spanY = extent.maxY - extent.minY;
  const fit = Math.min(spanX > 0 ? (routeView.width - 2 * routeView.padding) / spanX : Infinity,
    spanY > 0 ? (routeView.height - 2 * routeView.padding) / spanY : Infinity);
  const scale = Number.isFinite(fit) ? fit : 1;
  const cx = (extent.minX + extent.maxX) / 2;
  const cy = (extent.minY + extent.maxY) / 2;
  // This very array also positions the marker. No independent fit and no longitude-wrap jump.
  const projected = metres.map((p) => ({ x: (p.x - cx) * scale + routeView.width / 2, y: (p.y - cy) * scale + routeView.height / 2 }));
  const routeRuns: PlanePoint[][] = [];
  let route: PlanePoint[] = [];
  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let gapCount = 0;
  points.forEach((point, index) => {
    if (index > 0 && point.timestamp - points[index - 1]!.timestamp > REPLAY_GAP_MS) {
      routeRuns.push(simplifyRoute(route)); route = []; gapCount += 1;
    }
    route.push(projected[index]!);
    if (point.altitude !== null) { minAltitude = Math.min(minAltitude, point.altitude); maxAltitude = Math.max(maxAltitude, point.altitude); }
  });
  if (route.length) routeRuns.push(simplifyRoute(route));
  const hasAltitude = Number.isFinite(minAltitude);
  // Flat and negative altitudes are valid; pad a flat track without changing its value.
  const low = hasAltitude ? minAltitude - (minAltitude === maxAltitude ? 1 : 0) : 0;
  const high = hasAltitude ? maxAltitude + (minAltitude === maxAltitude ? 1 : 0) : 1;
  const chartX = (timestamp: number) => chartView.padding + (timestamp - bounds.startedAt) / (bounds.endedAt - bounds.startedAt) * (chartView.width - chartView.padding * 2);
  const chartY = (altitude: number) => chartView.height - chartView.padding - (altitude - low) / (high - low) * (chartView.height - chartView.padding * 2);
  const altitudeRuns: PlanePoint[][] = [];
  let altitudeRun: PlanePoint[] = [];
  points.forEach((point, index) => {
    if (point.altitude === null || (index > 0 && point.timestamp - points[index - 1]!.timestamp > REPLAY_GAP_MS)) {
      if (altitudeRun.length) altitudeRuns.push(chartEnvelope(altitudeRun));
      altitudeRun = [];
    }
    if (point.altitude !== null) altitudeRun.push({ x: chartX(point.timestamp), y: chartY(point.altitude) });
  });
  if (altitudeRun.length) altitudeRuns.push(chartEnvelope(altitudeRun));
  return {
    projected, routePath: drawablePath(routeRuns), chartPath: drawablePath(altitudeRuns),
    grid: graticulePath(routeView, Number.isFinite(fit) ? scale : 0),
    chartX, chartY, minAltitude: hasAltitude ? minAltitude : null, maxAltitude: hasAltitude ? maxAltitude : null,
    routeVertexCount: routeRuns.reduce((count, run) => count + run.length, 0),
    chartVertexCount: altitudeRuns.reduce((count, run) => count + run.length, 0), gapCount,
  };
}

export type ReplayGeometry = ReturnType<typeof buildReplayGeometry>;

export function markerAt(projected: readonly PlanePoint[], telemetry: ReplayTelemetry | null): PlanePoint | null {
  if (!telemetry) return null;
  const left = projected[telemetry.left]!;
  const right = projected[telemetry.right]!;
  return { x: left.x + (right.x - left.x) * telemetry.fraction, y: left.y + (right.y - left.y) * telemetry.fraction };
}
