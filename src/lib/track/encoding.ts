import type { TrackSegments } from './types';

/**
 * How a track crosses the SQLite boundary.
 *
 * Plain JSON, deliberately. An encoded polyline would take a 200-point track from ~3.6 KB to
 * ~1.0 KB — against the same flight's ~860 KB of raw `location_fixes` rows, a saving of 0.3%
 * for forty lines of varint loop and its round-trip tests. And on the axis that actually runs
 * N times per logbook render, decode, JSON is *faster*: `JSON.parse` is native, a varint loop
 * is Hermes bytecode.
 */

export function encodeTrackSegments(segments: TrackSegments): string {
  return JSON.stringify(segments);
}

/**
 * Whatever was in the column, as a track.
 *
 * Never throws and never returns a half-parsed shape. This value is read on every logbook
 * render for every flight, so a single corrupt row must degrade to one missing thumbnail
 * rather than to a screen that cannot mount.
 */
export function decodeTrackSegments(raw: string | null | undefined): TrackSegments {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const segments: number[][] = [];
  for (const candidate of parsed) {
    if (!Array.isArray(candidate)) return [];
    // Odd length means a coordinate lost its pair, and there is no way to tell which half
    // survived. Guessing would draw the track somewhere it never went.
    if (candidate.length % 2 !== 0) return [];
    for (const value of candidate) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    }
    if (candidate.length > 0) segments.push(candidate as number[]);
  }
  return segments;
}
