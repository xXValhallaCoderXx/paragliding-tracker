import { boundsOf, diagonalOf, perpendicularDistanceSquared, planeFrame, toPlanePoint } from './geometry';
import type { UsableFix } from './fixes';
import type { PlanePoint, TrackSegments } from './types';

/**
 * Reducing a recorded track to something drawable.
 *
 * Bumping the version is what makes every stored track re-derive lazily on next open,
 * instead of needing a migration that walks `location_fixes` inside a transaction. That is
 * the main reason the derive-on-miss path exists at all.
 */
export const TRACK_ALGORITHM_VERSION = 1 as const;

/**
 * Target vertices. The hero plate is 392 units wide, so 200 points is one every ~2 units —
 * past the density at which another vertex is visible.
 */
export const TRACK_POINT_BUDGET = 200;

/** Hard cap, enforced by widening the tolerance until the output fits. */
export const TRACK_POINT_CEILING = 256;

/**
 * Tolerance as a fraction of the bounding box diagonal, which is the whole trick.
 *
 * A *fixed metric* tolerance cannot hit a point budget: Douglas-Peucker keeps roughly
 * `PI / acos(1 - e/r)` vertices per circular turn, so at e = 10 m a three-hour flight with
 * 240 thermal turns of radius 100 m keeps about 1 680 points — six times over.
 *
 * Scaling it to the flight's own extent instead means the plate is equally detailed at every
 * zoom. A 2 km ridge-soaring flight keeps its spirals, because at that scale a 200 m circle
 * is 39 viewBox units and is the entire visual identity of the flight. A 60 km cross-country
 * drops them, because the same circle is 2.6 units and was never visible in the first place.
 */
export const TRACK_EPSILON_FRACTION = 1 / 512;

/**
 * Ceiling on what the simplifier will look at.
 *
 * At the recorder's 1 Hz this is 5.5 hours, so for any real flight the stride is 1 and
 * Douglas-Peucker sees every single fix. It exists only so that the pathological
 * O(n squared) case is bounded rather than unbounded — and at stride 2 the sampling is still
 * 2 s against an ~18 s thermal period, nowhere near aliasing.
 */
export const TRACK_MAX_INPUT_POINTS = 20_000;

/**
 * Longer than this between two fixes and the path breaks instead of joining them.
 *
 * A paraglider covers ~700 m in a minute; below that threshold the invented straight line is
 * sub-pixel at any scale where the flight fits on the plate, so drawing it claims nothing
 * untrue. Above it, the line is a claim about where the pilot went that nothing recorded.
 */
export const TRACK_GAP_MS = 60_000;

/** Stored precision. 5 dp is 1.1 m — sub-pixel even on a 500 m plate, where it is 0.86 units. */
const STORED_DECIMALS = 5;

/**
 * Douglas-Peucker, returning the indices it keeps.
 *
 * Indices rather than points so the caller can map back to the original coordinates and
 * store degrees, keeping the artefact reprojectable.
 *
 * Iterative with an explicit stack rather than recursive: depth here is bounded by the
 * *output* size, which with a small tolerance runs to thousands of frames, and Hermes' stack
 * is not generous. Five extra lines removes the question entirely.
 */
export function douglasPeuckerIndices(points: readonly PlanePoint[], epsilon: number): number[] {
  if (points.length <= 2) return points.map((_, index) => index);

  const epsilonSquared = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;

    let farthest = -1;
    let farthestDistance = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicularDistanceSquared(points[index]!, points[first]!, points[last]!);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = index;
      }
    }

    if (farthest < 0 || farthestDistance <= epsilonSquared) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }

  const indices: number[] = [];
  for (let index = 0; index < keep.length; index += 1) {
    if (keep[index] === 1) indices.push(index);
  }
  return indices;
}

