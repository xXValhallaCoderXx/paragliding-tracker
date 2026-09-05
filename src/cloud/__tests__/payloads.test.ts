import { flight, metrics, profile } from '../../../tests/support/fixtures';
import type { FlightSyncCandidate } from '@/recorder/types';
import { flightRow, profileRow } from '../payloads';

const candidate = (overrides: Partial<FlightSyncCandidate> = {}): FlightSyncCandidate => ({
  ...flight({ id: 'flight', recordingSessionId: 'session', startedAt: 1000, endedAt: 5000,
    title: 'Ridge', site: 'Launch', notes: 'Pilot note', takeoffLatitude: 46, takeoffLongitude: 8, siteSource: 'osm' }),
  metrics: metrics({ algorithmVersion: 3, durationMs: 4000, computedAt: 6000 }),
  pushedUpdatedAt: 2000, igcSha256: 'local-digest', igcObjectPath: 'local/file', attemptCount: 2, nextAttemptAt: 9000,
  ...overrides,
});
it('maps populated flight facts exactly and excludes local coordinates, provenance, evidence and sync bookkeeping', () => {
  const input = { ...candidate(), segments: [[46, 8]], locations: [{ latitude: 46 }], pressureSamples: [1000], events: ['private'], deviceMetadata: { deviceName: 'Personal phone' } };
  expect(flightRow(input, 'pilot', 'android')).toEqual({
    id: 'flight', user_id: 'pilot', recording_session_id: 'session', status: 'completed',
    started_at: 1000, ended_at: 5000, timezone_offset_minutes: -420, title: 'Ridge', site: 'Launch', notes: 'Pilot note',
    client_created_at: 1000, client_updated_at: 2000, device_platform: 'android', recorder_schema_version: 7,
    metrics_algorithm_version: 3, duration_ms: 4000, track_distance_metres: 52_400,
    min_gps_altitude: 400, max_gps_altitude: 2410, max_ground_speed: 14, fix_count: 11_486,
    median_source_gap_ms: 1000, p95_source_gap_ms: 1000, max_source_gap_ms: 1000, quality: 'healthy', metrics_computed_at: 6000,
  });
});
it('preserves nullable fields and missing metrics without inventing zeros', () => {
  expect(flightRow(candidate({ title: null, site: null, notes: null, endedAt: null, timezoneOffsetMinutes: null, metrics: null }), 'pilot', 'ios')).toEqual({
    id: 'flight', user_id: 'pilot', recording_session_id: 'session', status: 'completed',
    started_at: 1000, ended_at: null, timezone_offset_minutes: null, title: null, site: null, notes: null,
    client_created_at: 1000, client_updated_at: 2000, device_platform: 'ios', recorder_schema_version: 7,
    metrics_algorithm_version: null, duration_ms: null, track_distance_metres: null, min_gps_altitude: null,
    max_gps_altitude: null, max_ground_speed: null, fix_count: null, median_source_gap_ms: null,
    p95_source_gap_ms: null, max_source_gap_ms: null, quality: null, metrics_computed_at: null,
  });
});
it('maps all profile fields including registration, omitting server clocks and the local watermark', () => {
  expect(profileRow(profile({ pilotName: 'Renate', gliderType: 'Rush 6', gliderId: 'D-123', registrationId: 'APPI-123', updatedAt: 5000, pushedUpdatedAt: 1000 }), 'pilot')).toEqual({
    id: 'pilot', pilot_name: 'Renate', glider_type: 'Rush 6', glider_id: 'D-123', registration_id: 'APPI-123', client_updated_at: 5000,
  });
  expect(profileRow(profile(), 'pilot')).toEqual({
    id: 'pilot', pilot_name: null, glider_type: null, glider_id: null, registration_id: null, client_updated_at: 0,
  });
});
