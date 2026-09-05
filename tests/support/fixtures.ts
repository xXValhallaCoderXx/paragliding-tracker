import type { FlightMetricsRecord, FlightSummary, PilotProfile } from '@/recorder/types';

export function metrics(overrides: Partial<FlightMetricsRecord> = {}): FlightMetricsRecord {
  return {
    flightId: 'f1', algorithmVersion: 1, durationMs: 3_600_000, trackDistanceMetres: 52_400,
    minGpsAltitude: 400, maxGpsAltitude: 2410, maxGroundSpeed: 14, fixCount: 11_486,
    medianSourceGapMs: 1000, p95SourceGapMs: 1000, maxSourceGapMs: 1000,
    quality: 'healthy', computedAt: 0, ...overrides,
  };
}
export function flight(overrides: Partial<FlightSummary> = {}): FlightSummary {
  return {
    id: 'f1', recordingSessionId: 's1', status: 'completed', sessionStatus: 'completed',
    startedAt: Date.UTC(2026, 7, 16, 6, 42), endedAt: Date.UTC(2026, 7, 16, 9, 54),
    timezoneOffsetMinutes: -420, title: null, site: null, siteSource: null, notes: null,
    takeoffLatitude: null, takeoffLongitude: null, createdAt: 1000, updatedAt: 2000,
    metrics: metrics(), ...overrides,
  };
}
export function profile(overrides: Partial<PilotProfile> = {}): PilotProfile {
  return { pilotName: null, gliderType: null, gliderId: null, registrationId: null, updatedAt: 0, pushedUpdatedAt: null, ...overrides };
}