/** Splits an ordered run of fixes wherever the recorder lost more than `TRACK_GAP_MS`. */
function splitOnGaps(fixes: readonly UsableFix[]): UsableFix[][] {
  const runs: UsableFix[][] = [];
  let current: UsableFix[] = [];

  for (const fix of fixes) {
    const previous = current[current.length - 1];
    if (previous && fix.sourceTimestamp - previous.sourceTimestamp > TRACK_GAP_MS) {
      runs.push(current);
      current = [];
    }
    current.push(fix);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function round(value: number): number {
  const factor = 10 ** STORED_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * A recorded track, reduced to the shape worth drawing.
 *
 * Uniform decimation is not an option here and the reason is arithmetic: 10 800 fixes down
 * to 200 is every 54th fix, sampled against a thermal turn of 15-20 s. That is textbook
 * aliasing — the spirals do not blur, they collapse into a drift line or beat into a zigzag
 * that reads as GPS noise. Every thermal in the flight disappears, which is to say
 * everything that makes a paragliding track look like a paragliding track.
 */
export function simplifyTrack(orderedFixes: readonly UsableFix[]): number[][] {
  if (orderedFixes.length === 0) return [];

  // Purely a bound on the pathological case; stride is 1 for anything under 5.5 hours. The
  // last fix is appended unconditionally so the track still ends where the flight did.
  const stride = Math.max(1, Math.ceil(orderedFixes.length / TRACK_MAX_INPUT_POINTS));
  let input: readonly UsableFix[] = orderedFixes;
  if (stride > 1) {
    const strided = orderedFixes.filter((_, index) => index % stride === 0);
    const last = orderedFixes[orderedFixes.length - 1]!;
    if (strided[strided.length - 1] !== last) strided.push(last);
    input = strided;
  }

  const runs = splitOnGaps(input);
  const frame = planeFrame(input[0]!);
  const projected = runs.map((run) => run.map((fix) => toPlanePoint(fix, frame)));

  const bounds = boundsOf(projected);
  const diagonal = bounds ? diagonalOf(bounds) : 0;

  // A flight that never moved has no extent to scale a tolerance against. Zero keeps every
  // distinct point, and the duplicate collapse below reduces it to the one point it is.
  let epsilon = diagonal * TRACK_EPSILON_FRACTION;
  let kept = projected.map((run) => douglasPeuckerIndices(run, epsilon));
  let total = kept.reduce((sum, indices) => sum + indices.length, 0);

  // Doubling terminates provably: once epsilon reaches the diagonal no interior point can
  // exceed it and every run collapses to its two endpoints. Twelve attempts is what makes
  // that reachable — the tolerance starts at a 512th of the diagonal, so nine doublings are
  // needed just to get back to it, and a cap of eight would quietly return an over-budget
  // track for any flight with more turns than the budget can hold.
  for (let attempt = 0; total > TRACK_POINT_CEILING && epsilon > 0 && attempt < 12; attempt += 1) {
    epsilon *= 2;
    kept = projected.map((run) => douglasPeuckerIndices(run, epsilon));
    total = kept.reduce((sum, indices) => sum + indices.length, 0);
  }

  const segments: number[][] = [];
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex]!;
    const flat: number[] = [];
    let lastLatitude = Number.NaN;
    let lastLongitude = Number.NaN;

    for (const index of kept[runIndex]!) {
      const latitude = round(run[index]!.latitude);
      const longitude = round(run[index]!.longitude);
      // Rounding to 1.1 m can make two kept vertices identical on a tight plate. Collapsing
      // them costs nothing and keeps the path free of zero-length commands.
      if (latitude === lastLatitude && longitude === lastLongitude) continue;
      flat.push(latitude, longitude);
      lastLatitude = latitude;
      lastLongitude = longitude;
    }

    if (flat.length > 0) segments.push(flat);
  }

  return segments;
}

/** Total stored vertices across every segment. */
export function trackPointCount(segments: TrackSegments): number {
  let total = 0;
  for (const segment of segments) total += segment.length / 2;
  return total;
}
