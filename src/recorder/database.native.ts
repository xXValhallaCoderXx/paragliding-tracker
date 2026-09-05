import { readFlightReplay } from './replay-repository-core';
import * as SQLite from 'expo-sqlite';

import {
  EXPECTED_V1_TABLE_COLUMNS,
  EXPECTED_V2_TABLE_COLUMNS,
  EXPECTED_V3_INDEX_NAMES,
  EXPECTED_V3_TABLE_COLUMNS,
  EXPECTED_V4_INDEX_NAMES,
  EXPECTED_V4_TABLE_COLUMNS,
  EXPECTED_V5_INDEX_NAMES,
  EXPECTED_V5_TABLE_COLUMNS,
  EXPECTED_V6_INDEX_NAMES,
  EXPECTED_V6_TABLE_COLUMNS,
  EXPECTED_V7_INDEX_NAMES,
  EXPECTED_V7_TABLE_COLUMNS,
  LATEST_DATABASE_VERSION,
  flightStatusForSession,
  getSchemaMigrationSteps,
  normalizeFlightMetadataPatch,
  normalizePilotProfilePatch,
} from './flight-repository-core';
import {
  PENDING_SESSION_RECOVERY_ATTEMPT_SQL,
  SESSION_RECOVERY_ATTEMPT_BY_ID_SQL,
  beginSessionRecoveryAttemptTransaction,
  confirmSessionRecoveryAttemptTransaction,
  mapPendingSessionRecoveryAttemptRow,
  persistLocationBatchTransaction,
  requestSessionStopTransaction,
  resolveInterruptedPartialEndAt,
  resolveSessionCompletionTimestamp,
  type LocationBatchInput,
  type SessionRecoveryAttemptProofRow,
} from './repository-core';
import {
  BIND_CLOUD_LINK_SQL,
  CLOUD_LINK_SQL,
  COUNT_PENDING_SYNC_SQL,
  DIRTY_FLIGHTS_SQL,
  EMPTY_CLOUD_LINK,
  EMPTY_PILOT_PROFILE,
  MARK_FLIGHT_IGC_PUSHED_SQL,
  MARK_FLIGHT_PUSHED_SQL,
  MARK_PILOT_PROFILE_PUSHED_SQL,
  PENDING_FLIGHT_DELETIONS_SQL,
  PILOT_PROFILE_SQL,
  RECORD_FLIGHT_DELETION_FAILURE_SQL,
  RECORD_FLIGHT_SYNC_FAILURE_SQL,
  applyRemoteFlightMetadataTransaction,
  mapCloudLink,
  mapFlightDeletion,
  mapFlightSyncCandidate,
  mapPilotProfile,
  resetCloudLinkTransaction,
  updateAppSettingsTransaction,
  updatePilotProfileTransaction,
  APP_SETTINGS_SQL,
  EMPTY_APP_SETTINGS,
  mapAppSettings,
  type CloudLinkRow,
  type FlightDeletionRow,
  type FlightSyncCandidateRow,
  type AppSettingsRow,
  type PilotProfileRow,
  type RemoteFlightMetadata,
  type RemoteMetadataOutcome,
} from './sync-repository-core';
import type {
  AppSettings,
  AppSettingsPatch,
  BeginSessionRecoveryAttemptInput,
  CompletionReason,
  ExportArtifact,
  CloudLink,
  FlightDeletionRecord,
  FlightDetail,
  FlightMetadataPatch,
  FlightMetricsRecord,
  FlightRecord,
  FlightStatus,
  FlightSummary,
  FlightSyncCandidate,
  LocationFixRecord,
  PilotProfile,
  PilotProfilePatch,
  PendingSessionRecoveryAttempt,
  PendingSessionStop,
  PowerReading,
  PressureSampleRecord,
  RecorderEventRecord,
  SessionRecoveryAttempt,
  SessionRecoveryProof,
  SessionExportData,
  SessionRecord,
  SiteSource,
} from './types';

const DATABASE_NAME = 'xc-recorder.db';

export const PENDING_SESSION_STOP_SQL = `SELECT
  id AS session_id,
  manual_stop_at AS stopped_at,
  started_at
FROM sessions
WHERE status = 'interrupted' AND manual_stop_at IS NOT NULL
ORDER BY started_at DESC
LIMIT 1`;

export const COMPLETE_SESSION_SQL = `UPDATE sessions
SET status = 'completed', completion_reason = ?, ended_at = ?, updated_at = ?,
    end_power_json = ?
WHERE id = ?`;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

interface SchemaExecutor {
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
}

type ExpectedColumns = Readonly<Record<string, readonly string[]>>;

async function validateExpectedSchema(
  database: SchemaExecutor,
  expected: ExpectedColumns,
): Promise<void> {
  for (const [table, expectedColumns] of Object.entries(expected)) {
    const exists = await database.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      table,
    );
    if (!exists) throw new Error(`Recorder database is missing the expected ${table} table.`);

    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info("${table}")`);
    const actual = new Set(columns.map((column) => column.name));
    const missing = expectedColumns.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(`Recorder database table ${table} is missing columns: ${missing.join(', ')}.`);
    }
  }
}

async function validateExpectedIndexes(
  database: SchemaExecutor,
  expectedNames: readonly string[],
): Promise<void> {
  for (const name of expectedNames) {
    const exists = await database.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
      name,
    );
    if (!exists) throw new Error(`Recorder database is missing the expected ${name} index.`);
  }
}

async function assertDatabaseIntegrity(database: SchemaExecutor): Promise<void> {
  const quickCheck = await database.getAllAsync<Record<string, unknown>>('PRAGMA quick_check');
  const quickCheckValues = quickCheck.map((row) => String(Object.values(row)[0] ?? ''));
  if (quickCheckValues.length !== 1 || quickCheckValues[0] !== 'ok') {
    throw new Error(`Recorder database quick_check failed: ${quickCheckValues.join('; ')}`);
  }

  const foreignKeyViolations = await database.getAllAsync<Record<string, unknown>>(
    'PRAGMA foreign_key_check',
  );
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `Recorder database foreign_key_check found ${foreignKeyViolations.length} violation(s).`,
    );
  }
}

async function getRawRowCounts(database: SchemaExecutor): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of Object.keys(EXPECTED_V1_TABLE_COLUMNS)) {
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM "${table}"`,
    );
    counts[table] = row?.count ?? 0;
  }
  return counts;
}

async function assertRawRowCounts(
  database: SchemaExecutor,
  expected: Record<string, number>,
): Promise<void> {
  const actual = await getRawRowCounts(database);
  for (const [table, count] of Object.entries(expected)) {
    if (actual[table] !== count) {
      throw new Error(
        `Recorder database migration changed ${table} row count from ${count} to ${actual[table]}.`,
      );
    }
  }
}

