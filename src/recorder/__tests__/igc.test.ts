import { createHash } from 'node:crypto';

import {
  buildUnsignedIgc,
  formatIgcAltitude,
  formatIgcCoordinate,
  sanitizeIgcHeaderValue,
  selectExportEligibleFixes,
} from '../igc';
import type { LocationFixRecord } from '../types';

const allTimeSession = {
  id: 'flight-abc123',
  startedAt: 0,
  endedAt: Number.MAX_SAFE_INTEGER,
};

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

    const result = buildUnsignedIgc(allTimeSession, fixes);
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
    const first = buildUnsignedIgc(allTimeSession, fixes).content;
    const second = buildUnsignedIgc(allTimeSession, [...fixes].reverse()).content;
    expect(second).toBe(first);
    expect(createHash('sha256').update(first, 'utf8').digest('hex')).toBe(
      '7788bb481e2326d325526722b530f0307afb9e54362b4f2c883f30ba7fb3a129',
    );
  });

  it('exports only fixes inside the manual recording window', () => {
    const startedAt = Date.UTC(2026, 0, 15, 4, 5, 6);
    const fixes = [
      fix(1, startedAt - 1_000),
      fix(2, startedAt),
      fix(3, startedAt + 1_000),
      fix(4, startedAt + 1_001),
    ];

    const result = buildUnsignedIgc(
      { id: 'flight-abc123', startedAt, endedAt: startedAt + 1_000 },
      fixes,
    );
    expect(result.eligibleFixes.map((item) => item.sequence)).toEqual([2, 3]);
  });
});

describe('pilot header records', () => {
  const session = { id: 'session-header', startedAt: 1_700_000_000_000, endedAt: null };
  const fixes = [
    fix(1, 1_700_000_001_000, { sessionId: 'session-header' }),
  ];

  function headers(pilot?: Parameters<typeof buildUnsignedIgc>[2]): string[] {
    // IGC records are CRLF-terminated.
    return buildUnsignedIgc(session, fixes, pilot)
      .content.split('\r\n')
      .filter((line) => line.startsWith('HFPLT') || line.startsWith('HFGTY') || line.startsWith('HFGID'));
  }

  it('keeps the historical placeholders when no profile has been filled in', () => {
    const placeholders = [
      'HFPLTPILOTINCHARGE:UNSPECIFIED',
      'HFGTYGLIDERTYPE:PARAGLIDER',
      'HFGIDGLIDERID:UNSPECIFIED',
    ];
    expect(headers()).toEqual(placeholders);
    expect(headers({})).toEqual(placeholders);
    expect(headers({ pilotName: null, gliderType: '   ' })).toEqual(placeholders);
  });

  it('writes the profile into the pilot, glider type and glider id records', () => {
    expect(headers({ pilotName: 'Renate Gouveia', gliderType: 'Ozone Rush 6', gliderId: 'D-1234' })).toEqual([
      'HFPLTPILOTINCHARGE:RENATE GOUVEIA',
      'HFGTYGLIDERTYPE:OZONE RUSH 6',
      'HFGIDGLIDERID:D-1234',
    ]);
  });

  it('is deterministic: the same profile produces byte-identical output', () => {
    const pilot = { pilotName: 'Renate', gliderType: 'Rush 6', gliderId: 'D-1' };
    expect(buildUnsignedIgc(session, fixes, pilot).content).toBe(
      buildUnsignedIgc(session, fixes, pilot).content,
    );
  });
});

describe('sanitizeIgcHeaderValue', () => {
  it('strips the characters that would break the single-line record structure', () => {
    // A colon would look like a second record separator, and a newline would split
    // the header into two malformed records.
    expect(sanitizeIgcHeaderValue('Renate: the\npilot')).toBe('RENATE THE PILOT');
    expect(sanitizeIgcHeaderValue('a\r\nb')).toBe('A B');
  });

  it('folds accents rather than dropping the letters they sit on', () => {
    expect(sanitizeIgcHeaderValue('Renaté Gouveia')).toBe('RENATE GOUVEIA');
    expect(sanitizeIgcHeaderValue('Jörg Müller')).toBe('JORG MULLER');
    // Letters that are not decomposable accents (Æ, ø) have no ASCII fold, so they
    // become separators rather than silently turning into a different letter.
    expect(sanitizeIgcHeaderValue('Ærø')).toBe('R');
  });

  it('keeps the punctuation a glider registration actually uses', () => {
    expect(sanitizeIgcHeaderValue("Ozone Rush 6 / D-1234, v2.1 'red'")).toBe(
      "OZONE RUSH 6 / D-1234, V2.1 'RED'",
    );
  });

  it('collapses to null when nothing usable survives', () => {
    expect(sanitizeIgcHeaderValue(null)).toBeNull();
    expect(sanitizeIgcHeaderValue(undefined)).toBeNull();
    expect(sanitizeIgcHeaderValue('   ')).toBeNull();
    expect(sanitizeIgcHeaderValue('!!!')).toBeNull();
  });

  it('truncates to a length IGC parsers tolerate', () => {
    expect(sanitizeIgcHeaderValue('X'.repeat(200))).toHaveLength(60);
  });
});
