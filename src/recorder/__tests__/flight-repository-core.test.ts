import {
  EXPECTED_V3_INDEX_NAMES,
  EXPECTED_V3_TABLE_COLUMNS,
  EXPECTED_V4_INDEX_NAMES,
  EXPECTED_V4_TABLE_COLUMNS,
  LATEST_DATABASE_VERSION,
  MIGRATE_V3_SCHEMA_SQL,
  MIGRATE_V4_SCHEMA_SQL,
  flightStatusForSession,
  getSchemaMigrationSteps,
  normalizeFlightMetadataPatch,
} from '../flight-repository-core';

describe('recorder database migration plan', () => {
  it('runs each schema step once for fresh, v1, and v2 databases', () => {
    expect(LATEST_DATABASE_VERSION).toBe(4);
    expect(getSchemaMigrationSteps(0, true).map((step) => step.version)).toEqual([1, 2, 3, 4]);
    expect(getSchemaMigrationSteps(1, false).map((step) => step.version)).toEqual([2, 3, 4]);
    expect(getSchemaMigrationSteps(2, false).map((step) => step.version)).toEqual([3, 4]);
    expect(getSchemaMigrationSteps(3, false).map((step) => step.version)).toEqual([4]);
    expect(getSchemaMigrationSteps(4, false)).toEqual([]);
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

describe('legacy flight status mapping', () => {
  it('maps stopped, partial, and unfinished sessions deterministically', () => {
    expect(flightStatusForSession('completed', 'stopped')).toBe('completed');
    expect(flightStatusForSession('completed', 'interrupted_finalized')).toBe('partial');
    expect(flightStatusForSession('completed', null)).toBe('partial');
    expect(flightStatusForSession('recording', null)).toBe('recording');
    expect(flightStatusForSession('interrupted', null)).toBe('recording');
  });
});
