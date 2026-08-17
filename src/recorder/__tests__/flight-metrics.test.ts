import { calculateFlightMetrics } from '../flight-metrics';
import type { LocationFixRecord, RecorderEventRecord, SessionRecord } from '../types';

const STARTED_AT = Date.UTC(2026, 7, 16, 23, 59, 30);
const at = (offsetMs: number) => STARTED_AT + offsetMs;

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const startedAt = STARTED_AT;
  const endedAt = Date.UTC(2026, 7, 17, 0, 1, 0);
  return {
    id: 'session-1',
    status: 'completed',
    completionReason: 'stopped',
    startedAt,
    endedAt,
    updatedAt: endedAt,
    lastFixAt: endedAt - 1_000,
    lastLocationCallbackAt: null,
    manualStopAt: null,
    lastPressureAt: null,
    locationSequence: 0,
    pressureSequence: 0,
    platform: 'android',
    deviceMetadata: {},
    appMetadata: {},
    startPower: {
      batteryLevel: null,
      batteryState: null,
      lowPowerMode: null,
      batteryOptimizationEnabled: null,
      recordedAt: startedAt,
    },
    endPower: null,
    ...overrides,
  };
}

function fix(
  sequence: number,
  sourceTimestamp: number = at(sequence * 1_000),
  overrides: Partial<LocationFixRecord> = {},
): LocationFixRecord {
  return {
    sessionId: 'session-1',
    sequence,
    callbackId: `callback-${sequence}`,
    batchIndex: 0,
    sourceTimestamp,
    receiptTimestamp: sourceTimestamp + 25,
    latitude: 0,
    longitude: sequence - 1,
    gpsAltitude: 100 + sequence,
    verticalAccuracy: null,
    horizontalAccuracy: 5,
    speed: sequence,
    heading: null,
    mocked: false,
    ...overrides,
  };
}

function event(
  id: number,
  type: string,
  payload: Record<string, unknown> = {},
): RecorderEventRecord {
  return {
    id,
    sessionId: 'session-1',
    type,
    occurredAt: id * 1_000,
    payload,
  };
}

