import { METRES_PER_DEGREE, unwrapLongitude } from './geometry';

/** Geographic positions, in GeoJSON order. No renderer or recorder dependency. */
export type MapCoordinate = [longitude: number, latitude: number];

export interface MapBounds {
  /** Longitudes share one continuous frame, so east can exceed 180 at the dateline. */
  ne: MapCoordinate;
  sw: MapCoordinate;
}

export interface FlightMapTrack {
  id: string;
  /** Each line is continuous and stays on one side of the antimeridian. */
  segments: MapCoordinate[][];
  isolatedPoints: MapCoordinate[];
  bounds: MapBounds;
  first?: MapCoordinate;
  last?: MapCoordinate;
}

export function isMapCoordinate([longitude, latitude]: MapCoordinate): boolean {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

/** A stationary recording still gets a useful neighbourhood view, roughly 200 m across. */
export function mapBounds(coordinates: readonly MapCoordinate[]): MapBounds | null {
  const first = coordinates[0];
  if (!first) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of coordinates) {
    const continuousLongitude = unwrapLongitude(longitude, first[0]);
    west = Math.min(west, continuousLongitude);
    east = Math.max(east, continuousLongitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  const centreLongitude = (west + east) / 2;
  const centreLatitude = (south + north) / 2;
  const minimumLatitudeSpan = 200 / METRES_PER_DEGREE;
  const longitudeScale = Math.max(0.01, Math.cos(centreLatitude * Math.PI / 180));
  const halfLongitudeSpan = Math.max((east - west) / 2, minimumLatitudeSpan / longitudeScale / 2);
  const halfLatitudeSpan = Math.max((north - south) / 2, minimumLatitudeSpan / 2);
  return {
    ne: [centreLongitude + halfLongitudeSpan, Math.min(90, centreLatitude + halfLatitudeSpan)],
    sw: [centreLongitude - halfLongitudeSpan, Math.max(-90, centreLatitude - halfLatitudeSpan)],
  };
}

/**
 * Split one continuous run at the dateline for geographic polyline renderers. The two
 * seam vertices represent the same position; they do not fill a missing recording gap.
 * Camera bounds are computed from original fixes, not these opposite-side seam vertices.
 */
export function splitAntimeridian(run: readonly MapCoordinate[]): MapCoordinate[][] {
  if (run.length < 2) return [];
  const segments: MapCoordinate[][] = [];
  let segment = [run[0]!];
  for (let index = 1; index < run.length; index += 1) {
    const next = run[index]!;
    const previous = segment[segment.length - 1]!;
    if (Math.abs(next[0] - previous[0]) > 180) {
      const nextLongitude = unwrapLongitude(next[0], previous[0]);
      const delta = nextLongitude - previous[0];
      // +180 and -180 name the same meridian, including a stationary fix on it.
      if (delta === 0) {
        segment.push([previous[0], next[1]]);
        continue;
      }
      const edge = delta > 0 ? 180 : -180;
      const fraction = (edge - previous[0]) / delta;
      const latitude = previous[1] + (next[1] - previous[1]) * fraction;
      if (fraction > 0) segment.push([edge, latitude]);
      if (segment.length > 1) segments.push(segment);
      segment = [[-edge, latitude]];
      if (fraction < 1) segment.push(next);
    } else {
      segment.push(next);
    }
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}
