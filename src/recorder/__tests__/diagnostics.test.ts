import { buildDiagnosticJson } from '../diagnostics';
import type { SessionExportData } from '../types';

const data: SessionExportData = {
  session: {
    id: 'session-1',
    status: 'completed',
    completionReason: 'stopped',
    startedAt: 0,
    endedAt: 4000,
    updatedAt: 4000,
    lastFixAt: 3000,
    lastLocationCallbackAt: null,
    manualStopAt: null,
    lastPressureAt: 3000,
    locationSequence: 3,
    pressureSequence: 2,
    platform: 'android',
    deviceMetadata: { model: 'test' },
    appMetadata: { version: '1.0.0' },
    startPower: {
      batteryLevel: 0.95,
      batteryState: 1,
      lowPowerMode: false,
      batteryOptimizationEnabled: true,
      recordedAt: 0,
    },
    endPower: null,
  },
  locations: [1, 2, 3].map((sequence) => ({
    sessionId: 'session-1',
    sequence,
    callbackId: `callback-${sequence}`,
    batchIndex: 0,
    sourceTimestamp: sequence * 1000,
    receiptTimestamp: sequence * 1000 + 20,
    latitude: 1,
    longitude: 2,
    gpsAltitude: 100,
    verticalAccuracy: 4,
    horizontalAccuracy: sequence * 10,
    speed: 5,
    heading: 1,
    mocked: false,
  })),
  pressureSamples: [1, 2].map((sequence) => ({
    sessionId: 'session-1',
    sequence,
    nativeTimestamp: sequence,
    receiptTimestamp: sequence * 1000,
    pressure: 1000,
    relativeAltitude: null,
  })),
  events: [
    {
      id: 1,
      sessionId: 'session-1',
      type: 'location_callback',
      occurredAt: 3020,
      payload: { reported: 4, inserted: 3, duplicates: 1, invalid: 0 },
    },
    {
      id: 2,
      sessionId: 'session-1',
      type: 'location_callback_duplicate',
      occurredAt: 3030,
      payload: { reported: 2, inserted: 0, duplicates: 2, invalid: 0 },
    },
  ],
};

describe('diagnostic export', () => {
  it('calculates cadence and reconciles callback, row, and IGC counts', () => {
    const content = buildDiagnosticJson(data, {
      available: true,
      sha256: 'abc123',
      byteCount: 99,
      bRecordCount: 3,
    });
    const parsed = JSON.parse(content);
    expect(parsed.statistics.locationCadence).toMatchObject({
      sampleCount: 3,
      p95GapMs: 1000,
      maxGapMs: 1000,
      gapsOver15Seconds: 0,
    });
    expect(parsed.statistics.horizontalAccuracy.p95Metres).toBe(30);
    expect(parsed.statistics.callbacks).toEqual({
      reported: 6,
      inserted: 3,
      duplicates: 3,
      invalid: 0,
    });
    expect(parsed.statistics.reconciliation).toMatchObject({
      persistedLocationRows: 3,
      exportEligibleSeconds: 3,
      igcBRecords: 3,
      callbackAccountingBalanced: true,
      igcCountBalanced: true,
    });
    expect(
      buildDiagnosticJson(data, {
        available: true,
        sha256: 'abc123',
        byteCount: 99,
        bRecordCount: 3,
      }),
    ).toBe(content);
  });

  it('excludes a late callback outside the manual stop window from export reconciliation', () => {
    const lateFix = {
      ...data.locations[2]!,
      sequence: 4,
      callbackId: 'callback-late',
      sourceTimestamp: 5000,
      receiptTimestamp: 5020,
    };
    const content = buildDiagnosticJson(
      { ...data, locations: [...data.locations, lateFix] },
      { available: true, sha256: 'abc123', byteCount: 99, bRecordCount: 3 },
    );
    const parsed = JSON.parse(content);

    expect(parsed.statistics.locationCadence.sampleCount).toBe(3);
    expect(parsed.statistics.reconciliation).toMatchObject({
      persistedLocationRows: 4,
      exportEligibleSeconds: 3,
      igcBRecords: 3,
      igcCountBalanced: true,
    });
  });

  it('can preserve diagnostics when no IGC track is available', () => {
    const noTrack = { ...data, locations: [] };
    const content = buildDiagnosticJson(noTrack, {
      available: false,
      sha256: null,
      byteCount: 0,
      bRecordCount: 0,
    });
    const parsed = JSON.parse(content);

    expect(parsed.artifacts.igc).toEqual({
      available: false,
      sha256: null,
      byteCount: 0,
      bRecordCount: 0,
    });
    expect(parsed.statistics.reconciliation).toMatchObject({
      exportEligibleSeconds: 0,
      igcBRecords: 0,
      igcCountBalanced: true,
    });
  });
});
