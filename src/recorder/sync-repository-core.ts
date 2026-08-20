import type { SqlExecutor } from './repository-core';
import type {
  CloudLink,
  FlightDeletionRecord,
  FlightMetricsRecord,
  FlightStatus,
  FlightSyncCandidate,
  PilotProfile,
  AppSettings,
  AppSettingsPatch,
  SessionRecord,
  SiteSource,
  TrackQuality,
} from './types';

/**
 * Platform-free bodies for the cloud-backup bookkeeping added in schema v5.
 *
 * Mirrors `repository-core.ts`: the SQL and the mappers live here so they can be
 * exercised against a fake executor in Node, while `database.native.ts` keeps the
 * connection, the write serializer and the transaction boundaries.
 *
 * Nothing here writes `sessions`, `location_fixes`, `pressure_samples`, `events`,
 * `exports` or `session_recovery_attempts`. Cloud backup is an observer of the
 * recorder's output, never a participant in capture.
 */

// ---------------------------------------------------------------------------
// Pilot profile
// ---------------------------------------------------------------------------

export interface PilotProfileRow {
  pilot_name: string | null;
  glider_type: string | null;
  glider_id: string | null;
  registration_id: string | null;
  updated_at: number;
  pushed_updated_at: number | null;
}

export const PILOT_PROFILE_SQL = 'SELECT * FROM pilot_profile WHERE id = 1';

export function mapPilotProfile(row: PilotProfileRow): PilotProfile {
  return {
    pilotName: row.pilot_name,
    gliderType: row.glider_type,
    gliderId: row.glider_id,
    registrationId: row.registration_id,
    updatedAt: row.updated_at,
    pushedUpdatedAt: row.pushed_updated_at,
  };
}

/** The row the v5 migration seeds, extended by v6; used when a caller reads before any write. */
export const EMPTY_PILOT_PROFILE: PilotProfile = Object.freeze({
  pilotName: null,
  gliderType: null,
  gliderId: null,
  registrationId: null,
  updatedAt: 0,
  pushedUpdatedAt: null,
});

const PILOT_PROFILE_COLUMNS = Object.freeze({
  pilotName: 'pilot_name',
  gliderType: 'glider_type',
  gliderId: 'glider_id',
  registrationId: 'registration_id',
});

/**
 * Single-row device state that is not the pilot's data: it never syncs, never appears in
 * an IGC file, and is deliberately kept out of `pilot_profile` so that pushing a profile
 * can never leak "has this person seen the intro" to the server.
 */
export const APP_SETTINGS_SQL = 'SELECT * FROM app_settings WHERE id = 1';

export interface AppSettingsRow {
  id: number;
  onboarding_state: string;
  onboarding_completed_at: number | null;
  disclaimer_ack_at: number | null;
  updated_at: number;
}

export function mapAppSettings(row: AppSettingsRow): AppSettings {
  return {
    // Anything unrecognised reads as 'pending': showing the intro once too often is a
    // far smaller failure than silently skipping it on a fresh install.
    onboardingState:
      row.onboarding_state === 'done' || row.onboarding_state === 'skipped'
        ? row.onboarding_state
        : 'pending',
    onboardingCompletedAt: row.onboarding_completed_at,
    disclaimerAckAt: row.disclaimer_ack_at,
    updatedAt: row.updated_at,
  };
}

export const EMPTY_APP_SETTINGS: AppSettings = Object.freeze({
  onboardingState: 'pending',
  onboardingCompletedAt: null,
  disclaimerAckAt: null,
  updatedAt: 0,
});

const APP_SETTINGS_COLUMNS = Object.freeze({
  onboardingState: 'onboarding_state',
  onboardingCompletedAt: 'onboarding_completed_at',
  disclaimerAckAt: 'disclaimer_ack_at',
});

export async function updateAppSettingsTransaction(
  transaction: SqlExecutor,
  patch: AppSettingsPatch,
  updatedAt: number,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(APP_SETTINGS_COLUMNS) as [
    keyof typeof APP_SETTINGS_COLUMNS,
    string,
  ][]) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    assignments.push(`${column} = ?`);
    params.push(patch[field] ?? null);
  }
  if (assignments.length === 0) return;
  assignments.push('updated_at = ?');
  params.push(updatedAt);
  await transaction.runAsync(
    `UPDATE app_settings SET ${assignments.join(', ')} WHERE id = 1`,
    ...params,
  );
}

/**
 * Applies a normalized patch and stamps `updated_at`.
 *
 * `pushed_updated_at` is deliberately left alone: it is the push watermark, so an
 * edit simply makes the row dirty again by moving `updated_at` past it.
 */
