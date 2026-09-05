import { isUsableCoordinateFix, orderedUsableFixes } from '../fixes';
import type { UsableFix } from '../fixes';

function fix(overrides: Partial<UsableFix> = {}): UsableFix {
  return {
    latitude: 46.5,
    longitude: 11.5,
    sourceTimestamp: 1_000,
    sequence: 1,
    mocked: false,
    ...overrides,
  };
}

describe('isUsableCoordinateFix', () => {
  it('accepts an ordinary fix', () => {
    expect(isUsableCoordinateFix(fix())).toBe(true);
  });

  it('rejects coordinates that cannot exist', () => {
    expect(isUsableCoordinateFix(fix({ latitude: 91 }))).toBe(false);
    expect(isUsableCoordinateFix(fix({ latitude: -91 }))).toBe(false);
    expect(isUsableCoordinateFix(fix({ longitude: 181 }))).toBe(false);
    expect(isUsableCoordinateFix(fix({ longitude: -181 }))).toBe(false);
    expect(isUsableCoordinateFix(fix({ latitude: Number.NaN }))).toBe(false);
    expect(isUsableCoordinateFix(fix({ longitude: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it('rejects a fix with no usable ordering', () => {
    expect(isUsableCoordinateFix(fix({ sourceTimestamp: Number.NaN }))).toBe(false);
    expect(isUsableCoordinateFix(fix({ sequence: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it('rejects mock locations', () => {
    // A mocked fix is evidence of nothing, and it would drag the plate somewhere the pilot
    // was not.
    expect(isUsableCoordinateFix(fix({ mocked: true }))).toBe(false);
  });
});

describe('orderedUsableFixes', () => {
  it('sorts by source time, then sequence', () => {
    // Batches arrive out of order often enough that drawing them as delivered produces a
    // track that jumps backwards.
    const ordered = orderedUsableFixes(
      [
        fix({ sourceTimestamp: 3_000, sequence: 9 }),
        fix({ sourceTimestamp: 1_000, sequence: 5 }),
        fix({ sourceTimestamp: 1_000, sequence: 2 }),
      ],
      { startedAt: 0, endedAt: null },
    );
    expect(ordered.map((entry) => entry.sequence)).toEqual([2, 5, 9]);
  });

  it('drops fixes outside the session window', () => {
    const ordered = orderedUsableFixes(
      [
        fix({ sourceTimestamp: 500 }),
        fix({ sourceTimestamp: 1_500 }),
        fix({ sourceTimestamp: 9_000 }),
      ],
      { startedAt: 1_000, endedAt: 2_000 },
    );
    expect(ordered.map((entry) => entry.sourceTimestamp)).toEqual([1_500]);
  });

  it('keeps everything after the start while a session is still open', () => {
    const ordered = orderedUsableFixes(
      [fix({ sourceTimestamp: 1_500 }), fix({ sourceTimestamp: 90_000 })],
      { startedAt: 1_000, endedAt: null },
    );
    expect(ordered).toHaveLength(2);
  });

  it('does not mutate what it was given', () => {
    const input = [fix({ sequence: 2 }), fix({ sequence: 1 })];
    orderedUsableFixes(input, { startedAt: 0, endedAt: null });
    expect(input.map((entry) => entry.sequence)).toEqual([2, 1]);
  });
});
