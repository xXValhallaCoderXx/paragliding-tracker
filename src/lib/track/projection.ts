import { boundsOf, planeFrame, toPlanePoint } from './geometry';
import type { GeoPoint, PlanePoint, TrackSegments } from './types';

/** The drawing surface, in viewBox units. */
export interface Viewport {
  width: number;
  height: number;
  padding: number;
}

export interface Projection {
  /** Segments in viewBox units, ready to become path data. */
  segments: PlanePoint[][];
  /** viewBox units per metre — what the graticule spacing is chosen from. */
  unitsPerMetre: number;
  /** True when the track had no extent in either axis and was centred rather than fitted. */
  degenerate: boolean;
}

const EMPTY: Projection = { segments: [], unitsPerMetre: 0, degenerate: true };

function toGeoPoints(segment: readonly number[]): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (let index = 0; index + 1 < segment.length; index += 2) {
    points.push({ latitude: segment[index]!, longitude: segment[index + 1]! });
  }
  return points;
}

/**
 * A stored track, fitted to a viewport.
 *
 * One scale for both axes, so the shape is never distorted — a plate that stretched a flight
 * to fill its box would misrepresent every angle in it.
 */
export function projectSegments(segments: TrackSegments, view: Viewport): Projection {
  const geo = segments.map(toGeoPoints).filter((points) => points.length > 0);
  const anchor = geo[0]?.[0];
  if (!anchor) return EMPTY;

  const frame = planeFrame(anchor);
  const metres = geo.map((points) => points.map((point) => toPlanePoint(point, frame)));
  const bounds = boundsOf(metres);
  if (!bounds) return EMPTY;

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const availableWidth = view.width - view.padding * 2;
  const availableHeight = view.height - view.padding * 2;

  // Per axis, and only for axes that have an extent. A flight due north has spanX === 0, and
  // `min(Infinity, finite)` is the finite one — which is correct, and is exactly what a
  // both-axes guard written the obvious way would break.
  const scaleX = spanX > 0 ? availableWidth / spanX : Number.POSITIVE_INFINITY;
  const scaleY = spanY > 0 ? availableHeight / spanY : Number.POSITIVE_INFINITY;
  const fitted = Math.min(scaleX, scaleY);
  const degenerate = !Number.isFinite(fitted);
  const scale = degenerate ? 1 : fitted;

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const offsetX = view.width / 2 - scale * centreX;
  const offsetY = view.height / 2 - scale * centreY;

  return {
    segments: metres.map((points) =>
      points.map((point) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY })),
    ),
    unitsPerMetre: degenerate ? 0 : scale,
    degenerate,
  };
}

/** Trims a coordinate for path data. `toFixed` never produces exponent notation, which SVG cannot read. */
function unit(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/**
 * One `d` string for every segment.
 *
 * A single path with an `M` restart per segment, rather than one element each: the logbook
 * mounts every card at once, and native node count is what that costs.
 */
export function toPathData(segments: readonly (readonly PlanePoint[])[], decimals = 2): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    const commands: string[] = [];
    for (let index = 0; index < segment.length; index += 1) {
      const point = segment[index]!;
      commands.push(
        `${index === 0 ? 'M' : 'L'}${unit(point.x, decimals)} ${unit(point.y, decimals)}`,
      );
    }
    parts.push(commands.join(''));
  }
  return parts.join('');
}

/**
 * Round distances a grid square is allowed to be.
 *
 * The graticule is a scale, not decoration: if the squares mean "2 km" the plate makes a
 * claim, and the caption can say so. An arbitrary spacing would just be texture.
 */
const GRID_LADDER_METRES = [
  10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
];

/** Fewer divisions than this and there is no square to read a scale off. */
const MIN_GRID_DIVISIONS = 3;

export interface Graticule {
  d: string;
  /** Null when there is no track to take a scale from, and the grid is plain texture. */
  spacingMetres: number | null;
}

/** Fallback spacing in viewBox units, for a plate with no track to measure. */
const PLAIN_GRID_DIVISIONS = 4;

export function graticulePath(view: Viewport, unitsPerMetre: number): Graticule {
  let spacingUnits: number;
  let spacingMetres: number | null = null;

  // The coarsest spacing that still divides the plate a few times over. Coarsest, so the
  // squares are as large as the scale allows and the number stays round and memorable.
  const visibleMetres = unitsPerMetre > 0 ? Math.max(view.width, view.height) / unitsPerMetre : 0;
  const usable = GRID_LADDER_METRES.filter(
    (candidate) => visibleMetres / candidate >= MIN_GRID_DIVISIONS,
  );

  if (usable.length > 0) {
    spacingMetres = usable[usable.length - 1]!;
    spacingUnits = spacingMetres * unitsPerMetre;
  } else {
    // Nothing on the ladder divides this plate. Draw an even grid and claim no scale —
    // a caption reading "250 M GRID" over a plate with no visible square would be a
    // measurement the picture does not support.
    spacingUnits = Math.max(view.width, view.height) / PLAIN_GRID_DIVISIONS;
  }

  const commands: string[] = [];
  // Anchored at the centre so the grid is symmetric about the track it sits under.
  for (let x = view.width / 2; x > 0; x -= spacingUnits) {
    commands.push(`M${unit(x, 2)} 0V${unit(view.height, 2)}`);
  }
  for (let x = view.width / 2 + spacingUnits; x < view.width; x += spacingUnits) {
    commands.push(`M${unit(x, 2)} 0V${unit(view.height, 2)}`);
  }
  for (let y = view.height / 2; y > 0; y -= spacingUnits) {
    commands.push(`M0 ${unit(y, 2)}H${unit(view.width, 2)}`);
  }
  for (let y = view.height / 2 + spacingUnits; y < view.height; y += spacingUnits) {
    commands.push(`M0 ${unit(y, 2)}H${unit(view.width, 2)}`);
  }

  return { d: commands.join(''), spacingMetres };
}
