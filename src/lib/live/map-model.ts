import { isUsableCoordinateFix } from '../track/fixes';
import { mapBounds, splitAntimeridian, type FlightMapTrack, type MapCoordinate } from '../track/map-geometry';
import { LIVE_MAP_MAX_ROWS, LIVE_MAP_WINDOW_MS, type CapturedMapFix, type LiveMapData } from './types';

export const LIVE_POSITION_STALE_MS = 15_000;
export const LIVE_DEFAULT_ZOOM = 14;

export function isLiveMapFix(fix: CapturedMapFix, sessionId: string, now: number): boolean {
  return fix.sessionId === sessionId && isUsableCoordinateFix(fix) &&
    Number.isFinite(fix.receiptTimestamp) && fix.sourceTimestamp <= now;
}

export function liveMapPosition(data: LiveMapData, now: number): CapturedMapFix | null {
  return data.position && isLiveMapFix(data.position, data.sessionId, now) ? data.position : null;
}

/** Both event time and arrival time matter: a delayed batch never makes an old fix current. */
export function livePositionIsStale(fix: CapturedMapFix, now: number, captureHealthy: boolean): boolean {
  const sourceAge = now - fix.sourceTimestamp;
  const receiptAge = now - fix.receiptTimestamp;
  return !captureHealthy || !Number.isFinite(sourceAge) || !Number.isFinite(receiptAge) ||
    sourceAge < 0 || receiptAge < 0 || sourceAge >= LIVE_POSITION_STALE_MS || receiptAge >= LIVE_POSITION_STALE_MS;
}

/** Recorded sequence is authoritative. Invalid or skipped rows break a line rather than disappearing into it. */
export function buildLiveMapTrack(data: LiveMapData, now: number): FlightMapTrack | null {
  const segments: MapCoordinate[][] = [];
  const isolatedPoints: MapCoordinate[] = [];
  const coordinates: MapCoordinate[] = [];
  let run: MapCoordinate[] = [];
  let previous: CapturedMapFix | null = null;
  const finish = () => {
    if (run.length === 1) isolatedPoints.push(run[0]!);
    else if (run.length > 1) segments.push(...splitAntimeridian(run));
    run = [];
    previous = null;
  };
  for (const fix of data.rows.slice(-LIVE_MAP_MAX_ROWS)) {
    if (!isLiveMapFix(fix, data.sessionId, now) || fix.sourceTimestamp < now - LIVE_MAP_WINDOW_MS) {
      finish();
      continue;
    }
    if (previous && (fix.sequence !== previous.sequence + 1 || fix.sourceTimestamp <= previous.sourceTimestamp ||
      fix.sourceTimestamp - previous.sourceTimestamp > LIVE_POSITION_STALE_MS)) finish();
    const coordinate: MapCoordinate = [fix.longitude, fix.latitude];
    run.push(coordinate);
    coordinates.push(coordinate);
    previous = fix;
  }
  finish();
  const position = liveMapPosition(data, now);
  if (position) coordinates.push([position.longitude, position.latitude]);
  const bounds = mapBounds(coordinates);
  // There are deliberately no route endpoints: this is a recent window in an ongoing recording.
  return bounds ? { id: data.sessionId, segments, isolatedPoints, bounds } : null;
}