export async function updatePilotProfileTransaction(
  transaction: SqlExecutor,
  patch: Partial<Record<keyof typeof PILOT_PROFILE_COLUMNS, string | null>>,
  updatedAt: number,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(PILOT_PROFILE_COLUMNS) as [
    keyof typeof PILOT_PROFILE_COLUMNS,
    string,
  ][]) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    assignments.push(`${column} = ?`);
    params.push(patch[field] ?? null);
  }
  assignments.push('updated_at = ?');
  params.push(updatedAt);
  await transaction.runAsync(
    `UPDATE pilot_profile SET ${assignments.join(', ')} WHERE id = 1`,
    ...params,
  );
}

export const MARK_PILOT_PROFILE_PUSHED_SQL =
  'UPDATE pilot_profile SET pushed_updated_at = ? WHERE id = 1';

// ---------------------------------------------------------------------------
// Cloud link
// ---------------------------------------------------------------------------

export interface CloudLinkRow {
  user_id: string | null;
  linked_at: number | null;
  flights_cursor: string | null;
  profile_cursor: string | null;
  last_sync_at: number | null;
  last_sync_error: string | null;
  cloud_only_flight_count: number;
}

export const CLOUD_LINK_SQL = 'SELECT * FROM cloud_link WHERE id = 1';

export function mapCloudLink(row: CloudLinkRow): CloudLink {
  return {
    userId: row.user_id,
    linkedAt: row.linked_at,
    flightsCursor: row.flights_cursor,
    profileCursor: row.profile_cursor,
    lastSyncAt: row.last_sync_at,
    lastSyncError: row.last_sync_error,
    cloudOnlyFlightCount: row.cloud_only_flight_count,
  };
}

export const EMPTY_CLOUD_LINK: CloudLink = Object.freeze({
  userId: null,
  linkedAt: null,
  flightsCursor: null,
  profileCursor: null,
  lastSyncAt: null,
  lastSyncError: null,
  cloudOnlyFlightCount: 0,
});

export const BIND_CLOUD_LINK_SQL = `UPDATE cloud_link
SET user_id = ?, linked_at = ?
WHERE id = 1 AND user_id IS NULL`;

/**
 * Rebinds the device to a different account, or unbinds it entirely.
 *
 * Every `flight_sync_state` row is dropped so the whole local logbook re-claims into
 * the new account on the next push. **No flight, session or evidence row is touched** —
 * changing accounts must never cost the pilot their logbook.
 */
export async function resetCloudLinkTransaction(
  transaction: SqlExecutor,
  userId: string | null,
  resetAt: number,
): Promise<void> {
  await transaction.runAsync('DELETE FROM flight_sync_state');
  await transaction.runAsync(
    `UPDATE cloud_link
     SET user_id = ?,
         linked_at = ?,
         flights_cursor = NULL,
         profile_cursor = NULL,
         last_sync_at = NULL,
         last_sync_error = NULL,
         cloud_only_flight_count = 0
     WHERE id = 1`,
    userId,
    userId === null ? null : resetAt,
  );
  await transaction.runAsync('UPDATE pilot_profile SET pushed_updated_at = NULL WHERE id = 1');
}

// ---------------------------------------------------------------------------
// Dirty flights
// ---------------------------------------------------------------------------

export interface FlightSyncCandidateRow {
  id: string;
  recording_session_id: string;
  status: FlightStatus;
  started_at: number;
  ended_at: number | null;
  timezone_offset_minutes: number | null;
  title: string | null;
  site: string | null;
  notes: string | null;
  takeoff_latitude: number | null;
  takeoff_longitude: number | null;
  site_source: SiteSource | null;
  created_at: number;
  updated_at: number;
  session_status: SessionRecord['status'];
  pushed_updated_at: number | null;
  igc_sha256: string | null;
  igc_object_path: string | null;
  attempt_count: number | null;
  next_attempt_at: number | null;
  algorithm_version: number | null;
  duration_ms: number | null;
  track_distance_metres: number | null;
  min_gps_altitude: number | null;
  max_gps_altitude: number | null;
  max_ground_speed: number | null;
  fix_count: number | null;
  median_source_gap_ms: number | null;
  p95_source_gap_ms: number | null;
  max_source_gap_ms: number | null;
  quality: TrackQuality | null;
  computed_at: number | null;
}

/**
 * A flight is dirty when it has never been pushed, or when it has changed since the
 * last push. Every existing write path already stamps `flights.updated_at`, so no
 * trigger and no outbox row is needed at write time.
 *
 * The two status predicates are the first line of defence against interfering with an
 * active recording: an in-flight session's `updated_at` churns once per second and its
 * metrics are not final, so it is never a candidate. The sync gate refuses to run at
 * all while recording; this predicate makes that independently true.
 */
