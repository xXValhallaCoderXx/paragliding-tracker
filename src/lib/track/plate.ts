import { decodeTrackSegments } from './encoding';
import { graticulePath, projectSegments, toPathData } from './projection';
import type { Viewport } from './projection';
import { trackPointCount } from './simplify';
import type { TrackSegments } from './types';

/**
 * Everything the plate renders, decided here.
 *
 * Jest never collects `.tsx`, so a rule that lives in the component is a rule nothing checks
 * — the same reasoning that put the onboarding flow, the backup invitation and the site policy
 * in modules like this one. The component switches on `kind` and reads coordinates; it
 * decides nothing.
 */

export const HERO_PLATE: Viewport = Object.freeze({ width: 392, height: 340, padding: 26 });
export const THUMBNAIL_PLATE: Viewport = Object.freeze({ width: 64, height: 64, padding: 5 });

export type TrackPlateVariant = 'hero' | 'thumbnail';
export type TrackPlateState = 'ready' | 'recording' | 'processing' | 'no_track';

export interface PlateMarker {
  kind: 'takeoff' | 'landing';
  x: number;
  y: number;
  radius: number;
}

export interface PlateLabel {
  kind: 'takeoff' | 'landing';
  text: string;
  /** Percentages of the viewBox, so the overlay positions without measuring anything. */
  xPercent: number;
  yPercent: number;
  align: 'left' | 'right';
}

export type TrackPlate =
  | {
      kind: 'track';
      view: Viewport;
      /** Null on a thumbnail: at 64px a graticule is noise the track has to compete with. */
      grid: string | null;
      path: string;
      strokeWidth: number;
      markers: PlateMarker[];
      labels: PlateLabel[];
      caption: string | null;
      segmentCount: number;
    }
  | {
      kind: 'point';
      view: Viewport;
      grid: string | null;
      markers: PlateMarker[];
      labels: PlateLabel[];
      caption: string | null;
    }
  | {
      kind: 'empty';
      view: Viewport;
      grid: string;
      caption: string;
      tone: 'neutral' | 'warning';
    }
  /** Render nothing at all. */
  | { kind: 'none' };

export interface TrackPlateInput {
  segments: TrackSegments;
  variant: TrackPlateVariant;
  state: TrackPlateState;
  takeoffLabel?: string | null;
  landingLabel?: string | null;
}

/**
 * Stroke in viewBox units rather than `vectorEffect="non-scaling-stroke"`, which is
 * inconsistent on Android. The thumbnail's is proportionally far thicker because 64 px of
 * plate needs a line you can see, not a line to scale.
 */
const STROKE_UNITS: Record<TrackPlateVariant, number> = { hero: 2.4, thumbnail: 2.5 };
const MARKER_UNITS: Record<TrackPlateVariant, number> = { hero: 6, thumbnail: 3 };

/** Keeps a label anchor off the plate's edge, where the text would be clipped. */
const LABEL_INSET_PERCENT = 5;

/**
 * How far a label sits from the marker it names, in viewBox units.
 *
 * Centred on the marker the text lands on top of both the marker and the track leaving it,
 * which is unreadable exactly where the plate is most interesting.
 */
const LABEL_OFFSET_UNITS = 15;

/** Closer than this and two labels are one illegible smudge. */
const LABEL_MIN_SEPARATION_PERCENT = 7;

function clampPercent(value: number): number {
  return Math.min(100 - LABEL_INSET_PERCENT, Math.max(LABEL_INSET_PERCENT, value));
}

function labelAt(
  point: { x: number; y: number },
  view: Viewport,
  kind: 'takeoff' | 'landing',
  text: string,
  offsetUnits: number,
): PlateLabel {
  return {
    kind,
    text,
    xPercent: clampPercent((point.x / view.width) * 100),
    yPercent: clampPercent(((point.y + offsetUnits) / view.height) * 100),
    // Anchored on whichever side leaves the text room to run inward.
    align: point.x > view.width / 2 ? 'right' : 'left',
  };
}

function formatSpacing(metres: number): string {
  return metres >= 1_000 ? `${metres / 1_000} KM` : `${metres} M`;
}

function emptyCaption(state: TrackPlateState): { caption: string; tone: 'neutral' | 'warning' } {
  switch (state) {
    case 'no_track':
      return { caption: 'NO TRACK RECORDED', tone: 'warning' };
    case 'recording':
      return { caption: 'RECORDING…', tone: 'neutral' };
    default:
      return { caption: 'PLOTTING TRACK…', tone: 'neutral' };
  }
}