describe('flight metrics', () => {
  it('orders valid fixes, calculates deterministic track metrics, and crosses midnight', () => {
    const fixes = [
      fix(3, at(3_000), { longitude: 2, gpsAltitude: null, speed: -1 }),
      fix(1, at(0), { longitude: 0, gpsAltitude: 90, speed: null }),
      fix(2, at(1_000), { longitude: 1, gpsAltitude: 130, speed: 12 }),
    ];

    const first = calculateFlightMetrics(session(), fixes, []);
    const second = calculateFlightMetrics(session(), [...fixes].reverse(), []);

    expect(second).toEqual(first);
    expect(first).toEqual({
      algorithmVersion: 1,
      durationMs: 90_000,
      trackDistanceMetres: expect.any(Number),
      minGpsAltitude: 90,
      maxGpsAltitude: 130,
      maxGroundSpeed: 12,
      fixCount: 3,
      medianSourceGapMs: 1_000,
      p95SourceGapMs: 2_000,
      maxSourceGapMs: 2_000,
      quality: 'healthy',
    });
    expect(first.trackDistanceMetres).toBeCloseTo(222_389.853, 3);
  });

  it('orders fixes with equal timestamps by sequence', () => {
    const metrics = calculateFlightMetrics(
      session(),
      [
        fix(3, at(1_000), { longitude: 2 }),
        fix(1, at(1_000), { longitude: 0 }),
        fix(2, at(1_000), { longitude: 1 }),
      ],
      [],
    );

    expect(metrics.trackDistanceMetres).toBeCloseTo(222_389.853, 3);
    expect(metrics.medianSourceGapMs).toBe(0);
    expect(metrics.p95SourceGapMs).toBe(0);
  });

  it('excludes mocked, invalid, non-finite, and cross-session fixes', () => {
    const metrics = calculateFlightMetrics(
      session(),
      [
        fix(1, undefined, { longitude: 0, gpsAltitude: Number.NaN, speed: -3 }),
        fix(2, undefined, { longitude: 1, gpsAltitude: null, speed: Number.NaN }),
        fix(3, undefined, { longitude: 2, gpsAltitude: 110, speed: 9 }),
        fix(4, undefined, { mocked: true, gpsAltitude: 999, speed: 999 }),
        fix(5, undefined, { latitude: 91, gpsAltitude: 998, speed: 998 }),
        fix(6, undefined, { longitude: Number.POSITIVE_INFINITY }),
        fix(7, Number.NaN),
        fix(8, undefined, { sessionId: 'session-2' }),
      ],
      [],
    );

    expect(metrics).toMatchObject({
      minGpsAltitude: 110,
      maxGpsAltitude: 110,
      maxGroundSpeed: 9,
      fixCount: 3,
      medianSourceGapMs: 1_000,
      p95SourceGapMs: 1_000,
      maxSourceGapMs: 1_000,
      quality: 'healthy',
    });
    expect(metrics.trackDistanceMetres).toBeCloseTo(222_389.853, 3);
  });

  it('excludes fixes outside the manual recording window', () => {
    const metrics = calculateFlightMetrics(
      session({ endedAt: at(5_000) }),
      [
        fix(1, at(-1), { longitude: -1 }),
        fix(2, at(0), { longitude: 0 }),
        fix(3, at(5_000), { longitude: 1 }),
        fix(4, at(5_001), { longitude: 2 }),
      ],
      [],
    );

    expect(metrics.fixCount).toBe(2);
    expect(metrics.trackDistanceMetres).toBeCloseTo(111_194.927, 3);
  });

  it('returns no_track when there are no usable coordinates', () => {
    const metrics = calculateFlightMetrics(
      session(),
      [fix(1, undefined, { mocked: true }), fix(2, undefined, { latitude: Number.NaN })],
      [event(1, 'location_task_error')],
    );

    expect(metrics).toMatchObject({
      trackDistanceMetres: 0,
      minGpsAltitude: null,
      maxGpsAltitude: null,
      maxGroundSpeed: null,
      fixCount: 0,
      medianSourceGapMs: null,
      p95SourceGapMs: null,
      maxSourceGapMs: null,
      quality: 'no_track',
    });
  });

  it.each([
    session({ status: 'interrupted', completionReason: null }),
    session({ status: 'completed', completionReason: 'interrupted_finalized' }),
  ])('classifies interrupted recording data as partial', (interruptedSession) => {
    const metrics = calculateFlightMetrics(interruptedSession, [fix(1, at(0))], [
      event(1, 'location_task_error'),
    ]);

    expect(metrics.quality).toBe('partial');
  });

  it.each(['location_task_error', 'task_error'])(
    'classifies a %s event as gaps',
    (eventType) => {
      const metrics = calculateFlightMetrics(
        session(),
        [fix(1, at(0)), fix(2, at(1_000))],
        [event(1, eventType)],
      );

      expect(metrics.quality).toBe('gaps');
    },
  );

  it('classifies callback accounting imbalance as gaps', () => {
    const balanced = event(1, 'location_callback', {
      reported: 3,
      inserted: 1,
      duplicates: 1,
      invalid: 1,
    });
    const imbalanced = event(2, 'location_callback_duplicate', {
      reported: 2,
      duplicates: 1,
    });

    expect(
      calculateFlightMetrics(session(), [fix(1, at(0)), fix(2, at(1_000))], [balanced])
        .quality,
    ).toBe('healthy');
    expect(
      calculateFlightMetrics(session(), [fix(1, at(0)), fix(2, at(1_000))], [
        balanced,
        imbalanced,
      ]).quality,
    ).toBe('gaps');
  });

  it('classifies a p95 source gap over five seconds as gaps', () => {
    const metrics = calculateFlightMetrics(
      session(),
      [fix(1, at(0)), fix(2, at(1_000)), fix(3, at(7_000))],
      [],
    );

    expect(metrics.p95SourceGapMs).toBe(6_000);
    expect(metrics.quality).toBe('gaps');
  });

  it('classifies an isolated source gap over fifteen seconds as gaps', () => {
    const timestamps = Array.from({ length: 22 }, (_, index) =>
      index < 21 ? index * 1_000 : 36_000,
    );
    const metrics = calculateFlightMetrics(
      session(),
      timestamps.map((timestamp, index) => fix(index + 1, at(timestamp))),
      [],
    );

    expect(metrics.p95SourceGapMs).toBe(1_000);
    expect(metrics.maxSourceGapMs).toBe(16_000);
    expect(metrics.quality).toBe('gaps');
  });
});
