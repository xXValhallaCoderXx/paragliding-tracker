import { createHash } from 'node:crypto';

import {
  buildUnsignedIgc,
  formatIgcAltitude,
  formatIgcCoordinate,
  selectExportEligibleFixes,
} from '../igc';
import type { LocationFixRecord } from '../types';

function fix(
  sequence: number,
  sourceTimestamp: number,
  overrides: Partial<LocationFixRecord> = {},
): LocationFixRecord {
  return {
    sessionId: 'flight-abc123',
    sequence,
    callbackId: `callback-${sequence}`,
    batchIndex: 0,
    sourceTimestamp,
    receiptTimestamp: sourceTimestamp + 25,
    latitude: 1.3521,
    longitude: 103.8198,
    gpsAltitude: 123.4,
    verticalAccuracy: 3,
    horizontalAccuracy: 7.2,
    speed: 10,
    heading: 90,
    mocked: false,
    ...overrides,
  };
}

describe('IGC formatting', () => {
  it('converts coordinates, hemispheres, and rounding boundaries', () => {
    expect(formatIgcCoordinate(12.5, 'latitude')).toBe('1230000N');
    expect(formatIgcCoordinate(-0, 'latitude')).toBe('0000000S');
    expect(formatIgcCoordinate(-123.5, 'longitude')).toBe('12330000W');
    expect(formatIgcCoordinate(12.9999999, 'latitude')).toBe('1300000N');
    expect(formatIgcCoordinate(90, 'latitude')).toBe('9000000N');
    expect(() => formatIgcCoordinate(90.1, 'latitude')).toThrow(RangeError);
  });

  it('formats positive and negative altitude into five bytes', () => {
    expect(formatIgcAltitude(123.6)).toBe('00124');
    expect(formatIgcAltitude(-5.2)).toBe('-0005');
    expect(() => formatIgcAltitude(-10_000)).toThrow(RangeError);
  });

  it('orders source timestamps and emits one B record per eligible UTC second', () => {
    const fixes = [
      fix(3, Date.UTC(2026, 0, 2, 0, 0, 0, 400)),
      fix(1, Date.UTC(2026, 0, 1, 23, 59, 59, 800)),
      fix(2, Date.UTC(2026, 0, 2, 0, 0, 0, 100)),
      fix(4, Date.UTC(2026, 0, 2, 0, 0, 1), { gpsAltitude: null }),
      fix(5, Date.UTC(2026, 0, 2, 0, 0, 2), { mocked: true }),
    ];
    const eligible = selectExportEligibleFixes(fixes);
    expect(eligible.map((item) => item.sequence)).toEqual([1, 2]);

    const result = buildUnsignedIgc({ id: 'flight-abc123' }, fixes);
    const bRecords = result.content.split('\r\n').filter((line) => line.startsWith('B'));
    expect(bRecords).toHaveLength(2);
    expect(bRecords[0]).toContain('235959');
    expect(bRecords[1]).toContain('000000');
    expect(bRecords.every((line) => line.slice(25, 30) === '00000')).toBe(true);
    expect(result.content).not.toContain('\r\nG');
  });

  it('is byte deterministic with a pinned SHA-256', () => {
    const fixes = [
      fix(1, Date.UTC(2026, 0, 15, 4, 5, 6), { gpsAltitude: -5.2 }),
      fix(2, Date.UTC(2026, 0, 15, 4, 5, 7), {
        latitude: -33.865,
        longitude: 151.2094,
        gpsAltitude: 101.6,
        horizontalAccuracy: null,
      }),
    ];
    const first = buildUnsignedIgc({ id: 'flight-abc123' }, fixes).content;
    const second = buildUnsignedIgc({ id: 'flight-abc123' }, [...fixes].reverse()).content;
    expect(second).toBe(first);
    expect(createHash('sha256').update(first, 'utf8').digest('hex')).toBe(
      'e93b7140c91549b186f2296505ecf00df3ef9a3f5bf8d8ecd1369b5a43dcc7de',
    );
  });
});
