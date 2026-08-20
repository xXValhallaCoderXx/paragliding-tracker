import * as SQLite from 'expo-sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMPLETE_SESSION_SQL,
  PENDING_SESSION_STOP_SQL,
  SESSION_SNAPSHOT_METRICS_SQL,
  mapSessionSnapshotMetrics,
  migrateDatabase,
} from '../database.native';
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
} from '../flight-repository-core';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({ closeAsync: jest.fn(async () => undefined) })),
  backupDatabaseAsync: jest.fn(async () => undefined),
  deleteDatabaseAsync: jest.fn(async () => undefined),
}));

class StructurallyValidDatabase {
  userVersion: number;
  readonly trace: string[] = [];
  readonly indexes = new Set<string>();
  readonly tables = new Map<string, Set<string>>([
    ...Object.entries(EXPECTED_V1_TABLE_COLUMNS).map(
      ([table, columns]) => [table, new Set<string>(columns)] as const,
    ),
    ...Object.entries(EXPECTED_V2_TABLE_COLUMNS).map(
      ([table, columns]) => [table, new Set<string>(columns)] as const,
    ),
  ]);

  constructor(userVersion: 2 | 3 | 4 | 5 | 6 | 7 = 2) {
    this.userVersion = userVersion;
    if (userVersion >= 3) {
      this.applySchema(EXPECTED_V3_TABLE_COLUMNS, EXPECTED_V3_INDEX_NAMES);
    }
    if (userVersion >= 4) {
      this.applySchema(EXPECTED_V4_TABLE_COLUMNS, EXPECTED_V4_INDEX_NAMES);
    }
    if (userVersion >= 5) {
      this.applySchema(EXPECTED_V5_TABLE_COLUMNS, EXPECTED_V5_INDEX_NAMES);
    }
    if (userVersion >= 6) {
      this.applySchema(EXPECTED_V6_TABLE_COLUMNS, EXPECTED_V6_INDEX_NAMES);
    }
    if (userVersion >= 7) {
      this.applySchema(EXPECTED_V7_TABLE_COLUMNS, EXPECTED_V7_INDEX_NAMES);
    }
  }

  applySchema(
    columnsByTable: Readonly<Record<string, readonly string[]>>,
    indexNames: readonly string[],
  ): void {
    for (const [table, columns] of Object.entries(columnsByTable)) {
      const target = this.tables.get(table) ?? new Set<string>();
      columns.forEach((column) => target.add(column));
      this.tables.set(table, target);
    }
    indexNames.forEach((name) => this.indexes.add(name));
  }

  async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
    if (source === 'PRAGMA user_version') return { user_version: this.userVersion } as T;
    if (source.includes("type = 'table' AND name = ?")) {
      const name = String(params[0]);
      return (this.tables.has(name) ? { name } : null) as T | null;
    }
    if (source.includes("type = 'index' AND name = ?")) {
      const name = String(params[0]);
      return (this.indexes.has(name) ? { name } : null) as T | null;
    }
    if (source.includes('LEFT JOIN flights')) return { count: 0 } as T;
    const countTable = source.match(/SELECT COUNT\(\*\) AS count FROM "([^"]+)"/)?.[1];
    if (countTable) return { count: countTable === 'sessions' ? 1 : 0 } as T;
    throw new Error(`Unexpected getFirstAsync SQL: ${source}`);
  }

  async getAllAsync<T>(source: string): Promise<T[]> {
    if (source.includes("name NOT LIKE 'sqlite_%'")) {
      return [...this.tables.keys()].map((name) => ({ name }) as T);
    }
    const table = source.match(/PRAGMA table_info\("([^"]+)"\)/)?.[1];
    if (table) {
      if (table === 'sessions') {
        const version = this.tables.get(table)?.has('manual_stop_at')
          ? 'v4'
          : this.tables.get(table)?.has('last_location_callback_at')
            ? 'v3'
            : 'v2';
        this.trace.push(
          `inspect:sessions:${version}`,
        );
      }
      return [...(this.tables.get(table) ?? [])].map((name) => ({ name }) as T);
    }
    if (source === 'PRAGMA quick_check') return [{ quick_check: 'ok' } as T];
    if (source === 'PRAGMA foreign_key_check') return [];
    throw new Error(`Unexpected getAllAsync SQL: ${source}`);
  }

  async execAsync(source: string): Promise<void> {
    if (source.includes('ALTER TABLE sessions ADD COLUMN last_location_callback_at')) {
      this.trace.push('migrate:v3');
      this.tables.get('sessions')?.add('last_location_callback_at');
      this.indexes.add('location_fixes_eligible_receipt_order');
      return;
    }
    if (source.includes('ALTER TABLE sessions ADD COLUMN manual_stop_at')) {
      this.trace.push('migrate:v4');
      this.applySchema(EXPECTED_V4_TABLE_COLUMNS, EXPECTED_V4_INDEX_NAMES);
      return;
    }
    if (source.includes('CREATE TABLE pilot_profile')) {
      this.trace.push('migrate:v5');
      this.applySchema(EXPECTED_V5_TABLE_COLUMNS, EXPECTED_V5_INDEX_NAMES);
      return;
    }
    if (source.includes('CREATE TABLE app_settings')) {
      this.trace.push('migrate:v6');
      this.applySchema(EXPECTED_V6_TABLE_COLUMNS, EXPECTED_V6_INDEX_NAMES);
      return;
    }
    if (source.includes('CREATE TABLE flight_tracks')) {
      this.trace.push('migrate:v7');
      this.applySchema(EXPECTED_V7_TABLE_COLUMNS, EXPECTED_V7_INDEX_NAMES);
      return;
    }
    const version = source.match(/PRAGMA user_version = (\d+)/)?.[1];
    if (version) {
      this.userVersion = Number(version);
      this.trace.push(`stamp:v${version}`);
      return;
    }
    throw new Error(`Unexpected execAsync SQL: ${source}`);
  }

  async withExclusiveTransactionAsync(
    task: (transaction: StructurallyValidDatabase) => Promise<void>,
  ): Promise<void> {
    this.trace.push('transaction:begin');
    await task(this);
    this.trace.push('transaction:commit');
  }
}