export const DIRTY_FLIGHTS_SQL = `SELECT
  f.*,
  s.status AS session_status,
  st.pushed_updated_at,
  st.igc_sha256,
  st.igc_object_path,
  st.attempt_count,
  st.next_attempt_at,
  m.algorithm_version,
  m.duration_ms,
  m.track_distance_metres,
  m.min_gps_altitude,
  m.max_gps_altitude,
  m.max_ground_speed,
  m.fix_count,
  m.median_source_gap_ms,
  m.p95_source_gap_ms,
  m.max_source_gap_ms,
  m.quality,
  m.computed_at
FROM flights f
JOIN sessions s ON s.id = f.recording_session_id
LEFT JOIN flight_sync_state st ON st.flight_id = f.id
LEFT JOIN flight_metrics m ON m.flight_id = f.id
WHERE s.status = 'completed'
  AND f.status IN ('completed', 'partial')
  AND (st.pushed_updated_at IS NULL OR st.pushed_updated_at < f.updated_at)
  AND COALESCE(st.next_attempt_at, 0) <= ?
ORDER BY f.started_at ASC, f.id ASC
LIMIT ?`;

function mapCandidateMetrics(row: FlightSyncCandidateRow): FlightMetricsRecord | null {
  if (row.algorithm_version === null || row.computed_at === null) return null;
  return {
    flightId: row.id,
    algorithmVersion: row.algorithm_version,
    durationMs: row.duration_ms ?? 0,
    trackDistanceMetres: row.track_distance_metres ?? 0,
    minGpsAltitude: row.min_gps_altitude,
    maxGpsAltitude: row.max_gps_altitude,
    maxGroundSpeed: row.max_ground_speed,
    fixCount: row.fix_count ?? 0,
    medianSourceGapMs: row.median_source_gap_ms,
    p95SourceGapMs: row.p95_source_gap_ms,
    maxSourceGapMs: row.max_source_gap_ms,
    quality: row.quality ?? 'no_track',
    computedAt: row.computed_at,
  };
}

export function mapFlightSyncCandidate(row: FlightSyncCandidateRow): FlightSyncCandidate {
  return {
    id: row.id,
    recordingSessionId: row.recording_session_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    timezoneOffsetMinutes: row.timezone_offset_minutes,
    title: row.title,
    site: row.site,
    notes: row.notes,
    takeoffLatitude: row.takeoff_latitude,
    takeoffLongitude: row.takeoff_longitude,
    siteSource: row.site_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionStatus: row.session_status,
    metrics: mapCandidateMetrics(row),
    pushedUpdatedAt: row.pushed_updated_at,
    igcSha256: row.igc_sha256,
    igcObjectPath: row.igc_object_path,
    attemptCount: row.attempt_count ?? 0,
    nextAttemptAt: row.next_attempt_at ?? 0,
  };
}

export const COUNT_PENDING_SYNC_SQL = `SELECT
  (SELECT COUNT(*)
     FROM flights f
     JOIN sessions s ON s.id = f.recording_session_id
     LEFT JOIN flight_sync_state st ON st.flight_id = f.id
    WHERE s.status = 'completed'
      AND f.status IN ('completed', 'partial')
      AND (st.pushed_updated_at IS NULL OR st.pushed_updated_at < f.updated_at)) AS flights,
  (SELECT COUNT(*) FROM flight_deletions) AS deletions`;

// ---------------------------------------------------------------------------
// Push results
// ---------------------------------------------------------------------------

/**
 * Records a successful push. `pushed_updated_at` is the `flights.updated_at` that was
 * actually uploaded, not "now" — so an edit made while the request was in flight stays
 * dirty and gets pushed on the next cycle rather than being silently dropped.
 */
export const MARK_FLIGHT_PUSHED_SQL = `INSERT INTO flight_sync_state
  (flight_id, pushed_updated_at, remote_updated_at, attempt_count, next_attempt_at, last_error)
VALUES (?, ?, ?, 0, 0, NULL)
ON CONFLICT (flight_id) DO UPDATE SET
  pushed_updated_at = excluded.pushed_updated_at,
  remote_updated_at = excluded.remote_updated_at,
  attempt_count = 0,
  next_attempt_at = 0,
  last_error = NULL`;

export const MARK_FLIGHT_IGC_PUSHED_SQL = `UPDATE flight_sync_state
SET igc_sha256 = ?, igc_object_path = ?, igc_pushed_at = ?
WHERE flight_id = ?`;

export const RECORD_FLIGHT_SYNC_FAILURE_SQL = `INSERT INTO flight_sync_state
  (flight_id, attempt_count, next_attempt_at, last_error)
VALUES (?, 1, ?, ?)
ON CONFLICT (flight_id) DO UPDATE SET
  attempt_count = flight_sync_state.attempt_count + 1,
  next_attempt_at = excluded.next_attempt_at,
  last_error = excluded.last_error`;

