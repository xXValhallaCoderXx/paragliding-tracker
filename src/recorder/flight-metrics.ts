import { orderedUsableFixes } from '../lib/track/fixes';
import { calculateGapStatistics } from './statistics';
import type { LocationFixRecord, RecorderEventRecord, SessionRecord } from './types';

export const FLIGHT_METRICS_ALGORITHM_VERSION = 1 as const;

export type FlightTrackQuality = 'healthy' | 'gaps' | 'partial' | 'no_track';

export interface CalculatedFlightMetrics {
  algorithmVersion: typeof FLIGHT_METRICS_ALGORITHM_VERSION;
  durationMs: number;
  trackDistanceMetres: number;
  minGpsAltitude: number | null;
  maxGpsAltitude: number | null;
  maxGroundSpeed: number | null;
  fixCount: number;
  medianSourceGapMs: number | null;
  p95SourceGapMs: number | null;
  maxSourceGapMs: number | null;
  quality: FlightTrackQuality;
}

const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceMetres(
  left: LocationFixRecord,
  right: LocationFixRecord,
): number {
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const clampedHaversine = Math.min(1, Math.max(0, haversine));
  const centralAngle =
    2 *
    Math.atan2(
      Math.sqrt(clampedHaversine),
      Math.sqrt(1 - clampedHaversine),
    );
  return EARTH_RADIUS_METRES * centralAngle;
}

function finiteValues(values: (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function callbackAccountingIsBalanced(events: RecorderEventRecord[]): boolean {
  const totals = events
    .filter(
      (event) =>
        event.type === 'location_callback' ||
        event.type === 'location_callback_duplicate',
    )
    .reduce(
      (result, event) => ({
        reported: result.reported + Number(event.payload.reported ?? 0),
        inserted: result.inserted + Number(event.payload.inserted ?? 0),
        duplicates: result.duplicates + Number(event.payload.duplicates ?? 0),
        invalid: result.invalid + Number(event.payload.invalid ?? 0),
      }),
      { reported: 0, inserted: 0, duplicates: 0, invalid: 0 },
    );

  return totals.reported === totals.inserted + totals.duplicates + totals.invalid;
}

function calculateDurationMs(session: SessionRecord): number {
  if (
    session.endedAt === null ||
    !Number.isFinite(session.startedAt) ||
    !Number.isFinite(session.endedAt)
  ) {
    return 0;
  }
  return Math.max(0, session.endedAt - session.startedAt);
}

export function calculateFlightMetrics(
  session: SessionRecord,
  fixes: LocationFixRecord[],
  events: RecorderEventRecord[],
): CalculatedFlightMetrics {
  // Session identity stays here: it is a question about which recording a fix belongs to,
  // not about whether a coordinate is drawable, and the shared predicate has no idea what a
  // session is.
  const usableFixes = orderedUsableFixes(
    fixes.filter((fix) => fix.sessionId === session.id),
    session,
  );
  const sessionEvents = events.filter((event) => event.sessionId === session.id);
  const cadence = calculateGapStatistics(
    usableFixes.map((fix) => fix.sourceTimestamp),
  );

  let trackDistanceMetres = 0;
  for (let index = 1; index < usableFixes.length; index += 1) {
    trackDistanceMetres += haversineDistanceMetres(
      usableFixes[index - 1]!,
      usableFixes[index]!,
    );
  }

  const altitudes = finiteValues(usableFixes.map((fix) => fix.gpsAltitude));
  const speeds = finiteValues(usableFixes.map((fix) => fix.speed)).filter(
    (speed) => speed >= 0,
  );

  let quality: FlightTrackQuality;
  if (usableFixes.length === 0) {
    quality = 'no_track';
  } else if (
    session.status === 'interrupted' ||
    session.completionReason === 'interrupted_finalized'
  ) {
    quality = 'partial';
  } else {
    const hasTaskError = sessionEvents.some(
      (event) => event.type === 'location_task_error' || event.type === 'task_error',
    );
    const hasCadenceGap =
      (cadence.p95GapMs !== null && cadence.p95GapMs > 5_000) ||
      (cadence.maxGapMs !== null && cadence.maxGapMs > 15_000);
    quality =
      hasTaskError || !callbackAccountingIsBalanced(sessionEvents) || hasCadenceGap
        ? 'gaps'
        : 'healthy';
  }

  return {
    algorithmVersion: FLIGHT_METRICS_ALGORITHM_VERSION,
    durationMs: calculateDurationMs(session),
    trackDistanceMetres,
    minGpsAltitude: altitudes.length > 0 ? Math.min(...altitudes) : null,
    maxGpsAltitude: altitudes.length > 0 ? Math.max(...altitudes) : null,
    maxGroundSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
    fixCount: usableFixes.length,
    medianSourceGapMs: cadence.medianGapMs,
    p95SourceGapMs: cadence.p95GapMs,
    maxSourceGapMs: cadence.maxGapMs,
    quality,
  };
}
