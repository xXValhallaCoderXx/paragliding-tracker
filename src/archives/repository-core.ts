import { normalizeFlightMetadataPatch } from '../recorder/flight-repository-core';
import { assertFlightMetadata, assertFlightTarget, type FlightEditGuard, type FlightMutationGuard } from '../lib/flight-mutations';
import { assertFlightScope } from '../lib/flight-scope';
import { parseEquipmentSnapshot } from '../equipment/validation';
import type { ArchivedFlightDetail, ArchivedFlightSummary, ArchiveTrackState, FlightMetadataPatch } from '../recorder/types';
import { decodeTrackSegments, encodeTrackSegments } from '../lib/track/encoding';
import type { TrackSegments } from '../lib/track/types';
import { MAX_ARCHIVE_IGC_BYTES, type ArchiveCursor, type ArchiveDatabaseAccess, type ArchiveDeletion, type ArchiveDownloadCandidate, type ArchiveMetadataCandidate, type ArchiveRemoteFlight, type ArchiveSqlExecutor } from './types';

interface ArchiveRow {
  owner_user_id: string; flight_id: string; recording_session_id: string; summary_json: string;
  started_at: number; client_updated_at: number; remote_updated_at: string; dirty_updated_at: number | null;
  metadata_attempt_count: number; metadata_next_attempt_at: number; metadata_error: string | null;
  igc_object_path: string | null; igc_sha256: string | null; igc_byte_count: number | null; igc_artifact_version: number | null;
  track_state: ArchiveTrackState; downloaded_at: number | null; download_attempt_count: number;
  download_next_attempt_at: number; download_error: string | null;
}
interface DeletionRow {
  owner_user_id: string; flight_id: string; recording_session_id: string | null; deleted_at: number;
  attempt_count: number; next_attempt_at: number; last_error: string | null;
}
export interface ArchiveRepositoryDependencies {
  database: ArchiveDatabaseAccess;
  sha256(bytes: Uint8Array): Promise<string>;
  deriveTrack?(bytes: Uint8Array, bounds: { startedAt: number; endedAt: number }): TrackSegments;
  checkStorage?(bytes: number): void;
  now?(): number;
}

// Captured evidence always wins, including old backups whose flight ID differs but session is the same.
const VISIBLE = `NOT EXISTS (SELECT 1 FROM flights f WHERE f.id = a.flight_id OR f.recording_session_id = a.recording_session_id)
  AND NOT EXISTS (SELECT 1 FROM archive_deletions d WHERE d.owner_user_id = a.owner_user_id AND d.flight_id = a.flight_id)
  AND NOT EXISTS (SELECT 1 FROM flight_deletions d WHERE d.owner_user_id = a.owner_user_id AND d.flight_id = a.flight_id)`;
