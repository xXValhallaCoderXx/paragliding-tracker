import {
  CREATE_V1_SCHEMA_SQL,
  CREATE_V2_SCHEMA_SQL,
  EXPECTED_V3_INDEX_NAMES,
  EXPECTED_V3_TABLE_COLUMNS,
  EXPECTED_V4_INDEX_NAMES,
  EXPECTED_V4_TABLE_COLUMNS,
  EXPECTED_V5_INDEX_NAMES,
  EXPECTED_V5_TABLE_COLUMNS,
  EXPECTED_V6_INDEX_NAMES,
  EXPECTED_V6_TABLE_COLUMNS,
  MIGRATE_V6_SCHEMA_SQL,
  LATEST_DATABASE_VERSION,
  MIGRATE_V3_SCHEMA_SQL,
  MIGRATE_V4_SCHEMA_SQL,
  MIGRATE_V5_SCHEMA_SQL,
  flightStatusForSession,
  getSchemaMigrationSteps,
  normalizeFlightMetadataPatch,
  normalizePilotProfilePatch,
} from '../flight-repository-core';

describe('pilot profile patch normalization', () => {
  it('validates homeSiteSource rather than trimming it', () => {
    // It is an enum backed by a column CHECK. Trimming and length-limiting it would be
    // meaningless, and a bad value has to fail before the write transaction, not inside it.
    expect(normalizePilotProfilePatch({ homeSiteSource: 'manual' })).toEqual({
      homeSiteSource: 'manual',
    });
    expect(() =>
      normalizePilotProfilePatch({ homeSiteSource: 'AUTO' as never }),
    ).toThrow(/homeSiteSource/);
  });

  it('carries registrationId through with the text fields', () => {
    // Guards the silent-drop failure: the field is normalized here, but it also has to be
    // in PILOT_PROFILE_COLUMNS or the UPDATE never writes it.
    expect(normalizePilotProfilePatch({ registrationId: '  appi-123  ' })).toEqual({
      registrationId: 'appi-123',
    });
    expect(normalizePilotProfilePatch({ registrationId: '   ' })).toEqual({
      registrationId: null,
    });
  });

  it('leaves untouched fields out entirely, so a partial patch stays partial', () => {
    expect(normalizePilotProfilePatch({ pilotName: 'Renate' })).toEqual({
      pilotName: 'Renate',
    });
  });
});

