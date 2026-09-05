import { orderedUsableFixes, type UsableFix } from '../track/fixes';

export const REPLAY_GAP_MS = 15_000;
export interface ReplayPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Metres per second. */
  speed: number | null;
}
export interface ReplayBounds { startedAt: number; endedAt: number }
export type ReplayUnavailableReason = 'not_found' | 'open' | 'processing' | 'invalid_bounds' | 'insufficient_fixes';
export type FlightReplay = {
  kind: 'available';
  flightId: string;
  partial: boolean;
  bounds: ReplayBounds;
  points: ReplayPoint[];
} | { kind: 'unavailable'; reason: ReplayUnavailableReason };

export const REPLAY_UNAVAILABLE: Record<ReplayUnavailableReason, string> = {
  not_found: 'This flight is no longer on this phone.',
  open: 'Save this flight before replaying it. You can resume or save an interrupted recording from the recorder.',
  processing: 'This flight is still processing. Return to the logbook to retry its saved summary.',
  invalid_bounds: 'This recording has no valid saved start and end times.',
  insufficient_fixes: 'Replay needs at least two usable GPS fixes with different timestamps. Missing altitude alone does not prevent replay.',
};

export interface ReplayFix extends UsableFix { gpsAltitude: number | null; speed: number | null }

/** Never use thumbnail points: replay retains every usable timestamp and its telemetry. */
export function normalizeReplayPoints(fixes: readonly ReplayFix[], bounds: ReplayBounds): ReplayPoint[] {
  const ordered = orderedUsableFixes(fixes, bounds);
  const points: ReplayPoint[] = [];
  for (const fix of ordered) {
    const point: ReplayPoint = {
      timestamp: fix.sourceTimestamp, latitude: fix.latitude, longitude: fix.longitude,
      altitude: finiteOrNull(fix.gpsAltitude),
      speed: fix.speed !== null && fix.speed >= 0 ? finiteOrNull(fix.speed) : null,
    };
    // Ascending sequence means the last usable fix at this timestamp wins.
    if (points.at(-1)?.timestamp === point.timestamp) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export interface ReplayTelemetry {
  left: number;
  right: number;
  fraction: number;
  altitude: number | null;
  speed: number | null;
}

/** Binary search, including exact fixes at either edge of a gap. No extrapolation. */
export function telemetryAt(points: readonly ReplayPoint[], timestamp: number): ReplayTelemetry | null {
  if (!Number.isFinite(timestamp) || !points.length || timestamp < points[0]!.timestamp || timestamp > points[points.length - 1]!.timestamp) return null;
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle]!.timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  const right = points[low]!;
  if (right.timestamp === timestamp) return { left: low, right: low, fraction: 0, altitude: right.altitude, speed: right.speed };
  const left = points[low - 1]!;
  const gap = right.timestamp - left.timestamp;
  if (gap > REPLAY_GAP_MS) return null;
  const fraction = (timestamp - left.timestamp) / gap;
  const interpolate = (a: number | null, b: number | null) => a === null || b === null ? null : a + (b - a) * fraction;
  return { left: low - 1, right: low, fraction, altitude: interpolate(left.altitude, right.altitude), speed: interpolate(left.speed, right.speed) };
}
