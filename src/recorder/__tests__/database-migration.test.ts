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

  constructor(userVersion: 2 | 3 = 2) {
    this.userVersion = userVersion;
    if (userVersion >= 3) {
      for (const [table, columns] of Object.entries(EXPECTED_V3_TABLE_COLUMNS)) {
        const target = this.tables.get(table) ?? new Set<string>();
        columns.forEach((column) => target.add(column));
        this.tables.set(table, target);
      }
      EXPECTED_V3_INDEX_NAMES.forEach((name) => this.indexes.add(name));
    }
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
      for (const [table, columns] of Object.entries(EXPECTED_V4_TABLE_COLUMNS)) {
        const target = this.tables.get(table) ?? new Set<string>();
        columns.forEach((column) => target.add(column));
        this.tables.set(table, target);
      }
      EXPECTED_V4_INDEX_NAMES.forEach((name) => this.indexes.add(name));
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

  it('accepts a structurally valid v2 database and runs v3 then v4 before validating them', async () => {
    const database = new StructurallyValidDatabase(2);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(4);
    expect(database.tables.get('sessions')).toContain('last_location_callback_at');
    expect(database.tables.get('sessions')).toContain('manual_stop_at');
    expect(database.tables.has('session_recovery_attempts')).toBe(true);
    expect(database.indexes).toContain('location_fixes_eligible_receipt_order');
    expect(database.indexes).toContain('one_pending_session_recovery_attempt');
    expect(database.trace.indexOf('migrate:v3')).toBeGreaterThan(
      database.trace.indexOf('inspect:sessions:v2'),
    );
    expect(database.trace.indexOf('migrate:v4')).toBeGreaterThan(
      database.trace.indexOf('migrate:v3'),
    );
    expect(database.trace.slice(database.trace.indexOf('migrate:v4') + 1)).toContain(
      'inspect:sessions:v4',
    );
    expect(SQLite.backupDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('accepts a structurally valid v3 database and adds v4 only after validating v3', async () => {
    const database = new StructurallyValidDatabase(3);

    await migrateDatabase(database as unknown as SQLite.SQLiteDatabase);

    expect(database.userVersion).toBe(4);
    expect(database.trace).not.toContain('migrate:v3');
    expect(database.trace.indexOf('migrate:v4')).toBeGreaterThan(
      database.trace.indexOf('inspect:sessions:v3'),
    );
    expect(database.tables.get('sessions')).toContain('manual_stop_at');
    expect(database.tables.has('session_recovery_attempts')).toBe(true);
    expect(SQLite.backupDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
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
