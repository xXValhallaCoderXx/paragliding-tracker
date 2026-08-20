import { buildTrackPlate, HERO_PLATE, THUMBNAIL_PLATE } from '../plate';
import type { TrackPlateState } from '../plate';
import { graticulePath, projectSegments, toPathData } from '../projection';
import type { TrackSegments } from '../types';

/** A short flight in the Dolomites, as it would be stored. */
const TRACK: TrackSegments = [[46.5, 11.5, 46.51, 11.52, 46.52, 11.51, 46.53, 11.55]];

function hero(segments: TrackSegments, state: TrackPlateState = 'ready') {
  return buildTrackPlate({ segments, variant: 'hero', state });
}

describe('projectSegments', () => {
  it('does not distort the shape', () => {
    // One scale for both axes. A plate that stretched a flight to fill its box would
    // misrepresent every angle in it.
    const square: TrackSegments = [[46.5, 11.5, 46.51, 11.5, 46.51, 11.514, 46.5, 11.514]];
    const { segments } = projectSegments(square, HERO_PLATE);
    const points = segments[0]!;
    const width = Math.abs(points[2]!.x - points[0]!.x);
    const height = Math.abs(points[1]!.y - points[0]!.y);
    expect(width / height).toBeGreaterThan(0.85);
    expect(width / height).toBeLessThan(1.15);
  });

  it('respects the padding without wasting the plate', () => {
    const { segments } = projectSegments(TRACK, HERO_PLATE);
    const points = segments.flat();
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(HERO_PLATE.padding - 0.001);
      expect(point.x).toBeLessThanOrEqual(HERO_PLATE.width - HERO_PLATE.padding + 0.001);
      expect(point.y).toBeGreaterThanOrEqual(HERO_PLATE.padding - 0.001);
      expect(point.y).toBeLessThanOrEqual(HERO_PLATE.height - HERO_PLATE.padding + 0.001);
    }
    // And the track fills the padded box in whichever axis constrained it, or the fit is
    // not a fit. Which axis that is depends on the flight's own shape, not the plate's.
    const spanX = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
    const spanY = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    const fill = Math.max(
      spanX / (HERO_PLATE.width - HERO_PLATE.padding * 2),
      spanY / (HERO_PLATE.height - HERO_PLATE.padding * 2),
    );
    expect(fill).toBeCloseTo(1, 2);
  });

  it('fits a flight due north by height alone', () => {
    // The case a reviewer breaks: the longitude span is zero, so a both-axes guard written
    // the obvious way collapses the scale to 1 and draws the flight as a dot.
    const northward: TrackSegments = [[46.5, 11.5, 46.55, 11.5, 46.6, 11.5]];
    const projection = projectSegments(northward, HERO_PLATE);
    const points = projection.segments[0]!;
    expect(projection.degenerate).toBe(false);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(points[0]!.x).toBeCloseTo(points[2]!.x, 6);
    expect(Math.abs(points[2]!.y - points[0]!.y)).toBeCloseTo(
      HERO_PLATE.height - HERO_PLATE.padding * 2,
      1,
    );
  });

  it('draws an antimeridian crossing at its real size', () => {
    // Two kilometres of flight, not forty thousand.
    const crossing: TrackSegments = [[-17.6, 179.99, -17.61, -179.99]];
    const projection = projectSegments(crossing, HERO_PLATE);
    expect(projection.degenerate).toBe(false);
    // ~2.2 km across a 340-unit plate: a metre is a substantial fraction of a unit.
    expect(projection.unitsPerMetre).toBeGreaterThan(0.05);
  });

  it('has nothing to say about an empty track', () => {
    expect(projectSegments([], HERO_PLATE)).toEqual({
      segments: [],
      unitsPerMetre: 0,
      degenerate: true,
    });
  });

  it('centres a flight that never moved instead of dividing by zero', () => {
    const still: TrackSegments = [[46.5, 11.5, 46.5, 11.5]];
    const projection = projectSegments(still, HERO_PLATE);
    expect(projection.degenerate).toBe(true);
    expect(projection.segments[0]![0]).toEqual({
      x: HERO_PLATE.width / 2,
      y: HERO_PLATE.height / 2,
    });
  });
});

describe('toPathData', () => {
  it('restarts once per segment', () => {
    const { segments } = projectSegments([[46.5, 11.5, 46.51, 11.52], [46.6, 11.6, 46.61, 11.62]], HERO_PLATE);
    expect(toPathData(segments).match(/M/g)).toHaveLength(2);
  });

  it('emits nothing SVG cannot read', () => {
    // Exponent notation is valid JavaScript and invalid path data, and a NaN silently voids
    // the whole path rather than one command.
    const path = toPathData(projectSegments(TRACK, HERO_PLATE).segments);
    expect(path).not.toContain('NaN');
    expect(path).not.toMatch(/e[+-]/i);
  });
});

