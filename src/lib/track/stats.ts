import { planeFrame, toPlanePoint } from './geometry';
import type { TrackSegments } from './types';

/**
 * Facts that fall out of the stored shape.
 *
 * These are not metrics: `flight_metrics` is computed once from every recorded fix and
 * versioned, whereas these are read straight off the simplified track the plate is already
 * holding. Cheap enough to compute at render, and there is nothing to keep in sync.
 */

/**
 * Launch to landing in a straight line, which is not the same number as track distance and
 * is the one an XC pilot quotes. A tow around a single ridge can fly fifty kilometres and
 * land where it started.
 *
 * Measured from the simplified track rather than the raw fixes: Douglas-Peucker always
 * keeps the exact first and last point of every segment, so the endpoints are the real ones.
 */
export function straightLineMetres(segments: TrackSegments): number | null {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last || first.length < 2 || last.length < 2) return null;

  const frame = planeFrame({ latitude: first[0]!, longitude: first[1]! });
  const start = toPlanePoint({ latitude: first[0]!, longitude: first[1]! }, frame);
  const end = toPlanePoint(
    { latitude: last[last.length - 2]!, longitude: last[last.length - 1]! },
    frame,
  );
  return Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
}
