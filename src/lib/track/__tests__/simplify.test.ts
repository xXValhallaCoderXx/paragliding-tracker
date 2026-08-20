import type { UsableFix } from '../fixes';
import {
  douglasPeuckerIndices,
  simplifyTrack,
  trackPointCount,
  TRACK_GAP_MS,
  TRACK_POINT_CEILING,
} from '../simplify';
import { perpendicularDistanceSquared, planeFrame, toPlanePoint } from '../geometry';

const METRES_PER_DEGREE = 111_320;

function fix(latitude: number, longitude: number, seconds: number): UsableFix {
  return { latitude, longitude, sourceTimestamp: seconds * 1_000, sequence: seconds, mocked: false };
}

/** Metres north/east of an origin, as degrees. Keeps the synthetic flights readable. */
function offset(north: number, east: number, origin = { latitude: 46.5, longitude: 11.5 }) {
  const metresPerDegreeEast = METRES_PER_DEGREE * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    latitude: origin.latitude + north / METRES_PER_DEGREE,
    longitude: origin.longitude + east / metresPerDegreeEast,
  };
}

/**
 * Ten thermal turns at 1 Hz, radius 100 m, 20 s per turn, drifting 2 km downwind — the shape
 * that makes a paragliding track recognisable.
 */
function thermallingFlight(turns = 10, secondsPerTurn = 20, radius = 100, drift = 2_000) {
  const fixes: UsableFix[] = [];
  const total = turns * secondsPerTurn;
  for (let second = 0; second <= total; second += 1) {
    const angle = (second / secondsPerTurn) * Math.PI * 2;
    const point = offset(
      Math.sin(angle) * radius + (second / total) * drift,
      Math.cos(angle) * radius,
    );
    fixes.push(fix(point.latitude, point.longitude, second));
  }
  return fixes;
}

/**
 * A cross-country flight: six thermals of six turns each, separated by five-minute glides.
 *
 * The mix is the point. A pure spiral is the one shape uniform sampling is *optimal* for —
 * evenly spaced points on a circle are the best polygon that fits it — so a synthetic made
 * only of circles would flatter decimation and prove nothing. A real flight is mostly
 * straight lines with a few tight turns, and that is where spending vertices evenly is
 * exactly the wrong thing to do.
 */
function crossCountryFlight(cycles = 6) {
  const fixes: UsableFix[] = [];
  let north = 0;
  let east = 0;
  let second = 0;

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let tick = 0; tick < 120; tick += 1) {
      const angle = (tick / 20) * Math.PI * 2;
      const point = offset(north + Math.sin(angle) * 100 + tick * 5, east + Math.cos(angle) * 100);
      fixes.push(fix(point.latitude, point.longitude, second));
      second += 1;
    }
    north += 600;
    for (let tick = 0; tick < 300; tick += 1) {
      const point = offset(north, east + tick * 10);
      fixes.push(fix(point.latitude, point.longitude, second));
      second += 1;
    }
    east += 3_000;
  }
  return fixes;
}

/**
 * How far the drawn line ever strays from where the pilot actually flew, in metres.
 *
 * This is the property Douglas-Peucker guarantees and uniform decimation does not: every
 * dropped fix is within the tolerance of the retained polyline. It is also the only measure
 * that means anything to a pilot looking at the plate.
 */
function maxDeviationMetres(source: readonly UsableFix[], segments: readonly (readonly number[])[]) {
  const frame = planeFrame(source[0]!);
  const drawn: { x: number; y: number }[] = [];
  for (const segment of segments) {
    for (let index = 0; index + 1 < segment.length; index += 2) {
      drawn.push(toPlanePoint({ latitude: segment[index]!, longitude: segment[index + 1]! }, frame));
    }
  }

  let worst = 0;
  for (const entry of source) {
    const point = toPlanePoint(entry, frame);
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < drawn.length; index += 1) {
      nearest = Math.min(nearest, perpendicularDistanceSquared(point, drawn[index - 1]!, drawn[index]!));
    }
    worst = Math.max(worst, nearest);
  }
  return Math.sqrt(worst);
}

