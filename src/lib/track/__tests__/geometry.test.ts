import {
  boundsOf,
  diagonalOf,
  METRES_PER_DEGREE,
  perpendicularDistanceSquared,
  planeFrame,
  toPlanePoint,
  unwrapLongitude,
} from '../geometry';

describe('toPlanePoint', () => {
  const frame = planeFrame({ latitude: 46.5, longitude: 11.5 });

  it('puts the anchor at the origin', () => {
    expect(toPlanePoint({ latitude: 46.5, longitude: 11.5 }, frame)).toEqual({ x: 0, y: -0 });
  });

  it('measures a degree of latitude in metres', () => {
    const point = toPlanePoint({ latitude: 47.5, longitude: 11.5 }, frame);
    expect(Math.abs(point.y)).toBeCloseTo(METRES_PER_DEGREE, 0);
  });

  it('shrinks a degree of longitude by the cosine of the latitude', () => {
    // The correction the whole plane exists for. At 60 degrees north a degree of longitude
    // is half a degree of latitude, and a tolerance applied in degree space would be twice
    // as loose east-west as north-south.
    const northern = planeFrame({ latitude: 60, longitude: 0 });
    const point = toPlanePoint({ latitude: 60, longitude: 1 }, northern);
    expect(point.x).toBeCloseTo(METRES_PER_DEGREE / 2, -1);
  });

  it('grows y downward, because SVG does and north does not', () => {
    // Without the negation the plate is a perfect vertical mirror of the flight, which is
    // plausible enough to ship unnoticed.
    expect(toPlanePoint({ latitude: 46.6, longitude: 11.5 }, frame).y).toBeLessThan(0);
    expect(toPlanePoint({ latitude: 46.4, longitude: 11.5 }, frame).y).toBeGreaterThan(0);
  });

  it('keeps signs straight in the southern hemisphere', () => {
    const southern = planeFrame({ latitude: -5.2, longitude: 105.7 });
    const point = toPlanePoint({ latitude: -5.1, longitude: 105.8 }, southern);
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(0);
  });
});

describe('unwrapLongitude', () => {
  it('makes an antimeridian crossing a short hop', () => {
    // Without this a Fiji flight spans 360 degrees, the aspect fit zooms out to the whole
    // planet, and the plate draws a horizontal hairline.
    expect(unwrapLongitude(-179.99, 179.99)).toBeCloseTo(180.01, 5);
    expect(unwrapLongitude(179.99, -179.99)).toBeCloseTo(-180.01, 5);
  });

  it('leaves an ordinary longitude alone', () => {
    expect(unwrapLongitude(11.6, 11.5)).toBe(11.6);
    expect(unwrapLongitude(-73.2, -73.5)).toBe(-73.2);
  });
});

describe('boundsOf', () => {
  it('has no answer for nothing', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[]])).toBeNull();
  });

  it('spans every segment together', () => {
    expect(
      boundsOf([
        [{ x: 0, y: 0 }, { x: 10, y: 5 }],
        [{ x: -4, y: 20 }],
      ]),
    ).toEqual({ minX: -4, maxX: 10, minY: 0, maxY: 20 });
  });

  it('measures the diagonal', () => {
    expect(diagonalOf({ minX: 0, maxX: 3, minY: 0, maxY: 4 })).toBe(5);
  });
});

describe('perpendicularDistanceSquared', () => {
  it('measures across the line', () => {
    expect(perpendicularDistanceSquared({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
  });

  it('answers for a zero-length segment instead of returning NaN', () => {
    // Dividing by the length would return NaN, which compares false against every tolerance
    // and so would silently keep every vertex in the track.
    expect(perpendicularDistanceSquared({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(25);
  });

  it('clamps past the ends, so a track doubling back is measured honestly', () => {
    // A thermal exit passes back beyond its entry. Measured against the infinite line that
    // deviation reads as zero, and the vertex that captures the turn gets dropped.
    expect(perpendicularDistanceSquared({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(100);
    expect(perpendicularDistanceSquared({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(25);
  });
});
