import type {
  CompletionReason,
  FlightMetadataPatch,
  FlightStatus,
  PilotProfilePatch,
  SessionRecord,
} from './types';

export const LATEST_DATABASE_VERSION = 6;

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

export const EXPECTED_V5_TABLE_COLUMNS = Object.freeze({
  pilot_profile: [
    'id',
    'pilot_name',
    'glider_type',
    'glider_id',
    'home_site',
    'updated_at',
    'pushed_updated_at',
  ],
  cloud_link: [
    'id',
    'user_id',
    'linked_at',
    'flights_cursor',
    'profile_cursor',
    'last_sync_at',
    'last_sync_error',
    'cloud_only_flight_count',
  ],
  flight_sync_state: [
    'flight_id',
    'pushed_updated_at',
    'remote_updated_at',
    'igc_sha256',
    'igc_object_path',
    'igc_pushed_at',
    'attempt_count',
    'next_attempt_at',
    'last_error',
  ],
  flight_deletions: [
    'flight_id',
    'recording_session_id',
    'deleted_at',
    'attempt_count',
    'next_attempt_at',
    'last_error',
  ],
} as const);

export const EXPECTED_V5_INDEX_NAMES = Object.freeze([
  'flight_sync_state_retry_order',
  'flight_deletions_retry_order',
] as const);

export const EXPECTED_V6_TABLE_COLUMNS = Object.freeze({
  pilot_profile: ['registration_id', 'home_site_source'],
  flights: ['takeoff_latitude', 'takeoff_longitude', 'site_source', 'site_resolved_at'],
  app_settings: [
    'id',
    'onboarding_state',
    'onboarding_completed_at',
    'disclaimer_ack_at',
    'updated_at',
  ],
} as const);

