import { unwrapLongitude } from '../track/geometry';
import {
  isMapCoordinate,
  mapBounds,
  splitAntimeridian,
  type FlightMapTrack,
  type MapCoordinate,
} from '../track/map-geometry';
import { REPLAY_GAP_MS, type ReplayPoint, type ReplayTelemetry } from './model';

/** Build once per saved route, from original normalized replay points, never thumbnails. */
export function buildReplayMapTrack(points: readonly ReplayPoint[], id: string): FlightMapTrack | null {
  const coordinates: MapCoordinate[] = [];
  const segments: MapCoordinate[][] = [];
  const isolatedPoints: MapCoordinate[] = [];
  let run: MapCoordinate[] = [];
  let previousTimestamp: number | null = null;
  const finishRun = () => {
    if (run.length === 1) isolatedPoints.push(run[0]!);
    else if (run.length > 1) {
      for (const segment of splitAntimeridian(run)) segments.push(segment);
    }
    run = [];
  };
  for (const point of points) {
    const coordinate: MapCoordinate = [point.longitude, point.latitude];
    if (!isMapCoordinate(coordinate) || !Number.isFinite(point.timestamp)) {
      finishRun();
      previousTimestamp = null;
      continue;
    }
    if (previousTimestamp !== null &&
      (point.timestamp - previousTimestamp > REPLAY_GAP_MS || point.timestamp <= previousTimestamp)) {
      finishRun();
    }
    coordinates.push(coordinate);
    run.push(coordinate);
    previousTimestamp = point.timestamp;
  }
  finishRun();
  const bounds = mapBounds(coordinates);
  if (!bounds) return null;
  return { id, segments, isolatedPoints, bounds, first: coordinates[0]!, last: coordinates[coordinates.length - 1]! };
}

/** The same interpolation decision drives the grid, geographic marker and telemetry. */
export function replayMapPosition(points: readonly ReplayPoint[], telemetry: ReplayTelemetry | null): MapCoordinate | null {
  if (!telemetry || !Number.isFinite(telemetry.fraction) || telemetry.fraction < 0 || telemetry.fraction > 1) return null;
  const left = points[telemetry.left];
  const right = points[telemetry.right];
  if (!left || !right || !isMapCoordinate([left.longitude, left.latitude]) || !isMapCoordinate([right.longitude, right.latitude])) return null;
  const longitude = left.longitude + (unwrapLongitude(right.longitude, left.longitude) - left.longitude) * telemetry.fraction;
  return [unwrapLongitude(longitude, 0), left.latitude + (right.latitude - left.latitude) * telemetry.fraction];
}