describe('simplifyTrack preserves thermals', () => {
  it('stays close to the flown track where uniform decimation cannot', () => {
    // The test that justifies choosing Douglas-Peucker at all. Given the same vertex budget,
    // it spends them where the track curves; decimation spends most of them on glides that
    // needed two, and undersamples every thermal. Measured: ~28 m against ~110 m.
    const flight = crossCountryFlight();
    const simplified = simplifyTrack(flight);
    const kept = trackPointCount(simplified);

    const stride = Math.max(1, Math.round(flight.length / kept));
    const decimated = flight.filter((_, index) => index % stride === 0);
    expect(Math.abs(decimated.length - kept)).toBeLessThan(kept * 0.5);

    const dpError = maxDeviationMetres(flight, simplified);
    const strideError = maxDeviationMetres(flight, [
      decimated.flatMap((entry) => [entry.latitude, entry.longitude]),
    ]);

    expect(dpError).toBeLessThan(strideError / 3);
    // And in absolute terms: never further from the flown track than a thermal is wide.
    expect(dpError).toBeLessThan(50);
  });

  it('is scale relative, so a small flight keeps the detail a large one cannot show', () => {
    // A 200 m circle is 39 viewBox units on a 2 km plate and 2.6 on a 60 km one. The same
    // simplifier must keep it in the first case and drop it in the second, which is what a
    // tolerance measured against the bounding box buys.
    const tight = trackPointCount(simplifyTrack(thermallingFlight(10, 20, 100, 500)));
    const wide = trackPointCount(simplifyTrack(thermallingFlight(10, 20, 100, 60_000)));
    expect(tight).toBeGreaterThan(wide * 2);
  });
});

describe('simplifyTrack budget', () => {
  it('never exceeds the ceiling on a three-hour flight', () => {
    const flight = thermallingFlight(540, 20, 120, 40_000);
    expect(flight.length).toBeGreaterThan(10_000);
    expect(trackPointCount(simplifyTrack(flight))).toBeLessThanOrEqual(TRACK_POINT_CEILING);
  });

  it('stays inside the ceiling when the flight has more turns than the budget can hold', () => {
    // Two hours of ridge soaring: 7 200 fixes inside a 1.5 km box, 360 turns competing for
    // 256 vertices. The tolerance has to widen nine times over just to get back to the
    // bounding box diagonal, which is what a doubling cap set too low would silently fail.
    const flight = thermallingFlight(360, 20, 100, 1_500);
    expect(trackPointCount(simplifyTrack(flight))).toBeLessThanOrEqual(TRACK_POINT_CEILING);
  });

  it('terminates and stays inside the ceiling far past the input bound', () => {
    const flight = thermallingFlight(2_500, 20, 120, 80_000);
    expect(flight.length).toBeGreaterThan(50_000);
    expect(trackPointCount(simplifyTrack(flight))).toBeLessThanOrEqual(TRACK_POINT_CEILING);
  });

  it('does not overflow the stack on a long convex arc', () => {
    // Recursion depth in Douglas-Peucker is bounded by output size, not input size, and a
    // curve with no straight parts is where that bites. Hermes' stack is not generous.
    const fixes: UsableFix[] = [];
    for (let index = 0; index < 50_000; index += 1) {
      const angle = (index / 50_000) * (Math.PI / 2);
      const point = offset(Math.sin(angle) * 20_000, Math.cos(angle) * 20_000);
      fixes.push(fix(point.latitude, point.longitude, index));
    }
    expect(() => simplifyTrack(fixes)).not.toThrow();
  });
});