describe('recorder database migration plan', () => {
  it('runs each schema step once for fresh, v1, and v2 databases', () => {
    expect(LATEST_DATABASE_VERSION).toBe(6);
    expect(getSchemaMigrationSteps(0, true).map((step) => step.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(getSchemaMigrationSteps(1, false).map((step) => step.version)).toEqual([2, 3, 4, 5, 6]);
    expect(getSchemaMigrationSteps(2, false).map((step) => step.version)).toEqual([3, 4, 5, 6]);
    expect(getSchemaMigrationSteps(3, false).map((step) => step.version)).toEqual([4, 5, 6]);
    expect(getSchemaMigrationSteps(4, false).map((step) => step.version)).toEqual([5, 6]);
    expect(getSchemaMigrationSteps(5, false).map((step) => step.version)).toEqual([6]);
    expect(getSchemaMigrationSteps(6, false)).toEqual([]);
  });

  it('adds onboarding state and site provenance in v6', () => {
    expect(EXPECTED_V6_INDEX_NAMES).toEqual(['flights_pending_site_resolution']);
    expect(Object.keys(EXPECTED_V6_TABLE_COLUMNS)).toEqual([
      'pilot_profile',
      'flights',
      'app_settings',
    ]);
    // registration_id is a new column, not a rename: glider_id still carries the
    // glider's own registration into HFGIDGLIDERID.
    expect(EXPECTED_V6_TABLE_COLUMNS.pilot_profile).toContain('registration_id');
    expect(EXPECTED_V5_TABLE_COLUMNS.pilot_profile).toContain('glider_id');
  });

  it('marks every pre-v6 flight that already has a site as manually named', () => {
    // Without this the reverse geocoder would be free to overwrite sites the pilot
    // typed before v6, because those rows have no provenance recorded.
    expect(MIGRATE_V6_SCHEMA_SQL).toContain(
      "UPDATE flights SET site_source = 'manual' WHERE site IS NOT NULL",
    );
  });

  it('does not walk location_fixes inside the v6 transaction', () => {
    // The whole migration runs in one exclusive transaction and a real device holds
    // hundreds of thousands of fix rows. Takeoff coordinates are backfilled lazily.
    // Comments are stripped first: the SQL explains that decision in prose.
    const statements = MIGRATE_V6_SCHEMA_SQL.replace(/--[^\n]*/g, '');
    expect(statements).not.toContain('location_fixes');
  });

  it('adds cloud backup bookkeeping in v5 without touching the recorder tables', () => {
    expect(EXPECTED_V5_INDEX_NAMES).toEqual([
      'flight_sync_state_retry_order',
      'flight_deletions_retry_order',
    ]);
    expect(Object.keys(EXPECTED_V5_TABLE_COLUMNS)).toEqual([
      'pilot_profile',
      'cloud_link',
      'flight_sync_state',
      'flight_deletions',
    ]);

    // Both singletons are seeded by the migration so every later read can assume a row.
    expect(MIGRATE_V5_SCHEMA_SQL).toContain('INSERT INTO pilot_profile (id, updated_at) VALUES (1, 0)');
    expect(MIGRATE_V5_SCHEMA_SQL).toContain('INSERT INTO cloud_link (id) VALUES (1)');
    expect(MIGRATE_V5_SCHEMA_SQL).toContain('CHECK (id = 1)');

    // Statements only: the comments in this migration deliberately name the invariants
    // they protect, so structural assertions have to ignore them.
    const ddl = MIGRATE_V5_SCHEMA_SQL.replace(/--[^\n]*/g, '');

    // The single-open-session guard is a device invariant, not a per-account one.
    // Scoping it to an owner would let a signed-out session coexist with a signed-in
    // one, silently permitting two concurrent recordings. v5 must not touch it.
    expect(ddl).not.toContain('one_unfinished_session');

    // v5 is additive only: no ALTER, and no redefinition of any table the recorder
    // writes during capture.
    expect(ddl).not.toContain('ALTER TABLE');
    expect(ddl).not.toContain('DROP');
    for (const table of ['sessions', 'location_fixes', 'pressure_samples', 'events', 'exports']) {
      expect(ddl).not.toContain(`CREATE TABLE ${table}`);
    }

    // No column is added to flights, so FlightRecord and every existing query are untouched.
    expect(EXPECTED_V5_TABLE_COLUMNS).not.toHaveProperty('flights');

    // Dirtiness is derived from flights.updated_at, so nothing is backfilled here:
    // "no flight_sync_state row" already means "never pushed". A pure-DDL step also
    // keeps the strict row-count and integrity gauntlet in migrateDatabase trivial.
    expect(ddl).not.toContain('INSERT INTO flight_sync_state');
    expect(ddl).not.toContain('SELECT');

    // The v1 and v2 definitions stay frozen; v5 only appends.
    expect(CREATE_V1_SCHEMA_SQL).not.toContain('pilot_profile');
    expect(CREATE_V2_SCHEMA_SQL).not.toContain('flight_sync_state');
  });

  it('adds the sticky manual-stop boundary and durable recovery-attempt ledger in v4', () => {
    expect(EXPECTED_V4_TABLE_COLUMNS.sessions).toEqual(['manual_stop_at']);
    expect(EXPECTED_V4_TABLE_COLUMNS.session_recovery_attempts).toContain(
      'baseline_location_sequence',
    );
    expect(EXPECTED_V4_INDEX_NAMES).toEqual(['one_pending_session_recovery_attempt']);
    expect(MIGRATE_V4_SCHEMA_SQL).toContain('ALTER TABLE sessions ADD COLUMN manual_stop_at');
    expect(MIGRATE_V4_SCHEMA_SQL).toContain('CREATE TABLE session_recovery_attempts');
    expect(MIGRATE_V4_SCHEMA_SQL).toContain('maximum_cached_fix_age_ms');
    expect(MIGRATE_V4_SCHEMA_SQL).toContain('one_pending_session_recovery_attempt');
  });

  it('adds and backfills the v3 callback heartbeat without changing the v1 definition', () => {
    expect(EXPECTED_V3_TABLE_COLUMNS.sessions).toEqual(['last_location_callback_at']);
    expect(EXPECTED_V3_INDEX_NAMES).toEqual(['location_fixes_eligible_receipt_order']);
    expect(MIGRATE_V3_SCHEMA_SQL).toContain(
      'ALTER TABLE sessions ADD COLUMN last_location_callback_at INTEGER',
    );
    expect(MIGRATE_V3_SCHEMA_SQL).toContain('location_fixes_eligible_receipt_order');
    expect(MIGRATE_V3_SCHEMA_SQL).toContain("'location_callback_duplicate'");
    expect(MIGRATE_V3_SCHEMA_SQL).toContain("'location_task_error'");
    expect(MIGRATE_V3_SCHEMA_SQL).toContain('receipt_timestamp AS callback_at');
    expect(MIGRATE_V3_SCHEMA_SQL).toContain('UPDATE sessions');
  });

  it('rejects an impossible fresh-database version', () => {
    expect(() => getSchemaMigrationSteps(2, true)).toThrow(
      'Only a version 0 recorder database can be new.',
    );
  });
});

describe('flight repository metadata', () => {
  it('trims values, converts blank values to null, and preserves omitted fields', () => {
    expect(
      normalizeFlightMetadataPatch({ title: '  Evening ridge  ', site: '   ', notes: null }),
    ).toEqual({ title: 'Evening ridge', site: null, notes: null });
    expect(normalizeFlightMetadataPatch({ site: 'Bukit Kutu' })).toEqual({ site: 'Bukit Kutu' });
  });

  it('enforces the persisted metadata limits after trimming', () => {
    expect(() => normalizeFlightMetadataPatch({ title: 'x'.repeat(121) })).toThrow(
      'title must be 120 characters or fewer.',
    );
    expect(() => normalizeFlightMetadataPatch({ site: 'x'.repeat(121) })).toThrow(
      'site must be 120 characters or fewer.',
    );
    expect(() => normalizeFlightMetadataPatch({ notes: 'x'.repeat(4_001) })).toThrow(
      'notes must be 4000 characters or fewer.',
    );
  });
});

describe('pilot profile metadata', () => {
  it('trims values, converts blank values to null, and preserves omitted fields', () => {
    expect(normalizePilotProfilePatch({ pilotName: '  Renate  ', gliderId: '   ' })).toEqual({
      pilotName: 'Renate',
      gliderId: null,
    });
    expect(normalizePilotProfilePatch({})).toEqual({});
    expect(normalizePilotProfilePatch({ homeSite: null })).toEqual({ homeSite: null });
  });

  it('enforces the IGC-friendly length limits after trimming', () => {
    expect(() => normalizePilotProfilePatch({ pilotName: 'x'.repeat(61) })).toThrow(
      /pilotName must be 60 characters or fewer/,
    );
    expect(normalizePilotProfilePatch({ pilotName: `  ${'x'.repeat(60)}  ` })).toEqual({
      pilotName: 'x'.repeat(60),
    });
    expect(() => normalizePilotProfilePatch({ gliderId: 'y'.repeat(31) })).toThrow(
      /gliderId must be 30 characters or fewer/,
    );
    expect(() =>
      normalizePilotProfilePatch({ gliderType: 42 as unknown as string }),
    ).toThrow(TypeError);
  });
});

describe('legacy flight status mapping', () => {
  it('maps stopped, partial, and unfinished sessions deterministically', () => {
    expect(flightStatusForSession('completed', 'stopped')).toBe('completed');
    expect(flightStatusForSession('completed', 'interrupted_finalized')).toBe('partial');
    expect(flightStatusForSession('completed', null)).toBe('partial');
    expect(flightStatusForSession('recording', null)).toBe('recording');
    expect(flightStatusForSession('interrupted', null)).toBe('recording');
  });
});