async function createMigrationBackup(
  database: SQLite.SQLiteDatabase,
  fromVersion: number,
): Promise<string> {
  const backupName = `xc-recorder-migration-v${fromVersion}-to-v${LATEST_DATABASE_VERSION}-${Date.now()}.db`;
  const backup = await SQLite.openDatabaseAsync(backupName, { useNewConnection: true });
  try {
    await SQLite.backupDatabaseAsync({ sourceDatabase: database, destDatabase: backup });
  } catch (error) {
    await backup.closeAsync().catch(() => undefined);
    await SQLite.deleteDatabaseAsync(backupName).catch(() => undefined);
    throw error;
  }
  await backup.closeAsync();
  return backupName;
}

export async function migrateDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  const versionRow = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion > LATEST_DATABASE_VERSION) {
    throw new Error(
      `Recorder database version ${currentVersion} is newer than supported version ${LATEST_DATABASE_VERSION}.`,
    );
  }

  const applicationTables = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );
  const isNewDatabase = currentVersion === 0 && applicationTables.length === 0;

  if (currentVersion === 0 && !isNewDatabase) {
    await validateExpectedSchema(database, EXPECTED_V1_TABLE_COLUMNS);
    currentVersion = 1;
  } else if (currentVersion >= 1) {
    await validateExpectedSchema(database, EXPECTED_V1_TABLE_COLUMNS);
  }

  if (currentVersion >= 2) {
    await validateExpectedSchema(database, EXPECTED_V2_TABLE_COLUMNS);
  }

  if (currentVersion >= 3) {
    await validateExpectedSchema(database, EXPECTED_V3_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V3_INDEX_NAMES);
  }

  if (currentVersion >= 4) {
    await validateExpectedSchema(database, EXPECTED_V4_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V4_INDEX_NAMES);
  }

  if (currentVersion >= 5) {
    await validateExpectedSchema(database, EXPECTED_V5_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V5_INDEX_NAMES);
  }

  if (currentVersion >= 6) {
    await validateExpectedSchema(database, EXPECTED_V6_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V6_INDEX_NAMES);
  }

  // Each version validates in its own `>=` block rather than only in the terminal branch.
  // Folding the newest version into the `=== LATEST` check leaves the one below it verified
  // by nothing on a database that is about to be migrated past it — which is exactly how v6
  // shipped unchecked.
  if (currentVersion === LATEST_DATABASE_VERSION) {
    await validateExpectedSchema(database, EXPECTED_V7_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V7_INDEX_NAMES);
    await assertDatabaseIntegrity(database);
    return;
  }

  const originalCounts = isNewDatabase ? null : await getRawRowCounts(database);
  const backupName = isNewDatabase ? null : await createMigrationBackup(database, currentVersion);

  try {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const step of getSchemaMigrationSteps(currentVersion, isNewDatabase)) {
        for (const statement of step.statements) {
          await transaction.execAsync(statement);
        }
      }
      await transaction.execAsync(`PRAGMA user_version = ${LATEST_DATABASE_VERSION}`);

      if (originalCounts) await assertRawRowCounts(transaction, originalCounts);
      const missingFlights = await transaction.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM sessions s
         LEFT JOIN flights f ON f.recording_session_id = s.id
         WHERE f.id IS NULL`,
      );
      if ((missingFlights?.count ?? 0) !== 0) {
        throw new Error('Recorder database migration did not backfill every session.');
      }
      await assertDatabaseIntegrity(transaction);
    });

    await validateExpectedSchema(database, EXPECTED_V1_TABLE_COLUMNS);
    await validateExpectedSchema(database, EXPECTED_V2_TABLE_COLUMNS);
    await validateExpectedSchema(database, EXPECTED_V3_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V3_INDEX_NAMES);
    await validateExpectedSchema(database, EXPECTED_V4_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V4_INDEX_NAMES);
    await validateExpectedSchema(database, EXPECTED_V5_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V5_INDEX_NAMES);
    await validateExpectedSchema(database, EXPECTED_V6_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V6_INDEX_NAMES);
    await validateExpectedSchema(database, EXPECTED_V7_TABLE_COLUMNS);
    await validateExpectedIndexes(database, EXPECTED_V7_INDEX_NAMES);
    await assertDatabaseIntegrity(database);
    if (backupName) await SQLite.deleteDatabaseAsync(backupName);
  } catch (error) {
    const backupMessage = backupName ? ` Migration backup retained as ${backupName}.` : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${backupMessage}`, { cause: error });
  }
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 10000;
    `);
    await migrateDatabase(database);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

interface SessionRow {
  id: string;
  status: SessionRecord['status'];
  completion_reason: CompletionReason | null;
  started_at: number;
  ended_at: number | null;
  updated_at: number;
  last_fix_at: number | null;
  last_location_callback_at: number | null;
  manual_stop_at: number | null;
  last_pressure_at: number | null;
  location_sequence: number;
  pressure_sequence: number;
  platform: string;
  device_metadata_json: string;
  app_metadata_json: string;
  start_power_json: string;
  end_power_json: string | null;
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    status: row.status,
    completionReason: row.completion_reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    updatedAt: row.updated_at,
    lastFixAt: row.last_fix_at,
    lastLocationCallbackAt: row.last_location_callback_at,
    manualStopAt: row.manual_stop_at,
    lastPressureAt: row.last_pressure_at,
    locationSequence: row.location_sequence,
    pressureSequence: row.pressure_sequence,
    platform: row.platform,
    deviceMetadata: parseJsonObject(row.device_metadata_json),
    appMetadata: parseJsonObject(row.app_metadata_json),
    startPower: parseJsonObject(row.start_power_json) as unknown as PowerReading,
    endPower: row.end_power_json
      ? (parseJsonObject(row.end_power_json) as unknown as PowerReading)
      : null,
  };
}

interface FlightRow {
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
}

interface FlightSummaryRow extends FlightRow {
  session_status: SessionRecord['status'];
}

interface FlightMetricsRow {
  flight_id: string;
  algorithm_version: number;
  duration_ms: number;
  track_distance_metres: number;
  min_gps_altitude: number | null;
  max_gps_altitude: number | null;
  max_ground_speed: number | null;
  fix_count: number;
  median_source_gap_ms: number | null;
  p95_source_gap_ms: number | null;
  max_source_gap_ms: number | null;
  quality: FlightMetricsRecord['quality'];
  computed_at: number;
}

function mapFlight(row: FlightRow): FlightRecord {
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
  };
}

function mapFlightMetrics(row: FlightMetricsRow): FlightMetricsRecord {
  return {
    flightId: row.flight_id,
    algorithmVersion: row.algorithm_version,
    durationMs: row.duration_ms,
    trackDistanceMetres: row.track_distance_metres,
    minGpsAltitude: row.min_gps_altitude,
    maxGpsAltitude: row.max_gps_altitude,
    maxGroundSpeed: row.max_ground_speed,
    fixCount: row.fix_count,
    medianSourceGapMs: row.median_source_gap_ms,
    p95SourceGapMs: row.p95_source_gap_ms,
    maxSourceGapMs: row.max_source_gap_ms,
    quality: row.quality,
    computedAt: row.computed_at,
  };
}

export async function createSession(input: {
  id: string;
  flightId?: string;
  startedAt: number;
  timezoneOffsetMinutes?: number | null;
  platform: string;
  deviceMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
  startPower: PowerReading;
}): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const unfinished = await transaction.getFirstAsync<{ id: string }>(
        `SELECT id FROM sessions WHERE status IN ('recording', 'interrupted') LIMIT 1`,
      );
      if (unfinished) {
        throw new Error(`Session ${unfinished.id} must be resumed or finalized first.`);
      }
      await transaction.runAsync(
        `INSERT INTO sessions (
          id, status, started_at, updated_at, platform, device_metadata_json,
          app_metadata_json, start_power_json
        ) VALUES (?, 'recording', ?, ?, ?, ?, ?, ?)`,
        input.id,
        input.startedAt,
        input.startedAt,
        input.platform,
        JSON.stringify(input.deviceMetadata),
        JSON.stringify(input.appMetadata),
        JSON.stringify(input.startPower),
      );
      await transaction.runAsync(
        `INSERT INTO flights (
          id, recording_session_id, status, started_at, ended_at,
          timezone_offset_minutes, title, site, notes, created_at, updated_at
        ) VALUES (?, ?, 'recording', ?, NULL, ?, NULL, NULL, NULL, ?, ?)`,
        input.flightId ?? input.id,
        input.id,
        input.startedAt,
        input.timezoneOffsetMinutes ?? null,
        input.startedAt,
        input.startedAt,
      );
      await transaction.runAsync(
        `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
         VALUES (?, 'session_armed', ?, ?, ?)`,
        input.id,
        input.startedAt,
        `session-armed:${input.id}`,
        JSON.stringify({ startPower: input.startPower }),
      );
    });
  });
}

export async function createFlightForSession(input: {
  recordingSessionId: string;
  flightId?: string;
  timezoneOffsetMinutes?: number | null;
}): Promise<FlightRecord> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const session = await transaction.getFirstAsync<SessionRow>(
        'SELECT * FROM sessions WHERE id = ?',
        input.recordingSessionId,
      );
      if (!session) throw new Error(`Session ${input.recordingSessionId} was not found.`);

      const existing = await transaction.getFirstAsync<FlightRow>(
        'SELECT * FROM flights WHERE recording_session_id = ?',
        input.recordingSessionId,
      );
      if (existing) {
        if (input.flightId && existing.id !== input.flightId) {
          throw new Error(
            `Session ${input.recordingSessionId} already belongs to flight ${existing.id}.`,
          );
        }
        return;
      }

      await transaction.runAsync(
        `INSERT INTO flights (
          id, recording_session_id, status, started_at, ended_at,
          timezone_offset_minutes, title, site, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        input.flightId ?? input.recordingSessionId,
        input.recordingSessionId,
        flightStatusForSession(session.status, session.completion_reason),
        session.started_at,
        session.ended_at,
        input.timezoneOffsetMinutes ?? null,
        session.started_at,
        session.updated_at,
      );
    });

    const row = await database.getFirstAsync<FlightRow>(
      'SELECT * FROM flights WHERE recording_session_id = ?',
      input.recordingSessionId,
    );
    if (!row) throw new Error(`Flight for session ${input.recordingSessionId} was not created.`);
    return mapFlight(row);
  });
}

