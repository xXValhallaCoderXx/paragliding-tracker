import type {
  CompletionReason,
  FlightMetadataPatch,
  FlightStatus,
  SessionRecord,
} from './types';

export const LATEST_DATABASE_VERSION = 4;

export const EXPECTED_V1_TABLE_COLUMNS = Object.freeze({
  sessions: [
    'id',
    'status',
    'completion_reason',
    'started_at',
    'ended_at',
    'updated_at',
    'last_fix_at',
    'last_pressure_at',
    'location_sequence',
    'pressure_sequence',
    'platform',
    'device_metadata_json',
    'app_metadata_json',
    'start_power_json',
    'end_power_json',
  ],
  location_fixes: [
    'id',
    'session_id',
    'sequence',
    'callback_id',
    'batch_index',
    'source_timestamp',
    'receipt_timestamp',
    'latitude',
    'longitude',
    'gps_altitude',
    'vertical_accuracy',
    'horizontal_accuracy',
    'speed',
    'heading',
    'mocked',
  ],
  pressure_samples: [
    'id',
    'session_id',
    'sequence',
    'native_timestamp',
    'receipt_timestamp',
    'pressure',
    'relative_altitude',
  ],
  events: ['id', 'session_id', 'event_type', 'occurred_at', 'dedupe_key', 'payload_json'],
  exports: [
    'id',
    'session_id',
    'kind',
    'artifact_version',
    'path',
    'sha256',
    'byte_count',
    'eligible_fix_count',
    'created_at',
  ],
} as const);

export const EXPECTED_V2_TABLE_COLUMNS = Object.freeze({
  flights: [
    'id',
    'recording_session_id',
    'status',
    'started_at',
    'ended_at',
    'timezone_offset_minutes',
    'title',
    'site',
    'notes',
    'created_at',
    'updated_at',
  ],
  flight_metrics: [
    'flight_id',
    'algorithm_version',
    'duration_ms',
    'track_distance_metres',
    'min_gps_altitude',
    'max_gps_altitude',
    'max_ground_speed',
    'fix_count',
    'median_source_gap_ms',
    'p95_source_gap_ms',
    'max_source_gap_ms',
    'quality',
    'computed_at',
  ],
  pending_file_deletions: ['path', 'created_at'],
} as const);

export const EXPECTED_V3_TABLE_COLUMNS = Object.freeze({
  sessions: ['last_location_callback_at'],
} as const);

export const EXPECTED_V3_INDEX_NAMES = Object.freeze([
  'location_fixes_eligible_receipt_order',
] as const);

export const EXPECTED_V4_TABLE_COLUMNS = Object.freeze({
  sessions: ['manual_stop_at'],
  session_recovery_attempts: [
    'id',
    'session_id',
    'kind',
    'attempt_started_at',
    'deadline_at',
    'maximum_cached_fix_age_ms',
    'baseline_location_sequence',
    'completed_at',
    'outcome',
    'proving_fix_sequence',
    'proving_fix_source_at',
    'proving_fix_receipt_at',
  ],
} as const);

export const EXPECTED_V4_INDEX_NAMES = Object.freeze([
  'one_pending_session_recovery_attempt',
] as const);

export const CREATE_V1_SCHEMA_SQL = `
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
`;