export const EXPECTED_V6_INDEX_NAMES = Object.freeze([
  'flights_pending_site_resolution',
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

export const MIGRATE_V5_SCHEMA_SQL = `
  -- Local pilot identity. Works fully offline and with no account; it is what fills
  -- the IGC HFPLTPILOTINCHARGE / HFGTYGLIDERTYPE / HFGIDGLIDERID headers. Single row,
  -- enforced by the primary-key CHECK rather than a partial index.
  CREATE TABLE pilot_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pilot_name TEXT,
    glider_type TEXT,
    glider_id TEXT,
    home_site TEXT,
    updated_at INTEGER NOT NULL,
    pushed_updated_at INTEGER
  );

  INSERT INTO pilot_profile (id, updated_at) VALUES (1, 0);

  -- Which cloud account this device's logbook is bound to. There is deliberately no
  -- owner column on flights: this phone holds one logbook, and signing out must never
  -- hide it. Scoping one_unfinished_session to an owner would also let a signed-out
  -- session (NULL, distinct under SQLite unique indexes) coexist with a signed-in one,
  -- silently permitting two concurrent recordings. That index stays global.
  CREATE TABLE cloud_link (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT,
    linked_at INTEGER,
    flights_cursor TEXT,
    profile_cursor TEXT,
    last_sync_at INTEGER,
    last_sync_error TEXT,
    cloud_only_flight_count INTEGER NOT NULL DEFAULT 0
  );

  INSERT INTO cloud_link (id) VALUES (1);

  -- Per-flight sync bookkeeping. A flight is DIRTY when it has no row here or when
  -- pushed_updated_at < flights.updated_at, so every existing write path already marks
  -- flights dirty for free and needs no edit. Nothing is backfilled here on purpose:
  -- "no row" already means "never pushed", which is exactly right for existing flights.
  CREATE TABLE flight_sync_state (
    flight_id TEXT PRIMARY KEY NOT NULL REFERENCES flights(id) ON DELETE RESTRICT,
    pushed_updated_at INTEGER,
    remote_updated_at TEXT,
    igc_sha256 TEXT,
    igc_object_path TEXT,
    igc_pushed_at INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE INDEX flight_sync_state_retry_order
    ON flight_sync_state (next_attempt_at, flight_id);

  -- Tombstones. deleteCompletedFlight hard-deletes locally; without these the next
  -- pull would resurrect the flight from the server. No foreign key to flights: the
  -- flight row is gone by definition.
  CREATE TABLE flight_deletions (
    flight_id TEXT PRIMARY KEY NOT NULL,
    recording_session_id TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE INDEX flight_deletions_retry_order
    ON flight_deletions (next_attempt_at, flight_id);
`;

export const MIGRATE_V6_SCHEMA_SQL = `
  -- The pilot's federation or licence number. Deliberately a new column rather than a
  -- reuse of glider_id: that one is the glider's registration and rides in
  -- HFGIDGLIDERID, while this is a property of the person and rides in
  -- HFCIDCOMPETITIONID. Conflating them would put a licence number in a glider field.
  ALTER TABLE pilot_profile ADD COLUMN registration_id TEXT;

  -- 'auto' lets home_site follow wherever the pilot actually launches most. 'manual'
  -- is a latch: once they set it themselves, derivation must never touch it again.
  -- Existing rows default to 'auto' because nobody has overridden anything yet.
  ALTER TABLE pilot_profile ADD COLUMN home_site_source TEXT NOT NULL DEFAULT 'auto'
    CHECK (home_site_source IN ('auto', 'manual'));

  -- home_site shipped in v5 as a hand-typed field, so anyone who filled it in has
  -- already overridden it. Without this they would be treated as never having chosen,
  -- and the first derivation pass would quietly replace their answer with a guess.
  UPDATE pilot_profile SET home_site_source = 'manual' WHERE id = 1 AND home_site IS NOT NULL;

  -- Denormalised from the first export-eligible fix when the flight is finalized, so
  -- naming a launch never needs a foreground GPS read. Local only: the cloud flights
  -- table is unchanged, and raw position evidence is deliberately never uploaded.
  -- Left NULL for flights recorded before v6; the resolver backfills them lazily
  -- rather than walking every location_fixes row inside the migration transaction.
  ALTER TABLE flights ADD COLUMN takeoff_latitude REAL;
  ALTER TABLE flights ADD COLUMN takeoff_longitude REAL;

  -- NULL means nobody has said anything about this flight's site, and is the resolver's
  -- work queue. 'gps' means the reverse geocoder named it. 'manual' means the pilot
  -- typed it, and is what stops the geocoder ever overwriting their words. 'none' is
  -- the terminal answer for a launch that genuinely has no name — mid-ocean, a blank
  -- map region, a device with no Geocoder — without which those flights would be
  -- retried on every pass for the life of the install.
  ALTER TABLE flights ADD COLUMN site_source TEXT
    CHECK (site_source IS NULL OR site_source IN ('gps', 'manual', 'none'));
  ALTER TABLE flights ADD COLUMN site_resolved_at INTEGER;

  -- Every existing flight already has a site the pilot typed, or none at all. Marking
  -- the typed ones 'manual' now is what makes the resolver's "never overwrite" rule
  -- true retroactively, instead of only for flights recorded from here on.
  UPDATE flights SET site_source = 'manual' WHERE site IS NOT NULL;

  -- Drives the resolver's work queue. The takeoff-coordinate clause matters: every
  -- pre-v6 flight has a NULL site_source, and without it the whole legacy logbook would
  -- sit in this index forever as work that can never be done.
  CREATE INDEX flights_pending_site_resolution
    ON flights (started_at DESC)
    WHERE site_source IS NULL AND takeoff_latitude IS NOT NULL;

  -- Device-scoped app state that is not the pilot's data and never syncs. Single row,
  -- same CHECK-based shape as pilot_profile and cloud_link.
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    onboarding_state TEXT NOT NULL DEFAULT 'pending'
      CHECK (onboarding_state IN ('pending', 'done', 'skipped')),
    onboarding_completed_at INTEGER,
    disclaimer_ack_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  INSERT INTO app_settings (id, updated_at) VALUES (1, 0);
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
    version = 4;
  }
  if (version < 5) {
    steps.push({ version: 5, statements: [MIGRATE_V5_SCHEMA_SQL] });
    version = 5;
  }
  if (version < 6) {
    steps.push({ version: 6, statements: [MIGRATE_V6_SCHEMA_SQL] });
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

// IGC H-records are single-line ASCII, so the pilot fields stay short by design.
const PILOT_PROFILE_LIMITS = Object.freeze({
  pilotName: 60,
  gliderType: 60,
  gliderId: 30,
  registrationId: 30,
  homeSite: 120,
});

export function normalizePilotProfilePatch(patch: PilotProfilePatch): PilotProfilePatch {
  const normalized: PilotProfilePatch = {};

  // Handled before the text fields and deliberately not trimmed or length-checked: it is
  // an enum backed by a column CHECK, so an unknown value has to fail here rather than
  // blow up inside the write transaction.
  if (Object.prototype.hasOwnProperty.call(patch, 'homeSiteSource')) {
    const source = patch.homeSiteSource;
    if (source !== 'auto' && source !== 'manual') {
      throw new TypeError(`homeSiteSource must be 'auto' or 'manual', got ${String(source)}.`);
    }
    normalized.homeSiteSource = source;
  }

  for (const field of [
    'pilotName',
    'gliderType',
    'gliderId',
    'registrationId',
    'homeSite',
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field];
    if (value !== null && typeof value !== 'string') {
      throw new TypeError(`${field} must be a string or null.`);
    }
    const trimmed = value?.trim() ?? '';
    if (trimmed.length > PILOT_PROFILE_LIMITS[field]) {
      throw new Error(`${field} must be ${PILOT_PROFILE_LIMITS[field]} characters or fewer.`);
    }
    normalized[field] = trimmed.length > 0 ? trimmed : null;
  }
  return normalized;
}