export function persistLocationBatch(input: LocationBatchInput) {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    return persistLocationBatchTransaction(database, input);
  });
}

export async function persistPressureSample(input: {
  nativeTimestamp: number;
  receivedAt: number;
  pressure: number;
  relativeAltitude: number | null;
}): Promise<boolean> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    let inserted = false;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const session = await transaction.getFirstAsync<{
        id: string;
        pressure_sequence: number;
      }>(
        `SELECT id, pressure_sequence FROM sessions
         WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1`,
      );
      if (!session) return;
      if (
        !Number.isFinite(input.nativeTimestamp) ||
        !Number.isFinite(input.pressure) ||
        input.pressure <= 0 ||
        (input.relativeAltitude !== null && !Number.isFinite(input.relativeAltitude))
      ) {
        await transaction.runAsync(
          `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
           VALUES (?, 'pressure_rejected', ?, NULL, ?)`,
          session.id,
          input.receivedAt,
          JSON.stringify(input),
        );
        return;
      }
      const sequence = session.pressure_sequence + 1;
      const result = await transaction.runAsync(
        `INSERT OR IGNORE INTO pressure_samples (
          session_id, sequence, native_timestamp, receipt_timestamp, pressure, relative_altitude
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        session.id,
        sequence,
        input.nativeTimestamp,
        input.receivedAt,
        input.pressure,
        input.relativeAltitude,
      );
      if (result.changes !== 1) return;
      inserted = true;
      await transaction.runAsync(
        `UPDATE sessions
         SET pressure_sequence = ?, last_pressure_at = ?, updated_at = ?
         WHERE id = ?`,
        sequence,
        input.receivedAt,
        input.receivedAt,
        session.id,
      );
    });
    return inserted;
  });
}

export async function recordEvent(
  sessionId: string,
  type: string,
  occurredAt: number,
  payload: Record<string, unknown> = {},
  dedupeKey: string | null = null,
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    const insertEvent = async (executor: Pick<SQLite.SQLiteDatabase, 'runAsync'>) => {
      await executor.runAsync(
        `INSERT OR IGNORE INTO events (
          session_id, event_type, occurred_at, dedupe_key, payload_json
        ) VALUES (?, ?, ?, ?, ?)`,
        sessionId,
        type,
        occurredAt,
        dedupeKey,
        JSON.stringify(payload),
      );
    };

    if (type !== 'location_task_error') {
      await insertEvent(database);
      return;
    }

    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE sessions
         SET last_location_callback_at = CASE
               WHEN last_location_callback_at IS NULL OR ? > last_location_callback_at THEN ?
               ELSE last_location_callback_at
             END,
             updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
         WHERE id = ? AND status = 'recording'`,
        occurredAt,
        occurredAt,
        occurredAt,
        occurredAt,
        sessionId,
      );
      await insertEvent(transaction);
    });
  });
}

export async function requestSessionStop(sessionId: string, stoppedAt: number): Promise<number> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    let storedBoundary: number | null = null;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      storedBoundary = await requestSessionStopTransaction(transaction, sessionId, stoppedAt);
    });
    if (storedBoundary === null) throw new Error('The manual stop boundary was not persisted.');
    return storedBoundary;
  });
}