const ROW = 'SELECT * FROM archive_flights WHERE owner_user_id = ? AND flight_id = ?';
function summary(row: ArchiveRow): ArchivedFlightSummary {
  const value = JSON.parse(row.summary_json) as ArchivedFlightSummary;
  return { ...value, source: 'archive', ownerUserId: row.owner_user_id, cloudOwnerUserId: row.owner_user_id,
    sessionStatus: null, archive: { trackState: row.track_state, error: row.download_error, downloadedAt: row.downloaded_at } };
}
function remoteSummary(owner: string, row: ArchiveRemoteFlight): ArchivedFlightSummary {
  const metrics = row.metrics_algorithm_version !== null && row.duration_ms !== null && row.track_distance_metres !== null &&
    row.fix_count !== null && row.quality !== null && row.metrics_computed_at !== null ? {
      flightId: row.id, algorithmVersion: row.metrics_algorithm_version, durationMs: row.duration_ms,
      trackDistanceMetres: row.track_distance_metres, minGpsAltitude: row.min_gps_altitude, maxGpsAltitude: row.max_gps_altitude,
      maxGroundSpeed: row.max_ground_speed, fixCount: row.fix_count, medianSourceGapMs: row.median_source_gap_ms,
      p95SourceGapMs: row.p95_source_gap_ms, maxSourceGapMs: row.max_source_gap_ms, quality: row.quality, computedAt: row.metrics_computed_at,
    } : null;
  return { source: 'archive', ownerUserId: owner, cloudOwnerUserId: owner, id: row.id, recordingSessionId: row.recording_session_id,
    status: row.status, startedAt: row.started_at, endedAt: row.ended_at, timezoneOffsetMinutes: row.timezone_offset_minutes,
    title: row.title, site: row.site, notes: row.notes, takeoffLatitude: null, takeoffLongitude: null,
    siteSource: row.site && (row.site_source === 'manual' || row.site_source === 'osm' || row.site_source === 'paraglidingearth') ? row.site_source : null,
    createdAt: row.client_created_at, updatedAt: row.client_updated_at,
    equipmentSnapshot: parseEquipmentSnapshot(row.equipment_snapshot),
    sessionStatus: null, metrics, archive: { trackState: 'pending', error: null, downloadedAt: null } };
}
function downloadable(row: Pick<ArchiveRow, 'owner_user_id' | 'flight_id' | 'igc_object_path' | 'igc_sha256' | 'igc_byte_count' | 'igc_artifact_version' | 'summary_json'>): boolean {
  const flight = JSON.parse(row.summary_json) as ArchivedFlightSummary;
  return row.igc_object_path === `${row.owner_user_id}/${row.flight_id}.igc` && /^[a-f0-9]{64}$/i.test(row.igc_sha256 ?? '') &&
    Number.isSafeInteger(row.igc_byte_count) && row.igc_byte_count! > 0 && row.igc_byte_count! <= MAX_ARCHIVE_IGC_BYTES &&
    Number.isSafeInteger(row.igc_artifact_version) && row.igc_artifact_version! > 0 &&
    Number.isFinite(flight.endedAt) && flight.endedAt! >= flight.startedAt;
}
function downloadCandidate(row: ArchiveRow): ArchiveDownloadCandidate {
  const flight = summary(row);
  return { ownerUserId: row.owner_user_id, flightId: row.flight_id, recordingSessionId: row.recording_session_id,
    title: flight.title, startedAt: flight.startedAt, endedAt: flight.endedAt!, objectPath: row.igc_object_path!, sha256: row.igc_sha256!,
    byteCount: row.igc_byte_count!, artifactVersion: row.igc_artifact_version!, attemptCount: row.download_attempt_count };
}
async function receipt(database: ArchiveSqlExecutor, owner: string, id: string): Promise<boolean> {
  return !!await database.getFirstAsync(`SELECT 1 FROM archive_deletions WHERE owner_user_id = ? AND flight_id = ?
    UNION ALL SELECT 1 FROM flight_deletions WHERE owner_user_id = ? AND flight_id = ? LIMIT 1`, owner, id, owner, id);
}

