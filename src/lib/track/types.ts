/**
 * A flight's shape, as stored and as drawn.
 *
 * An array of **continuous runs**, each a flat `[lat, lon, lat, lon, ...]`. Segments rather
 * than one array because a recording gap has to draw as a break: one polyline across a
 * ten-minute dropout draws a straight line the pilot never flew, which is exactly the claim
 * a plate built entirely from our own fixes must not make.
 *
 * An empty array means the simplifier ran and found nothing usable — a real answer, not a
 * missing one.
 */
export type TrackSegments = readonly (readonly number[])[];

/** A position in degrees. Deliberately structural: this layer knows nothing about flights. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A position on the local flat-earth plane, in metres, or in viewBox units once scaled. */
export interface PlanePoint {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