export async function markSessionInterrupted(
  sessionId: string,
  occurredAt: number,
  reason: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const session = await transaction.getFirstAsync<{
        started_at: number;
        manual_stop_at: number | null;
        latest_eligible_fix_source_at: number | null;
      }>(
        `SELECT
           s.started_at,
           s.manual_stop_at,
           (
             SELECT source_timestamp
             FROM location_fixes
             WHERE session_id = s.id
               AND mocked = 0
               AND source_timestamp >= s.started_at
               AND source_timestamp <= ?
             ORDER BY source_timestamp DESC, sequence DESC
             LIMIT 1
           ) AS latest_eligible_fix_source_at
         FROM sessions s
         WHERE s.id = ?`,
        occurredAt,
        sessionId,
      );
      if (!session) throw new Error(`Session ${sessionId} was not found.`);
      const pendingRecoveryAttempt = await transaction.getFirstAsync<{ id: string }>(
        `SELECT id
         FROM session_recovery_attempts
         WHERE session_id = ? AND completed_at IS NULL
         LIMIT 1`,
        sessionId,
      );

      const partialEndAt = resolveInterruptedPartialEndAt(
        session.started_at,
        occurredAt,
        session.latest_eligible_fix_source_at,
      );
      const suppliedManualStopAt = details.manualStopAt;
      const validSuppliedManualStopAt =
        typeof suppliedManualStopAt === 'number' &&
        Number.isFinite(suppliedManualStopAt) &&
        suppliedManualStopAt >= session.started_at &&
        suppliedManualStopAt <= occurredAt
          ? suppliedManualStopAt
          : null;
      if (
        session.manual_stop_at !== null &&
        (!Number.isFinite(session.manual_stop_at) ||
          session.manual_stop_at < session.started_at ||
          session.manual_stop_at > occurredAt)
      ) {
        throw new Error('The stored manual stop boundary is invalid.');
      }
      const manualStopAt = session.manual_stop_at ?? validSuppliedManualStopAt;
      const result = await transaction.runAsync(
        `UPDATE sessions
         SET status = 'interrupted',
             manual_stop_at = COALESCE(manual_stop_at, ?),
             updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
         WHERE id = ? AND status = 'recording'`,
        manualStopAt,
        occurredAt,
        occurredAt,
        sessionId,
      );
      if (result.changes === 1) {
        if (pendingRecoveryAttempt) {
          await transaction.runAsync(
            `UPDATE session_recovery_attempts
             SET completed_at = ?, outcome = 'failed'
             WHERE id = ? AND completed_at IS NULL`,
            occurredAt,
            pendingRecoveryAttempt.id,
          );
        }
        const payloadDetails = { ...details };
        delete payloadDetails.manualStopAt;
        await transaction.runAsync(
          `INSERT OR IGNORE INTO events (
            session_id, event_type, occurred_at, dedupe_key, payload_json
          ) VALUES (?, 'interruption_detected', ?, ?, ?)`,
          sessionId,
          occurredAt,
          null,
          JSON.stringify({
            ...payloadDetails,
            ...(pendingRecoveryAttempt === null
              ? {}
              : { recoveryAttemptId: pendingRecoveryAttempt.id }),
            ...(manualStopAt === null ? {} : { manualStopAt }),
            partialEndAt,
            reason,
          }),
        );
      }
    });
  });
}

export async function beginSessionRecoveryAttempt(
  input: BeginSessionRecoveryAttemptInput,
): Promise<SessionRecoveryAttempt> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    let attempt: SessionRecoveryAttempt | null = null;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      attempt = await beginSessionRecoveryAttemptTransaction(transaction, input);
    });
    if (!attempt) throw new Error('The recovery attempt was not persisted.');
    return attempt;
  });
}

export async function confirmSessionRecoveryAttempt(
  attemptId: string,
  occurredAt: number,
): Promise<SessionRecoveryProof> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    let proof: SessionRecoveryProof | null = null;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      proof = await confirmSessionRecoveryAttemptTransaction(transaction, attemptId, occurredAt);
    });
    if (!proof) throw new Error('The recovery proof was not persisted.');
    return proof;
  });
}

export async function completeSession(
  sessionId: string,
  endedAt: number,
  reason: CompletionReason,
  endPower: PowerReading,
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const session = await transaction.getFirstAsync<{
        status: SessionRecord['status'];
        started_at: number;
        manual_stop_at: number | null;
      }>(
        'SELECT status, started_at, manual_stop_at FROM sessions WHERE id = ?',
        sessionId,
      );
      if (!session) throw new Error(`Session ${sessionId} was not found.`);
      if (session.status === 'completed') return;
      const completedAt = resolveSessionCompletionTimestamp(
        session.started_at,
        endedAt,
        session.manual_stop_at,
        reason,
      );
      await transaction.runAsync(
        `UPDATE session_recovery_attempts
         SET completed_at = ?, outcome = ?
         WHERE session_id = ? AND completed_at IS NULL`,
        completedAt,
        reason === 'stopped' ? 'stopped' : 'failed',
        sessionId,
      );
      await transaction.runAsync(
        COMPLETE_SESSION_SQL,
        reason,
        completedAt,
        completedAt,
        JSON.stringify(endPower),
        sessionId,
      );
      await transaction.runAsync(
        `UPDATE flights
         SET status = 'processing', ended_at = ?, updated_at = ?
         WHERE recording_session_id = ?`,
        completedAt,
        completedAt,
        sessionId,
      );
      await transaction.runAsync(
        `INSERT OR IGNORE INTO events (
          session_id, event_type, occurred_at, dedupe_key, payload_json
        ) VALUES (?, 'session_completed', ?, ?, ?)`,
        sessionId,
        completedAt,
        `session-completed:${sessionId}`,
        JSON.stringify({
          reason,
          endPower,
          ...(session.manual_stop_at === null ? {} : { manualStopAt: session.manual_stop_at }),
        }),
      );
    });
  });
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE id = ?',
    sessionId,
  );
  return row ? mapSession(row) : null;
}