export function buildTrackPlate(input: TrackPlateInput): TrackPlate {
  const view = input.variant === 'hero' ? HERO_PLATE : THUMBNAIL_PLATE;
  const isHero = input.variant === 'hero';
  const points = trackPointCount(input.segments);

  if (input.state !== 'ready' || points === 0) {
    // A card with an empty box next to it reads as broken; a card with no box reads as no
    // picture. The chip on that card already says why, and the detail screen already raises
    // a notice — the plate is never the loud channel.
    if (!isHero) return { kind: 'none' };
    // A finalized flight with nothing drawable is a flight with no track, whatever the
    // metrics happen to say — the simplifier is the thing that just looked.
    const { caption, tone } = emptyCaption(input.state === 'ready' ? 'no_track' : input.state);
    return { kind: 'empty', view, grid: graticulePath(view, 0).d, caption, tone };
  }

  const projection = projectSegments(input.segments, view);
  const first = projection.segments[0]?.[0];
  const lastSegment = projection.segments[projection.segments.length - 1];
  const last = lastSegment?.[lastSegment.length - 1];

  if (!first || !last) {
    if (!isHero) return { kind: 'none' };
    return {
      kind: 'empty',
      view,
      grid: graticulePath(view, 0).d,
      caption: 'NO TRACK RECORDED',
      tone: 'warning',
    };
  }

  const graticule = graticulePath(view, projection.unitsPerMetre);
  const markerRadius = MARKER_UNITS[input.variant];

  // Takeoff sits below its marker and landing above, so neither covers the track leaving or
  // arriving at it.
  const labels: PlateLabel[] = [];
  if (isHero && input.takeoffLabel) {
    labels.push(labelAt(first, view, 'takeoff', input.takeoffLabel, LABEL_OFFSET_UNITS));
  }

  // A flight that never moved has one place to stand and one time to name; a second label on
  // top of the first would just be two overlapping strings. At thumbnail size a lone dot is
  // indistinguishable from a rendering fault, so the card shows nothing instead.
  if (points === 1 || projection.degenerate) {
    if (!isHero) return { kind: 'none' };
    return {
      kind: 'point',
      view,
      grid: graticule.d,
      markers: [{ kind: 'takeoff', x: first.x, y: first.y, radius: markerRadius }],
      labels,
      caption: isHero ? 'ONE FIX ONLY' : null,
    };
  }

  if (isHero && input.landingLabel) {
    let landing = labelAt(last, view, 'landing', input.landingLabel, -LABEL_OFFSET_UNITS);
    const takeoff = labels[0];
    // A flight that lands where it launched puts both labels in the same place. Clamping
    // can do it too, when a marker sits against an edge and both get pushed to the inset.
    // Sending the landing label the other way is the only move that always separates them.
    if (
      takeoff &&
      Math.abs(takeoff.yPercent - landing.yPercent) < LABEL_MIN_SEPARATION_PERCENT &&
      Math.abs(takeoff.xPercent - landing.xPercent) < 30
    ) {
      landing = labelAt(last, view, 'landing', input.landingLabel, LABEL_OFFSET_UNITS * 3);
    }
    labels.push(landing);
  }

  const segmentCount = projection.segments.length;
  const parts = ['CHART PLATE'];
  if (graticule.spacingMetres !== null) parts.push(`${formatSpacing(graticule.spacingMetres)} GRID`);
  if (segmentCount > 1) parts.push('GAP IN TRACK');

  return {
    kind: 'track',
    view,
    grid: isHero ? graticule.d : null,
    path: toPathData(projection.segments),
    strokeWidth: STROKE_UNITS[input.variant],
    markers: [
      { kind: 'takeoff', x: first.x, y: first.y, radius: markerRadius },
      { kind: 'landing', x: last.x, y: last.y, radius: markerRadius },
    ],
    labels,
    caption: isHero ? parts.join(' · ') : null,
    segmentCount,
  };
}

/** Convenience for the common path: a stored column straight to a plate. */
export function buildTrackPlateFromColumn(
  raw: string | null | undefined,
  input: Omit<TrackPlateInput, 'segments'>,
): TrackPlate {
  return buildTrackPlate({ ...input, segments: decodeTrackSegments(raw) });
}