describe('simplifyTrack fidelity', () => {
  it('keeps the exact first and last fix', () => {
    const flight = thermallingFlight();
    const segments = simplifyTrack(flight);
    const firstSegment = segments[0]!;
    const lastSegment = segments[segments.length - 1]!;
    expect(firstSegment[0]).toBeCloseTo(flight[0]!.latitude, 4);
    expect(firstSegment[1]).toBeCloseTo(flight[0]!.longitude, 4);
    expect(lastSegment[lastSegment.length - 2]).toBeCloseTo(flight[flight.length - 1]!.latitude, 4);
    expect(lastSegment[lastSegment.length - 1]).toBeCloseTo(flight[flight.length - 1]!.longitude, 4);
  });

  it('invents no coordinates', () => {
    // Every output vertex must be a fix that was actually recorded. A smoothing filter would
    // draw a track the pilot did not fly, on a plate whose whole premise is that it did.
    const flight = thermallingFlight(4);
    const recorded = new Set(flight.map((entry) => `${entry.latitude.toFixed(5)},${entry.longitude.toFixed(5)}`));
    for (const segment of simplifyTrack(flight)) {
      for (let index = 0; index + 1 < segment.length; index += 2) {
        expect(recorded.has(`${segment[index]!.toFixed(5)},${segment[index + 1]!.toFixed(5)}`)).toBe(true);
      }
    }
  });

  it('reduces a straight line to its two ends', () => {
    const fixes = Array.from({ length: 1_000 }, (_, index) => {
      const point = offset(index * 20, 0);
      return fix(point.latitude, point.longitude, index);
    });
    expect(simplifyTrack(fixes)).toHaveLength(1);
    expect(trackPointCount(simplifyTrack(fixes))).toBe(2);
  });
});

describe('simplifyTrack gaps', () => {
  it('breaks the path where the recorder lost more than a minute', () => {
    const before = Array.from({ length: 60 }, (_, index) => {
      const point = offset(index * 20, 0);
      return fix(point.latitude, point.longitude, index);
    });
    const after = Array.from({ length: 60 }, (_, index) => {
      const point = offset(2_000 + index * 20, 3_000);
      return fix(point.latitude, point.longitude, 60 + TRACK_GAP_MS / 1_000 + 10 + index);
    });
    expect(simplifyTrack([...before, ...after])).toHaveLength(2);
  });

  it('joins across a gap short enough that the invented line is sub-pixel', () => {
    const before = Array.from({ length: 60 }, (_, index) => {
      const point = offset(index * 20, 0);
      return fix(point.latitude, point.longitude, index);
    });
    const after = Array.from({ length: 60 }, (_, index) => {
      const point = offset(2_000 + index * 20, 0);
      return fix(point.latitude, point.longitude, 90 + index);
    });
    expect(simplifyTrack([...before, ...after])).toHaveLength(1);
  });
});

describe('simplifyTrack degenerate input', () => {
  it('returns nothing for no fixes', () => {
    expect(simplifyTrack([])).toEqual([]);
  });

  it('returns the single point it was given', () => {
    expect(trackPointCount(simplifyTrack([fix(46.5, 11.5, 0)]))).toBe(1);
  });

  it('collapses a phone sitting on a table to one point', () => {
    const still = Array.from({ length: 500 }, (_, index) => fix(46.5, 11.5, index));
    expect(trackPointCount(simplifyTrack(still))).toBe(1);
  });
});

describe('douglasPeuckerIndices', () => {
  it('keeps everything when there is nothing to drop', () => {
    expect(douglasPeuckerIndices([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1)).toEqual([0, 1]);
    expect(douglasPeuckerIndices([], 1)).toEqual([]);
  });

  it('returns indices in order', () => {
    const points = Array.from({ length: 50 }, (_, index) => ({
      x: index,
      y: Math.sin(index / 3) * 10,
    }));
    const indices = douglasPeuckerIndices(points, 1);
    expect(indices).toEqual([...indices].sort((left, right) => left - right));
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(49);
  });
});
