import * as SQLite from 'expo-sqlite';

import { persistLocationBatchTransaction, type LocationBatchInput } from './repository-core';
import type {
  CompletionReason,
  ExportArtifact,
  LocationFixRecord,
  PowerReading,
  PressureSampleRecord,
  RecorderEventRecord,
  SessionExportData,
  SessionRecord,
} from './types';

const DATABASE_NAME = 'xc-recorder.db';

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

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 10000;

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('recording', 'interrupted', 'completed')),
          completion_reason TEXT,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          updated_at INTEGER NOT NULL,
          last_fix_at INTEGER,
          last_pressure_at INTEGER,
          location_sequence INTEGER NOT NULL DEFAULT 0,
          pressure_sequence INTEGER NOT NULL DEFAULT 0,
          platform TEXT NOT NULL,
          device_metadata_json TEXT NOT NULL,
          app_metadata_json TEXT NOT NULL,
          start_power_json TEXT NOT NULL,
          end_power_json TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_session
          ON sessions ((1))
          WHERE status IN ('recording', 'interrupted');

        CREATE TABLE IF NOT EXISTS location_fixes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
          sequence INTEGER NOT NULL,
          callback_id TEXT NOT NULL,
          batch_index INTEGER NOT NULL,
          source_timestamp INTEGER NOT NULL,
          receipt_timestamp INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          gps_altitude REAL,
          vertical_accuracy REAL,
          horizontal_accuracy REAL,
          speed REAL,
          heading REAL,
          mocked INTEGER NOT NULL DEFAULT 0,
          UNIQUE (session_id, sequence),
          UNIQUE (session_id, callback_id, batch_index),
          UNIQUE (session_id, source_timestamp, latitude, longitude)
        );

        CREATE INDEX IF NOT EXISTS location_fixes_source_order
          ON location_fixes (session_id, source_timestamp, sequence);

        CREATE TABLE IF NOT EXISTS pressure_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
          sequence INTEGER NOT NULL,
          native_timestamp REAL NOT NULL,
          receipt_timestamp INTEGER NOT NULL,
          pressure REAL NOT NULL,
          relative_altitude REAL,
          UNIQUE (session_id, sequence),
          UNIQUE (session_id, native_timestamp, pressure)
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
          event_type TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          dedupe_key TEXT UNIQUE,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS events_session_order
          ON events (session_id, occurred_at, id);

        CREATE TABLE IF NOT EXISTS exports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
          kind TEXT NOT NULL CHECK (kind IN ('igc', 'diagnostics')),
          artifact_version INTEGER NOT NULL,
          path TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          byte_count INTEGER NOT NULL,
          eligible_fix_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE (session_id, kind, artifact_version, sha256)
        );
      `);
      return database;
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

export async function createSession(input: {
  id: string;
  startedAt: number;
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
    await database.runAsync(
      `INSERT OR IGNORE INTO events (
        session_id, event_type, occurred_at, dedupe_key, payload_json
      ) VALUES (?, ?, ?, ?, ?)`,
      sessionId,
      type,
      occurredAt,
      dedupeKey,
      JSON.stringify(payload),
    );
  });
}

export async function markSessionInterrupted(
  sessionId: string,
  occurredAt: number,
  reason: string,
): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE sessions SET status = 'interrupted', updated_at = ?
         WHERE id = ? AND status = 'recording'`,
        occurredAt,
        sessionId,
      );
      if (result.changes === 1) {
        await transaction.runAsync(
          `INSERT OR IGNORE INTO events (
            session_id, event_type, occurred_at, dedupe_key, payload_json
          ) VALUES (?, 'interruption_detected', ?, ?, ?)`,
          sessionId,
          occurredAt,
          null,
          JSON.stringify({ reason }),
        );
      }
    });
  });
}

export async function markSessionResumed(sessionId: string, occurredAt: number): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const session = await transaction.getFirstAsync<{ status: SessionRecord['status'] }>(
        'SELECT status FROM sessions WHERE id = ?',
        sessionId,
      );
      if (!session) throw new Error(`Session ${sessionId} was not found.`);
      if (session.status === 'recording') return;
      if (session.status === 'completed') throw new Error('A completed session cannot be resumed.');
      await transaction.runAsync(
        `UPDATE sessions SET status = 'recording', updated_at = ? WHERE id = ?`,
        occurredAt,
        sessionId,
      );
      await transaction.runAsync(
        `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
         VALUES (?, 'session_resumed', ?, NULL, '{}')`,
        sessionId,
        occurredAt,
      );
    });
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
      const session = await transaction.getFirstAsync<{ status: SessionRecord['status'] }>(
        'SELECT status FROM sessions WHERE id = ?',
        sessionId,
      );
      if (!session) throw new Error(`Session ${sessionId} was not found.`);
      if (session.status === 'completed') return;
      await transaction.runAsync(
        `UPDATE sessions
         SET status = 'completed', completion_reason = ?, ended_at = ?, updated_at = ?,
             end_power_json = ?
         WHERE id = ?`,
        reason,
        endedAt,
        endedAt,
        JSON.stringify(endPower),
        sessionId,
      );
      await transaction.runAsync(
        `INSERT OR IGNORE INTO events (
          session_id, event_type, occurred_at, dedupe_key, payload_json
        ) VALUES (?, 'session_completed', ?, ?, ?)`,
        sessionId,
        endedAt,
        `session-completed:${sessionId}`,
        JSON.stringify({ reason, endPower }),
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

export async function getLatestSession(): Promise<SessionRecord | null> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1',
  );
  return row ? mapSession(row) : null;
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
}

interface SnapshotMetricsRow {
  fix_count: number;
  pressure_count: number;
  gps_altitude: number | null;
  speed: number | null;
  horizontal_accuracy: number | null;
  pressure: number | null;
  task_error_json: string | null;
  task_error_at: number | null;
}

export async function getSessionSnapshotMetrics(
  sessionId: string,
): Promise<SessionSnapshotMetrics> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<SnapshotMetricsRow>(
    `SELECT
       (SELECT COUNT(*) FROM location_fixes WHERE session_id = s.id) AS fix_count,
       (SELECT COUNT(*) FROM pressure_samples WHERE session_id = s.id) AS pressure_count,
       (SELECT gps_altitude FROM location_fixes WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS gps_altitude,
       (SELECT speed FROM location_fixes WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS speed,
       (SELECT horizontal_accuracy FROM location_fixes WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS horizontal_accuracy,
       (SELECT pressure FROM pressure_samples WHERE session_id = s.id ORDER BY sequence DESC LIMIT 1) AS pressure,
       (SELECT payload_json FROM events WHERE session_id = s.id AND event_type = 'location_task_error' ORDER BY occurred_at DESC, id DESC LIMIT 1) AS task_error_json,
       (SELECT occurred_at FROM events WHERE session_id = s.id AND event_type = 'location_task_error' ORDER BY occurred_at DESC, id DESC LIMIT 1) AS task_error_at
     FROM sessions s WHERE s.id = ?`,
    sessionId,
  );
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
  };
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
