import type { RecorderSnapshot } from '../types';
import { deriveRecorderNotices } from '../ui-state';

function snapshot(overrides: Partial<RecorderSnapshot> = {}): RecorderSnapshot {
  return {
    capturedAt: 0,
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
    batteryLevel: null,
    lowPowerMode: null,
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

describe('diagnostic UI states', () => {
  it.each([
    [
      { capabilities: { ...snapshot().capabilities, foregroundPermission: 'denied' as const } },
      'Precise foreground location permission was denied.',
    ],
    [
      { capabilities: { ...snapshot().capabilities, locationServicesEnabled: false } },
      'Device location services are disabled.',
    ],
    [
      { capabilities: { ...snapshot().capabilities, pressureAvailable: false } },
      'No barometer is available.',
    ],
    [
      { capabilities: { ...snapshot().capabilities, sharingAvailable: false } },
      'native share sheet is unavailable',
    ],
  ])('renders the expected capability notice', (overrides, message) => {
    expect(deriveRecorderNotices(snapshot(overrides as Partial<RecorderSnapshot>))).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(message) })]),
    );
  });

  it('surfaces a location task error', () => {
    const notices = deriveRecorderNotices(
      snapshot({
        lastError: {
          code: 'task_error',
          message: 'Native location task failed.',
          occurredAt: 1,
        },
      }),
    );
    expect(notices).toContainEqual({ tone: 'error', message: 'Native location task failed.' });
  });
});