export const CREATE_V2_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS flights (
    id TEXT PRIMARY KEY NOT NULL,
    recording_session_id TEXT UNIQUE NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('recording', 'processing', 'completed', 'partial')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    timezone_offset_minutes INTEGER,
    title TEXT,
    site TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS flights_started_at_desc ON flights (started_at DESC);

  CREATE TABLE IF NOT EXISTS flight_metrics (
    flight_id TEXT PRIMARY KEY NOT NULL REFERENCES flights(id) ON DELETE RESTRICT,
    algorithm_version INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    track_distance_metres REAL NOT NULL,
    min_gps_altitude REAL,
    max_gps_altitude REAL,
    max_ground_speed REAL,
    fix_count INTEGER NOT NULL,
    median_source_gap_ms INTEGER,
    p95_source_gap_ms INTEGER,
    max_source_gap_ms INTEGER,
    quality TEXT NOT NULL CHECK (quality IN ('healthy', 'gaps', 'partial', 'no_track')),
    computed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_file_deletions (
    path TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

export const MIGRATE_V3_SCHEMA_SQL = `
  ALTER TABLE sessions ADD COLUMN last_location_callback_at INTEGER;

  CREATE INDEX IF NOT EXISTS location_fixes_eligible_receipt_order
    ON location_fixes (session_id, receipt_timestamp DESC, sequence DESC)
    WHERE mocked = 0;

  WITH callback_times AS (
    SELECT session_id, MAX(callback_at) AS callback_at
    FROM (
      SELECT session_id, occurred_at AS callback_at
      FROM events
      WHERE event_type IN (
        'location_callback',
        'location_callback_duplicate',
        'location_task_error'
      )
      UNION ALL
      SELECT session_id, receipt_timestamp AS callback_at
      FROM location_fixes
    )
    GROUP BY session_id
  )
  UPDATE sessions
  SET last_location_callback_at = (
    SELECT callback_at
    FROM callback_times
    WHERE callback_times.session_id = sessions.id
  );
`;

export const MIGRATE_V4_SCHEMA_SQL = `
  ALTER TABLE sessions ADD COLUMN manual_stop_at INTEGER;

  CREATE TABLE session_recovery_attempts (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('automatic', 'manual')),
    attempt_started_at INTEGER NOT NULL,
    deadline_at INTEGER NOT NULL CHECK (deadline_at >= attempt_started_at),
    maximum_cached_fix_age_ms INTEGER NOT NULL CHECK (maximum_cached_fix_age_ms >= 0),
    baseline_location_sequence INTEGER NOT NULL CHECK (baseline_location_sequence >= 0),
    completed_at INTEGER,
    outcome TEXT CHECK (outcome IN ('succeeded', 'failed', 'stopped')),
    proving_fix_sequence INTEGER,
    proving_fix_source_at INTEGER,
    proving_fix_receipt_at INTEGER,
    FOREIGN KEY (session_id, proving_fix_sequence)
      REFERENCES location_fixes(session_id, sequence) ON DELETE RESTRICT,
    CHECK (
      (completed_at IS NULL AND outcome IS NULL) OR
      (completed_at IS NOT NULL AND outcome IS NOT NULL)
    ),
    CHECK (
      (proving_fix_sequence IS NULL AND proving_fix_source_at IS NULL AND proving_fix_receipt_at IS NULL) OR
      (proving_fix_sequence IS NOT NULL AND proving_fix_source_at IS NOT NULL AND proving_fix_receipt_at IS NOT NULL)
    )
  );

  CREATE UNIQUE INDEX one_pending_session_recovery_attempt
    ON session_recovery_attempts (session_id)
    WHERE completed_at IS NULL;
`;

export const BACKFILL_FLIGHTS_SQL = `
  INSERT OR IGNORE INTO flights (
    id, recording_session_id, status, started_at, ended_at,
    timezone_offset_minutes, title, site, notes, created_at, updated_at
  )
  SELECT
    id,
    id,
    CASE
      WHEN status = 'completed' AND completion_reason = 'stopped' THEN 'completed'
      WHEN status = 'completed' THEN 'partial'
      ELSE 'recording'
    END,
    started_at,
    ended_at,
    NULL,
    NULL,
    NULL,
    NULL,
    started_at,
    updated_at
  FROM sessions;
`;

export interface SchemaMigrationStep {
  version: number;
  statements: readonly string[];
}

export function getSchemaMigrationSteps(
  currentVersion: number,
  isNewDatabase: boolean,
): SchemaMigrationStep[] {
  if (currentVersion < 0 || currentVersion > LATEST_DATABASE_VERSION) {
    throw new Error(`Unsupported recorder database version ${currentVersion}.`);
  }

  const steps: SchemaMigrationStep[] = [];
  let version = currentVersion;
  if (isNewDatabase) {
    if (version !== 0) throw new Error('Only a version 0 recorder database can be new.');
    steps.push({ version: 1, statements: [CREATE_V1_SCHEMA_SQL] });
    version = 1;
  }
  if (version < 2) {
    steps.push({ version: 2, statements: [CREATE_V2_SCHEMA_SQL, BACKFILL_FLIGHTS_SQL] });
    version = 2;
  }
  if (version < 3) {
    steps.push({ version: 3, statements: [MIGRATE_V3_SCHEMA_SQL] });
    version = 3;
  }
  if (version < 4) {
    steps.push({ version: 4, statements: [MIGRATE_V4_SCHEMA_SQL] });
  }
  return steps;
}

export function flightStatusForSession(
  status: SessionRecord['status'],
  completionReason: CompletionReason | null,
): FlightStatus {
  if (status !== 'completed') return 'recording';
  return completionReason === 'stopped' ? 'completed' : 'partial';
}

const METADATA_LIMITS = Object.freeze({ title: 120, site: 120, notes: 4_000 });

export function normalizeFlightMetadataPatch(
  patch: FlightMetadataPatch,
): FlightMetadataPatch {
  const normalized: FlightMetadataPatch = {};
  for (const field of ['title', 'site', 'notes'] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field];
    if (value !== null && typeof value !== 'string') {
      throw new TypeError(`${field} must be a string or null.`);
    }
    const trimmed = value?.trim() ?? '';
    if (trimmed.length > METADATA_LIMITS[field]) {
      throw new Error(`${field} must be ${METADATA_LIMITS[field]} characters or fewer.`);
    }
    normalized[field] = trimmed.length > 0 ? trimmed : null;
  }
  return normalized;
}