describe('graticulePath', () => {
  it('picks a spacing a pilot would recognise', () => {
    // The grid is a scale, not texture: if a square means two kilometres the caption can say
    // so, and the plate makes a claim instead of an apology.
    for (const metres of [800, 3_000, 12_000, 60_000, 250_000]) {
      const unitsPerMetre = HERO_PLATE.height / metres;
      const { spacingMetres } = graticulePath(HERO_PLATE, unitsPerMetre);
      expect([10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000]).toContain(
        spacingMetres,
      );
      // Enough squares to read a scale off, few enough to still be a grid.
      const divisions = (HERO_PLATE.width / unitsPerMetre) / spacingMetres!;
      expect(divisions).toBeGreaterThanOrEqual(3);
      expect(divisions).toBeLessThanOrEqual(10);
    }
  });

  it('claims no scale when no square would be visible', () => {
    // A flight that never left the launch spans metres, and the coarsest grid the ladder
    // offers still would not divide the plate once. Drawing an even grid is fine; captioning
    // it "10 M" would be a measurement the picture does not support.
    const { d, spacingMetres } = graticulePath(HERO_PLATE, HERO_PLATE.height / 8);
    expect(spacingMetres).toBeNull();
    expect(d.length).toBeGreaterThan(0);
  });

  it('still draws a grid when there is no track to measure', () => {
    const { d, spacingMetres } = graticulePath(HERO_PLATE, 0);
    expect(spacingMetres).toBeNull();
    expect(d.length).toBeGreaterThan(0);
  });
});

describe('buildTrackPlate', () => {
  it('draws the track, its markers and a scale caption', () => {
    const plate = hero(TRACK);
    expect(plate.kind).toBe('track');
    if (plate.kind !== 'track') return;
    expect(plate.path).toContain('M');
    expect(plate.markers.map((marker) => marker.kind)).toEqual(['takeoff', 'landing']);
    expect(plate.caption).toMatch(/^CHART PLATE · \d+ (KM|M) GRID$/);
    expect(plate.segmentCount).toBe(1);
  });

  it('says so when the path is broken', () => {
    const plate = hero([[46.5, 11.5, 46.51, 11.52], [46.6, 11.6, 46.61, 11.62]]);
    expect(plate.kind).toBe('track');
    if (plate.kind !== 'track') return;
    expect(plate.segmentCount).toBe(2);
    expect(plate.caption).toContain('GAP IN TRACK');
  });

  it('places labels as percentages, clear of the edges', () => {
    // Percentages rather than units because the overlay is real RN text over the SVG, which
    // is what keeps the pilot's own fonts and the screen reader.
    const plate = buildTrackPlate({
      segments: TRACK,
      variant: 'hero',
      state: 'ready',
      takeoffLabel: 'TAKEOFF 13:42',
      landingLabel: 'LANDED 16:54',
    });
    if (plate.kind !== 'track') throw new Error('expected a track');
    expect(plate.labels).toHaveLength(2);
    for (const label of plate.labels) {
      expect(label.xPercent).toBeGreaterThanOrEqual(5);
      expect(label.xPercent).toBeLessThanOrEqual(95);
      expect(label.yPercent).toBeGreaterThanOrEqual(5);
      expect(label.yPercent).toBeLessThanOrEqual(95);
    }
  });

  it('shows one marker and no line for a flight that never moved', () => {
    const plate = hero([[46.5, 11.5, 46.5, 11.5]]);
    expect(plate.kind).toBe('point');
    if (plate.kind !== 'point') return;
    expect(plate.markers).toHaveLength(1);
    expect(plate.caption).toBe('ONE FIX ONLY');
  });

  it('draws the grid alone when there is nothing to plot', () => {
    // The grid is the point: it is what makes the plate honest with no track rather than a
    // grey box apologising for itself.
    const cases: [TrackPlateState, string, string][] = [
      ['no_track', 'NO TRACK RECORDED', 'warning'],
      ['processing', 'PLOTTING TRACK…', 'neutral'],
      ['recording', 'RECORDING…', 'neutral'],
    ];
    for (const [state, caption, tone] of cases) {
      const plate = hero([], state);
      expect(plate.kind).toBe('empty');
      if (plate.kind !== 'empty') continue;
      expect(plate.caption).toBe(caption);
      expect(plate.tone).toBe(tone);
      expect(plate.grid.length).toBeGreaterThan(0);
    }
  });

  it('treats a finished flight with no drawable fixes as having no track', () => {
    // Whatever the metrics say, the simplifier is the thing that just looked.
    const plate = hero([], 'ready');
    expect(plate.kind).toBe('empty');
    if (plate.kind !== 'empty') return;
    expect(plate.caption).toBe('NO TRACK RECORDED');
  });
});

describe('buildTrackPlate thumbnails', () => {
  it('renders nothing rather than an empty box', () => {
    // A card with an empty box beside it reads as broken; a card with no box reads as no
    // picture. The chip on that card already says why.
    for (const state of ['no_track', 'processing', 'recording'] as TrackPlateState[]) {
      expect(buildTrackPlate({ segments: [], variant: 'thumbnail', state })).toEqual({ kind: 'none' });
    }
    expect(buildTrackPlate({ segments: [], variant: 'thumbnail', state: 'ready' })).toEqual({
      kind: 'none',
    });
    expect(
      buildTrackPlate({ segments: [[46.5, 11.5]], variant: 'thumbnail', state: 'ready' }),
    ).toEqual({ kind: 'none' });
  });

  it('carries no caption, no labels and a thicker line than the hero', () => {
    const plate = buildTrackPlate({
      segments: TRACK,
      variant: 'thumbnail',
      state: 'ready',
      takeoffLabel: 'TAKEOFF 13:42',
    });
    if (plate.kind !== 'track') throw new Error('expected a track');
    expect(plate.caption).toBeNull();
    expect(plate.labels).toEqual([]);
    // No graticule either: at 64px it is noise the track has to compete with.
    expect(plate.grid).toBeNull();
    expect(plate.view).toBe(THUMBNAIL_PLATE);
    // 2.5 of 64 units against 2.4 of 392: proportionally far thicker, which is what 64px of
    // plate needs to stay legible.
    expect(plate.strokeWidth / plate.view.width).toBeGreaterThan(0.03);
  });
});
