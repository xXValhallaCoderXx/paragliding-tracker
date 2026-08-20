import { straightLineMetres } from '../stats';

describe('straightLineMetres', () => {
  it('measures launch to landing, not distance flown', () => {
    // One degree of latitude is ~111 km.
    expect(straightLineMetres([[46, 11, 46.5, 11, 47, 11]])).toBeCloseTo(111_320, -2);
  });

  it('spans a broken track from its true first to its true last point', () => {
    // The pilot kept flying through the dropout, so the two ends are still the two ends.
    expect(straightLineMetres([[46, 11, 46.2, 11], [46.8, 11, 47, 11]])).toBeCloseTo(111_320, -2);
  });

  it('is zero for a flight that landed where it launched', () => {
    expect(straightLineMetres([[46, 11, 46.5, 11.5, 46, 11]])).toBeCloseTo(0, 5);
  });

  it('has no answer without a track', () => {
    expect(straightLineMetres([])).toBeNull();
    expect(straightLineMetres([[]])).toBeNull();
  });

  it('is zero for a single fix, which is where the pilot was', () => {
    expect(straightLineMetres([[46, 11]])).toBe(0);
  });
});
