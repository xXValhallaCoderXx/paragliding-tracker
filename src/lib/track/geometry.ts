import type { Bounds, GeoPoint, PlanePoint } from './types';

/**
 * Metres per degree of latitude. Constant enough at logbook scale — the real figure varies
 * from 110 574 m at the equator to 111 694 m at the poles, a 0.5% spread that is far below
 * one viewBox unit on any plate a flight fits on.
 */
export const METRES_PER_DEGREE = 111_320;

/**
 * A longitude made continuous relative to a reference.
 *
 * Without this a flight crossing the antimeridian — Fiji, Chatham, eastern Russia — has a
 * longitude span of ~360 degrees, the aspect fit zooms out to the whole planet, and the
 * plate draws a horizontal hairline. Two lines to fix, and the failure it prevents is total
 * rather than degraded, so it is not worth documenting as a known limitation instead.
 *
 * This makes the drawing correct. It does not make a track genuinely spanning more than
 * 180 degrees of longitude correct, which a paraglider cannot fly.
 */
export function unwrapLongitude(longitude: number, reference: number): number {
  return longitude - 360 * Math.round((longitude - reference) / 360);
}

/**
 * A local flat-earth frame anchored at one point.
 *
 * Everything downstream — simplification, bounding box, aspect fit — works in metres on this
 * plane rather than in degrees, because a degree of longitude is a degree of latitude times
 * cos(latitude). At 46°N that is 0.69, so a tolerance applied in degree space would be 1.44x
 * looser east-west than north-south and would quietly flatten every eastward turn.
 *
 * Equirectangular, the same family as `distanceBetween` in `src/sites/site-plan.ts`, so the
 * app has one geodesy story rather than two.
 */
export interface PlaneFrame {
  latitude: number;
  longitude: number;
  metresPerDegreeLongitude: number;
}

export function planeFrame(anchor: GeoPoint): PlaneFrame {
  return {
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    metresPerDegreeLongitude: METRES_PER_DEGREE * Math.cos((anchor.latitude * Math.PI) / 180),
  };
}

export function toPlanePoint(point: GeoPoint, frame: PlaneFrame): PlanePoint {
  const longitude = unwrapLongitude(point.longitude, frame.longitude);
  return {
    x: (longitude - frame.longitude) * frame.metresPerDegreeLongitude,
    // Negated: SVG's y axis grows downward and north does not, so a track drawn without this
    // is a perfect vertical mirror of the flight — plausible enough to ship unnoticed.
    y: -(point.latitude - frame.latitude) * METRES_PER_DEGREE,
  };
}

/** The extent of every segment together, or null when there is nothing to bound. */
export function boundsOf(segments: readonly (readonly PlanePoint[])[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = false;

  for (const segment of segments) {
    for (const point of segment) {
      seen = true;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }

  return seen ? { minX, maxX, minY, maxY } : null;
}

/** The diagonal of a bounding box, which is what every scale-relative tolerance is measured against. */
export function diagonalOf(bounds: Bounds): number {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return Math.sqrt(width * width + height * height);
}

/**
 * Squared distance from a point to a segment, clamped to the segment's ends.
 *
 * Squared so the Douglas-Peucker inner loop never calls `sqrt` — the comparison against a
 * tolerance works identically on squares. Clamped because the start and end are real
 * vertices: measuring to the infinite line instead would under-report a track that doubles
 * back past them, which is precisely what a thermal exit does.
 */
export function perpendicularDistanceSquared(
  point: PlanePoint,
  start: PlanePoint,
  end: PlanePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    // A zero-length segment is a point, and the distance to a point is the only answer
    // available. Dividing by it instead would return NaN and silently keep every vertex.
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const ex = point.x - (start.x + t * dx);
  const ey = point.y - (start.y + t * dy);
  return ex * ex + ey * ey;
}