export async function getUnfinishedSession(): Promise<SessionRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions
     WHERE status IN ('recording', 'interrupted')
     ORDER BY started_at DESC LIMIT 1`,
  );
  return row ? mapSession(row) : null;
}

export async function getPendingSessionStop(): Promise<PendingSessionStop | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<{
    session_id: string;
    stopped_at: number;
    started_at: number;
  }>(
    PENDING_SESSION_STOP_SQL,
  );
  if (!row) return null;
  if (!Number.isFinite(row.stopped_at) || row.stopped_at < row.started_at) {
    throw new Error(`Session ${row.session_id} has an invalid manual stop boundary.`);
  }
  return { sessionId: row.session_id, stoppedAt: row.stopped_at };
}

export async function getPendingSessionRecoveryAttempt(
  sessionId: string,
): Promise<PendingSessionRecoveryAttempt | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SessionRecoveryAttemptProofRow>(
    PENDING_SESSION_RECOVERY_ATTEMPT_SQL,
    sessionId,
  );
  return mapPendingSessionRecoveryAttemptRow(row);
}

export async function getFinalSessionRecoveryAttempt(
  attemptId: string,
): Promise<PendingSessionRecoveryAttempt | null> {
  // A deadline check must observe every callback write already accepted by the
  // recorder queue before deciding that no in-window proving fix exists.
  return enqueueWrite(async () => {
    const database = await openDatabase();
    const row = await database.getFirstAsync<SessionRecoveryAttemptProofRow>(
      SESSION_RECOVERY_ATTEMPT_BY_ID_SQL,
      attemptId,
    );
    return mapPendingSessionRecoveryAttemptRow(row);
  });
}

export async function getLatestSession(): Promise<SessionRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1',
  );
  return row ? mapSession(row) : null;
}

export async function getFlight(flightId: string): Promise<FlightRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<FlightRow>('SELECT * FROM flights WHERE id = ?', flightId);
  return row ? mapFlight(row) : null;
}

export async function getFlightBySessionId(sessionId: string): Promise<FlightRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<FlightRow>(
    'SELECT * FROM flights WHERE recording_session_id = ?',
    sessionId,
  );
  return row ? mapFlight(row) : null;
}

export async function getFlightMetrics(
  flightId: string,
): Promise<FlightMetricsRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<FlightMetricsRow>(
    'SELECT * FROM flight_metrics WHERE flight_id = ?',
    flightId,
  );
  return row ? mapFlightMetrics(row) : null;
}

/**
 * The stored track row, as strings.
 *
 * Encoding and decoding deliberately happen a layer up, in `flight-repository.native.ts`.
 * This module is reachable from the headless location task's import graph, and keeping it
 * ignorant of `@/lib/track` is what stops the drawing code being evaluated in a GPS callback.
 */
export interface FlightTrackRow {
  flight_id: string;
  segments: string;
  algorithm_version: number;
  computed_at: number;
}

export async function getFlightTrackRow(flightId: string): Promise<FlightTrackRow | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<FlightTrackRow>(
    'SELECT * FROM flight_tracks WHERE flight_id = ?',
    flightId,
  );
  return row ?? null;
}

/**
 * Every stored track in one read.
 *
 * One query for the whole logbook rather than a hook per card: the list screen already
 * mounts every card at once, and a per-card read would turn one scan of small rows into N
 * round trips through the write queue.
 */
export async function listFlightTrackRows(): Promise<FlightTrackRow[]> {
  const database = await openDatabase();
  return database.getAllAsync<FlightTrackRow>('SELECT * FROM flight_tracks');
}

export async function upsertFlightTrack(row: FlightTrackRow): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      `INSERT INTO flight_tracks (flight_id, segments, algorithm_version, computed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(flight_id) DO UPDATE SET
         segments = excluded.segments,
         algorithm_version = excluded.algorithm_version,
         computed_at = excluded.computed_at`,
      row.flight_id,
      row.segments,
      row.algorithm_version,
      row.computed_at,
    );
  });
}

/** Just the columns a track needs, in recorded order. */
export interface TrackFixRow {
  source_timestamp: number;
  sequence: number;
  latitude: number;
  longitude: number;
  mocked: number;
}

/**
 * Coordinates and nothing else, for re-deriving a track.
 *
 * The only read in the app that wants position without the rest of the evidence.
 * `getSessionExportData` would do the job, but it pulls all fifteen columns of every fix
 * plus every pressure sample and every event — a heavyweight export path, invoked on
 * explicit user action, and far too much to pay for redrawing one plate.
 *
 * `location_fixes_source_order` satisfies the ordering, so there is no temp B-tree sort. It
 * is not a covering index and should not be widened into one: ~10 800 rows of extra index
 * per flight is a large permanent cost for a read that happens once.
 */
export async function listSessionTrackFixes(sessionId: string): Promise<TrackFixRow[]> {
  const database = await openDatabase();
  return database.getAllAsync<TrackFixRow>(
    `SELECT source_timestamp, sequence, latitude, longitude, mocked
     FROM location_fixes
     WHERE session_id = ?
     ORDER BY source_timestamp, sequence`,
    sessionId,
  );
}

export async function getFlightReplay(flightId: string) {
  return readFlightReplay(await openDatabase(), flightId);
}

export async function listFlights(): Promise<FlightSummary[]> {
  const database = await openDatabase();
  const [flightRows, metricRows] = await Promise.all([
    database.getAllAsync<FlightSummaryRow>(
      `SELECT f.*, s.status AS session_status
       FROM flights f
       JOIN sessions s ON s.id = f.recording_session_id
       ORDER BY f.started_at DESC, f.id DESC`,
    ),
    database.getAllAsync<FlightMetricsRow>('SELECT * FROM flight_metrics'),
  ]);
  const metrics = new Map(
    metricRows.map((row) => {
      const mapped = mapFlightMetrics(row);
      return [mapped.flightId, mapped] as const;
    }),
  );
  return flightRows.map((row) => {
    const flight = mapFlight(row);
    return {
      ...flight,
      sessionStatus: row.session_status,
      metrics: metrics.get(flight.id) ?? null,
    };
  });
}

export async function getFlightDetail(flightId: string): Promise<FlightDetail | null> {
  const database = await openDatabase();
  const flightRow = await database.getFirstAsync<FlightRow>(
    'SELECT * FROM flights WHERE id = ?',
    flightId,
  );
  if (!flightRow) return null;

  const [metricRow, sessionRow] = await Promise.all([
    database.getFirstAsync<FlightMetricsRow>(
      'SELECT * FROM flight_metrics WHERE flight_id = ?',
      flightId,
    ),
    database.getFirstAsync<SessionRow>(
      'SELECT * FROM sessions WHERE id = ?',
      flightRow.recording_session_id,
    ),
  ]);
  if (!sessionRow) {
    throw new Error(`Session ${flightRow.recording_session_id} for flight ${flightId} was not found.`);
  }
  return {
    ...mapFlight(flightRow),
    sessionStatus: sessionRow.status,
    metrics: metricRow ? mapFlightMetrics(metricRow) : null,
    session: mapSession(sessionRow),
  };
}

export async function updateFlightMetadata(
  flightId: string,
  patch: FlightMetadataPatch,
  updatedAt = Date.now(),
): Promise<FlightRecord> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    const normalized = normalizeFlightMetadataPatch(patch);
    const assignments: string[] = [];
    const params: (string | number | null)[] = [];
    for (const field of ['title', 'site', 'notes'] as const) {
      if (!Object.prototype.hasOwnProperty.call(normalized, field)) continue;
      assignments.push(`${field} = ?`);
      params.push(normalized[field] ?? null);
    }
    // Provenance rides with the name, never on its own. Clearing the site clears it too:
    // a flight with no name has nothing to have a source for, and leaving a stale
    // 'picked' behind would later be read as "this name came from a site database".
    if (Object.prototype.hasOwnProperty.call(normalized, 'site')) {
      assignments.push('site_source = ?');
      params.push(normalized.site === null ? null : (normalized.siteSource ?? 'manual'));
    }

    if (assignments.length > 0) {
      const result = await database.runAsync(
        `UPDATE flights SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`,
        ...params,
        updatedAt,
        flightId,
      );
      if (result.changes !== 1) throw new Error(`Flight ${flightId} was not found.`);
    }

    const row = await database.getFirstAsync<FlightRow>('SELECT * FROM flights WHERE id = ?', flightId);
    if (!row) throw new Error(`Flight ${flightId} was not found.`);
    return mapFlight(row);
  });
}

export async function upsertFlightMetrics(metrics: FlightMetricsRecord): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      `INSERT INTO flight_metrics (
        flight_id, algorithm_version, duration_ms, track_distance_metres,
        min_gps_altitude, max_gps_altitude, max_ground_speed, fix_count,
        median_source_gap_ms, p95_source_gap_ms, max_source_gap_ms, quality, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(flight_id) DO UPDATE SET
        algorithm_version = excluded.algorithm_version,
        duration_ms = excluded.duration_ms,
        track_distance_metres = excluded.track_distance_metres,
        min_gps_altitude = excluded.min_gps_altitude,
        max_gps_altitude = excluded.max_gps_altitude,
        max_ground_speed = excluded.max_ground_speed,
        fix_count = excluded.fix_count,
        median_source_gap_ms = excluded.median_source_gap_ms,
        p95_source_gap_ms = excluded.p95_source_gap_ms,
        max_source_gap_ms = excluded.max_source_gap_ms,
        quality = excluded.quality,
        computed_at = excluded.computed_at`,
      metrics.flightId,
      metrics.algorithmVersion,
      metrics.durationMs,
      metrics.trackDistanceMetres,
      metrics.minGpsAltitude,
      metrics.maxGpsAltitude,
      metrics.maxGroundSpeed,
      metrics.fixCount,
      metrics.medianSourceGapMs,
      metrics.p95SourceGapMs,
      metrics.maxSourceGapMs,
      metrics.quality,
      metrics.computedAt,
    );
  });
}

/**
 * Denormalises where the flight actually launched from.
 *
 * Written once at finalize rather than derived on demand: naming a launch weeks later
 * would otherwise mean re-reading every fix of that flight, and the coordinate never
 * changes once the session is closed.
 *
 * Idempotent, and deliberately not part of `setFlightStatus` — a re-finalize (a metrics
 * algorithm bump, a repaired `processing` flight) must not disturb `updated_at` here,
 * because that is what marks a flight dirty for backup.
 */
export async function setFlightTakeoff(input: {
  flightId: string;
  latitude: number;
  longitude: number;
}): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      'UPDATE flights SET takeoff_latitude = ?, takeoff_longitude = ? WHERE id = ?',
      input.latitude,
      input.longitude,
      input.flightId,
    );
  });
}

export async function setFlightStatus(input: {
  flightId: string;
  status: FlightStatus;
  updatedAt: number;
  endedAt?: number | null;
}): Promise<FlightRecord> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    const shouldUpdateEndedAt = Object.prototype.hasOwnProperty.call(input, 'endedAt');
    const result = shouldUpdateEndedAt
      ? await database.runAsync(
          'UPDATE flights SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?',
          input.status,
          input.endedAt ?? null,
          input.updatedAt,
          input.flightId,
        )
      : await database.runAsync(
          'UPDATE flights SET status = ?, updated_at = ? WHERE id = ?',
          input.status,
          input.updatedAt,
          input.flightId,
        );
    if (result.changes !== 1) throw new Error(`Flight ${input.flightId} was not found.`);

    const row = await database.getFirstAsync<FlightRow>(
      'SELECT * FROM flights WHERE id = ?',
      input.flightId,
    );
    if (!row) throw new Error(`Flight ${input.flightId} was not found.`);
    return mapFlight(row);
  });
}

export async function deleteCompletedFlight(
  flightId: string,
  deletedAt = Date.now(),
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<{
        recording_session_id: string;
        flight_status: FlightStatus;
        session_status: SessionRecord['status'];
      }>(
        `SELECT
           f.recording_session_id,
           f.status AS flight_status,
           s.status AS session_status
         FROM flights f
         JOIN sessions s ON s.id = f.recording_session_id
         WHERE f.id = ?`,
        flightId,
      );
      if (!row) throw new Error(`Flight ${flightId} was not found.`);
      if (
        !['completed', 'partial'].includes(row.flight_status) ||
        row.session_status !== 'completed'
      ) {
        throw new Error(`Flight ${flightId} is active or unfinished and cannot be deleted.`);
      }

      await transaction.runAsync(
        `INSERT OR IGNORE INTO pending_file_deletions (path, created_at)
         SELECT path, ? FROM exports WHERE session_id = ?`,
        deletedAt,
        row.recording_session_id,
      );
      await transaction.runAsync('DELETE FROM exports WHERE session_id = ?', row.recording_session_id);
      await transaction.runAsync('DELETE FROM events WHERE session_id = ?', row.recording_session_id);
      await transaction.runAsync(
        'DELETE FROM pressure_samples WHERE session_id = ?',
        row.recording_session_id,
      );
      // Recovery attempts can reference their exact proving location fix, so they
      // must be removed before the raw fixes under the RESTRICT foreign keys.
      await transaction.runAsync(
        'DELETE FROM session_recovery_attempts WHERE session_id = ?',
        row.recording_session_id,
      );
      await transaction.runAsync(
        'DELETE FROM location_fixes WHERE session_id = ?',
        row.recording_session_id,
      );
      await transaction.runAsync('DELETE FROM flight_metrics WHERE flight_id = ?', flightId);
      // Same RESTRICT foreign key as flight_metrics, so it has to go before flights.
      await transaction.runAsync('DELETE FROM flight_tracks WHERE flight_id = ?', flightId);
      // Tombstone before the row disappears, so a later sync can push the delete
      // instead of the next pull resurrecting the flight from the server. The sync
      // state row holds a RESTRICT foreign key, so it must go before flights.
      await transaction.runAsync(
        `INSERT OR IGNORE INTO flight_deletions (flight_id, recording_session_id, deleted_at)
         VALUES (?, ?, ?)`,
        flightId,
        row.recording_session_id,
        deletedAt,
      );
      await transaction.runAsync('DELETE FROM flight_sync_state WHERE flight_id = ?', flightId);
      await transaction.runAsync('DELETE FROM flights WHERE id = ?', flightId);
      await transaction.runAsync('DELETE FROM sessions WHERE id = ?', row.recording_session_id);
    });
  });
}

export async function listPendingFileDeletions(): Promise<string[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<{ path: string }>(
    'SELECT path FROM pending_file_deletions ORDER BY created_at, path',
  );
  return rows.map((row) => row.path);
}

export async function completePendingFileDeletion(path: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync('DELETE FROM pending_file_deletions WHERE path = ?', path);
  });
}

export interface SessionSnapshotMetrics {
  fixCount: number;
  pressureCount: number;
  gpsAltitude: number | null;
  speed: number | null;
  horizontalAccuracy: number | null;
  pressure: number | null;
  taskErrorMessage: string | null;
  taskErrorAt: number | null;
  lastLocationCallbackAt: number | null;
  latestEligibleFixSourceAt: number | null;
  latestEligibleFixReceiptAt: number | null;
}

export interface SnapshotMetricsRow {
  fix_count: number;
  pressure_count: number;
  gps_altitude: number | null;
  speed: number | null;
  horizontal_accuracy: number | null;
  pressure: number | null;
  task_error_json: string | null;
  task_error_at: number | null;
  last_location_callback_at: number | null;
  latest_eligible_fix_source_at: number | null;
  latest_eligible_fix_receipt_at: number | null;
}

export const SESSION_SNAPSHOT_METRICS_SQL = `SELECT
  (SELECT COUNT(*) FROM location_fixes WHERE session_id = s.id) AS fix_count,
  (SELECT COUNT(*) FROM pressure_samples WHERE session_id = s.id) AS pressure_count,
  (SELECT gps_altitude FROM location_fixes WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS gps_altitude,
  (SELECT speed FROM location_fixes WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS speed,
  (SELECT horizontal_accuracy FROM location_fixes WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS horizontal_accuracy,
  (SELECT pressure FROM pressure_samples WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS pressure,
  (SELECT payload_json FROM events WHERE session_id = s.id AND event_type = 'location_task_error' ORDER BY occurred_at DESC, id DESC LIMIT 1) AS task_error_json,
  (SELECT occurred_at FROM events WHERE session_id = s.id AND event_type = 'location_task_error' ORDER BY occurred_at DESC, id DESC LIMIT 1) AS task_error_at,
  s.last_location_callback_at,
  eligible.source_timestamp AS latest_eligible_fix_source_at,
  eligible.receipt_timestamp AS latest_eligible_fix_receipt_at
FROM sessions s
LEFT JOIN location_fixes eligible ON eligible.id = (
  SELECT id
  FROM location_fixes INDEXED BY location_fixes_eligible_receipt_order
  WHERE session_id = s.id
    AND mocked = 0
    AND source_timestamp >= s.started_at
  ORDER BY receipt_timestamp DESC, sequence DESC
  LIMIT 1
)
WHERE s.id = ?`;

export function mapSessionSnapshotMetrics(
  row: SnapshotMetricsRow | null,
): SessionSnapshotMetrics {
  return {
    fixCount: row?.fix_count ?? 0,
    pressureCount: row?.pressure_count ?? 0,
    gpsAltitude: row?.gps_altitude ?? null,
    speed: row?.speed ?? null,
    horizontalAccuracy: row?.horizontal_accuracy ?? null,
    pressure: row?.pressure ?? null,
    taskErrorMessage: row?.task_error_json
      ? String(parseJsonObject(row.task_error_json).message ?? 'The location task reported an error.')
      : null,
    taskErrorAt: row?.task_error_at ?? null,
    lastLocationCallbackAt: row?.last_location_callback_at ?? null,
    latestEligibleFixSourceAt: row?.latest_eligible_fix_source_at ?? null,
    latestEligibleFixReceiptAt: row?.latest_eligible_fix_receipt_at ?? null,
  };
}

export async function getSessionSnapshotMetrics(
  sessionId: string,
): Promise<SessionSnapshotMetrics> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SnapshotMetricsRow>(
    SESSION_SNAPSHOT_METRICS_SQL,
    sessionId,
  );
  return mapSessionSnapshotMetrics(row);
}

interface LocationRow {
  session_id: string;
  sequence: number;
  callback_id: string;
  batch_index: number;
  source_timestamp: number;
  receipt_timestamp: number;
  latitude: number;
  longitude: number;
  gps_altitude: number | null;
  vertical_accuracy: number | null;
  horizontal_accuracy: number | null;
  speed: number | null;
  heading: number | null;
  mocked: number;
}

function mapLocation(row: LocationRow): LocationFixRecord {
  return {
    sessionId: row.session_id,
    sequence: row.sequence,
    callbackId: row.callback_id,
    batchIndex: row.batch_index,
    sourceTimestamp: row.source_timestamp,
    receiptTimestamp: row.receipt_timestamp,
    latitude: row.latitude,
    longitude: row.longitude,
    gpsAltitude: row.gps_altitude,
    verticalAccuracy: row.vertical_accuracy,
    horizontalAccuracy: row.horizontal_accuracy,
    speed: row.speed,
    heading: row.heading,
    mocked: row.mocked === 1,
  };
}

interface PressureRow {
  session_id: string;
  sequence: number;
  native_timestamp: number;
  receipt_timestamp: number;
  pressure: number;
  relative_altitude: number | null;
}

function mapPressure(row: PressureRow): PressureSampleRecord {
  return {
    sessionId: row.session_id,
    sequence: row.sequence,
    nativeTimestamp: row.native_timestamp,
    receiptTimestamp: row.receipt_timestamp,
    pressure: row.pressure,
    relativeAltitude: row.relative_altitude,
  };
}

interface EventRow {
  id: number;
  session_id: string;
  event_type: string;
  occurred_at: number;
  payload_json: string;
}

function mapEvent(row: EventRow): RecorderEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.event_type,
    occurredAt: row.occurred_at,
    payload: parseJsonObject(row.payload_json),
  };
}

export async function getSessionExportData(sessionId: string): Promise<SessionExportData> {
  const database = await openDatabase();
  const [session, locations, pressureSamples, events] = await Promise.all([
    getSession(sessionId),
    database.getAllAsync<LocationRow>(
      `SELECT * FROM location_fixes
       WHERE session_id = ? ORDER BY source_timestamp, sequence`,
      sessionId,
    ),
    database.getAllAsync<PressureRow>(
      `SELECT * FROM pressure_samples
       WHERE session_id = ? ORDER BY receipt_timestamp, sequence`,
      sessionId,
    ),
    database.getAllAsync<EventRow>(
      `SELECT * FROM events WHERE session_id = ? ORDER BY occurred_at, id`,
      sessionId,
    ),
  ]);
  if (!session) throw new Error(`Session ${sessionId} was not found.`);
  return {
    session,
    locations: locations.map(mapLocation),
    pressureSamples: pressureSamples.map(mapPressure),
    events: events.map(mapEvent),
  };
}

export async function recordExport(
  artifact: ExportArtifact,
  artifactVersion: number,
  createdAt: number,
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO exports (
        session_id, kind, artifact_version, path, sha256, byte_count,
        eligible_fix_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      artifact.sessionId,
      artifact.kind,
      artifactVersion,
      artifact.uri,
      artifact.sha256,
      artifact.byteCount,
      artifact.eligibleFixCount,
      createdAt,
    );
  });
}

// ---------------------------------------------------------------------------
// Cloud backup bookkeeping (schema v5)
//
// Every write below goes through enqueueWrite, so it can never interleave inside a
// recorder transaction. None of them touch sessions, location_fixes, pressure_samples,
// events, exports or session_recovery_attempts — cloud backup observes the recorder's
// output, it never participates in capture.
// ---------------------------------------------------------------------------

export async function getPilotProfile(): Promise<PilotProfile> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<PilotProfileRow>(PILOT_PROFILE_SQL);
  return row ? mapPilotProfile(row) : EMPTY_PILOT_PROFILE;
}

export async function updatePilotProfile(
  patch: PilotProfilePatch,
  updatedAt = Date.now(),
): Promise<PilotProfile> {
  const normalized = normalizePilotProfilePatch(patch);
  return enqueueWrite(async () => {
    const database = await openDatabase();
    if (Object.keys(normalized).length > 0) {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await updatePilotProfileTransaction(transaction, normalized, updatedAt);
      });
    }
    const row = await database.getFirstAsync<PilotProfileRow>(PILOT_PROFILE_SQL);
    return row ? mapPilotProfile(row) : EMPTY_PILOT_PROFILE;
  });
}

export async function getAppSettings(): Promise<AppSettings> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<AppSettingsRow>(APP_SETTINGS_SQL);
  return row ? mapAppSettings(row) : EMPTY_APP_SETTINGS;
}

export async function updateAppSettings(
  patch: AppSettingsPatch,
  updatedAt = Date.now(),
): Promise<AppSettings> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await updateAppSettingsTransaction(transaction, patch, updatedAt);
    });
    const row = await database.getFirstAsync<AppSettingsRow>(APP_SETTINGS_SQL);
    return row ? mapAppSettings(row) : EMPTY_APP_SETTINGS;
  });
}

export async function markPilotProfilePushed(updatedAt: number): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(MARK_PILOT_PROFILE_PUSHED_SQL, updatedAt);
  });
}

export async function getCloudLink(): Promise<CloudLink> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<CloudLinkRow>(CLOUD_LINK_SQL);
  return row ? mapCloudLink(row) : EMPTY_CLOUD_LINK;
}

/**
 * Claims this device's logbook for an account, but only if it is unclaimed. A device
 * already bound elsewhere is left alone so the caller can surface the mismatch rather
 * than silently uploading one pilot's flights into another pilot's account.
 */
export async function bindCloudLink(userId: string, linkedAt = Date.now()): Promise<CloudLink> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(BIND_CLOUD_LINK_SQL, userId, linkedAt);
    const row = await database.getFirstAsync<CloudLinkRow>(CLOUD_LINK_SQL);
    return row ? mapCloudLink(row) : EMPTY_CLOUD_LINK;
  });
}

/** Rebinds to a different account, or unbinds with `null`. Never touches local flights. */
export async function resetCloudLink(
  userId: string | null,
  resetAt = Date.now(),
): Promise<CloudLink> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await resetCloudLinkTransaction(transaction, userId, resetAt);
    });
    const row = await database.getFirstAsync<CloudLinkRow>(CLOUD_LINK_SQL);
    return row ? mapCloudLink(row) : EMPTY_CLOUD_LINK;
  });
}

export interface CloudCursorPatch {
  flightsCursor?: string | null;
  profileCursor?: string | null;
  lastSyncAt?: number | null;
  lastSyncError?: string | null;
  cloudOnlyFlightCount?: number;
}

const CLOUD_CURSOR_COLUMNS: Readonly<Record<keyof CloudCursorPatch, string>> = Object.freeze({
  flightsCursor: 'flights_cursor',
  profileCursor: 'profile_cursor',
  lastSyncAt: 'last_sync_at',
  lastSyncError: 'last_sync_error',
  cloudOnlyFlightCount: 'cloud_only_flight_count',
});

export async function setCloudCursors(patch: CloudCursorPatch): Promise<void> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [field, column] of Object.entries(CLOUD_CURSOR_COLUMNS) as [
    keyof CloudCursorPatch,
    string,
  ][]) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    assignments.push(`${column} = ?`);
    params.push(patch[field] ?? null);
  }
  if (assignments.length === 0) return;
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      `UPDATE cloud_link SET ${assignments.join(', ')} WHERE id = 1`,
      ...params,
    );
  });
}

export async function listDirtyFlights(
  limit: number,
  now = Date.now(),
): Promise<FlightSyncCandidate[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<FlightSyncCandidateRow>(DIRTY_FLIGHTS_SQL, now, limit);
  return rows.map(mapFlightSyncCandidate);
}

export async function countPendingSync(): Promise<{ flights: number; deletions: number }> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<{ flights: number; deletions: number }>(
    COUNT_PENDING_SYNC_SQL,
  );
  return { flights: row?.flights ?? 0, deletions: row?.deletions ?? 0 };
}

export async function markFlightPushed(input: {
  flightId: string;
  pushedUpdatedAt: number;
  remoteUpdatedAt: string;
}): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      MARK_FLIGHT_PUSHED_SQL,
      input.flightId,
      input.pushedUpdatedAt,
      input.remoteUpdatedAt,
    );
  });
}

export async function markFlightIgcPushed(input: {
  flightId: string;
  sha256: string;
  objectPath: string;
  pushedAt: number;
}): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(
      MARK_FLIGHT_IGC_PUSHED_SQL,
      input.sha256,
      input.objectPath,
      input.pushedAt,
      input.flightId,
    );
  });
}

export async function recordFlightSyncFailure(
  flightId: string,
  error: string,
  nextAttemptAt: number,
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(RECORD_FLIGHT_SYNC_FAILURE_SQL, flightId, nextAttemptAt, error);
  });
}

export async function listPendingFlightDeletions(
  limit: number,
  now = Date.now(),
): Promise<FlightDeletionRecord[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<FlightDeletionRow>(
    PENDING_FLIGHT_DELETIONS_SQL,
    now,
    limit,
  );
  return rows.map(mapFlightDeletion);
}

export async function clearFlightDeletion(flightId: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync('DELETE FROM flight_deletions WHERE flight_id = ?', flightId);
  });
}

export async function recordFlightDeletionFailure(
  flightId: string,
  error: string,
  nextAttemptAt: number,
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.runAsync(RECORD_FLIGHT_DELETION_FAILURE_SQL, nextAttemptAt, error, flightId);
  });
}

/** Applies a remote metadata edit under last-write-wins. See `RemoteMetadataOutcome`. */
export async function applyRemoteFlightMetadata(
  remote: RemoteFlightMetadata,
  remoteUpdatedAt: string,
): Promise<RemoteMetadataOutcome> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    let outcome: RemoteMetadataOutcome = 'missing';
    await database.withExclusiveTransactionAsync(async (transaction) => {
      outcome = await applyRemoteFlightMetadataTransaction(transaction, remote, remoteUpdatedAt);
    });
    return outcome;
  });
}