// ---------------------------------------------------------------------------
// Deletions
// ---------------------------------------------------------------------------

export interface FlightDeletionRow {
  flight_id: string;
  recording_session_id: string;
  deleted_at: number;
  attempt_count: number;
  next_attempt_at: number;
  last_error: string | null;
}

export const PENDING_FLIGHT_DELETIONS_SQL = `SELECT *
FROM flight_deletions
WHERE next_attempt_at <= ?
ORDER BY deleted_at ASC, flight_id ASC
LIMIT ?`;

export function mapFlightDeletion(row: FlightDeletionRow): FlightDeletionRecord {
  return {
    flightId: row.flight_id,
    recordingSessionId: row.recording_session_id,
    deletedAt: row.deleted_at,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}

export const RECORD_FLIGHT_DELETION_FAILURE_SQL = `UPDATE flight_deletions
SET attempt_count = attempt_count + 1, next_attempt_at = ?, last_error = ?
WHERE flight_id = ?`;

// ---------------------------------------------------------------------------
// Metadata pull-back
// ---------------------------------------------------------------------------

/**
 * Last-write-wins on the client clock, guarded in SQL so the comparison and the write
 * are one atomic step — a local edit landing mid-cycle can never be clobbered.
 *
 * Only title, site and notes are ever pulled. Flight facts (status, timestamps,
 * metrics, IGC references) are local-wins unconditionally: the phone is the recorder
 * and the server is a backup, never an authority.
 *
 * `changes === 0` means the local row was newer or equal, which is also what stops the
 * echo loop after a push bumps the server's own `updated_at`.
 */
/**
 * `site_source` is rewritten alongside `site`, never left as it was.
 *
 * Provenance is not pushed, so a name arriving from another device carries none this
 * device can vouch for. Leaving the old value would attach a catalogue's credit — and its
 * licence — to a string that may have been typed by hand on a different phone.
 */
export const APPLY_REMOTE_FLIGHT_METADATA_SQL = `UPDATE flights
SET title = ?,
    site = ?,
    site_source = CASE WHEN ? IS NULL THEN NULL ELSE 'manual' END,
    notes = ?,
    updated_at = ?
WHERE id = ? AND updated_at < ?`;

export interface RemoteFlightMetadata {
  flightId: string;
  title: string | null;
  site: string | null;
  notes: string | null;
  clientUpdatedAt: number;
}

/**
 * Three distinct outcomes, because the caller needs to tell them apart:
 *
 * - `applied`    the remote edit won and is now the local value.
 * - `local_newer` this device holds a newer edit; the next push will correct the server.
 * - `missing`     no local row at all — a flight recorded on another phone. This is the
 *                 only one that counts towards `cloudOnlyFlightCount`. A plain
 *                 "did the UPDATE change a row" boolean cannot distinguish the last two,
 *                 and conflating them would report every locally-edited flight as one
 *                 this device does not have.
 */
export type RemoteMetadataOutcome = 'applied' | 'local_newer' | 'missing';

export const FLIGHT_EXISTS_SQL = 'SELECT 1 AS present FROM flights WHERE id = ?';

export async function applyRemoteFlightMetadataTransaction(
  transaction: SqlExecutor,
  remote: RemoteFlightMetadata,
  remoteUpdatedAt: string,
): Promise<RemoteMetadataOutcome> {
  const result = await transaction.runAsync(
    APPLY_REMOTE_FLIGHT_METADATA_SQL,
    remote.title,
    remote.site,
    // Bound twice: once for the column, once for the CASE that derives its provenance.
    remote.site,
    remote.notes,
    remote.clientUpdatedAt,
    remote.flightId,
    remote.clientUpdatedAt,
  );

  if (result.changes === 0) {
    // Checked inside the same transaction as the UPDATE, so a flight deleted
    // concurrently cannot be reported as "local newer".
    const existing = await transaction.getFirstAsync<{ present: number }>(
      FLIGHT_EXISTS_SQL,
      remote.flightId,
    );
    // Either way the watermark is left alone: a local row that is newer stays dirty so
    // the next push corrects the server, and a row that does not exist has nothing to
    // mark.
    return existing ? 'local_newer' : 'missing';
  }

  // The remote value won and is now the local value, so it is by definition already
  // pushed. Advancing the watermark here is what stops the echo loop — otherwise the
  // pull would dirty the flight and the next push would bump the server's updated_at,
  // which would dirty it again on the following pull, forever.
  await transaction.runAsync(
    MARK_FLIGHT_PUSHED_SQL,
    remote.flightId,
    remote.clientUpdatedAt,
    remoteUpdatedAt,
  );
  return 'applied';
}
