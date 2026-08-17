import type { RecorderSnapshot } from '@/recorder/types';

import {
  inFlightNotices,
  readinessRows,
  readinessSummary,
} from '../recorder-presentation';

function snapshot(overrides: Partial<RecorderSnapshot> = {}): RecorderSnapshot {
  return {
    capturedAt: 100_000,
    state: 'idle',
    flightId: null,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    lastFixAt: null,
    lastFixReceivedAt: null,
    lastLocationCallbackAt: null,
    captureHealth: 'inactive',
    durationMs: 0,
    fixCount: 0,
    pressureCount: 0,
    gpsAltitude: null,
    speed: null,
    horizontalAccuracy: null,
    pressure: null,
    batteryLevel: 0.78,
    lowPowerMode: false,
    batteryOptimizationEnabled: false,
    taskRegistered: false,
    capabilities: {
      platform: 'android',
      supported: true,
      taskManagerAvailable: true,
      locationServicesEnabled: true,
      gpsAvailable: true,
      preciseLocation: true,
      pressureAvailable: true,
      batteryAvailable: true,
      sharingAvailable: true,
      foregroundPermission: 'granted',
      backgroundPermission: 'granted',
    },
    lastError: null,
    ...overrides,
  };
}

describe('readiness', () => {
  it('is all good when everything the recorder needs is in place', () => {
    const rows = readinessRows(snapshot());
    expect(rows.map((row) => [row.key, row.tone])).toEqual([
      ['location', 'good'],
      ['precise', 'good'],
      ['always', 'good'],
      ['barometer', 'good'],
      ['battery', 'good'],
    ]);
    expect(readinessSummary(rows)).toMatchObject({ level: 'ready', label: 'ALL GOOD' });
  });

  it('explains degraded conditions as consequences, not warnings', () => {
    const rows = readinessRows(
      snapshot({
        batteryLevel: 0.17,
        batteryOptimizationEnabled: true,
        capabilities: { ...snapshot().capabilities, pressureAvailable: false },
      }),
    );
    const barometer = rows.find((row) => row.key === 'barometer');
    const battery = rows.find((row) => row.key === 'battery');
    expect(barometer).toMatchObject({ tone: 'warning', value: 'none' });
    expect(barometer?.detail).toMatch(/GPS only/);
    expect(battery).toMatchObject({ tone: 'warning', value: '17% · optimization on' });
    expect(battery?.detail).toMatch(/flat battery/);
    expect(battery?.detail).toMatch(/optimization/);
    expect(battery?.action).toBe('open_battery_settings');
    expect(readinessSummary(rows)).toMatchObject({ level: 'degraded', label: 'TWO THINGS TO KNOW' });
  });

  it('blocks on denied permissions and points to Android settings', () => {
    const rows = readinessRows(
      snapshot({
        capabilities: {
          ...snapshot().capabilities,
          foregroundPermission: 'denied',
          backgroundPermission: 'denied',
        },
      }),
    );
    expect(rows.filter((row) => row.tone === 'danger').map((row) => row.action)).toEqual([
      'open_app_settings',
      'open_app_settings',
    ]);
    expect(readinessSummary(rows)).toMatchObject({
      level: 'blocked',
      label: "CAN'T RECORD YET",
      title: expect.stringContaining('Android'),
    });
  });

  it('blocks when location services are off and offers the location settings', () => {
    const rows = readinessRows(
      snapshot({ capabilities: { ...snapshot().capabilities, locationServicesEnabled: false } }),
    );
    expect(rows[0]).toMatchObject({ key: 'location', tone: 'danger', action: 'open_location_settings' });
    expect(readinessSummary(rows).level).toBe('blocked');
  });

  it('treats unasked permissions as neutral so first-run is not a blocked state', () => {
    const rows = readinessRows(
      snapshot({
        capabilities: {
          ...snapshot().capabilities,
          foregroundPermission: 'unknown',
          backgroundPermission: 'unknown',
        },
      }),
    );
    expect(rows.find((row) => row.key === 'precise')).toMatchObject({ tone: 'neutral', value: 'not asked yet' });
    expect(readinessSummary(rows).level).toBe('ready');
  });

  it('flags Expo Go style environments as blocked', () => {
    const rows = readinessRows(
      snapshot({ capabilities: { ...snapshot().capabilities, taskManagerAvailable: false } }),
    );
    expect(rows[0]).toMatchObject({ key: 'background', tone: 'danger' });
  });
});

describe('inFlightNotices', () => {
  it('never dresses a stale or recovering capture as healthy', () => {
    const stale = inFlightNotices(
      snapshot({ state: 'recording', captureHealth: 'stale', lastFixReceivedAt: 60_000 }),
    );
    expect(stale[0]).toMatchObject({ key: 'stale', tone: 'warning', title: 'No valid GPS fix for 40 s' });
    const recovering = inFlightNotices(snapshot({ state: 'recording', captureHealth: 'recovering' }));
    expect(recovering[0]).toMatchObject({ key: 'recovering', tone: 'warning' });
    const inactive = inFlightNotices(snapshot({ state: 'recording', captureHealth: 'inactive' }));
    expect(inactive[0]).toMatchObject({ key: 'inactive', tone: 'danger' });
  });

  it('adds battery and error facts, leaving optimization and barometer to pre-flight', () => {
    const notices = inFlightNotices(
      snapshot({
        state: 'recording',
        captureHealth: 'healthy',
        batteryLevel: 0.12,
        batteryOptimizationEnabled: true,
        capabilities: { ...snapshot().capabilities, pressureAvailable: false },
        lastError: { code: 'task_error', message: 'Native task failed.', occurredAt: 1 },
      }),
    );
    expect(notices.map((notice) => notice.key)).toEqual(['battery', 'error']);
    expect(notices[0]?.title).toBe('Battery 12%');
    expect(notices[1]?.body).toBe('Native task failed.');
  });

  it('is empty for a healthy recording on a capable phone', () => {
    expect(inFlightNotices(snapshot({ state: 'recording', captureHealth: 'healthy' }))).toEqual([]);
  });
});