describe('native database migration ordering', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts a structurally valid v2 database and runs every later step in order', async () => {
    const database = new StructurallyValidDatabase(2);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(LATEST_DATABASE_VERSION);
    expect(database.tables.get('sessions')).toContain('last_location_callback_at');
    expect(database.tables.get('sessions')).toContain('manual_stop_at');
    expect(database.tables.has('session_recovery_attempts')).toBe(true);
    expect(database.tables.has('flight_sync_state')).toBe(true);
    expect(database.indexes).toContain('location_fixes_eligible_receipt_order');
    expect(database.indexes).toContain('one_pending_session_recovery_attempt');
    expect(database.indexes).toContain('flight_sync_state_retry_order');
    expect(database.trace.indexOf('migrate:v3')).toBeGreaterThan(
      database.trace.indexOf('inspect:sessions:v2'),
    );
    expect(database.trace.indexOf('migrate:v4')).toBeGreaterThan(
      database.trace.indexOf('migrate:v3'),
    );
    expect(database.trace.indexOf('migrate:v5')).toBeGreaterThan(
      database.trace.indexOf('migrate:v4'),
    );
    expect(database.trace.indexOf('migrate:v6')).toBeGreaterThan(
      database.trace.indexOf('migrate:v5'),
    );
    expect(database.tables.has('app_settings')).toBe(true);
    expect(database.tables.get('flights')).toContain('takeoff_latitude');
    expect(database.trace.slice(database.trace.indexOf('migrate:v4') + 1)).toContain(
      'inspect:sessions:v4',
    );
    expect(SQLite.backupDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('accepts a structurally valid v3 database and adds v4 onward only after validating v3', async () => {
    const database = new StructurallyValidDatabase(3);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(LATEST_DATABASE_VERSION);
    expect(database.trace).not.toContain('migrate:v3');
    expect(database.trace.indexOf('migrate:v4')).toBeGreaterThan(
      database.trace.indexOf('inspect:sessions:v3'),
    );
    expect(database.tables.get('sessions')).toContain('manual_stop_at');
    expect(database.tables.has('session_recovery_attempts')).toBe(true);
    expect(SQLite.backupDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('accepts a structurally valid v4 database and adds v5 onward only after validating v4', async () => {
    const database = new StructurallyValidDatabase(4);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(LATEST_DATABASE_VERSION);
    expect(database.trace).not.toContain('migrate:v3');
    expect(database.trace).not.toContain('migrate:v4');
    // v4's own validation used to live only inside the "already latest" branch. It has
    // to run before the v5 step, or a corrupt v4 database would migrate unchecked.
    expect(database.trace.indexOf('migrate:v5')).toBeGreaterThan(
      database.trace.indexOf('inspect:sessions:v4'),
    );
    expect(database.tables.has('pilot_profile')).toBe(true);
    expect(database.tables.has('cloud_link')).toBe(true);
    expect(database.tables.has('flight_deletions')).toBe(true);
    expect(database.indexes).toContain('flight_deletions_retry_order');
    expect(SQLite.backupDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('accepts a structurally valid v5 database and adds v6 then v7', async () => {
    const database = new StructurallyValidDatabase(5);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(7);
    expect(database.trace.filter((entry) => entry.startsWith('migrate:'))).toEqual([
      'migrate:v6',
      'migrate:v7',
    ]);
    expect(database.tables.has('app_settings')).toBe(true);
    expect(database.tables.get('pilot_profile')).toContain('registration_id');
    expect(database.tables.get('flights')).toContain('takeoff_latitude');
    expect(SQLite.backupDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('migrates a v6 database to v7 rather than demanding a wipe', async () => {
    // The reason v7 exists at all. Adding flight_tracks to the v6 expectations instead
    // would make an already-v6 device fail validation in the early-return branch, and
    // openDatabase re-throws forever — a dead app, not a degraded logbook.
    const database = new StructurallyValidDatabase(6);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(7);
    expect(database.trace.filter((entry) => entry.startsWith('migrate:'))).toEqual(['migrate:v7']);
    expect(database.tables.has('flight_tracks')).toBe(true);
  });

  it('rejects a v7 database whose v7 schema is incomplete', async () => {
    // The regression guard for the validation ladder itself. Every positive test above
    // passes whether or not migrateDatabase ever validates V7, because the fake applies
    // the v7 schema to itself when it sees the migration SQL. Only removing a table the
    // fake already has can prove the check runs.
    const database = new StructurallyValidDatabase(7);
    database.tables.delete('flight_tracks');

    await expect(
      migrateDatabase(database as unknown as SQLite.SQLiteDatabase),
    ).rejects.toThrow(/flight_tracks/);
  });

  it('rejects a v6 database whose v6 schema is incomplete, before running v7', async () => {
    // v6 used to be validated only in the "already latest" branch. Bumping to v7 moved that
    // branch past it, exactly as bumping to v6 once moved it past v5 — so v6 gets its own
    // block, and this is what proves the block is there.
    const database = new StructurallyValidDatabase(6);
    database.tables.delete('app_settings');

    await expect(
      migrateDatabase(database as unknown as SQLite.SQLiteDatabase),
    ).rejects.toThrow(/app_settings/);
    expect(database.trace).not.toContain('migrate:v7');
  });

  it('rejects a v5 database whose v5 schema is incomplete, before running v6', async () => {
    // v5 used to be validated only in the "already latest" branch. Bumping to v6 moved
    // that branch past it, which would have let a corrupt v5 database migrate unchecked.
    const database = new StructurallyValidDatabase(5);
    database.tables.delete('flight_sync_state');

    await expect(
      migrateDatabase(database as unknown as SQLite.SQLiteDatabase),
    ).rejects.toThrow(/flight_sync_state/);
    expect(database.trace).not.toContain('migrate:v6');
  });

  it('accepts a current v7 database without migrating or taking a backup', async () => {
    const database = new StructurallyValidDatabase(7);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(7);
    expect(database.trace).not.toContain('transaction:begin');
    expect(database.trace.filter((entry) => entry.startsWith('migrate:'))).toEqual([]);
    expect(SQLite.backupDatabaseAsync).not.toHaveBeenCalled();
    expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
  });
});

describe('session snapshot evidence query', () => {
  it('selects and maps callback and eligible-fix evidence in one statement', () => {
    expect(SESSION_SNAPSHOT_METRICS_SQL).toContain('FROM sessions s');
    expect(SESSION_SNAPSHOT_METRICS_SQL).toContain('s.last_location_callback_at');
    expect(SESSION_SNAPSHOT_METRICS_SQL).toContain(
      'eligible.source_timestamp AS latest_eligible_fix_source_at',
    );
    expect(SESSION_SNAPSHOT_METRICS_SQL).toContain(
      'eligible.receipt_timestamp AS latest_eligible_fix_receipt_at',
    );

    expect(
      mapSessionSnapshotMetrics({
        fix_count: 2,
        pressure_count: 1,
        gps_altitude: 123,
        speed: 8,
        horizontal_accuracy: 4,
        pressure: 1000,
        task_error_json: null,
        task_error_at: null,
        last_location_callback_at: 12_345,
        latest_eligible_fix_source_at: 12_300,
        latest_eligible_fix_receipt_at: 12_345,
      }),
    ).toMatchObject({
      lastLocationCallbackAt: 12_345,
      latestEligibleFixSourceAt: 12_300,
      latestEligibleFixReceiptAt: 12_345,
    });
  });
});

describe('sticky manual Stop SQL', () => {
  it('discovers only unfinished stop intents and retains the audit boundary at completion', () => {
    expect(PENDING_SESSION_STOP_SQL).toContain("status = 'interrupted'");
    expect(PENDING_SESSION_STOP_SQL).toContain('manual_stop_at IS NOT NULL');
    expect(COMPLETE_SESSION_SQL).toContain("status = 'completed'");
    expect(COMPLETE_SESSION_SQL).not.toContain('manual_stop_at = NULL');
  });

  it('tombstones and clears flight sync state before the flight row it references', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/recorder/database.native.ts'),
      'utf8',
    );
    // flight_sync_state holds a RESTRICT foreign key to flights, and the tombstone
    // needs the flight's session id, so both must happen before the flight row goes.
    const tombstone = source.indexOf('INSERT OR IGNORE INTO flight_deletions');
    const syncState = source.indexOf('DELETE FROM flight_sync_state WHERE flight_id = ?');
    const flights = source.indexOf("DELETE FROM flights WHERE id = ?");

    expect(tombstone).toBeGreaterThanOrEqual(0);
    expect(syncState).toBeGreaterThan(tombstone);
    expect(flights).toBeGreaterThan(syncState);
  });

  it('deletes recovery proof rows before their referenced location fixes', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/recorder/database.native.ts'),
      'utf8',
    );
    const attempts = source.indexOf(
      "DELETE FROM session_recovery_attempts WHERE session_id = ?",
    );
    const fixes = source.indexOf("DELETE FROM location_fixes WHERE session_id = ?");

    expect(attempts).toBeGreaterThanOrEqual(0);
    expect(fixes).toBeGreaterThan(attempts);
  });
});