/** Owner-scoped durable catalogue and outboxes. Raw recorder evidence is never synthesized here. */
export class ArchiveRepositoryCore {
  private readonly database: ArchiveDatabaseAccess;
  private readonly now: () => number;
  constructor(private readonly dependencies: ArchiveRepositoryDependencies) {
    this.database = dependencies.database; this.now = dependencies.now ?? Date.now;
  }
  list(owner: string): Promise<ArchivedFlightSummary[]> {
    return this.database.read(async db => (await db.getAllAsync<ArchiveRow>(
      `SELECT a.* FROM archive_flights a WHERE a.owner_user_id = ? AND ${VISIBLE} ORDER BY a.started_at DESC, a.flight_id`, owner)).map(summary));
  }
  get(owner: string, id: string): Promise<ArchivedFlightDetail | null> {
    return this.database.read(async db => {
      const row = await db.getFirstAsync<ArchiveRow>(`SELECT a.* FROM archive_flights a WHERE a.owner_user_id = ? AND a.flight_id = ? AND ${VISIBLE}`, owner, id);
      return row ? { ...summary(row), session: null } : null;
    });
  }
  async upsertRemote(owner: string, remote: ArchiveRemoteFlight, expectedLocalUpdatedAt?: number): Promise<boolean> {
    if (remote.user_id !== owner) throw new Error('The archive belongs to another account.');
    if (remote.deleted_at) { await this.applyRemoteDeletion(owner, remote.id, remote.recording_session_id, Date.parse(remote.deleted_at)); return false; }
    if (!['completed', 'partial'].includes(remote.status) || !Number.isFinite(remote.started_at) || !Number.isFinite(remote.client_updated_at) ||
        !Number.isFinite(Date.parse(remote.updated_at))) throw new Error('Invalid archived flight summary.');
    return this.database.write(async db => {
      if (await receipt(db, owner, remote.id)) return false;
      const old = await db.getFirstAsync<ArchiveRow>(ROW, owner, remote.id);
      if (old && Date.parse(old.remote_updated_at) > Date.parse(remote.updated_at)) return false;
      let flight = remoteSummary(owner, remote);
      const canonicalReply = expectedLocalUpdatedAt !== undefined && old?.dirty_updated_at === expectedLocalUpdatedAt;
      // Pending edits must reach the write RPC before its canonical reply can resolve them.
      // A following catalogue pull must not erase a newer edit made during that RPC.
      const keepLocal = !canonicalReply && old?.dirty_updated_at !== null && old?.dirty_updated_at !== undefined;
      if (keepLocal && old) {
        const local = summary(old);
        flight = { ...flight, title: local.title, site: local.site, siteSource: local.siteSource, notes: local.notes, updatedAt: local.updatedAt };
      }
      const sameArtifact = !!old && old.igc_sha256 === remote.igc_sha256 && old.igc_byte_count === remote.igc_byte_count &&
        old.igc_artifact_version === remote.igc_artifact_version && old.igc_object_path === remote.igc_object_path;
      const eligible = downloadable({ owner_user_id: owner, flight_id: remote.id, summary_json: JSON.stringify(flight),
        igc_object_path: remote.igc_object_path, igc_sha256: remote.igc_sha256, igc_byte_count: remote.igc_byte_count, igc_artifact_version: remote.igc_artifact_version });
      // A new manifest requests a replacement; the prior verified export remains usable until commit.
      await db.runAsync(`INSERT INTO archive_flights (owner_user_id, flight_id, recording_session_id, summary_json, started_at, client_updated_at, remote_updated_at,
        dirty_updated_at, igc_object_path, igc_sha256, igc_byte_count, igc_artifact_version, track_state, downloaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, flight_id) DO UPDATE SET recording_session_id = excluded.recording_session_id, summary_json = excluded.summary_json,
        started_at = excluded.started_at, client_updated_at = excluded.client_updated_at, remote_updated_at = excluded.remote_updated_at,
        dirty_updated_at = excluded.dirty_updated_at, igc_object_path = excluded.igc_object_path, igc_sha256 = excluded.igc_sha256,
        igc_byte_count = excluded.igc_byte_count, igc_artifact_version = excluded.igc_artifact_version, track_state = excluded.track_state,
        downloaded_at = excluded.downloaded_at, metadata_error = CASE WHEN excluded.dirty_updated_at IS NULL THEN NULL ELSE metadata_error END,
        metadata_attempt_count = CASE WHEN excluded.dirty_updated_at IS NULL THEN 0 ELSE metadata_attempt_count END,
        metadata_next_attempt_at = CASE WHEN excluded.dirty_updated_at IS NULL THEN 0 ELSE metadata_next_attempt_at END,
        download_error = CASE WHEN ? THEN download_error ELSE NULL END,
        download_attempt_count = CASE WHEN ? THEN download_attempt_count ELSE 0 END,
        download_next_attempt_at = CASE WHEN ? THEN download_next_attempt_at ELSE 0 END`,
      owner, remote.id, remote.recording_session_id, JSON.stringify(flight), flight.startedAt, flight.updatedAt, remote.updated_at,
      keepLocal ? old!.dirty_updated_at : null, remote.igc_object_path, remote.igc_sha256, remote.igc_byte_count, remote.igc_artifact_version,
      sameArtifact ? old!.track_state : eligible ? 'pending' : 'missing', old?.downloaded_at ?? null,
      sameArtifact ? 1 : 0, sameArtifact ? 1 : 0, sameArtifact ? 1 : 0);
      return true;
    });
  }
  updateMetadata(owner: string, id: string, patch: FlightMetadataPatch, guard?: FlightEditGuard): Promise<ArchivedFlightDetail> {
    const normalized = normalizeFlightMetadataPatch(patch);
    return this.database.write(async db => {
      const row = await db.getFirstAsync<ArchiveRow>(ROW, owner, id);
      if (!row || await receipt(db, owner, id)) throw new Error('Flight not found.');
      const flight = summary(row);
      if (guard) {
        assertFlightTarget(flight, guard);
        if (await db.getFirstAsync('SELECT 1 FROM flights WHERE id = ? OR recording_session_id = ?', id, flight.recordingSessionId)) throw new Error('The flight source changed. Reopen this flight.');
        assertFlightMetadata(flight, normalized, guard.original);
        assertFlightScope(guard.scope);
      }
      if (['title', 'site', 'notes'].some(field => Object.hasOwn(normalized, field))) {
        for (const field of ['title', 'site', 'notes'] as const) if (Object.hasOwn(normalized, field)) flight[field] = normalized[field] ?? null;
        if (Object.hasOwn(normalized, 'site')) flight.siteSource = flight.site === null ? null : normalized.siteSource ?? 'manual';
        flight.updatedAt = Math.max(this.now(), row.client_updated_at + 1);
        await db.runAsync(`UPDATE archive_flights SET summary_json = ?, client_updated_at = ?, dirty_updated_at = ?, metadata_attempt_count = 0,
          metadata_next_attempt_at = 0, metadata_error = NULL WHERE owner_user_id = ? AND flight_id = ?`, JSON.stringify(flight), flight.updatedAt, flight.updatedAt, owner, id);
      }
      if (guard) assertFlightScope(guard.scope);
      return { ...flight, session: null };
    });
  }
  deleteLocal(owner: string, id: string, guard?: FlightMutationGuard): Promise<void> {
    return this.database.write(async db => {
      const row = await db.getFirstAsync<ArchiveRow>(ROW, owner, id);
      if (!row) { if (!guard && await receipt(db, owner, id)) return; throw new Error('Flight not found.'); }
      if (guard) {
        const flight = summary(row);
        assertFlightTarget(flight, guard);
        if (await receipt(db, owner, id)) throw new Error('This flight was deleted.');
        if (await db.getFirstAsync('SELECT 1 FROM flights WHERE id = ? OR recording_session_id = ?', id, flight.recordingSessionId)) throw new Error('The flight source changed. Reopen this flight.');
        assertFlightScope(guard.scope);
      }
      await db.runAsync(`INSERT OR IGNORE INTO archive_deletions (owner_user_id, flight_id, recording_session_id, deleted_at) VALUES (?, ?, ?, ?)`, owner, id, row.recording_session_id, this.now());
      // Expo's exclusive connection does not inherit foreign_keys; do not rely on its cascade.
      await db.runAsync('DELETE FROM archive_artifacts WHERE owner_user_id = ? AND flight_id = ?', owner, id);
      await db.runAsync('DELETE FROM archive_flights WHERE owner_user_id = ? AND flight_id = ?', owner, id);
      if (guard) assertFlightScope(guard.scope);
    });
  }
  applyRemoteDeletion(owner: string, id: string, recordingSessionId: string | null, deletedAt: number): Promise<void> {
    if (!Number.isFinite(deletedAt)) throw new Error('Invalid archive deletion time.');
    return this.database.write(async db => {
      await db.runAsync(`INSERT INTO archive_deletions (owner_user_id, flight_id, recording_session_id, deleted_at, acknowledged_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, flight_id) DO UPDATE SET acknowledged_at = excluded.acknowledged_at, last_error = NULL`, owner, id, recordingSessionId, deletedAt, this.now());
      await db.runAsync('DELETE FROM archive_artifacts WHERE owner_user_id = ? AND flight_id = ?', owner, id);
      await db.runAsync('DELETE FROM archive_flights WHERE owner_user_id = ? AND flight_id = ?', owner, id);
    });
  }
  listDirtyMetadata(owner: string, limit = 100, now = this.now(), ignoreBackoff = false): Promise<ArchiveMetadataCandidate[]> {
    return this.database.read(async db => (await db.getAllAsync<ArchiveRow>(`SELECT a.* FROM archive_flights a WHERE a.owner_user_id = ?
      AND a.dirty_updated_at IS NOT NULL AND (? = 1 OR a.metadata_next_attempt_at <= ?) AND ${VISIBLE} ORDER BY a.client_updated_at, a.flight_id LIMIT ?`, owner, ignoreBackoff ? 1 : 0, now, limit))
      .map(row => ({ ...summary(row), dirtyUpdatedAt: row.dirty_updated_at! })));
  }
  markMetadataPushed(owner: string, id: string, expectedUpdatedAt: number, remoteUpdatedAt: string): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE archive_flights SET dirty_updated_at = NULL, remote_updated_at = ?, metadata_attempt_count = 0,
      metadata_next_attempt_at = 0, metadata_error = NULL WHERE owner_user_id = ? AND flight_id = ? AND dirty_updated_at = ?`, remoteUpdatedAt, owner, id, expectedUpdatedAt); });
  }
  recordMetadataFailure(owner: string, id: string, error: string, nextAttemptAt = this.now() + 60_000): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE archive_flights SET metadata_attempt_count = metadata_attempt_count + 1,
      metadata_next_attempt_at = ?, metadata_error = ? WHERE owner_user_id = ? AND flight_id = ? AND dirty_updated_at IS NOT NULL`, nextAttemptAt, error, owner, id); });
  }
  listPendingDeletions(owner: string, limit = 100, now = this.now(), ignoreBackoff = false): Promise<ArchiveDeletion[]> {
    return this.database.read(async db => (await db.getAllAsync<DeletionRow>(`SELECT * FROM archive_deletions WHERE owner_user_id = ? AND acknowledged_at IS NULL
      AND (? = 1 OR next_attempt_at <= ?) ORDER BY deleted_at, flight_id LIMIT ?`, owner, ignoreBackoff ? 1 : 0, now, limit))
      .map(row => ({ ownerUserId: row.owner_user_id, flightId: row.flight_id, recordingSessionId: row.recording_session_id, deletedAt: row.deleted_at,
        attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, lastError: row.last_error })));
  }
  acknowledgeDeletion(owner: string, id: string, deletedAt: number): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE archive_deletions SET acknowledged_at = ?, last_error = NULL
      WHERE owner_user_id = ? AND flight_id = ? AND deleted_at = ?`, this.now(), owner, id, deletedAt); });
  }
  recordDeletionFailure(owner: string, id: string, error: string, nextAttemptAt = this.now() + 60_000): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE archive_deletions SET attempt_count = attempt_count + 1, next_attempt_at = ?, last_error = ?
      WHERE owner_user_id = ? AND flight_id = ? AND acknowledged_at IS NULL`, nextAttemptAt, error, owner, id); });
  }
  listPendingDownloads(owner: string, limit = 1000, now = this.now(), ignoreBackoff = false): Promise<ArchiveDownloadCandidate[]> {
    return this.database.read(async db => (await db.getAllAsync<ArchiveRow>(`SELECT a.* FROM archive_flights a WHERE a.owner_user_id = ?
      AND a.track_state IN ('pending', 'downloading', 'error') AND (? = 1 OR a.download_next_attempt_at <= ?) AND ${VISIBLE}
      ORDER BY a.started_at DESC, a.flight_id LIMIT ?`, owner, ignoreBackoff ? 1 : 0, now, limit)).filter(downloadable).map(downloadCandidate));
  }
  markDownloadStarted(owner: string, id: string): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE archive_flights SET track_state = 'downloading', download_error = NULL
      WHERE owner_user_id = ? AND flight_id = ? AND track_state IN ('pending', 'error', 'downloading')`, owner, id); });
  }
  recordDownloadFailure(owner: string, id: string, error: string, nextAttemptAt = this.now()): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE archive_flights SET track_state = 'error', download_attempt_count = download_attempt_count + 1,
      download_next_attempt_at = ?, download_error = ? WHERE owner_user_id = ? AND flight_id = ? AND track_state != 'ready'`, nextAttemptAt, error, owner, id); });
  }
  async storeVerifiedIgc(owner: string, id: string, expectedSha256: string, bytes: Uint8Array, expectedArtifactVersion?: number, shouldCommit?: () => boolean): Promise<boolean> {
    const before = await this.database.read(db => db.getFirstAsync<ArchiveRow>(ROW, owner, id));
    if (!before || before.igc_sha256 !== expectedSha256 || (expectedArtifactVersion !== undefined && before.igc_artifact_version !== expectedArtifactVersion)) return false;
    if (!downloadable(before) || bytes.byteLength !== before.igc_byte_count || bytes.byteLength > MAX_ARCHIVE_IGC_BYTES) throw new Error('The downloaded track does not match its saved size.');
    this.dependencies.checkStorage?.(bytes.byteLength);
    if ((await this.dependencies.sha256(bytes)).toLowerCase() !== expectedSha256.toLowerCase()) throw new Error('The downloaded track failed its integrity check. Retry restoration.');
    const flight = summary(before);
    let track: TrackSegments = [];
    try { track = this.dependencies.deriveTrack?.(bytes, { startedAt: flight.startedAt, endedAt: flight.endedAt! }) ?? []; }
    catch { /* Keep the verified original export even when its fixes cannot be replayed. */ }
    const trackJson = encodeTrackSegments(track);
    return this.database.write(async db => {
      const current = await db.getFirstAsync<ArchiveRow>(ROW, owner, id);
      if (!current || await receipt(db, owner, id) || current.igc_sha256 !== expectedSha256 || current.igc_artifact_version !== before.igc_artifact_version ||
          current.igc_object_path !== before.igc_object_path || current.igc_byte_count !== bytes.byteLength) return false;
      this.dependencies.checkStorage?.(bytes.byteLength);
      const now = this.now();
      if (shouldCommit && !shouldCommit()) return false;
      await db.runAsync(`INSERT INTO archive_artifacts (owner_user_id, flight_id, sha256, artifact_version, byte_count, bytes, stored_at, track_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id, flight_id) DO UPDATE SET sha256 = excluded.sha256,
        artifact_version = excluded.artifact_version, byte_count = excluded.byte_count, bytes = excluded.bytes, stored_at = excluded.stored_at, track_json = excluded.track_json`,
      owner, id, expectedSha256, current.igc_artifact_version, bytes.byteLength, bytes, now, trackJson);
      await db.runAsync(`UPDATE archive_flights SET track_state = 'ready', downloaded_at = ?, download_error = NULL, download_attempt_count = 0,
        download_next_attempt_at = 0 WHERE owner_user_id = ? AND flight_id = ?`, now, owner, id);
      return true;
    });
  }
  readIgc(owner: string, id: string): Promise<Uint8Array | null> {
    return this.database.read(async db => (await db.getFirstAsync<{ bytes: Uint8Array }>(`SELECT b.bytes FROM archive_artifacts b JOIN archive_flights a
      ON a.owner_user_id = b.owner_user_id AND a.flight_id = b.flight_id WHERE a.owner_user_id = ? AND a.flight_id = ?
      AND ${VISIBLE}`, owner, id))?.bytes ?? null);
  }
  listTracks(owner: string): Promise<Record<string, TrackSegments>> {
    return this.database.read(async db => Object.fromEntries((await db.getAllAsync<{ flight_id: string; track_json: string | null }>(`SELECT a.flight_id, b.track_json
      FROM archive_flights a LEFT JOIN archive_artifacts b ON a.owner_user_id = b.owner_user_id AND a.flight_id = b.flight_id
      WHERE a.owner_user_id = ? AND ${VISIBLE}`, owner)).map(row => [row.flight_id, decodeTrackSegments(row.track_json)])));
  }
  getTrack(owner: string, id: string): Promise<TrackSegments> {
    return this.database.read(async db => decodeTrackSegments((await db.getFirstAsync<{ track_json: string | null }>(`SELECT b.track_json FROM archive_flights a
      LEFT JOIN archive_artifacts b ON a.owner_user_id = b.owner_user_id AND a.flight_id = b.flight_id WHERE a.owner_user_id = ? AND a.flight_id = ? AND ${VISIBLE}`, owner, id))?.track_json));
  }
  getCursor(owner: string): Promise<ArchiveCursor | null> {
    return this.database.read(async db => { const row = await db.getFirstAsync<{ updated_at: string; flight_id: string }>('SELECT updated_at, flight_id FROM archive_cursors WHERE owner_user_id = ?', owner);
      return row ? { updatedAt: row.updated_at, flightId: row.flight_id } : null; });
  }
  setCursor(owner: string, cursor: ArchiveCursor | null): Promise<void> {
    return this.database.write(async db => {
      if (!cursor) { await db.runAsync('DELETE FROM archive_cursors WHERE owner_user_id = ?', owner); return; }
      await db.runAsync(`INSERT INTO archive_cursors VALUES (?, ?, ?) ON CONFLICT(owner_user_id) DO UPDATE SET updated_at = excluded.updated_at, flight_id = excluded.flight_id`, owner, cursor.updatedAt, cursor.flightId);
    });
  }
  getLastOwner(): Promise<string | null> {
    return this.database.read(async db => (await db.getFirstAsync<{ last_owner_user_id: string | null }>('SELECT last_owner_user_id FROM archive_settings WHERE id = 1'))?.last_owner_user_id ?? null);
  }
  rememberOwner(owner: string): Promise<void> {
    return this.database.write(async db => { await db.runAsync('UPDATE archive_settings SET last_owner_user_id = ? WHERE id = 1', owner); });
  }
  getRestorePaused(owner: string): Promise<boolean> {
    return this.database.read(async db => (await db.getFirstAsync<{ restore_paused: number }>('SELECT restore_paused FROM archive_owner_settings WHERE owner_user_id = ?', owner))?.restore_paused === 1);
  }
  setRestorePaused(owner: string, paused: boolean): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`INSERT INTO archive_owner_settings VALUES (?, ?) ON CONFLICT(owner_user_id) DO UPDATE SET restore_paused = excluded.restore_paused`, owner, paused ? 1 : 0); });
  }
}
