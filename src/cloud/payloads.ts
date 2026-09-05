import type { FlightSyncCandidate, PilotProfile } from '@/recorder/types';
import { RECORDER_CONFIG } from '@/recorder/config';
import type { TablesInsert } from './database.types';

export function flightRow(flight: FlightSyncCandidate, userId: string, platform: string) {
  return {
    id: flight.id,
    user_id: userId,
    recording_session_id: flight.recordingSessionId,
    status: flight.status,
    started_at: flight.startedAt,
    ended_at: flight.endedAt,
    timezone_offset_minutes: flight.timezoneOffsetMinutes,
    title: flight.title,
    site: flight.site,
    notes: flight.notes,
    client_created_at: flight.createdAt,
    client_updated_at: flight.updatedAt,
    device_platform: platform,
    recorder_schema_version: RECORDER_CONFIG.schemaVersion,
    metrics_algorithm_version: flight.metrics?.algorithmVersion ?? null,
    duration_ms: flight.metrics?.durationMs ?? null,
    track_distance_metres: flight.metrics?.trackDistanceMetres ?? null,
    min_gps_altitude: flight.metrics?.minGpsAltitude ?? null,
    max_gps_altitude: flight.metrics?.maxGpsAltitude ?? null,
    max_ground_speed: flight.metrics?.maxGroundSpeed ?? null,
    fix_count: flight.metrics?.fixCount ?? null,
    median_source_gap_ms: flight.metrics?.medianSourceGapMs ?? null,
    p95_source_gap_ms: flight.metrics?.p95SourceGapMs ?? null,
    max_source_gap_ms: flight.metrics?.maxSourceGapMs ?? null,
    quality: flight.metrics?.quality ?? null,
    metrics_computed_at: flight.metrics?.computedAt ?? null,
  } satisfies TablesInsert<'flights'>;
}

export function profileRow(profile: PilotProfile, userId: string) {
  return {
    id: userId,
    pilot_name: profile.pilotName,
    glider_type: profile.gliderType,
    glider_id: profile.gliderId,
    registration_id: profile.registrationId,
    client_updated_at: profile.updatedAt,
  } satisfies TablesInsert<'profiles'>;
}
